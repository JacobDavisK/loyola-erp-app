import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { schedule, weeklyLoad, type FixedSlot, type Placement, type SchedRequest } from "@/lib/domain/scheduler";
import { findClashes, type Slot } from "@/lib/domain/timetable";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound, workflowError } from "@/server/errors";
import { assertTermEditable } from "@/server/services/academic-setup";
import { audit } from "@/server/services/audit";
import { getSetting } from "@/server/services/settings";

/**
 * Automatic timetable. The generator proposes weekly slots for every class of a term (optionally one
 * department) that has no slots yet, around the slots already in the timetable, using the bell schedule
 * from settings. A proposal is a draft until the timetable officer applies it; applying re-checks every
 * slot against the live timetable so nothing changed in between can cause a clash.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

function assertScope(ctx: AuthContext, departmentId: string | null) {
  if (departmentId ? !can(ctx, "timetable.manage", departmentId) : scopeOf(ctx, "timetable.manage") !== null) throw forbidden();
}

export async function generateTimetable(ctx: AuthContext, raw: unknown) {
  const v = z.object({ termId: z.string(), departmentId: z.string().nullable().optional() }).parse(raw);
  const departmentId = v.departmentId || null;
  assertScope(ctx, departmentId);
  await assertTermEditable(v.termId);
  const cfg = await getSetting("timetable");
  const offerings = await db.courseOffering.findMany({
    where: { termId: v.termId, status: { not: "CANCELLED" } },
    include: {
      course: { select: { code: true, credits: true, mode: true, departmentId: true } },
      instructors: { select: { userId: true } },
      slots: true,
      _count: { select: { registrations: { where: { status: { in: ["REGISTERED", "COMPLETED"] } } } } },
    },
  });
  const cohort = (o: { batchId: string | null; section: string }) => (o.batchId ? `${o.batchId}:${o.section}` : null);
  const fixed: FixedSlot[] = offerings.flatMap((o) => o.slots.map((s) => ({ offeringId: o.id, day: s.dayOfWeek, start: s.startTime, end: s.endTime, roomId: s.roomId, instructorIds: o.instructors.map((i) => i.userId), cohortKey: cohort(o) })));
  const todo = offerings.filter((o) => o.slots.length === 0 && (!departmentId || o.course.departmentId === departmentId));
  const requests: SchedRequest[] = todo.map((o) => {
    const load = weeklyLoad(o.course, { weeklyLectures: o.weeklyLectures, weeklyLabs: o.weeklyLabs });
    return { offeringId: o.id, label: `${o.course.code}-${o.section}`, lectures: load.lectures, labs: load.labs, size: Math.max(o._count.registrations, Math.min(o.capacity, 60)), instructorIds: o.instructors.map((i) => i.userId), cohortKey: cohort(o) };
  });
  if (!requests.length) throw workflowError("Every class in scope already has timetable slots. Remove a class's slots to have it scheduled again.");
  const rooms = await db.room.findMany({ where: { isActive: true, type: { not: "EXAM_HALL" } }, select: { id: true, code: true, capacity: true, type: true } });
  const result = schedule({ days: cfg.days, periods: cfg.periods, rooms, requests, fixed, maxInstructorPeriodsPerDay: cfg.maxInstructorPeriodsPerDay });
  const run = await db.timetableRun.create({
    data: { termId: v.termId, departmentId, proposal: result.placements as unknown as Prisma.InputJsonValue, unplaced: result.unplaced as unknown as Prisma.InputJsonValue, stats: { ...result.stats, classes: requests.length }, createdById: ctx.user.id },
  });
  await audit({ ...actor(ctx), action: "timetable.generate", resourceType: "timetableRun", resourceId: run.id, summary: `${result.stats.placed} of ${result.stats.requested} session(s) placed for ${requests.length} class(es)` });
  return run;
}

export async function loadRun(ctx: AuthContext, id: string) {
  const run = await db.timetableRun.findUnique({ where: { id }, include: { term: { select: { name: true } } } });
  if (!run) throw notFound("Timetable proposal");
  assertScope(ctx, run.departmentId);
  return { run, placements: run.proposal as unknown as Placement[], unplaced: run.unplaced as unknown as { offeringId: string; label: string; kind: string; reason: string }[] };
}

/** Write the proposal into the timetable, refusing it if anything now clashes. */
export async function applyRun(ctx: AuthContext, id: string) {
  const { run, placements } = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw workflowError("This proposal has already been applied or discarded.");
  await assertTermEditable(run.termId);
  const offerings = await db.courseOffering.findMany({ where: { termId: run.termId, status: { not: "CANCELLED" } }, include: { slots: true, instructors: { select: { userId: true } } } });
  const byId = new Map(offerings.map((o) => [o.id, o]));
  const toSlot = (o: (typeof offerings)[number], s: { dayOfWeek: number; startTime: string; endTime: string; roomId: string | null; id?: string }): Slot => ({ id: s.id, offeringId: o.id, dayOfWeek: s.dayOfWeek, startTime: s.startTime, endTime: s.endTime, roomId: s.roomId, instructorIds: o.instructors.map((i) => i.userId), cohortKey: o.batchId ? `${o.batchId}:${o.section}` : null });
  const existing = offerings.flatMap((o) => o.slots.map((s) => toSlot(o, s)));
  const already = placements.filter((p) => (byId.get(p.offeringId)?.slots.length ?? 0) > 0);
  if (already.length) throw workflowError(`Some classes were scheduled by hand since this proposal was made (${[...new Set(already.map((p) => p.label))].join(", ")}). Generate a new proposal.`);
  const accepted: Slot[] = [];
  for (const p of placements) {
    const o = byId.get(p.offeringId);
    if (!o) throw workflowError(`${p.label} no longer exists. Generate a new proposal.`);
    const cand = toSlot(o, { dayOfWeek: p.day, startTime: p.startTime, endTime: p.endTime, roomId: p.roomId });
    const clashes = findClashes(cand, [...existing, ...accepted]);
    if (clashes.length) throw workflowError(`${p.label}: ${clashes[0].message}. Generate a new proposal.`);
    accepted.push(cand);
  }
  await db.$transaction(async (tx) => {
    await tx.timetableSlot.createMany({ data: placements.map((p) => ({ offeringId: p.offeringId, dayOfWeek: p.day, startTime: p.startTime, endTime: p.endTime, roomId: p.roomId, kind: p.kind === "LAB" ? "LAB" as const : "LECTURE" as const })) });
    await tx.timetableRun.update({ where: { id }, data: { status: "APPLIED", appliedAt: new Date() } });
    await audit({ ...actor(ctx), action: "timetable.apply", resourceType: "timetableRun", resourceId: id, summary: `${placements.length} slot(s) added to ${run.term.name}` }, tx);
  });
  return placements.length;
}

export async function discardRun(ctx: AuthContext, id: string) {
  const { run } = await loadRun(ctx, id);
  if (run.status !== "DRAFT") throw workflowError("This proposal is no longer a draft.");
  await db.timetableRun.update({ where: { id }, data: { status: "DISCARDED" } });
}
