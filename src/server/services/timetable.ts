import "server-only";
import { z } from "zod";
import { SessionKind } from "@/generated/prisma/enums";
import { findClashes, generateMeetings, zonedTimeToUtc, type Slot } from "@/lib/domain/timetable";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { assertTermEditable } from "@/server/services/academic-setup";
import { audit } from "@/server/services/audit";
import { getInstitution } from "@/server/services/directory";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM");
export const slotSchema = z
  .object({ dayOfWeek: z.number().int().min(1).max(7), startTime: time, endTime: time, roomId: z.string().nullable().optional().transform((v) => v || null), kind: z.enum(SessionKind).default("LECTURE") })
  .refine((v) => v.endTime > v.startTime, { path: ["endTime"], message: "Must end after it starts" });

async function offeringForTimetable(ctx: AuthContext, offeringId: string) {
  const o = await db.courseOffering.findUnique({ where: { id: offeringId }, include: { course: { select: { code: true, departmentId: true } }, instructors: { select: { userId: true } } } });
  if (!o) throw notFound("Class");
  if (!can(ctx, "timetable.manage", o.course.departmentId) && !can(ctx, "enrollment.manage", o.course.departmentId)) throw forbidden();
  return o;
}

/** All slots of the term as clash-check input. */
async function termSlots(termId: string): Promise<Slot[]> {
  const slots = await db.timetableSlot.findMany({ where: { offering: { termId, status: { not: "CANCELLED" } } }, include: { offering: { select: { batchId: true, section: true, course: { select: { code: true } }, instructors: { select: { userId: true } } } }, room: { select: { code: true } } } });
  return slots.map((s) => ({
    id: s.id, offeringId: s.offeringId, label: `${s.offering.course.code}-${s.offering.section}${s.room ? ` in ${s.room.code}` : ""}`, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime,
    roomId: s.roomId, instructorIds: s.offering.instructors.map((i) => i.userId), cohortKey: s.offering.batchId ? `${s.offering.batchId}:${s.offering.section}` : null,
  }));
}

export async function addSlot(ctx: AuthContext, offeringId: string, raw: unknown, force = false) {
  const o = await offeringForTimetable(ctx, offeringId);
  await assertTermEditable(o.termId);
  const v = slotSchema.parse(raw);
  if (v.roomId) {
    const room = await db.room.findUnique({ where: { id: v.roomId } });
    if (!room || !room.isActive) throw invalid("The room is not available.");
  }
  const candidate: Slot = { offeringId, dayOfWeek: v.dayOfWeek, startTime: v.startTime, endTime: v.endTime, roomId: v.roomId, instructorIds: o.instructors.map((i) => i.userId), cohortKey: o.batchId ? `${o.batchId}:${o.section}` : null };
  const clashes = findClashes(candidate, await termSlots(o.termId));
  // Room double-booking is never allowed; instructor/cohort clashes can be forced deliberately (e.g. combined classes).
  const room = clashes.filter((c) => c.kind === "ROOM");
  if (room.length) throw workflowError(room.map((c) => c.message).join("; "));
  if (clashes.length && !force) throw workflowError(`${clashes.map((c) => c.message).join("; ")}. Save again with “allow clash” to keep it.`);
  const slot = await db.timetableSlot.create({ data: { offeringId, ...v } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "timetable.slot.add", resourceType: "offering", resourceId: offeringId, summary: `${o.course.code}-${o.section}: day ${v.dayOfWeek} ${v.startTime}–${v.endTime}${clashes.length ? " (clash allowed)" : ""}`, newValue: v });
  return slot;
}

export async function removeSlot(ctx: AuthContext, slotId: string) {
  const s = await db.timetableSlot.findUnique({ where: { id: slotId } });
  if (!s) throw notFound("Timetable slot");
  const o = await offeringForTimetable(ctx, s.offeringId);
  await assertTermEditable(o.termId);
  await db.timetableSlot.delete({ where: { id: slotId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "timetable.slot.remove", resourceType: "offering", resourceId: s.offeringId, summary: `${o.course.code}-${o.section}: day ${s.dayOfWeek} ${s.startTime}–${s.endTime}`, oldValue: s });
}

/**
 * Create dated class meetings from the weekly timetable for the rest of the term, skipping holidays.
 * Idempotent: meetings that already exist (same class, same start) are left untouched, so re-running
 * after a timetable change only adds the new sessions. Future meetings of removed slots are cancelled
 * when they have no attendance.
 */
export async function generateClassMeetings(ctx: AuthContext, offeringId: string, fromDate?: Date) {
  const o = await offeringForTimetable(ctx, offeringId);
  const term = await assertTermEditable(o.termId);
  const inst = await getInstitution();
  const slots = await db.timetableSlot.findMany({ where: { offeringId } });
  const holidays = await db.calendarEvent.findMany({ where: { isHoliday: true, endDate: { gte: term.startDate }, startDate: { lte: term.endDate } } });
  const from = fromDate && fromDate > term.startDate ? fromDate : term.startDate;
  const planned = generateMeetings(slots, from, term.endDate, holidays);
  const rows = planned.map((m) => {
    const slot = slots[m.slotIndex];
    return {
      offeringId, slotId: slot.id, date: new Date(`${m.date}T00:00:00Z`), startsAt: zonedTimeToUtc(m.date, m.startTime, inst.timezone), endsAt: zonedTimeToUtc(m.date, m.endTime, inst.timezone),
      roomId: slot.roomId, kind: slot.kind,
    };
  });
  const result = await db.$transaction(async (tx) => {
    const created = await tx.classMeeting.createMany({ data: rows, skipDuplicates: true });
    const keep = new Set(rows.map((r) => r.startsAt.getTime()));
    const stale = await tx.classMeeting.findMany({ where: { offeringId, status: "SCHEDULED", startsAt: { gte: from }, records: { none: {} } }, select: { id: true, startsAt: true } });
    const cancel = stale.filter((m) => !keep.has(m.startsAt.getTime())).map((m) => m.id);
    if (cancel.length) await tx.classMeeting.updateMany({ where: { id: { in: cancel } }, data: { status: "CANCELLED" } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "timetable.meetings.generate", resourceType: "offering", resourceId: offeringId, summary: `${o.course.code}-${o.section}: ${created.count} class session(s) added, ${cancel.length} cancelled` }, tx);
    return { created: created.count, cancelled: cancel.length };
  });
  return result;
}

/** Timetable grid rows for a term, filtered to a room, instructor or batch. */
export async function timetableFor(termId: string, filter: { roomId?: string; instructorId?: string; batchId?: string; offeringIds?: string[] }) {
  return db.timetableSlot.findMany({
    where: {
      offering: {
        termId, status: { not: "CANCELLED" },
        ...(filter.batchId ? { batchId: filter.batchId } : {}),
        ...(filter.instructorId ? { instructors: { some: { userId: filter.instructorId } } } : {}),
        ...(filter.offeringIds ? { id: { in: filter.offeringIds } } : {}),
      },
      ...(filter.roomId ? { roomId: filter.roomId } : {}),
    },
    include: { room: { select: { code: true } }, offering: { select: { id: true, section: true, course: { select: { code: true, title: true } }, instructors: { include: { user: { select: { name: true } } } } } } },
    orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
  });
}
