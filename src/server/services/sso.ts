import "server-only";
import { createHash, type JsonWebKey } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import type { SsoProviderKind } from "@/generated/prisma/client";
import { domainAllowed, expectedIssuer, idTokenEmail } from "@/lib/domain/integrations";
import { completeLogin } from "@/server/auth/login";
import { createSession } from "@/server/auth/session";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid } from "@/server/errors";
import { requestMeta } from "@/server/request-context";
import { decryptString, encryptString, randomToken } from "@/server/security/crypto";
import { verifyRs256 } from "@/server/security/jwt";
import { audit } from "@/server/services/audit";

/**
 * Sign in with Google or Microsoft (OpenID Connect, authorisation-code flow with PKCE). Only people who
 * already have an account can sign in this way — matched by a previously linked identity, or by a verified
 * e-mail address the first time — so single sign-on never creates accounts. Two-step verification still
 * applies to accounts that have it on.
 */

export const SSO_COOKIE = "examcore_sso";
const LABEL: Record<SsoProviderKind, string> = { GOOGLE: "Google", MICROSOFT: "Microsoft" };

export const kindFromSlug = (slug: string): SsoProviderKind | null => (slug === "google" ? "GOOGLE" : slug === "microsoft" ? "MICROSOFT" : null);
const redirectUri = (kind: SsoProviderKind) => `${env.APP_URL}/api/auth/sso/${kind.toLowerCase()}/callback`;

function discoveryUrl(kind: SsoProviderKind, tenant: string | null) {
  return kind === "GOOGLE" ? "https://accounts.google.com/.well-known/openid-configuration" : `https://login.microsoftonline.com/${encodeURIComponent(tenant || "organizations")}/v2.0/.well-known/openid-configuration`;
}

interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
const cache = new Map<string, { at: number; value: unknown }>();
async function cachedJson<T>(url: string, fetcher: typeof fetch): Promise<T> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.value as T;
  const res = await fetcher(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const value = await res.json();
  cache.set(url, { at: Date.now(), value });
  return value as T;
}
export const clearSsoCache = () => cache.clear();

// ───────────────────────── Configuration ─────────────────────────

export async function enabledProviders(): Promise<{ kind: SsoProviderKind; label: string }[]> {
  const rows = await db.ssoProvider.findMany({ where: { enabled: true }, orderBy: { kind: "asc" } });
  return rows.map((r) => ({ kind: r.kind, label: LABEL[r.kind] }));
}

export async function saveProvider(ctx: AuthContext, kind: SsoProviderKind, raw: unknown) {
  if (!can(ctx, "integration.manage")) throw forbidden();
  const v = z.object({
    enabled: z.boolean(),
    clientId: z.string().trim().min(5).max(300),
    clientSecret: z.string().trim().max(500).nullable().optional(),
    tenant: z.string().trim().max(100).nullable().optional(),
    allowedDomains: z.string().trim().max(500).nullable().optional(),
  }).parse(raw);
  const existing = await db.ssoProvider.findUnique({ where: { kind } });
  if (!existing && !v.clientSecret) throw invalid("Enter the client secret.");
  const domains = (v.allowedDomains ?? "").split(/[,\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
  for (const d of domains) if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw invalid(`"${d}" is not a domain.`);
  const data = { enabled: v.enabled, clientId: v.clientId, tenant: kind === "MICROSOFT" ? v.tenant || "organizations" : null, allowedDomains: domains, updatedById: ctx.user.id, ...(v.clientSecret ? { clientSecretEnc: encryptString(v.clientSecret) } : {}) };
  await db.ssoProvider.upsert({ where: { kind }, create: { kind, ...data, clientSecretEnc: encryptString(v.clientSecret!) }, update: data });
  clearSsoCache();
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "integration.sso.update", resourceType: "ssoProvider", resourceId: kind, summary: `${LABEL[kind]} sign-in ${v.enabled ? "on" : "off"}${domains.length ? ` for ${domains.join(", ")}` : ""}` });
}

// ───────────────────────── Sign-in flow ─────────────────────────

interface Pending { kind: SsoProviderKind; state: string; nonce: string; verifier: string; exp: number; remember: boolean }

/** Step 1: the URL to send the browser to. Remembers state, nonce and the PKCE verifier in an encrypted cookie. */
export async function startSso(kind: SsoProviderKind, remember = false, fetcher: typeof fetch = fetch): Promise<string> {
  const p = await db.ssoProvider.findUnique({ where: { kind } });
  if (!p?.enabled) throw forbidden(`${LABEL[kind]} sign-in is not enabled.`);
  const d = await cachedJson<Discovery>(discoveryUrl(kind, p.tenant), fetcher);
  const pending: Pending = { kind, state: randomToken(24), nonce: randomToken(24), verifier: randomToken(48), exp: Date.now() + 10 * 60_000, remember };
  (await cookies()).set(SSO_COOKIE, encryptString(JSON.stringify(pending)), { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth/sso", maxAge: 600 });
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: p.clientId, response_type: "code", scope: "openid email profile", redirect_uri: redirectUri(kind), state: pending.state, nonce: pending.nonce,
    code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"), code_challenge_method: "S256", prompt: "select_account",
    ...(kind === "GOOGLE" && p.allowedDomains.length === 1 ? { hd: p.allowedDomains[0] } : {}),
  }).toString();
  return url.toString();
}

export type SsoOutcome = { status: "ok" } | { status: "mfa" } | { status: "error"; message: string };

