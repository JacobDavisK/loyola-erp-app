import "server-only";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { type AuthContext, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { hashPassword } from "@/server/security/password";
import { audit } from "@/server/services/audit";

/**
 * Demo users. The demonstration accounts (one per role, e-mail ending in @example.edu) are no longer offered
 * on the sign-in page. Instead the Super Admin enrols a person's e-mail against a demo account and generates
 * a password; that person signs in with their own e-mail and the password and works as the demo account.
 * Every sign-in is recorded against both. Access can be reset, given an end date, or revoked.
 */

export const DEMO_DOMAIN = "@example.edu";

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertSuperAdmin = (ctx: AuthContext) => {
  if (!isSuperAdmin(ctx)) throw forbidden("Only the Super Admin manages demo users.");
};

/** Readable but strong: 3 groups of 4 from an alphabet without look-alike characters, e.g. "Kq7m-Xt4r-9Hpw". */
export function generatePassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ", lower = "abcdefghijkmnopqrstuvwxyz", digit = "23456789";
  const all = upper + lower + digit;
  for (;;) {
    const groups = Array.from({ length: 3 }, () => Array.from({ length: 4 }, () => all[randomInt(all.length)]).join(""));
    const pw = groups.join("-");
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw)) return pw;
  }
}

/** The demo accounts that can be shared: every @example.edu account except Super Admins. */
export async function demoAccounts() {
  const users = await db.user.findMany({
    where: { email: { endsWith: DEMO_DOMAIN }, deletedAt: null, NOT: { roles: { some: { role: { key: "SUPER_ADMIN" } } } }, ...(env.SUPER_ADMIN_LOGIN ? { employeeId: { not: env.SUPER_ADMIN_LOGIN } } : {}) },
    include: { roles: { include: { role: { select: { name: true, rank: true } }, department: { select: { code: true } } } }, demoGrants: { orderBy: { createdAt: "desc" } } },
    orderBy: { email: "asc" },
  });
  return users
    .map((u) => ({ id: u.id, name: u.name, email: u.email, userType: u.userType, status: u.status, roles: u.roles.map((r) => `${r.role.name}${r.department ? ` (${r.department.code})` : ""}`), rank: Math.min(...u.roles.map((r) => r.role.rank), 999), grants: u.demoGrants }))
    .sort((a, b) => a.rank - b.rank || a.email.localeCompare(b.email));
}

export async function grantDemoAccess(ctx: AuthContext, demoUserId: string, raw: unknown) {
  assertSuperAdmin(ctx);
  const v = z.object({ email: z.string().trim().toLowerCase().email().max(200), name: z.string().trim().max(120).nullable().optional(), expiresInDays: z.number().int().min(1).max(365).nullable().optional() }).parse(raw);
  const account = (await demoAccounts()).find((a) => a.id === demoUserId);
  if (!account) throw notFound("Demo account");
  if (v.email.endsWith(DEMO_DOMAIN)) throw invalid("Enter the person's own e-mail address.");
  if (await db.user.findFirst({ where: { email: { equals: v.email, mode: "insensitive" } } })) throw conflict("This e-mail belongs to a real account; it cannot also be a demo sign-in.");
  if (await db.demoGrant.findUnique({ where: { email: v.email } })) throw conflict("This e-mail already has demo access. Reset or revoke it first.");
  const password = generatePassword();
  const g = await db.demoGrant.create({ data: { demoUserId, email: v.email, name: v.name || null, passwordHash: await hashPassword(password), expiresAt: v.expiresInDays ? new Date(Date.now() + v.expiresInDays * 86_400_000) : null, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "demo.grant", resourceType: "user", resourceId: demoUserId, summary: `${v.email} may sign in as ${account.name} (${account.roles.join(", ")})${g.expiresAt ? ` until ${g.expiresAt.toISOString().slice(0, 10)}` : ""}` });
  return { email: v.email, password };
}

export async function resetDemoPassword(ctx: AuthContext, grantId: string) {
  assertSuperAdmin(ctx);
  const g = await db.demoGrant.findUnique({ where: { id: grantId } });
  if (!g) throw notFound("Demo access");
  const password = generatePassword();
  await db.demoGrant.update({ where: { id: grantId }, data: { passwordHash: await hashPassword(password), revokedAt: null } });
  await db.session.updateMany({ where: { demoGrantId: grantId, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ ...actor(ctx), action: "demo.reset", resourceType: "user", resourceId: g.demoUserId, summary: `New password for ${g.email}` });
  return { email: g.email, password };
}

export async function revokeDemoAccess(ctx: AuthContext, grantId: string) {
  assertSuperAdmin(ctx);
  const g = await db.demoGrant.findUnique({ where: { id: grantId } });
  if (!g) throw notFound("Demo access");
  await db.demoGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } });
  // End any sessions opened with this access.
  await db.session.updateMany({ where: { demoGrantId: g.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ ...actor(ctx), action: "demo.revoke", resourceType: "user", resourceId: g.demoUserId, summary: `Demo access for ${g.email} revoked` });
}

export async function deleteDemoAccess(ctx: AuthContext, grantId: string) {
  assertSuperAdmin(ctx);
  const g = await db.demoGrant.delete({ where: { id: grantId } });
  await audit({ ...actor(ctx), action: "demo.delete", resourceType: "user", resourceId: g.demoUserId, summary: `Demo access for ${g.email} removed` });
}

/** For sign-in: an active grant for this e-mail, or null. */
export async function findDemoGrant(email: string) {
  const g = await db.demoGrant.findUnique({ where: { email: email.trim().toLowerCase() }, include: { demoUser: true } });
  if (!g || g.revokedAt || (g.expiresAt && g.expiresAt < new Date())) return null;
  return g;
}
