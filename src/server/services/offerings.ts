import "server-only";
import { z } from "zod";
import { AttemptType, OfferingStatus } from "@/generated/prisma/enums";
import { blocking, registrationViolations } from "@/lib/domain/registration";
import { overlaps } from "@/lib/domain/timetable";
import { loadStudentFor, offeringWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { passedCourseIds } from "@/server/services/academic-record";
import { assertTermEditable } from "@/server/services/academic-setup";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";

export const offeringSchema = z.object({
  courseId: z.string().min(1, "Choose a course"),
  termId: z.string().min(1, "Choose a term"),
  batchId: z.string().nullable().optional().transform((v) => v || null),
  section: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,6}$/, "1–6 letters or digits").default("A"),
  capacity: z.number().int().min(1).max(2000),
  status: z.enum(OfferingStatus).default("PLANNED"),
  notes: z.string().trim().max(500).nullable().optional().transform((v) => v || null),
});

async function courseDept(courseId: string) {
  const c = await db.course.findFirst({ where: { id: courseId, deletedAt: null }, select: { departmentId: true, code: true, programId: true } });
  if (!c) throw invalid("The course does not exist.");
  return c;
}

export async function loadOfferingFor(ctx: AuthContext, id: string) {
  const o = await db.courseOffering.findFirst({
    where: { AND: [{ id }, offeringWhere(ctx)] },
    include: { course: { select: { id: true, code: true, title: true, credits: true, departmentId: true, programId: true } }, term: true, instructors: { select: { userId: true, isPrimary: true } } },
  });
  if (!o) throw notFound("Class");
  return o;
}

export async function saveOffering(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = offeringSchema.parse(raw);
  const course = await courseDept(v.courseId);
  if (!can(ctx, "enrollment.manage", course.departmentId)) throw forbidden();
  await assertTermEditable(v.termId);
  if (v.batchId) {
    const b = await db.batch.findUnique({ where: { id: v.batchId } });
    if (!b) throw invalid("The batch does not exist.");
  }
  const clash = await db.courseOffering.findFirst({ where: { courseId: v.courseId, termId: v.termId, section: v.section, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict(`${course.code} already has section ${v.section} in this term.`);
  return db.$transaction(async (tx) => {
    if (id) {
      const before = await tx.courseOffering.findUnique({ where: { id }, include: { _count: { select: { registrations: { where: { status: "REGISTERED" } } } } } });
      if (!before) throw notFound("Class");
      if (before.courseId !== v.courseId && before._count.registrations) throw invalid("Students are registered; the course cannot be changed. Create a new class instead.");
      if (v.capacity < before._count.registrations) throw invalid(`${before._count.registrations} students are registered; capacity cannot be lower.`);
    }
    const o = id ? await tx.courseOffering.update({ where: { id }, data: v }) : await tx.courseOffering.create({ data: v });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "offering.update" : "offering.create", resourceType: "offering", resourceId: o.id, summary: `${course.code} section ${v.section}`, newValue: v }, tx);
    return o;
  });
}

export async function setInstructors(ctx: AuthContext, offeringId: string, raw: unknown) {
  const v = z.object({ userIds: z.array(z.string()).max(6), primaryId: z.string().nullable().optional() }).parse(raw);
  const o = await loadOfferingFor(ctx, offeringId);
  if (!can(ctx, "enrollment.manage", o.course.departmentId)) throw forbidden();
  const users = await db.user.findMany({ where: { id: { in: v.userIds }, status: "ACTIVE", deletedAt: null, userType: "STAFF" }, select: { id: true, name: true } });
  if (users.length !== new Set(v.userIds).size) throw invalid("Every instructor must be an active staff member.");
  const primary = v.primaryId && v.userIds.includes(v.primaryId) ? v.primaryId : v.userIds[0];
  await db.$transaction(async (tx) => {
    await tx.offeringInstructor.deleteMany({ where: { offeringId } });
    if (users.length) await tx.offeringInstructor.createMany({ data: users.map((u) => ({ offeringId, userId: u.id, isPrimary: u.id === primary })) });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "offering.instructors", resourceType: "offering", resourceId: offeringId, summary: `${o.course.code}-${o.section}: ${users.map((u) => u.name).join(", ") || "none"}`, oldValue: o.instructors.map((i) => i.userId), newValue: v.userIds }, tx);
    await notify({ userIds: users.map((u) => u.id).filter((uid) => !o.instructors.some((i) => i.userId === uid)), type: "teaching.assigned", title: `You are teaching ${o.course.code} (section ${o.section})`, body: `${o.course.title} · ${o.term.name}`, link: `/teaching/${offeringId}` }, tx);
  });
}

// ───────────────────────── Registration ─────────────────────────

