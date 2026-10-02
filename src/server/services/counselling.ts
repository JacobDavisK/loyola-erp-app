import "server-only";
import { z } from "zod";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getInstitution } from "@/server/services/directory";
import { zonedTimeToUtc } from "@/lib/domain/timetable";

/**
 * Counselling service. Counsellors publish slots; students book them privately from the portal.
 * What a student writes when booking and the counsellor's notes are seen only by counselling staff —
 * not by teachers, mentors or the HoD. Marking a session as a crisis alerts the head of counselling.
 * Audit entries record that something happened, never what was said.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const isCounsellor = (ctx: AuthContext) => can(ctx, "counselling.provide") || can(ctx, "counselling.manage");

export async function addSlots(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "counselling.provide")) throw forbidden();
  const v = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), count: z.number().int().min(1).max(12), minutes: z.number().int().min(15).max(120),
    mode: z.enum(["IN_PERSON", "ONLINE", "PHONE"]), location: z.string().trim().max(200).nullable().optional(),
  }).parse(raw);
  // Times are entered in the institution's time zone.
  const start = zonedTimeToUtc(v.date, v.from, (await getInstitution()).timezone);
  if (start < new Date()) throw invalid("Slots must be in the future.");
  const slots = Array.from({ length: v.count }, (_, i) => ({ counsellorId: ctx.user.id, startsAt: new Date(start.getTime() + i * v.minutes * 60_000), endsAt: new Date(start.getTime() + (i + 1) * v.minutes * 60_000), mode: v.mode, location: v.location ?? null }));
  const clash = await db.counsellingSlot.findFirst({ where: { counsellorId: ctx.user.id, status: { not: "CANCELLED" }, startsAt: { lt: slots.at(-1)!.endsAt }, endsAt: { gt: slots[0].startsAt } } });
  if (clash) throw conflict("These times overlap slots you already published.");
  await db.counsellingSlot.createMany({ data: slots });
  return slots.length;
}

export async function cancelSlot(ctx: AuthContext, slotId: string) {
  const s = await db.counsellingSlot.findUnique({ where: { id: slotId }, include: { booking: { include: { student: { select: { userId: true } } } } } });
  if (!s || (s.counsellorId !== ctx.user.id && !can(ctx, "counselling.manage"))) throw notFound("Slot");
  await db.$transaction(async (tx) => {
    await tx.counsellingSlot.update({ where: { id: slotId }, data: { status: "CANCELLED" } });
    if (s.booking && s.booking.status === "BOOKED") {
      await tx.counsellingBooking.update({ where: { id: s.booking.id }, data: { status: "CANCELLED" } });
      await notify({ userIds: [s.booking.student.userId], type: "counselling.booked", title: "Your counselling session was cancelled", body: "Please book another time.", link: "/portal/counselling" }, tx);
    }
  });
}

/** Open slots students can book (next three weeks). */
export async function openSlots() {
  const now = new Date();
  return db.counsellingSlot.findMany({ where: { status: "OPEN", startsAt: { gt: now, lt: new Date(now.getTime() + 21 * 86_400_000) } }, orderBy: { startsAt: "asc" }, include: { counsellor: { select: { name: true } } }, take: 200 });
}

export async function bookSlot(ctx: AuthContext, slotId: string, raw: unknown) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden("Counselling is booked from the student portal.");
  const v = z.object({ reason: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  if (await db.counsellingBooking.count({ where: { studentId, status: "BOOKED", slot: { startsAt: { gt: new Date() } } } }) >= 2) throw workflowError("You already have two upcoming sessions.");
  return db.$transaction(async (tx) => {
    // Lock the slot row so two students cannot book it at once.
    const rows = await tx.$queryRaw<{ status: string; startsAt: Date; counsellorId: string }[]>`SELECT "status", "startsAt", "counsellorId" FROM "CounsellingSlot" WHERE id = ${slotId} FOR UPDATE`;
    const s = rows[0];
    if (!s || s.status !== "OPEN" || s.startsAt < new Date()) throw workflowError("This slot is no longer available.");
    await tx.counsellingSlot.update({ where: { id: slotId }, data: { status: "BOOKED" } });
    const b = await tx.counsellingBooking.create({ data: { slotId, studentId, reason: v.reason || null } });
    await notify({ userIds: [s.counsellorId], type: "counselling.booked", title: "New counselling booking", body: s.startsAt.toISOString().slice(0, 16).replace("T", " "), link: "/counselling", email: false }, tx);
    await notify({ userIds: [ctx.user.id], type: "counselling.booked", title: "Counselling session booked", body: s.startsAt.toISOString().slice(0, 16).replace("T", " ") + " UTC", link: "/portal/counselling" }, tx);
    await audit({ ...actor(ctx), action: "counselling.book", resourceType: "counsellingBooking", resourceId: b.id, summary: "Session booked" }, tx);
    return b;
  });
}

export async function cancelBooking(ctx: AuthContext, bookingId: string) {
  const b = await db.counsellingBooking.findUnique({ where: { id: bookingId }, include: { slot: true } });
  if (!b || b.studentId !== ctx.subject.studentId) throw notFound("Booking");
  if (b.status !== "BOOKED" || b.slot.startsAt < new Date()) throw workflowError("This session can no longer be cancelled here.");
  await db.$transaction(async (tx) => {
    await tx.counsellingBooking.update({ where: { id: bookingId }, data: { status: "CANCELLED" } });
    await tx.counsellingSlot.update({ where: { id: b.slotId }, data: { status: "OPEN" } });
  });
}

export async function recordSession(ctx: AuthContext, bookingId: string, raw: unknown) {
  const b = await db.counsellingBooking.findUnique({ where: { id: bookingId }, include: { slot: true } });
  if (!b || (b.slot.counsellorId !== ctx.user.id && !can(ctx, "counselling.manage"))) throw notFound("Booking");
  const v = z.object({ status: z.enum(["ATTENDED", "NO_SHOW"]), notes: z.string().trim().max(10_000).nullable().optional(), crisis: z.boolean().default(false), followUpOn: z.coerce.date().nullable().optional() }).parse(raw);
  await db.counsellingBooking.update({ where: { id: bookingId }, data: { status: v.status, notes: v.notes ?? b.notes, crisis: v.crisis, followUpOn: v.followUpOn ?? null } });
  if (v.crisis && !b.crisis) {
    const heads = (await usersWithPermission("counselling.manage")).filter((u) => u !== ctx.user.id);
    await notify({ userIds: heads, type: "counselling.crisis", title: "Counselling: a student needs urgent support", body: "Open the counselling desk for details.", link: "/counselling", email: true });
  }
  await audit({ ...actor(ctx), action: "counselling.record", resourceType: "counsellingBooking", resourceId: bookingId, summary: `${v.status.toLowerCase()}${v.crisis ? " (crisis)" : ""}` });
}

/** The counselling desk: a counsellor's own sessions; the head of counselling sees every counsellor's. */
export async function counsellingDesk(ctx: AuthContext) {
  if (!isCounsellor(ctx)) throw forbidden();
  const all = can(ctx, "counselling.manage");
  const since = new Date(Date.now() - 30 * 86_400_000);
  return db.counsellingSlot.findMany({
    where: { ...(all ? {} : { counsellorId: ctx.user.id }), startsAt: { gte: since } },
    orderBy: { startsAt: "asc" },
    include: { counsellor: { select: { name: true } }, booking: { include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, phone: true } } } } },
    take: 300,
  });
}
