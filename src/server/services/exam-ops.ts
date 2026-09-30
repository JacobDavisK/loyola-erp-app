import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { summarise, type Mark } from "@/lib/domain/attendance";
import { allocateSeats } from "@/lib/domain/seating";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { attendancePolicy, getSetting } from "@/server/services/settings";
import { startWorkflow } from "@/server/services/workflow";
import type { CondonationData } from "@/server/workflow/modules/exam";

const need = (ctx: AuthContext, perm: "examreg.manage" | "seating.manage") => {
  if (!can(ctx, perm)) throw forbidden();
};

async function sessionWithTerm(sessionId: string) {
  const s = await db.examinationSession.findUnique({ where: { id: sessionId } });
  if (!s) throw notFound("Examination session");
  if (!s.termId) throw invalid("Link the session to a teaching term first (Examinations → session settings).");
  return s as typeof s & { termId: string };
}

/**
 * Build or refresh the registrations of a session from class registrations and attendance.
 * Idempotent; decisions already taken (issued hall tickets, cancellations, condonations in progress)
 * are never overwritten.
 */
export async function generateExamRegistrations(ctx: AuthContext, sessionId: string) {
  need(ctx, "examreg.manage");
  const session = await sessionWithTerm(sessionId);
  const policy = await attendancePolicy();
  const { examFeeRequired, allowCondonation } = await getSetting("examination");
  const { blockExamOnDues } = await getSetting("finance");
  const overdue = blockExamOnDues
    ? new Set((await db.invoice.findMany({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } }, select: { studentId: true }, distinct: ["studentId"] })).map((i) => i.studentId))
    : new Set<string>();
  const exams = await db.examination.findMany({ where: { sessionId }, include: { course: { select: { id: true, code: true } } } });
  let created = 0;
  let updated = 0;
  for (const exam of exams) {
    const regs = await db.courseRegistration.findMany({
      where: { offering: { courseId: exam.courseId, termId: session.termId }, status: { in: ["REGISTERED", "COMPLETED"] } },
      include: { student: { select: { id: true, status: true } } },
    });
    for (const r of regs) {
      const marks = await db.attendanceRecord.findMany({ where: { studentId: r.studentId, meeting: { offeringId: r.offeringId, status: "HELD" } }, select: { mark: true } });
      const summary = summarise(marks.map((m) => m.mark as Mark), policy);
      const reasons: string[] = [];
      let status: "ELIGIBLE" | "NOT_ELIGIBLE" | "CONDONATION_PENDING" = "ELIGIBLE";
      if (r.student.status !== "ACTIVE") {
        status = "NOT_ELIGIBLE";
        reasons.push(`Student status: ${r.student.status.toLowerCase().replace("_", " ")}`);
      } else if (overdue.has(r.studentId)) {
        status = "NOT_ELIGIBLE";
        reasons.push("Overdue fees");
      } else if (summary.standing === "SHORTAGE" || (summary.standing === "CONDONABLE" && !allowCondonation)) {
        status = "NOT_ELIGIBLE";
        reasons.push(`Attendance ${summary.percent}% is below ${policy.minimumPercent}%`);
      } else if (summary.standing === "CONDONABLE") {
        status = "CONDONATION_PENDING";
        reasons.push(`Attendance ${summary.percent}% — condonation required`);
      }
      const existing = await db.examRegistration.findUnique({ where: { examinationId_studentId: { examinationId: exam.id, studentId: r.studentId } } });
      if (!existing) {
        await db.examRegistration.create({ data: { sessionId, examinationId: exam.id, studentId: r.studentId, attemptType: r.attemptType, status, reasons, attendancePct: summary.percent, feeStatus: examFeeRequired ? "PENDING" : "NOT_REQUIRED" } });
        created++;
      } else if (existing.status === "ELIGIBLE" || existing.status === "NOT_ELIGIBLE") {
        await db.examRegistration.update({ where: { id: existing.id }, data: { status, reasons, attendancePct: summary.percent } });
        updated++;
      }
    }
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.registrations.generate", resourceType: "session", resourceId: sessionId, summary: `${created} created, ${updated} refreshed` });
  return { created, updated };
}

