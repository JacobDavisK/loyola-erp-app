import { createHmac, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar standing in for the browser during the single sign-on round trip.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

import { GET as summaryGET } from "@/app/api/v1/me/summary/route";
import { GET as studentsGET } from "@/app/api/v1/students/route";
import { POST as mcpPOST } from "@/app/api/mcp/route";
import { db } from "@/server/db";
import { signRs256 } from "@/server/security/jwt";
import { createToken, revokeToken } from "@/server/services/api-tokens";
import { audit } from "@/server/services/audit";
import { createFeed, feedByToken } from "@/server/services/calendar";
import { SSO_COOKIE, clearSsoCache, finishSso, saveProvider, startSso } from "@/server/services/sso";
import { deliverWebhooks, saveEndpoint, signPayload } from "@/server/services/webhooks";
import { as } from "./helpers";

const call = (handler: (req: NextRequest, route: { params: Promise<Record<string, string>> }) => Promise<Response>, path: string, token?: string) =>
  handler(new NextRequest(`http://localhost${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({}) });

describe("API tokens, REST API and the AI connector", () => {
  it("acts as the owner, only within the token's scopes", async () => {
    const student = await as("student");
    const { id, token } = await createToken(student, { name: "My assistant", scopes: ["self:read", "students:read"], expiresInDays: 30 });
    expect(token).toMatch(/^ecp_/);
    expect((await db.apiToken.findUniqueOrThrow({ where: { id } })).tokenHash).not.toContain(token);

    expect((await call(summaryGET, "/api/v1/me/summary")).status).toBe(401);
    const res = await call(summaryGET, "/api/v1/me/summary", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { student: { studentNo: string }; attendance: unknown } };
    const own = await db.student.findFirstOrThrow({ where: { user: { email: "student@example.edu" } } });
    expect(body.data.student.studentNo).toBe(own.studentNo);
    // The scope is there but the owner lacks the permission: still refused.
    expect((await call(studentsGET, "/api/v1/students", token)).status).toBe(403);

    const mcp = (msg: object) => mcpPOST(new NextRequest("http://localhost/api/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(msg) }));
    const init = (await (await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })).json()) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe("university-erp");
    expect((await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = (await (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((t) => t.name);
    expect(names).toContain("my_summary");
    expect(names).not.toContain("list_invoices"); // no finance:read scope
    const out = (await (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "my_summary", arguments: {} } })).json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(out.result.isError).toBe(false);
    expect(out.result.content[0].text).toContain(own.studentNo);
    const denied = (await (await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_invoices", arguments: {} } })).json()) as { error: { message: string } };
    expect(denied.error.message).toMatch(/scope/);

    await revokeToken(student, id);
    expect((await call(summaryGET, "/api/v1/me/summary", token)).status).toBe(401);
  });
});

describe("webhooks", () => {
  it("queues matching events with the change and delivers them signed", async () => {
    const admin = await as("admin");
    const { id, secret } = await saveEndpoint(admin, null, { name: "Accounts sync", url: "https://hooks.example.com/erp", events: ["payment."] });
    expect(secret).toMatch(/^whsec_/);
    await expect(saveEndpoint(admin, null, { name: "Plain", url: "http://hooks.example.com/x", events: ["payment."] })).rejects.toThrow(/https/);

    await audit({ action: "payment.record", resourceType: "payment", resourceId: "pay-1", summary: "₹5,000 received" });
    await audit({ action: "paper.submit", resourceType: "paper", resourceId: "p-1", summary: "Confidential" });
    const queued = await db.webhookDelivery.findMany({ where: { endpointId: id } });
    expect(queued.map((d) => d.event)).toEqual(["payment.record"]);

    const sent: { headers: Headers; body: string }[] = [];
    const ok = (async (_url: string, init: RequestInit) => { sent.push({ headers: new Headers(init.headers), body: String(init.body) }); return new Response("ok", { status: 200 }); }) as unknown as typeof fetch;
    const now = new Date();
    await deliverWebhooks(now, ok);
    expect(sent).toHaveLength(1);
    const ts = Math.floor(now.getTime() / 1000);
    expect(sent[0].headers.get("x-erp-signature")).toBe(signPayload(secret!, sent[0].body, ts));
    expect(sent[0].headers.get("x-erp-signature")).toBe(`t=${ts},v1=${createHmac("sha256", secret!).update(`${ts}.${sent[0].body}`).digest("hex")}`);
    expect(JSON.parse(sent[0].body)).toMatchObject({ event: "payment.record", resource: { type: "payment", id: "pay-1" } });
    expect((await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: id } })).status).toBe("DELIVERED");

    await audit({ action: "payment.reverse", resourceType: "payment", resourceId: "pay-1", summary: "Cheque bounced" });
    const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    await deliverWebhooks(new Date(), failing);
    const d = await db.webhookDelivery.findFirstOrThrow({ where: { endpointId: id, event: "payment.reverse" } });
    expect(d.status).toBe("FAILED");
    expect(d.responseStatus).toBe(503);
    expect(d.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id } })).failingSince).not.toBeNull();
    await db.webhookEndpoint.update({ where: { id }, data: { active: false } });
  });
});

describe("single sign-on", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const issuer = "https://accounts.google.com";
  let claims: Record<string, unknown> = {};
  const fakeGoogle = (async (url: string) => {
    if (url.endsWith("openid-configuration")) return Response.json({ issuer, authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth", token_endpoint: "https://oauth2.googleapis.com/token", jwks_uri: "https://www.googleapis.com/oauth2/v3/certs" });
    if (url.endsWith("/certs")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/token")) return Response.json({ id_token: signRs256({ iss: issuer, aud: "client-123.apps.googleusercontent.com", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...claims }, pem, "k1") });
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;

  beforeEach(async () => {
    jar.clear();
    clearSsoCache();
    await saveProvider(await as("admin"), "GOOGLE", { enabled: true, clientId: "client-123.apps.googleusercontent.com", clientSecret: "secret-xyz", allowedDomains: "example.edu" });
  });

  const roundTrip = async (c: Record<string, unknown>) => {
    const url = new URL(await startSso("GOOGLE", false, fakeGoogle));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(jar.has(SSO_COOKIE)).toBe(true);
    claims = { nonce: url.searchParams.get("nonce"), ...c };
    return finishSso("GOOGLE", { code: "auth-code", state: url.searchParams.get("state") }, fakeGoogle);
  };

  it("signs in an existing account by verified e-mail and links the identity", async () => {
    const out = await roundTrip({ sub: "google-sub-1", email: "faculty.cs1@example.edu", email_verified: true });
    expect(out.status).toBe("ok");
    const u = await db.user.findUniqueOrThrow({ where: { email: "faculty.cs1@example.edu" } });
    expect(await db.userIdentity.count({ where: { userId: u.id, provider: "GOOGLE", subject: "google-sub-1" } })).toBe(1);
    expect([...jar.keys()].some((k) => k.includes("session"))).toBe(true);
  });

  it("refuses unknown people, other domains, a replayed nonce and a forged state", async () => {
    expect(await roundTrip({ sub: "x2", email: "nobody@example.edu", email_verified: true })).toMatchObject({ status: "error", message: expect.stringMatching(/No account/) });
    expect(await roundTrip({ sub: "x3", email: "someone@gmail.com", email_verified: true })).toMatchObject({ status: "error", message: expect.stringMatching(/university account/) });
    expect(await roundTrip({ sub: "x4", email: "faculty.cs1@example.edu", email_verified: true, nonce: "wrong" })).toMatchObject({ status: "error" });
    const url = new URL(await startSso("GOOGLE", false, fakeGoogle));
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(await finishSso("GOOGLE", { code: "c", state: "forged" }, fakeGoogle)).toMatchObject({ status: "error" });
  });
});

describe("calendar subscription", () => {
  it("serves a person's schedule for the secret link only", async () => {
    const url = await createFeed(await as("student"));
    const token = url.split("/").pop()!.replace(".ics", "");
    const ics = await feedByToken(token);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(await feedByToken(`${token.slice(0, -2)}xx`)).toBeNull();
    await createFeed(await as("student"));
    expect(await feedByToken(token)).toBeNull(); // replaced
  });
});
