"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticate, completeLogin } from "@/server/auth/login";
import { readSession, destroyCurrentSession, revokeAllSessions } from "@/server/auth/session";
import { requireAuth } from "@/server/auth/current";
import { runAction, type ActionResult } from "@/server/action";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid } from "@/server/errors";
import { decryptString, encryptString, randomToken, sha256 } from "@/server/security/crypto";
import { checkPasswordPolicy, hashPassword, verifyPassword } from "@/server/security/password";
import { hit } from "@/server/security/rate-limit";
import { generateTotpSecret, otpauthUri, verifyTotp } from "@/server/security/totp";
import { audit } from "@/server/services/audit";
import { getSetting } from "@/server/services/settings";
import { requestMeta } from "@/server/request-context";
import { BRAND } from "@/lib/brand";

const loginSchema = z.object({
  identifier: z.string().trim().min(1, "Enter your e-mail or employee ID").max(200),
  password: z.string().min(1, "Enter your password").max(200),
  remember: z.boolean().default(false),
});

export async function loginAction(raw: unknown): Promise<ActionResult<{ next: "dashboard" | "mfa" }>> {
  return runAction(async () => {
    const input = loginSchema.parse(raw);
    const out = await authenticate(input.identifier, input.password, input.remember);
    // Same message whether the account exists or not.
    if (out.status === "invalid") throw invalid("Your university ID or password doesn't match our records.");
    if (out.status === "locked") throw forbidden("Your account is temporarily unavailable. Please contact IT Support.");
    return { next: out.status === "mfa" ? ("mfa" as const) : ("dashboard" as const) };
  });
}

export async function verifyMfaAction(code: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const session = await readSession();
    if (!session?.mfaPending) throw forbidden("Your sign-in session expired. Please sign in again.");
    if (!hit(`mfa:${session.id}`, 6, 5 * 60_000)) throw forbidden("Too many incorrect codes. Please sign in again.");
    const user = await db.user.findUniqueOrThrow({ where: { id: session.userId } });
    if (!user.mfaSecretEnc || !verifyTotp(decryptString(user.mfaSecretEnc), code)) {
      await audit({ actorId: user.id, actorName: user.name, action: "auth.mfa.failed", resourceType: "user", resourceId: user.id, summary: "Incorrect MFA code" });
      throw invalid("That code is not valid. Check your authenticator app and try again.");
    }
    const remember = (await db.session.findUniqueOrThrow({ where: { id: session.id } })).remember;
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await completeLogin(user.id, user.name, remember, "password + MFA");
    return null;
  });
}

export async function requestPasswordResetAction(identifier: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const meta = await requestMeta();
    if (!hit(`reset:${meta.ip}`, 5, 15 * 60_000)) return null; // silently throttle
    const id = String(identifier ?? "").trim().toLowerCase();
    const user = await db.user.findFirst({
      where: { OR: [{ email: { equals: id, mode: "insensitive" } }, { employeeId: { equals: id, mode: "insensitive" } }], deletedAt: null, status: "ACTIVE" },
    });
    if (user) {
      const token = randomToken(32);
      await db.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
      await db.emailOutbox.create({
        data: {
          to: user.email,
          subject: `${BRAND.mailTag} Reset your password`,
          text: `A password reset was requested for your ${BRAND.name} account.\n\nReset link (valid 30 minutes): ${env.APP_URL}/reset-password?token=${token}\n\nIf you did not request this, ignore this e-mail and inform the Examination Cell.`,
        },
      });
      await audit({ actorId: user.id, actorName: user.name, action: "auth.password.reset_requested", resourceType: "user", resourceId: user.id });
    }
    return null; // identical response whether or not the account exists
  });
}

export async function resetPasswordAction(token: string, password: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const row = await db.passwordResetToken.findUnique({ where: { tokenHash: sha256(String(token ?? "")) }, include: { user: true } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw invalid("This reset link is invalid or has expired. Request a new one.");
    await setNewPassword(row.user.id, password, [row.user.name, row.user.email.split("@")[0], row.user.employeeId]);
    await db.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } });
    await revokeAllSessions(row.user.id);
    await audit({ actorId: row.user.id, actorName: row.user.name, action: "auth.password.reset", resourceType: "user", resourceId: row.user.id, summary: "Password reset via e-mail link; all sessions revoked" });
    return null;
  });
}

async function setNewPassword(userId: string, password: string, context: string[]) {
  const s = await getSetting("security");
  const errors = checkPasswordPolicy(password, {
    minLength: s.passwordMinLength,
    requireUpper: s.passwordRequireUpper,
    requireLower: s.passwordRequireLower,
    requireDigit: s.passwordRequireDigit,
    requireSymbol: s.passwordRequireSymbol,
    maxAgeDays: s.passwordMaxAgeDays,
  }, context);
  if (errors.length) throw invalid(`Password must include: ${errors.join(", ")}.`);
  await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } });
}

export async function changePasswordAction(current: string, next: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await verifyPassword(user.passwordHash, current))) throw invalid("Your current password is incorrect.");
    await setNewPassword(user.id, next, [user.name, user.email.split("@")[0], user.employeeId]);
    await revokeAllSessions(user.id, ctx.sessionId);
    await audit({ actorId: user.id, actorName: user.name, action: "auth.password.changed", resourceType: "user", resourceId: user.id, summary: "Password changed; other sessions revoked" });
    return null;
  }, "Password updated. Other devices have been signed out.");
}

export async function startMfaEnrollmentAction(): Promise<ActionResult<{ secret: string; uri: string }>> {
  return runAction(async () => {
    const ctx = await requireAuth();
    if (ctx.user.mfaEnabled) throw invalid("Multi-factor authentication is already enabled.");
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: ctx.user.id }, data: { mfaSecretEnc: encryptString(secret) } });
    return { secret, uri: otpauthUri(secret, ctx.user.email) };
  });
}

export async function confirmMfaEnrollmentAction(code: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!user.mfaSecretEnc || !verifyTotp(decryptString(user.mfaSecretEnc), code)) throw invalid("That code is not valid. Try the current code from your app.");
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
    await audit({ actorId: user.id, actorName: user.name, action: "auth.mfa.enabled", resourceType: "user", resourceId: user.id });
    return null;
  }, "Multi-factor authentication is now on.");
}

export async function disableMfaAction(password: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
    if (!(await verifyPassword(user.passwordHash, password))) throw invalid("Password is incorrect.");
    await db.user.update({ where: { id: user.id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
    await audit({ actorId: user.id, actorName: user.name, action: "auth.mfa.disabled", resourceType: "user", resourceId: user.id });
    return null;
  }, "Multi-factor authentication turned off.");
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ctx = await requireAuth();
    const s = await db.session.findFirst({ where: { id: sessionId, userId: ctx.user.id } });
    if (!s) throw invalid("Session not found.");
    await db.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "auth.session.revoked", resourceType: "session", resourceId: s.id, summary: s.deviceLabel ?? undefined });
    return null;
  }, "Session signed out.");
}

export async function cancelMfaChallengeAction() {
  await destroyCurrentSession();
  redirect("/login");
}
