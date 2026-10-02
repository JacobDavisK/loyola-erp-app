import "server-only";
import { createHmac } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { safeEqual } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { awardBadge } from "@/server/services/vc";

/**
 * Clubs (including NSS, NCC and sports teams) and campus events. Coordinators run their club's
 * members and events; students and staff register; attendance is taken by scanning the event's QR code
 * at the venue or by the organiser. Completing an event credits activity hours to attending club members
 * (NSS / NCC service hours) and awards the event's participation badge as a verifiable credential.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

async function clubForManager(ctx: AuthContext, clubId: string) {
  const c = await db.club.findUnique({ where: { id: clubId } });
  if (!c) throw notFound("Club");
  if (c.coordinatorId !== ctx.user.id && !can(ctx, "events.manage") && !isSuperAdmin(ctx)) throw forbidden();
  return c;
}

export async function saveClub(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "events.manage")) throw forbidden();
  const v = z.object({ name: z.string().trim().min(3).max(120), kind: z.enum(["CLUB", "NSS", "NCC", "SPORTS", "CULTURAL", "PROFESSIONAL"]), description: z.string().trim().min(10).max(2000), coordinatorId: z.string(), active: z.boolean().default(true) }).parse(raw);
  if (!(await db.user.findFirst({ where: { id: v.coordinatorId, userType: "STAFF", status: "ACTIVE" } }))) throw invalid("The coordinator must be a member of staff.");
  const c = id ? await db.club.update({ where: { id }, data: v }) : await db.club.create({ data: v });
  await audit({ ...actor(ctx), action: "club.save", resourceType: "club", resourceId: c.id, summary: `${v.kind}: ${v.name}` });
  return c;
}

/** Students join a club themselves; the coordinator can add students by number. */
export async function joinClub(ctx: AuthContext, clubId: string) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden("Clubs are joined from the student portal.");
  const c = await db.club.findUnique({ where: { id: clubId } });
  if (!c || !c.active) throw notFound("Club");
  const existing = await db.clubMember.findUnique({ where: { clubId_studentId: { clubId, studentId } } });
  if (existing && !existing.leftAt) throw conflict("You are already a member.");
  if (existing) await db.clubMember.update({ where: { id: existing.id }, data: { leftAt: null, joinedAt: new Date() } });
  else await db.clubMember.create({ data: { clubId, studentId } });
}

export async function leaveClub(ctx: AuthContext, clubId: string) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden();
  await db.clubMember.updateMany({ where: { clubId, studentId, leftAt: null }, data: { leftAt: new Date() } });
}

export async function addMembers(ctx: AuthContext, clubId: string, raw: unknown) {
  await clubForManager(ctx, clubId);
  const v = z.object({ studentNos: z.string().trim().min(3).max(10_000), role: z.string().trim().max(40).nullable().optional() }).parse(raw);
  const nos = [...new Set(v.studentNos.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const students = await db.student.findMany({ where: { studentNo: { in: nos }, deletedAt: null }, select: { id: true, studentNo: true } });
  const missing = nos.filter((n) => !students.some((s) => s.studentNo === n));
  if (missing.length) throw invalid(`Unknown student number(s): ${missing.slice(0, 10).join(", ")}`);
  const role = v.role || "MEMBER";
  for (const s of students) await db.clubMember.upsert({ where: { clubId_studentId: { clubId, studentId: s.id } }, create: { clubId, studentId: s.id, role }, update: { leftAt: null, role } });
  return students.length;
}

// ───────────────────────── Events ─────────────────────────

const eventSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(5000),
  clubId: z.string().nullable().optional(),
  venue: z.string().trim().min(2).max(200),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  capacity: z.number().int().positive().max(100_000).nullable().optional(),
  registrationCloses: z.coerce.date().nullable().optional(),
  hours: z.number().positive().max(100).nullable().optional(),
  badgeId: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]),
}).refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "Must end after it starts" });

async function eventForManager(ctx: AuthContext, id: string) {
  const e = await db.campusEvent.findUnique({ where: { id }, include: { club: true } });
  if (!e) throw notFound("Event");
  if (e.createdById !== ctx.user.id && e.club?.coordinatorId !== ctx.user.id && !can(ctx, "events.manage") && !isSuperAdmin(ctx)) throw forbidden();
  return e;
}

export async function saveEvent(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = eventSchema.parse(raw);
  if (v.clubId) await clubForManager(ctx, v.clubId);
  else if (!can(ctx, "events.manage")) throw forbidden();
  if (id) {
    const cur = await eventForManager(ctx, id);
    if (cur.status === "COMPLETED" || cur.status === "CANCELLED") throw workflowError("This event can no longer be edited.");
  }
  const data = { ...v, clubId: v.clubId || null, capacity: v.capacity ?? null, registrationCloses: v.registrationCloses ?? null, hours: v.hours ?? null, badgeId: v.badgeId || null };
  const e = id ? await db.campusEvent.update({ where: { id }, data }) : await db.campusEvent.create({ data: { ...data, createdById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "event.save", resourceType: "campusEvent", resourceId: e.id, summary: `${v.title} (${v.status.toLowerCase()})` });
  return e;
}

const fullError = (err: unknown) => err instanceof Error && err.message.includes("EXAMCORE: the event is full");

export async function registerForEvent(ctx: AuthContext, eventId: string) {
  const e = await db.campusEvent.findUnique({ where: { id: eventId } });
  if (!e || e.status !== "PUBLISHED") throw notFound("Event");
  const now = new Date();
  if ((e.registrationCloses && now > e.registrationCloses) || now > e.endsAt) throw workflowError("Registration has closed.");
  const existing = await db.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId: ctx.user.id } } });
  if (existing && !existing.cancelledAt) throw conflict("You are already registered.");
  try {
    if (existing) await db.eventRegistration.update({ where: { id: existing.id }, data: { cancelledAt: null, registeredAt: now } });
    else await db.eventRegistration.create({ data: { eventId, userId: ctx.user.id, studentId: ctx.subject.studentId } });
  } catch (err) {
    if (fullError(err)) throw workflowError("The event is full.");
    throw err;
  }
}

