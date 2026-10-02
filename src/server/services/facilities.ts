import "server-only";
import { z } from "zod";
import { type Busy, clashesWith } from "@/lib/domain/operations";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

/**
 * Room and hall booking. Any staff member can book a room for a seminar, meeting or event; the system checks
 * the room against scheduled classes and other approved bookings. Ordinary rooms are confirmed at once;
 * seminar halls, auditoriums and exam halls (configurable) wait for the estate office. The database itself
 * refuses two approved bookings that overlap in the same room.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

/** Everything that occupies a room in a window: classes and approved bookings. */
export async function roomBusy(roomId: string, from: Date, to: Date, excludeBookingId?: string): Promise<Busy[]> {
  const [meetings, bookings] = await Promise.all([
    db.classMeeting.findMany({ where: { roomId, status: { not: "CANCELLED" }, startsAt: { lt: to }, endsAt: { gt: from } }, include: { offering: { include: { course: { select: { code: true } } } } } }),
    db.facilityBooking.findMany({ where: { roomId, status: "APPROVED", startsAt: { lt: to }, endsAt: { gt: from }, ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}) } }),
  ]);
  return [
    ...meetings.map((m) => ({ startsAt: m.startsAt, endsAt: m.endsAt, label: `Class: ${m.offering.course.code}` })),
    ...bookings.map((b) => ({ startsAt: b.startsAt, endsAt: b.endsAt, label: `Booked: ${b.title}` })),
  ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Free rooms of at least a capacity for a window. */
export async function freeRooms(from: Date, to: Date, minCapacity = 0) {
  const rooms = await db.room.findMany({ where: { isActive: true, capacity: { gte: minCapacity } }, orderBy: { code: "asc" } });
  const out = [];
  for (const r of rooms) if (!(await roomBusy(r.id, from, to)).length) out.push(r);
  return out;
}

const bookingSchema = z.object({
  roomId: z.string(),
  title: z.string().trim().min(3).max(200),
  purpose: z.string().trim().max(1000).nullable().optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  attendees: z.number().int().positive().nullable().optional(),
});

export async function requestBooking(ctx: AuthContext, raw: unknown) {
  if (ctx.user.userType !== "STAFF") throw forbidden("Rooms are booked by staff.");
  const v = bookingSchema.parse(raw);
  if (v.endsAt <= v.startsAt) throw invalid("The end must be after the start.");
  if (v.endsAt.getTime() - v.startsAt.getTime() > 14 * 3_600_000) throw invalid("A booking can be at most 14 hours.");
  if (v.startsAt.getTime() < Date.now() - 3_600_000) throw invalid("The booking is in the past.");
  const room = await db.room.findUnique({ where: { id: v.roomId } });
  if (!room?.isActive) throw notFound("Room");
  if (v.attendees && v.attendees > room.capacity) throw invalid(`${room.code} seats ${room.capacity}.`);
  const clash = clashesWith(v.startsAt, v.endsAt, await roomBusy(room.id, v.startsAt, v.endsAt));
  if (clash.length) throw conflict(`${room.code} is taken: ${clash.map((c) => c.label).join(", ")}.`);
  const ops = await getSetting("operations");
  const needsApproval = ops.approvalRoomTypes.includes(room.type) && !can(ctx, "facility.manage");
  try {
    const b = await db.facilityBooking.create({ data: { ...v, purpose: v.purpose ?? null, attendees: v.attendees ?? null, bookedById: ctx.user.id, status: needsApproval ? "REQUESTED" : "APPROVED", ...(needsApproval ? {} : { decidedAt: new Date(), decisionNote: "Confirmed automatically" }) } });
    await audit({ ...actor(ctx), action: "facility.book", resourceType: "facilityBooking", resourceId: b.id, summary: `${room.code}: ${v.title}` });
    if (needsApproval) {
      await notify({ userIds: await usersWithPermission("facility.manage"), type: "facility.request", title: `Booking request: ${room.code}`, body: v.title, link: "/facilities" });
    }
    return b;
  } catch (e) {
    if (e instanceof Error && e.message.includes("FacilityBooking_no_overlap")) throw conflict("Someone booked the room in the meantime.");
    throw e;
  }
}

export async function decideBooking(ctx: AuthContext, id: string, approve: boolean, note?: string | null) {
  if (!can(ctx, "facility.manage")) throw forbidden();
  const b = await db.facilityBooking.findUnique({ where: { id }, include: { room: true } });
  if (!b) throw notFound("Booking");
  if (b.status !== "REQUESTED") throw workflowError("The booking was already decided.");
  if (approve) {
    const clash = clashesWith(b.startsAt, b.endsAt, await roomBusy(b.roomId, b.startsAt, b.endsAt, b.id));
    if (clash.length) throw conflict(`The room is now taken: ${clash.map((c) => c.label).join(", ")}.`);
  } else if (!note?.trim()) throw invalid("Give a reason for refusing.");
  try {
    await db.facilityBooking.update({ where: { id }, data: { status: approve ? "APPROVED" : "REJECTED", decidedById: ctx.user.id, decidedAt: new Date(), decisionNote: note?.trim() || null } });
  } catch (e) {
    if (e instanceof Error && e.message.includes("FacilityBooking_no_overlap")) throw conflict("The room is now taken.");
    throw e;
  }
  await audit({ ...actor(ctx), action: approve ? "facility.approve" : "facility.reject", resourceType: "facilityBooking", resourceId: id, summary: `${b.room.code}: ${b.title}` });
  await notify({ userIds: [b.bookedById], type: "facility.decision", title: `${b.room.code} booking ${approve ? "confirmed" : "refused"}`, body: note ?? b.title, link: "/facilities" });
}

export async function cancelBooking(ctx: AuthContext, id: string) {
  const b = await db.facilityBooking.findUnique({ where: { id } });
  if (!b) throw notFound("Booking");
  if (b.bookedById !== ctx.user.id && !can(ctx, "facility.manage")) throw forbidden();
  if (!["REQUESTED", "APPROVED"].includes(b.status)) throw workflowError("The booking is not active.");
  await db.facilityBooking.update({ where: { id }, data: { status: "CANCELLED" } });
  await audit({ ...actor(ctx), action: "facility.cancel", resourceType: "facilityBooking", resourceId: id, summary: b.title });
}

/** Utilisation of each room over a window: booked or class hours against available hours (8 h a weekday). */
export async function utilisation(from: Date, to: Date) {
  const rooms = await db.room.findMany({ where: { isActive: true }, orderBy: { code: "asc" } });
  let weekdays = 0;
  for (let d = new Date(from); d < to; d = new Date(d.getTime() + 86_400_000)) if (d.getUTCDay() !== 0) weekdays++;
  const available = weekdays * 8;
  const out = [];
  for (const r of rooms) {
    const busy = await roomBusy(r.id, from, to);
    const hours = busy.reduce((a, b) => a + (Math.min(b.endsAt.getTime(), to.getTime()) - Math.max(b.startsAt.getTime(), from.getTime())) / 3_600_000, 0);
    out.push({ room: r, hours: Math.round(hours * 10) / 10, percent: available ? Math.round((hours / available) * 1000) / 10 : 0 });
  }
  return out;
}
