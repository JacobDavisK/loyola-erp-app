import "server-only";
import { z } from "zod";
import { API_SCOPES, type ApiScope, TOKEN_PREFIX, isApiScope } from "@/lib/domain/integrations";
import { type AuthContext, buildAuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { randomToken, sha256 } from "@/server/security/crypto";
import { hit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";

/**
 * Personal access tokens for the REST API (/api/v1) and the AI connector (/api/mcp). A token acts as its
 * owner, limited to the scopes chosen when it was made — it can never do more than the owner can. Only a
 * hash is stored; the token itself is shown once.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

export async function createToken(ctx: AuthContext, raw: unknown) {
  const v = z.object({ name: z.string().trim().min(2).max(80), scopes: z.array(z.string()).min(1).max(20), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }).parse(raw);
  const scopes = [...new Set(v.scopes)].filter(isApiScope);
  if (!scopes.length) throw invalid("Choose at least one scope.");
  if ((await db.apiToken.count({ where: { userId: ctx.user.id, revokedAt: null } })) >= 20) throw invalid("You have 20 active tokens; revoke one first.");
  const token = `${TOKEN_PREFIX}${randomToken(32)}`;
  const row = await db.apiToken.create({ data: { userId: ctx.user.id, name: v.name, prefix: token.slice(0, 10), tokenHash: sha256(token), scopes, expiresAt: v.expiresInDays ? new Date(Date.now() + v.expiresInDays * 86_400_000) : null } });
  await audit({ ...actor(ctx), action: "integration.token.create", resourceType: "apiToken", resourceId: row.id, summary: `${v.name}: ${scopes.join(", ")}` });
  return { id: row.id, token };
}

export async function revokeToken(ctx: AuthContext, id: string) {
  const t = await db.apiToken.findUnique({ where: { id } });
  if (!t) throw notFound("Token");
  if (t.userId !== ctx.user.id && !can(ctx, "integration.manage")) throw forbidden();
  if (t.revokedAt) return;
  await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ ...actor(ctx), action: "integration.token.revoke", resourceType: "apiToken", resourceId: id, summary: t.name });
}

export class ApiAuthError extends Error {
  constructor(public status: 401 | 403 | 429, message: string) {
    super(message);
  }
}

/** Resolve "Authorization: Bearer ecp_…" to the owner's context and the token's scopes. */
export async function authenticateBearer(header: string | null, ip: string | null): Promise<{ ctx: AuthContext; scopes: ApiScope[]; tokenId: string }> {
  const m = /^Bearer\s+(\S+)$/i.exec(header ?? "");
  if (!m || !m[1].startsWith(TOKEN_PREFIX)) throw new ApiAuthError(401, "Send a personal access token: Authorization: Bearer ecp_…");
  const t = await db.apiToken.findUnique({ where: { tokenHash: sha256(m[1]) }, include: { user: { select: { status: true, deletedAt: true } } } });
  if (!t || t.revokedAt || (t.expiresAt && t.expiresAt < new Date())) throw new ApiAuthError(401, "The token is invalid, expired or revoked.");
  if (t.user.status !== "ACTIVE" || t.user.deletedAt) throw new ApiAuthError(401, "The token's owner can no longer sign in.");
  if (!hit(`apitoken:${t.id}`, 120, 60_000)) throw new ApiAuthError(429, "Too many requests; slow down (120 a minute).");
  const ctx = await buildAuthContext(t.userId, `api:${t.id}`);
  if (!ctx) throw new ApiAuthError(401, "The token's owner can no longer sign in.");
  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > 60_000) await db.apiToken.update({ where: { id: t.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip } });
  return { ctx, scopes: t.scopes.filter(isApiScope), tokenId: t.id };
}

export const scopeLabel = (s: string) => (isApiScope(s) ? API_SCOPES[s] : s);
