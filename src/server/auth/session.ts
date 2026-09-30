import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { describeDevice, requestMeta } from "@/server/request-context";
import { randomToken, sha256 } from "@/server/security/crypto";
import { getSetting } from "@/server/services/settings";

/** In production the __Host- prefix pins the cookie to this origin, HTTPS and path "/". */
export const SESSION_COOKIE = env.NODE_ENV === "production" ? "__Host-examcore_session" : "examcore_session";

export async function createSession(userId: string, opts: { remember: boolean; mfaPending: boolean }) {
  const security = await getSetting("security");
  const meta = await requestMeta();
  const token = randomToken(32);
  const ttlMs = opts.remember ? security.rememberDeviceDays * 86_400_000 : security.sessionAbsoluteHours * 3_600_000;
  const expiresAt = new Date(Date.now() + ttlMs);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      ip: meta.ip,
      userAgent: meta.userAgent,
      deviceLabel: describeDevice(meta.userAgent),
      remember: opts.remember,
      mfaPending: opts.mfaPending,
    },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: opts.remember ? expiresAt : undefined, // session cookie unless "remember device"
  });
  return session;
}

export interface ActiveSession {
  id: string;
  userId: string;
  mfaPending: boolean;
  expiresAt: Date;
}

/** Validates the session cookie (expiry, revocation, idle timeout). Cached per request. */
export const readSession = cache(async (): Promise<ActiveSession | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  const security = await getSetting("security");
  const idleMs = security.sessionIdleMinutes * 60_000;
  if (!session.remember && Date.now() - session.lastSeenAt.getTime() > idleMs) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return { id: session.id, userId: session.userId, mfaPending: session.mfaPending, expiresAt: session.expiresAt };
});

export async function destroyCurrentSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  if (!token) return null;
  const s = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  if (s && !s.revokedAt) await db.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
  return s?.userId ?? null;
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await db.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}