async function clashingCodes(tx: Tx, studentId: string, termId: string, offeringId: string) {
  const [target, mine] = await Promise.all([
    tx.timetableSlot.findMany({ where: { offeringId } }),
    tx.timetableSlot.findMany({ where: { offering: { termId, registrations: { some: { studentId, status: "REGISTERED" } } } }, include: { offering: { select: { course: { select: { code: true } } } } } }),
  ]);
  const out = new Set<string>();
  for (const a of target) for (const b of mine) if (b.offeringId !== offeringId && overlaps(a, b)) out.add(b.offering.course.code);
  return [...out];
}

/**
 * Register a student. Staff with enrollment.manage for the course's department may override soft rules
 * (window, capacity, credit limit, prerequisites, clashes) with a reason; hard rules always apply.
 * Capacity is checked under a row lock on the offering, so concurrent registrations cannot overfill it.
 */
async function register(ctx: AuthContext, offeringId: string, studentId: string, opts: { staff: boolean; override: boolean; reason?: string; attemptType?: AttemptType }) {
  const policy = await getSetting("academic");
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "CourseOffering" WHERE id = ${offeringId} FOR UPDATE`;
    const o = await tx.courseOffering.findUnique({
      where: { id: offeringId },
      include: { term: true, course: { select: { id: true, code: true, title: true, credits: true, departmentId: true, prerequisites: { include: { prerequisite: { select: { id: true, code: true } } } } } }, _count: { select: { registrations: { where: { status: "REGISTERED" } } } } },
    });
    if (!o) throw notFound("Class");
    const student = await tx.student.findUniqueOrThrow({ where: { id: studentId } });
    const existing = await tx.courseRegistration.findUnique({ where: { studentId_offeringId: { studentId, offeringId } } });
    if (existing?.status === "REGISTERED") throw conflict("The student is already registered in this class.");
    const termRegs = await tx.courseRegistration.findMany({ where: { studentId, status: "REGISTERED", offering: { termId: o.termId } }, include: { offering: { select: { courseId: true, course: { select: { credits: true } } } } } });
    const passed = await passedCourseIds(studentId, tx);
    const violations = registrationViolations({
      studentStatus: student.status,
      window: { opensAt: o.term.registrationOpensAt, closesAt: o.term.addDropUntil ?? o.term.registrationClosesAt },
      now: new Date(),
      staffOverride: opts.staff,
      offering: { status: o.status, capacity: o.capacity, registered: o._count.registrations, programId: null, batchId: o.batchId, credits: o.course.credits, courseId: o.courseId },
      student: { programId: student.programId, batchId: student.batchId },
      alreadyRegisteredCourseIds: termRegs.map((r) => r.offering.courseId),
      creditsThisTerm: termRegs.reduce((a, r) => a + r.offering.course.credits, 0),
      maxCreditsPerTerm: policy.maxCreditsPerTerm,
      prerequisites: o.course.prerequisites.map((p) => ({ courseId: p.prerequisiteId, code: p.prerequisite.code, passed: passed.has(p.prerequisiteId) })),
      clashesWith: await clashingCodes(tx, studentId, o.termId, offeringId),
    });
    const hard = blocking(violations, opts.override);
    if (hard.length) throw workflowError(hard.map((x) => x.message).join(" "));
    if (opts.override && violations.length && !opts.reason) throw invalid("Give a reason for overriding: " + violations.map((x) => x.message).join(" "));

    const reg = existing
      ? await tx.courseRegistration.update({ where: { id: existing.id }, data: { status: "REGISTERED", droppedAt: null, registeredAt: new Date(), registeredById: ctx.user.id, attemptType: opts.attemptType ?? existing.attemptType } })
      : await tx.courseRegistration.create({ data: { studentId, offeringId, registeredById: ctx.user.id, attemptType: opts.attemptType ?? "REGULAR" } });
    await audit(
      {
        actorId: ctx.user.id, actorName: ctx.user.name, action: opts.staff ? "registration.create" : "registration.self", resourceType: "student", resourceId: studentId,
        summary: `${student.studentNo} registered for ${o.course.code}-${o.section}${violations.length ? " (override)" : ""}`,
        newValue: { offeringId, overridden: violations.map((x) => x.code), reason: opts.reason ?? null },
      },
      tx,
    );
    await emitEvent(tx, { type: "CourseRegistered", aggregateType: "student", aggregateId: studentId, payload: { offeringId, courseId: o.courseId, termId: o.termId }, actorId: ctx.user.id });
    return reg;
  });
}

export async function staffRegister(ctx: AuthContext, offeringId: string, raw: unknown) {
  const v = z.object({ studentIds: z.array(z.string()).min(1).max(500), override: z.boolean().default(false), reason: z.string().trim().max(500).optional(), attemptType: z.enum(AttemptType).optional() }).parse(raw);
  const o = await loadOfferingFor(ctx, offeringId);
  if (!can(ctx, "enrollment.manage", o.course.departmentId)) throw forbidden();
  const results: { studentId: string; ok: boolean; error?: string }[] = [];
  for (const studentId of v.studentIds) {
    try {
      await loadStudentFor(ctx, studentId);
      await register(ctx, offeringId, studentId, { staff: true, override: v.override, reason: v.reason, attemptType: v.attemptType });
      results.push({ studentId, ok: true });
    } catch (e) {
      results.push({ studentId, ok: false, error: e instanceof Error ? e.message : "Failed" });
    }
  }
  return results;
}

export async function selfRegister(ctx: AuthContext, offeringId: string) {
  if (!can(ctx, "enrollment.self") || !ctx.subject.studentId) throw forbidden();
  return register(ctx, offeringId, ctx.subject.studentId, { staff: false, override: false });
}

export async function dropRegistration(ctx: AuthContext, registrationId: string, reason?: string) {
  const reg = await db.courseRegistration.findUnique({ where: { id: registrationId }, include: { offering: { include: { term: true, course: { select: { code: true, departmentId: true } } } }, student: { select: { studentNo: true } } } });
  if (!reg) throw notFound("Registration");
  const self = ctx.subject.studentId === reg.studentId && can(ctx, "enrollment.self");
  const staff = can(ctx, "enrollment.manage", reg.offering.course.departmentId);
  if (!self && !staff) throw notFound("Registration");
  if (reg.status !== "REGISTERED") throw conflict("Only active registrations can be dropped.");
  const deadline = reg.offering.term.addDropUntil ?? reg.offering.term.registrationClosesAt;
  if (self && deadline && new Date() > deadline) throw workflowError("The add/drop period is over. Contact your department to withdraw.");
  const attendance = await db.attendanceRecord.count({ where: { studentId: reg.studentId, meeting: { offeringId: reg.offeringId } } });
  const status = attendance > 0 && staff ? "WITHDRAWN" : "DROPPED";
  await db.$transaction(async (tx) => {
    await tx.courseRegistration.update({ where: { id: registrationId }, data: { status, droppedAt: new Date() } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `registration.${status.toLowerCase()}`, resourceType: "student", resourceId: reg.studentId, summary: `${reg.student.studentNo} ${status.toLowerCase()} ${reg.offering.course.code}-${reg.offering.section}`, newValue: { reason: reason ?? null } }, tx);
  });
  return status;
}

/** Open classes a student could register for this term (for the self-service catalogue). */
export async function registrationCatalogue(ctx: AuthContext) {
  const studentId = ctx.subject.studentId;
  if (!studentId || !can(ctx, "enrollment.self")) throw forbidden();
  const student = await db.student.findUniqueOrThrow({ where: { id: studentId } });
  const terms = await db.academicTerm.findMany({ where: { status: { in: ["REGISTRATION", "IN_PROGRESS"] } }, orderBy: { startDate: "desc" }, take: 1 });
  const term = terms[0];
  if (!term) return { term: null, offerings: [], mine: [] };
  const [offerings, mine] = await Promise.all([
    db.courseOffering.findMany({
      where: { termId: term.id, status: "OPEN", OR: [{ batchId: null, course: { programId: student.programId } }, { batchId: student.batchId }, { batchId: null, course: { courseType: { in: ["ELECTIVE", "ALLIED", "ABILITY_ENHANCEMENT", "SKILL_ENHANCEMENT"] } } }] },
      include: { course: { select: { code: true, title: true, credits: true, courseType: true } }, instructors: { include: { user: { select: { name: true } } } }, slots: true, _count: { select: { registrations: { where: { status: "REGISTERED" } } } } },
      orderBy: [{ course: { code: "asc" } }, { section: "asc" }],
    }),
    db.courseRegistration.findMany({ where: { studentId, offering: { termId: term.id } }, include: { offering: { include: { course: { select: { code: true, title: true, credits: true } } } } } }),
  ]);
  return { term, offerings, mine };
}

/** Register every active student of a batch (optionally one section) into a class. Soft rules may be overridden. */
export async function registerBatch(ctx: AuthContext, offeringId: string, raw: unknown) {
  const v = z.object({ batchId: z.string().min(1), section: z.string().trim().max(10).nullable().optional(), override: z.boolean().default(false), reason: z.string().trim().max(500).optional() }).parse(raw);
  const { studentWhere } = await import("@/server/auth/access");
  const students = await db.student.findMany({ where: { AND: [studentWhere(ctx), { batchId: v.batchId, status: "ACTIVE", ...(v.section ? { section: v.section } : {}) }] }, select: { id: true }, orderBy: { studentNo: "asc" } });
  if (!students.length) throw invalid("No active students in that batch/section.");
  return staffRegister(ctx, offeringId, { studentIds: students.map((s) => s.id), override: v.override, reason: v.reason });
}