/** Override eligibility (Controller), with a reason that is kept on the registration. */
export async function setEligibility(ctx: AuthContext, registrationId: string, raw: unknown) {
  if (!can(ctx, "examreg.manage")) throw forbidden();
  const v = z.object({ eligible: z.boolean(), reason: z.string().trim().min(5).max(300) }).parse(raw);
  const reg = await db.examRegistration.findUnique({ where: { id: registrationId }, include: { student: { select: { studentNo: true } }, examination: { include: { course: { select: { code: true } } } } } });
  if (!reg) throw notFound("Registration");
  if (reg.status === "REGISTERED" || reg.status === "CANCELLED") throw workflowError("The hall ticket is already issued or the registration cancelled.");
  await db.$transaction(async (tx) => {
    await tx.examRegistration.update({ where: { id: registrationId }, data: { status: v.eligible ? "ELIGIBLE" : "NOT_ELIGIBLE", reasons: [v.eligible ? `Declared eligible: ${v.reason}` : v.reason] } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.eligibility.override", resourceType: "examRegistration", resourceId: registrationId, summary: `${reg.student.studentNo} ${reg.examination.course.code}: ${v.eligible ? "eligible" : "not eligible"} — ${v.reason}`, oldValue: { status: reg.status, reasons: reg.reasons } }, tx);
  });
}

/** A student (or staff on their behalf) asks for condonation of an attendance shortage. */
export async function requestCondonation(ctx: AuthContext, registrationId: string, reason: string) {
  const reg = await db.examRegistration.findUnique({ where: { id: registrationId }, include: { student: true, examination: { include: { course: { select: { code: true, title: true, departmentId: true } } } } } });
  if (!reg) throw notFound("Registration");
  const self = ctx.subject.studentId === reg.studentId;
  if (!self && !can(ctx, "examreg.manage") && !can(ctx, "student.status", reg.student.departmentId)) throw notFound("Registration");
  if (reg.status !== "CONDONATION_PENDING") throw workflowError("Condonation applies only to students in the condonation band.");
  if (String(reason ?? "").trim().length < 10) throw invalid("Explain the reason for the shortage (at least 10 characters).");
  const data: CondonationData = {
    registrationId, studentId: reg.studentId, studentNo: reg.student.studentNo, studentName: `${reg.student.firstName} ${reg.student.lastName}`,
    course: `${reg.examination.course.code} ${reg.examination.course.title}`, attendancePct: reg.attendancePct ?? 0, reason: String(reason).trim(),
  };
  return db.$transaction((tx) =>
    startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "exam.condonation", resourceType: "examRegistration", resourceId: registrationId, title: `Condonation: ${data.studentName}, ${reg.examination.course.code}`,
      summary: `${data.attendancePct}% attendance — ${data.reason}`, departmentId: reg.examination.course.departmentId, subjectUserId: reg.student.userId,
      data: data as unknown as Record<string, unknown>,
    }),
  );
}

/**
 * Issue hall tickets to every eligible candidate whose fees are settled. Each gets a hall ticket number and
 * an anonymous dummy number used on the answer script, so valuers never see the student's identity.
 */