/** Step 2: the provider redirected back. Verify everything, then sign the matching account in. */
export async function finishSso(kind: SsoProviderKind, q: { code?: string | null; state?: string | null; error?: string | null }, fetcher: typeof fetch = fetch): Promise<SsoOutcome> {
  const jar = await cookies();
  const raw = jar.get(SSO_COOKIE)?.value;
  jar.delete({ name: SSO_COOKIE, path: "/api/auth/sso" });
  const fail = async (message: string, detail: string, email?: string) => {
    const meta = await requestMeta();
    await db.loginAttempt.create({ data: { identifier: email ?? `sso:${kind.toLowerCase()}`, ip: meta.ip, userAgent: meta.userAgent, success: false, reason: `sso_${detail}`.slice(0, 60) } });
    await audit({ action: "auth.login.failed", resourceType: "auth", summary: `${LABEL[kind]} sign-in refused: ${detail}`, metadata: email ? { email } : undefined });
    return { status: "error", message } as const;
  };
  if (q.error) return fail(`${LABEL[kind]} sign-in was cancelled.`, q.error.slice(0, 40));
  let pending: Pending;
  try {
    pending = JSON.parse(decryptString(raw ?? "")) as Pending;
  } catch {
    return fail("The sign-in took too long or was started in another browser. Please try again.", "no_state");
  }
  if (pending.kind !== kind || pending.exp < Date.now() || !q.state || q.state !== pending.state || !q.code) return fail("The sign-in could not be verified. Please try again.", "state_mismatch");
  const p = await db.ssoProvider.findUnique({ where: { kind } });
  if (!p?.enabled) return fail(`${LABEL[kind]} sign-in is not enabled.`, "disabled");

  let claims: Record<string, unknown>;
  try {
    const d = await cachedJson<Discovery>(discoveryUrl(kind, p.tenant), fetcher);
    const res = await fetcher(d.token_endpoint, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({ grant_type: "authorization_code", code: q.code, redirect_uri: redirectUri(kind), client_id: p.clientId, client_secret: decryptString(p.clientSecretEnc), code_verifier: pending.verifier }),
    });
    const tok = (await res.json()) as { id_token?: string; error?: string };
    if (!res.ok || !tok.id_token) return fail("The identity provider did not confirm the sign-in.", tok.error ?? `token_http_${res.status}`);
    const { keys } = await cachedJson<{ keys: JsonWebKey[] }>(d.jwks_uri, fetcher);
    const unverified = JSON.parse(Buffer.from(tok.id_token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    claims = verifyRs256(tok.id_token, keys, { aud: p.clientId, iss: expectedIssuer(d.issuer, unverified), maxAgeSeconds: 600 });
  } catch (e) {
    console.error("[sso]", e);
    return fail("The sign-in could not be verified. Please try again.", "verify_failed");
  }
  if (claims.nonce !== pending.nonce) return fail("The sign-in could not be verified. Please try again.", "nonce");
  if (kind === "MICROSOFT" && p.tenant && !["common", "organizations", "consumers"].includes(p.tenant) && claims.tid !== p.tenant) return fail("Use your university Microsoft account.", "wrong_tenant");
  const subject = String(claims.sub ?? "");
  const email = idTokenEmail(kind, claims);
  if (!subject || !email) return fail(`Your ${LABEL[kind]} account has no verified e-mail address.`, "no_email");
  if (!domainAllowed(email, p.allowedDomains)) return fail(`Sign in with your university account (${p.allowedDomains.map((d) => `@${d}`).join(", ")}).`, "domain", email);

  const linked = await db.userIdentity.findUnique({ where: { provider_subject: { provider: kind, subject } }, include: { user: true } });
  const user = linked?.user ?? (await db.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, deletedAt: null } }));
  if (!user) return fail(`No account uses ${email}. Ask the university office to create one, or sign in with your password.`, "no_account", email);
  if (user.status !== "ACTIVE" || (user.lockedUntil && user.lockedUntil > new Date())) return fail("This account cannot sign in at the moment. Contact the IT office.", "inactive", email);
  if (linked) await db.userIdentity.update({ where: { id: linked.id }, data: { lastUsedAt: new Date(), email } });
  else {
    await db.userIdentity.create({ data: { userId: user.id, provider: kind, subject, email, lastUsedAt: new Date() } });
    await audit({ actorId: user.id, actorName: user.name, action: "auth.identity.link", resourceType: "user", resourceId: user.id, summary: `${LABEL[kind]} account ${email} linked on first sign-in` });
  }
  const meta = await requestMeta();
  await db.loginAttempt.create({ data: { identifier: email, ip: meta.ip, userAgent: meta.userAgent, success: true, reason: user.mfaEnabled ? "mfa_challenge" : `sso_${kind.toLowerCase()}` } });
  if (user.mfaEnabled) {
    await createSession(user.id, { remember: pending.remember, mfaPending: true });
    return { status: "mfa" };
  }
  await completeLogin(user.id, user.name, pending.remember, LABEL[kind]);
  return { status: "ok" };
}

export async function unlinkIdentity(ctx: AuthContext, id: string) {
  const i = await db.userIdentity.findUnique({ where: { id } });
  if (!i || (i.userId !== ctx.user.id && !can(ctx, "admin.users.manage"))) throw forbidden();
  await db.userIdentity.delete({ where: { id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "auth.identity.unlink", resourceType: "user", resourceId: i.userId, summary: `${LABEL[i.provider]} account ${i.email} unlinked` });
}
