import "server-only";
import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { notFound } from "@/server/errors";
import { safeEqual } from "@/server/security/crypto";

/**
 * Digital ID card. The QR code encodes a link with a signed token that names the card holder and expires
 * after a day, so a screenshot cannot be reused for long. Security staff scan it with any phone camera;
 * the public check page shows the name, photo, programme or designation and whether the person is
 * currently a student or employee — nothing else.
 */

const TTL_SECONDS = 24 * 3600;
const sig = (data: string) => createHmac("sha256", `${env.APP_SECRET}:idcard`).update(data).digest("base64url").slice(0, 22);

export function idToken(kind: "S" | "E", id: string, now = Date.now()) {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  const data = `${kind}.${id}.${exp}`;
  return `${data}.${sig(data)}`;
}

export function readIdToken(token: string, now = Date.now()): { kind: "S" | "E"; id: string; exp: number } | null {
  const parts = token.split(".");
  if (parts.length !== 4 || !["S", "E"].includes(parts[0])) return null;
  const data = parts.slice(0, 3).join(".");
  if (!safeEqual(sig(data), parts[3])) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp * 1000 < now) return null;
  return { kind: parts[0] as "S" | "E", id: parts[1], exp };
}

/** The signed-in person's card (student or employee). */
export async function myIdCard(ctx: AuthContext) {
  const inst = await db.institution.findFirstOrThrow({ select: { name: true } });
  if (ctx.subject.studentId) {
    const s = await db.student.findUniqueOrThrow({ where: { id: ctx.subject.studentId }, include: { program: { select: { name: true } }, batch: { select: { code: true, graduationYear: true } } } });
    const token = idToken("S", s.id);
    return { institution: inst.name, kind: "Student" as const, name: `${s.firstName} ${s.lastName}`, number: s.studentNo, line: `${s.program.name} · ${s.batch.code}`, validTill: `June ${s.batch.graduationYear}`, bloodGroup: s.bloodGroup, photoAssetId: s.photoAssetId, active: s.status === "ACTIVE" || s.status === "ON_LEAVE", qr: await QRCode.toString(`${env.APP_URL}/id/${token}`, { type: "svg", margin: 1 }) };
  }
  if (ctx.subject.employeeId) {
    const e = await db.employee.findUniqueOrThrow({ where: { id: ctx.subject.employeeId }, include: { department: { select: { name: true } }, user: { select: { avatarAssetId: true } } } });
    const token = idToken("E", e.id);
    return { institution: inst.name, kind: "Staff" as const, name: `${e.firstName} ${e.lastName}`, number: e.employeeNo, line: [e.designation, e.department?.name].filter(Boolean).join(" · "), validTill: null, bloodGroup: null, photoAssetId: e.user?.avatarAssetId ?? null, active: e.status === "ACTIVE" || e.status === "ON_LEAVE", qr: await QRCode.toString(`${env.APP_URL}/id/${token}`, { type: "svg", margin: 1 }) };
  }
  throw notFound("ID card");
}

/** What a guard sees after scanning (no sign-in needed). */
export async function checkIdToken(token: string) {
  const t = readIdToken(token);
  if (!t) return { ok: false as const, reason: "This code is not valid or has expired. Ask the person to open their card again." };
  if (t.kind === "S") {
    const s = await db.student.findUnique({ where: { id: t.id }, include: { program: { select: { name: true } } } });
    if (!s) return { ok: false as const, reason: "Unknown card." };
    return { ok: true as const, active: s.status === "ACTIVE" || s.status === "ON_LEAVE", kind: "Student", name: `${s.firstName} ${s.lastName}`, number: s.studentNo, line: s.program.name, status: s.status, photoAssetId: s.photoAssetId };
  }
  const e = await db.employee.findUnique({ where: { id: t.id }, include: { department: { select: { name: true } }, user: { select: { avatarAssetId: true } } } });
  if (!e) return { ok: false as const, reason: "Unknown card." };
  return { ok: true as const, active: e.status === "ACTIVE" || e.status === "ON_LEAVE", kind: "Staff", name: `${e.firstName} ${e.lastName}`, number: e.employeeNo, line: [e.designation, e.department?.name].filter(Boolean).join(" · "), status: e.status, photoAssetId: e.user?.avatarAssetId ?? null };
}