export async function cancelRegistration(ctx: AuthContext, eventId: string) {
  await db.eventRegistration.updateMany({ where: { eventId, userId: ctx.user.id, cancelledAt: null, attendedAt: null }, data: { cancelledAt: new Date() } });
}

const eventSig = (eventId: string) => createHmac("sha256", `${env.APP_SECRET}:event`).update(eventId).digest("base64url").slice(0, 20);

/** The QR code shown at the venue; scanning it while the event runs marks the scanner as attended. */
export async function eventQr(ctx: AuthContext, eventId: string) {
  await eventForManager(ctx, eventId);
  const url = `${env.APP_URL}/events/${eventId}/attend?k=${eventSig(eventId)}`;
  return { url, svg: await QRCode.toString(url, { type: "svg", margin: 1 }) };
}

export async function selfCheckIn(ctx: AuthContext, eventId: string, key: string) {
  const e = await db.campusEvent.findUnique({ where: { id: eventId } });
  if (!e || e.status !== "PUBLISHED" || !safeEqual(eventSig(eventId), key)) throw notFound("Event");
  const now = new Date();
  if (now < new Date(e.startsAt.getTime() - 30 * 60_000) || now > new Date(e.endsAt.getTime() + 30 * 60_000)) throw workflowError("Attendance is taken only during the event.");
  const reg = await db.eventRegistration.findUnique({ where: { eventId_userId: { eventId, userId: ctx.user.id } } });
  try {
    if (reg) await db.eventRegistration.update({ where: { id: reg.id }, data: { attendedAt: reg.attendedAt ?? now, cancelledAt: null } });
    else await db.eventRegistration.create({ data: { eventId, userId: ctx.user.id, studentId: ctx.subject.studentId, attendedAt: now } });
  } catch (err) {
    if (fullError(err)) throw workflowError("The event is full.");
    throw err;
  }
  return e.title;
}

export async function markAttendance(ctx: AuthContext, eventId: string, raw: unknown) {
  await eventForManager(ctx, eventId);
  const v = z.object({ registrationIds: z.array(z.string()).max(5000), attended: z.boolean() }).parse(raw);
  await db.eventRegistration.updateMany({ where: { eventId, id: { in: v.registrationIds } }, data: { attendedAt: v.attended ? new Date() : null } });
}

/** Close the event: credit hours to attending club members and award the participation badge. */
export async function completeEvent(ctx: AuthContext, eventId: string) {
  const e = await eventForManager(ctx, eventId);
  if (e.status !== "PUBLISHED") throw workflowError("Only a published event can be completed.");
  if (e.endsAt > new Date()) throw workflowError("Complete the event after it has ended.");
  const attended = await db.eventRegistration.findMany({ where: { eventId, attendedAt: { not: null }, cancelledAt: null, studentId: { not: null } }, select: { studentId: true } });
  const studentIds = attended.map((a) => a.studentId!);
  let badges = 0;
  await db.$transaction(async (tx) => {
    await tx.campusEvent.update({ where: { id: eventId }, data: { status: "COMPLETED" } });
    if (e.clubId && e.hours) await tx.clubMember.updateMany({ where: { clubId: e.clubId, studentId: { in: studentIds }, leftAt: null }, data: { hours: { increment: e.hours } } });
    if (e.badgeId && studentIds.length) {
      const nos = await tx.student.findMany({ where: { id: { in: studentIds } }, select: { studentNo: true } });
      badges = await awardBadge(ctx, e.badgeId, { studentNos: nos.map((n) => n.studentNo).join(" "), evidence: `Attended ${e.title} on ${e.startsAt.toISOString().slice(0, 10)}` }, tx);
    }
    await audit({ ...actor(ctx), action: "event.complete", resourceType: "campusEvent", resourceId: eventId, summary: `${e.title}: ${studentIds.length} attended${e.hours ? `, ${e.hours} h credited` : ""}${badges ? `, ${badges} badge(s)` : ""}` }, tx);
  });
  return { attended: studentIds.length, badges };
}

export async function cancelEvent(ctx: AuthContext, eventId: string, reason: string) {
  const e = await eventForManager(ctx, eventId);
  if (e.status === "COMPLETED") throw workflowError("A completed event cannot be cancelled.");
  if (reason.trim().length < 5) throw invalid("Give the reason.");
  const regs = await db.eventRegistration.findMany({ where: { eventId, cancelledAt: null }, select: { userId: true } });
  await db.campusEvent.update({ where: { id: eventId }, data: { status: "CANCELLED" } });
  await notify({ userIds: regs.map((r) => r.userId), type: "event.reminder", title: `Cancelled: ${e.title}`, body: reason, link: `/events/${eventId}` });
}

/** Reminders the day before (worker job). */
export async function sendEventReminders(now = new Date()): Promise<number> {
  const soon = await db.campusEvent.findMany({ where: { status: "PUBLISHED", startsAt: { gt: new Date(now.getTime() + 23 * 3_600_000), lte: new Date(now.getTime() + 24 * 3_600_000) } }, include: { registrations: { where: { cancelledAt: null }, select: { userId: true } } } });
  let n = 0;
  for (const e of soon) {
    await notify({ userIds: e.registrations.map((r) => r.userId), type: "event.reminder", title: `Tomorrow: ${e.title}`, body: `At ${e.venue}`, link: `/events/${e.id}` });
    n += e.registrations.length;
  }
  return n;
}