export async function issueHallTickets(ctx: AuthContext, sessionId: string) {
  need(ctx, "examreg.manage");
  const session = await db.examinationSession.findUniqueOrThrow({ where: { id: sessionId } });
  const { hallTicketPrefix } = await getSetting("examination");
  const eligible = await db.examRegistration.findMany({ where: { sessionId, status: "ELIGIBLE", feeStatus: { in: ["NOT_REQUIRED", "PAID", "WAIVED"] } }, orderBy: [{ student: { studentNo: "asc" } }], include: { student: { select: { id: true, userId: true } } } });
  // One hall ticket number per student per session, shared by all their papers.
  const existing = await db.examRegistration.findMany({ where: { sessionId, hallTicketNo: { not: null } }, select: { studentId: true, hallTicketNo: true } });
  const ticketOf = new Map(existing.map((e) => [e.studentId, e.hallTicketNo!.split("/")[0]]));
  const papersOf = new Map<string, number>();
  for (const e of existing) papersOf.set(e.studentId, (papersOf.get(e.studentId) ?? 0) + 1);
  let issued = 0;
  await db.$transaction(async (tx) => {
    for (const reg of eligible) {
      let base = ticketOf.get(reg.studentId);
      if (!base) {
        base = await nextNumber(tx, `hallticket.${session.code}`, { prefix: hallTicketPrefix.replaceAll("{SESSION}", session.code), padding: 5 });
        ticketOf.set(reg.studentId, base);
      }
      const dummyNo = `${session.code.slice(0, 3)}${randomBytes(4).toString("hex").toUpperCase()}`;
      const n = (papersOf.get(reg.studentId) ?? 0) + 1;
      papersOf.set(reg.studentId, n);
      await tx.examRegistration.update({ where: { id: reg.id }, data: { status: "REGISTERED", hallTicketNo: `${base}/${n}`, dummyNo } });
      issued++;
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.halltickets.issue", resourceType: "session", resourceId: sessionId, summary: `${issued} paper registration(s) confirmed` }, tx);
    const accounts = await tx.student.findMany({ where: { id: { in: [...new Set(eligible.map((e) => e.studentId))] }, userId: { not: null } }, select: { userId: true } });
    await notify({ userIds: accounts.map((a) => a.userId), type: "exam.hallticket", title: `Hall ticket available: ${session.name}`, body: "Download it from your portal and bring it to every examination.", link: "/portal/exams" }, tx);
  });
  await db.$transaction((tx) => emitEvent(tx, { type: "ExamScheduled", aggregateType: "session", aggregateId: sessionId, payload: { issued }, actorId: ctx.user.id }));
  return { issued };
}

export async function cancelExamRegistration(ctx: AuthContext, registrationId: string, reason: string) {
  need(ctx, "examreg.manage");
  const reg = await db.examRegistration.findUnique({ where: { id: registrationId }, include: { script: true } });
  if (!reg) throw notFound("Registration");
  if (reg.script?.finalMarks !== null && reg.script?.finalMarks !== undefined) throw workflowError("The script has already been valued.");
  await db.$transaction(async (tx) => {
    await tx.examSeat.deleteMany({ where: { registrationId } });
    await tx.examRegistration.update({ where: { id: registrationId }, data: { status: "CANCELLED", reasons: [reason] } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.registration.cancel", resourceType: "examRegistration", resourceId: registrationId, summary: reason }, tx);
  });
}

// ───────────────────────── Seating & invigilation ─────────────────────────

const sittingSchema = z.object({ date: z.coerce.date(), slot: z.enum(["FN", "AN"]), roomIds: z.array(z.string()).min(1).max(100) });

/** Allocate seats for one sitting (date + slot) across the chosen rooms. Replaces that sitting's plan. */
export async function allocateSitting(ctx: AuthContext, sessionId: string, raw: unknown) {
  need(ctx, "seating.manage");
  const v = sittingSchema.parse(raw);
  const day = new Date(Date.UTC(v.date.getUTCFullYear(), v.date.getUTCMonth(), v.date.getUTCDate()));
  const next = new Date(day.getTime() + 86_400_000);
  const regs = await db.examRegistration.findMany({
    where: { sessionId, status: "REGISTERED", examination: { schedule: { slot: v.slot, date: { gte: day, lt: next } } } },
    include: { student: { select: { studentNo: true } } },
  });
  if (!regs.length) throw invalid("No confirmed candidates are scheduled for that date and slot.");
  const rooms = await db.room.findMany({ where: { id: { in: v.roomIds }, isActive: true } });
  const ordered = v.roomIds.map((id) => rooms.find((r) => r.id === id)).filter((r): r is (typeof rooms)[number] => !!r);
  const plan = allocateSeats(
    regs.map((r) => ({ registrationId: r.id, examinationId: r.examinationId, sortKey: r.student.studentNo })),
    ordered.map((r) => ({ id: r.id, code: r.code, seats: r.examCapacity ?? Math.floor(r.capacity / 2) })),
  );
  if (plan.unseated.length) throw workflowError(`Not enough examination seats: ${plan.unseated.length} candidate(s) left without a seat. Add rooms.`);
  await db.$transaction(async (tx) => {
    await tx.examSeat.deleteMany({ where: { registrationId: { in: regs.map((r) => r.id) } } });
    await tx.examSeat.deleteMany({ where: { roomId: { in: ordered.map((r) => r.id) }, date: day, slot: v.slot } });
    await tx.examSeat.createMany({ data: plan.assignments.map((a) => ({ ...a, date: day, slot: v.slot })) });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.seating.allocate", resourceType: "session", resourceId: sessionId, summary: `${day.toISOString().slice(0, 10)} ${v.slot}: ${plan.assignments.length} seats in ${new Set(plan.assignments.map((a) => a.roomId)).size} room(s)` }, tx);
  });
  return { seated: plan.assignments.length, rooms: new Set(plan.assignments.map((a) => a.roomId)).size };
}

export async function assignInvigilator(ctx: AuthContext, sessionId: string, raw: unknown) {
  need(ctx, "seating.manage");
  const v = z.object({ userId: z.string().min(1), roomId: z.string().min(1), date: z.coerce.date(), slot: z.enum(["FN", "AN"]), role: z.enum(["CHIEF_SUPERINTENDENT", "INVIGILATOR", "RELIEVER"]).default("INVIGILATOR") }).parse(raw);
  const day = new Date(Date.UTC(v.date.getUTCFullYear(), v.date.getUTCMonth(), v.date.getUTCDate()));
  const user = await db.user.findFirst({ where: { id: v.userId, status: "ACTIVE", userType: "STAFF" } });
  if (!user) throw notFound("Staff member");
  const clash = await db.invigilationDuty.findUnique({ where: { userId_date_slot: { userId: v.userId, date: day, slot: v.slot } } });
  if (clash) throw conflict(`${user.name} already has a duty in that slot.`);
  // An invigilator must not supervise a paper they set or teach, where known.
  const teaches = await db.examSeat.count({ where: { roomId: v.roomId, date: day, slot: v.slot, registration: { examination: { OR: [{ assignments: { some: { setterId: v.userId, status: { not: "CANCELLED" } } } }, { course: { offerings: { some: { instructors: { some: { userId: v.userId } } } } } }] } } } });
  if (teaches) throw workflowError(`${user.name} teaches or set a paper being written in this room.`);
  const duty = await db.$transaction(async (tx) => {
    const d = await tx.invigilationDuty.create({ data: { sessionId, roomId: v.roomId, userId: v.userId, date: day, slot: v.slot, role: v.role } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.duty.assign", resourceType: "session", resourceId: sessionId, summary: `${user.name}: ${day.toISOString().slice(0, 10)} ${v.slot}` }, tx);
    await notify({ userIds: [v.userId], type: "exam.duty", title: "Examination duty assigned", body: `${day.toDateString()} (${v.slot === "FN" ? "forenoon" : "afternoon"})`, link: "/duties" }, tx);
    return d;
  });
  return duty;
}

export async function removeDuty(ctx: AuthContext, dutyId: string) {
  need(ctx, "seating.manage");
  const d = await db.invigilationDuty.findUnique({ where: { id: dutyId }, include: { user: { select: { name: true } } } });
  if (!d) throw notFound("Duty");
  await db.invigilationDuty.delete({ where: { id: dutyId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "exam.duty.remove", resourceType: "session", resourceId: d.sessionId, summary: `${d.user.name}: ${d.date.toISOString().slice(0, 10)} ${d.slot}` });
}

/** Hall ticket data for one student (self, guardian with academic access, or exam staff). */
export async function hallTicket(ctx: AuthContext, studentId: string, sessionId: string) {
  const self = ctx.subject.studentId === studentId || ctx.subject.wardStudentIds.includes(studentId);
  if (!self && !can(ctx, "examreg.manage")) throw notFound("Hall ticket");
  const regs = await db.examRegistration.findMany({
    where: { studentId, sessionId, status: "REGISTERED" },
    include: {
      examination: { include: { course: { select: { code: true, title: true } }, schedule: true } },
      seat: { include: { room: { select: { code: true, name: true } } } },
    },
    orderBy: { examination: { schedule: { startsAt: "asc" } } },
  });
  if (!regs.length) throw notFound("Hall ticket");
  const [student, session] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: studentId }, include: { program: { select: { name: true } }, batch: { select: { code: true } } } }),
    db.examinationSession.findUniqueOrThrow({ where: { id: sessionId } }),
  ]);
  return { student, session, ticketNo: regs[0].hallTicketNo!.split("/")[0], papers: regs };
}
