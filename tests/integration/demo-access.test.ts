import { describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));

import { authenticate } from "@/server/auth/login";
import { db } from "@/server/db";
import { demoAccounts, generatePassword, grantDemoAccess, resetDemoPassword, revokeDemoAccess } from "@/server/services/demo-access";
import { as } from "./helpers";

describe("Demo Users", () => {
  it("generates strong, readable passwords", () => {
    for (let i = 0; i < 50; i++) expect(generatePassword()).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*[2-9])[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}-[A-HJ-NP-Za-km-z2-9]{4}$/);
  });

  it("lets an enrolled e-mail sign in as the demo account until revoked", async () => {
    const admin = await as("admin");
    const accounts = await demoAccounts();
    expect(accounts.some((a) => a.roles.some((r) => r.startsWith("Super Admin")))).toBe(false);
    const controller = accounts.find((a) => a.email === "controller@example.edu")!;

    await expect(grantDemoAccess(await as("controller"), controller.id, { email: "visitor@gmail.com" })).rejects.toThrow(/Super Admin/);
    await expect(grantDemoAccess(admin, controller.id, { email: "registrar@example.edu" })).rejects.toThrow(/own e-mail/);
    const superAdmin = await db.user.findFirstOrThrow({ where: { email: "admin@example.edu" } });
    await expect(grantDemoAccess(admin, superAdmin.id, { email: "visitor@gmail.com" })).rejects.toThrow(/Demo account/);

    const { email, password } = await grantDemoAccess(admin, controller.id, { email: "Visitor@Gmail.com", name: "A Visitor", expiresInDays: 7 });
    expect(email).toBe("visitor@gmail.com");
    await expect(grantDemoAccess(admin, controller.id, { email: "visitor@gmail.com" })).rejects.toThrow(/already/);

    expect(await authenticate("visitor@gmail.com", "wrong-password", false)).toEqual({ status: "invalid" });
    expect(await authenticate("VISITOR@gmail.com", password, false)).toEqual({ status: "ok" });
    const grant = await db.demoGrant.findUniqueOrThrow({ where: { email } });
    expect(grant.lastUsedAt).not.toBeNull();
    const session = await db.session.findFirstOrThrow({ where: { demoGrantId: grant.id }, orderBy: { createdAt: "desc" } });
    expect(session.userId).toBe(controller.id);
    expect(await db.auditLog.count({ where: { action: "auth.login", resourceId: controller.id, summary: { contains: "visitor@gmail.com" } } })).toBeGreaterThan(0);

    const fresh = await resetDemoPassword(admin, grant.id);
    expect((await db.session.findUniqueOrThrow({ where: { id: session.id } })).revokedAt).not.toBeNull();
    expect(await authenticate(email, password, false)).toEqual({ status: "invalid" });
    expect(await authenticate(email, fresh.password, false)).toEqual({ status: "ok" });

    await revokeDemoAccess(admin, grant.id);
    expect(await db.session.count({ where: { demoGrantId: grant.id, revokedAt: null } })).toBe(0);
    expect(await authenticate(email, fresh.password, false)).toEqual({ status: "invalid" });
  });
});
