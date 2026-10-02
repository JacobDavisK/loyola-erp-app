import "server-only";
import { createSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { rateLimited } from "@/server/errors";
import { requestMeta } from "@/server/request-context";
import { hashPassword, verifyPassword } from "@/server/security/password";
import { hit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { findDemoGrant } from "@/server/services/demo-access";
import { getSetting } from "@/server/services/settings";

let dummyHash: string | null = null;
async function getDummyHash() {
  dummyHash ??= await hashPassword("examcore-timing-equaliser");
  return dummyHash;
}

export type LoginOutcome =
  | { status: "ok" }
  | { status: "mfa" }
  | { status: "invalid" }
  | { status: "locked"; minutes: number };

/**
 * Credential check with brute-force protection:
 *  - per-IP burst limit (memory) and per-identifier window (database)
 *  - account lockout after N consecutive failures
 *  - constant-work verification to avoid user enumeration via timing
 */
export async function authenticate(identifier: string, password: string, remember: boolean): Promise<LoginOutcome> {
  const meta = await requestMeta();
  const id = identifier.trim().toLowerCase();
  const security = await getSetting("security");

  if (!hit(`login:ip:${meta.ip ?? "unknown"}`, 30, 60_000)) throw rateLimited();
  const windowStart = new Date(Date.now() - 15 * 60_000);
  const recentFailures = await db.loginAttempt.count({ where: { identifier: id, success: false, createdAt: { gte: windowStart } } });
  if (recentFailures >= security.maxFailedLogins * 3) throw rateLimited();

  const user = await db.user.findFirst({
    where: { OR: [{ email: { equals: id, mode: "insensitive" } }, { employeeId: { equals: identifier.trim(), mode: "insensitive" } }], deletedAt: null },
  });

  const record = (success: boolean, reason: string) =>
    db.loginAttempt.create({ data: { identifier: id, ip: meta.ip, userAgent: meta.userAgent, success, reason } });

  if (!user) {
    // A person given access to a demo account signs in with their own e-mail (see Demo Users).
    const grant = await findDemoGrant(id);
    if (grant && grant.demoUser.status === "ACTIVE" && !grant.demoUser.deletedAt && (await verifyPassword(grant.passwordHash, password))) {
      await record(true, "demo_access");
      await db.demoGrant.update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } });
      if (grant.demoUser.mfaEnabled) {
        await createSession(grant.demoUserId, { remember, mfaPending: true, demoGrantId: grant.id });
        return { status: "mfa" };
      }
      await completeLogin(grant.demoUserId, grant.demoUser.name, remember, `demo access for ${grant.email}`, grant.id);
      return { status: "ok" };
    }
    if (!grant) await verifyPassword(await getDummyHash(), password);
    await record(false, grant ? "demo_bad_password" : "unknown_user");
    await audit({ action: "auth.login.failed", resourceType: "auth", summary: "Unknown identifier", metadata: { identifier: id } });
    return { status: "invalid" };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await verifyPassword(await getDummyHash(), password);
    await record(false, "locked");
    await audit({ actorId: user.id, actorName: user.name, action: "auth.login.blocked", resourceType: "user", resourceId: user.id, summary: "Login attempt on locked account" });
    return { status: "locked", minutes: Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000) };
  }

  const ok = await verifyPassword(user.passwordHash, password);
  if (!ok || user.status !== "ACTIVE") {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= security.maxFailedLogins;
    await db.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failures, lockedUntil: lock ? new Date(Date.now() + security.lockoutMinutes * 60_000) : undefined },
    });
    await record(false, ok ? "inactive" : "bad_password");
    await audit({
      actorId: user.id,
      actorName: user.name,
      action: lock ? "auth.account.locked" : "auth.login.failed",
      resourceType: "user",
      resourceId: user.id,
      summary: lock ? `Account locked for ${security.lockoutMinutes} minutes after ${failures} failed attempts` : `Failed login (${failures}/${security.maxFailedLogins})`,
    });
    if (lock) return { status: "locked", minutes: security.lockoutMinutes };
    return { status: "invalid" };
  }

  await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await record(true, user.mfaEnabled ? "mfa_challenge" : "ok");

  if (user.mfaEnabled) {
    await createSession(user.id, { remember, mfaPending: true });
    return { status: "mfa" };
  }
  await completeLogin(user.id, user.name, remember);
  return { status: "ok" };
}

export async function completeLogin(userId: string, name: string, remember: boolean, method = "password", demoGrantId: string | null = null) {
  await createSession(userId, { remember, mfaPending: false, demoGrantId });
  await db.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  await audit({ actorId: userId, actorName: name, action: "auth.login", resourceType: "user", resourceId: userId, summary: `Signed in (${method})` });
}
