import "server-only";
import { z } from "zod";
import type { Prisma, RiskLevel } from "@/generated/prisma/client";
import { toMinor } from "@/lib/domain/money";
import { assessRisk, type RiskInput } from "@/lib/domain/success";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { attemptsByCourse } from "@/server/services/academic-record";
import { currentTerm } from "@/server/services/academic-setup";
import { audit } from "@/server/services/audit";
import { usersWithRole } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Early warning and support cases.
 *
 * Every day the `success.risk` job scores each active student for the current term from attendance,
 * internal marks, uncleared failures, overdue fees and online engagement. The score is explainable (the
 * factors are stored with it). When a student turns high-risk, a support case is opened for their mentor
 * (or the HoD when they have none). Teachers and mentors can also open a case, and students can ask for
 * help themselves. Case notes are append-only.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const DAY = 86_400_000;

// ───────────────────────── Signals and scoring ─────────────────────────

export async function riskInputs(studentId: string, termId: string, now = new Date()): Promise<RiskInput> {
  const regs = await db.courseRegistration.findMany({ where: { studentId, status: { in: ["REGISTERED", "COMPLETED"] }, offering: { termId } }, select: { offeringId: true } });
  const offeringIds = regs.map((r) => r.offeringId);
  const policy = await getSetting("academic");
  const [att, marks, attempts, invoices, lastView, lastSub, lastQuiz, assignments] = await Promise.all([
    db.attendanceRecord.findMany({ where: { studentId, meeting: { offeringId: { in: offeringIds }, status: "HELD" } }, select: { mark: true } }),
    db.mark.findMany({ where: { studentId, component: { offeringId: { in: offeringIds }, kind: { not: "EXTERNAL" } }, marks: { not: null } }, select: { marks: true, component: { select: { maxMarks: true } } } }),
    attemptsByCourse(studentId),
    db.invoice.findMany({ where: { studentId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: now } }, select: { total: true, amountPaid: true, dueDate: true } }),
    db.learningItemView.findFirst({ where: { studentId, item: { module: { offeringId: { in: offeringIds } } } }, orderBy: { lastViewedAt: "desc" }, select: { lastViewedAt: true } }),
    db.submission.findFirst({ where: { studentId, assignment: { offeringId: { in: offeringIds } } }, orderBy: { submittedAt: "desc" }, select: { submittedAt: true } }),
    db.quizAttempt.findFirst({ where: { studentId, quiz: { offeringId: { in: offeringIds } } }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    db.assignment.findMany({ where: { offeringId: { in: offeringIds }, isPublished: true, dueAt: { lt: now } }, select: { id: true, submissions: { where: { studentId }, select: { id: true }, take: 1 } } }),
  ]);
  const counted = att.filter((a) => !policy.attendanceExcludedMarks.includes(a.mark as never));
  const attended = counted.filter((a) => policy.attendancePresentMarks.includes(a.mark as never)).length;
  const max = marks.reduce((a, m) => a + m.component.maxMarks, 0);
  const got = marks.reduce((a, m) => a + (m.marks ?? 0), 0);
  const overdue = invoices.map((i) => ({ due: toMinor(i.total) - toMinor(i.amountPaid), date: i.dueDate })).filter((i) => i.due > 0);
  const lastActive = [lastView?.lastViewedAt, lastSub?.submittedAt, lastQuiz?.startedAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
  return {
    attendancePercent: counted.length ? Math.round((attended / counted.length) * 1000) / 10 : null,
    internalPercent: max > 0 ? Math.round((got / max) * 1000) / 10 : null,
    activeFailures: [...attempts.values()].filter((a) => a.attempts > 0 && !a.passed).length,
    overdueAmount: overdue.reduce((a, i) => a + i.due, 0),
    overdueDays: overdue.length ? Math.floor((now.getTime() - Math.min(...overdue.map((i) => i.date.getTime()))) / DAY) : 0,
    daysInactive: lastActive ? Math.floor((now.getTime() - lastActive.getTime()) / DAY) : offeringIds.length ? null : 0,
    missedAssignments: assignments.filter((a) => a.submissions.length === 0).length,
  };
}

export async function riskPolicy() {
  const s = await getSetting("success");
  return { weights: s.weights, mediumAt: s.mediumAt, highAt: s.highAt, attendanceFloor: s.attendanceFloor, marksComfort: s.marksComfort, inactivityDays: s.inactivityDays };
}

/** Recompute every active student's risk for the current term; open cases for students who turned high-risk. */
export async function computeRisks(now = new Date()): Promise<{ assessed: number; high: number; casesOpened: number }> {
  const term = await currentTerm();
  if (!term) return { assessed: 0, high: 0, casesOpened: 0 };
  const [policy, cfg] = await Promise.all([riskPolicy(), getSetting("success")]);
  const students = await db.student.findMany({ where: { deletedAt: null, status: "ACTIVE", registrations: { some: { offering: { termId: term.id }, status: { in: ["REGISTERED", "COMPLETED"] } } } }, select: { id: true } });
  let high = 0;
  let casesOpened = 0;
  for (const s of students) {
    const a = assessRisk(await riskInputs(s.id, term.id, now), policy);
    const prev = await db.studentRisk.findUnique({ where: { studentId_termId: { studentId: s.id, termId: term.id } }, select: { level: true } });
    await db.studentRisk.upsert({
      where: { studentId_termId: { studentId: s.id, termId: term.id } },
      create: { studentId: s.id, termId: term.id, score: a.score, level: a.level, factors: a.factors as unknown as Prisma.InputJsonValue, computedAt: now },
      update: { score: a.score, level: a.level, factors: a.factors as unknown as Prisma.InputJsonValue, computedAt: now },
    });
    if (a.level !== "HIGH") continue;
    high++;
    if (!cfg.autoOpenCases || prev?.level === "HIGH") continue;
    const open = await db.supportCase.findFirst({ where: { studentId: s.id, status: { in: ["OPEN", "IN_PROGRESS"] } } });
    if (open) continue;
    const top = a.factors.filter((f) => f.risk > 0).slice(0, 3);
    await db.$transaction((tx) => openCaseTx(tx, null, s.id, { source: "SYSTEM", level: "HIGH", summary: `Early warning: risk score ${a.score}`, reasons: top.map((f) => `${f.label}: ${f.detail}`) }));
    casesOpened++;
  }
  return { assessed: students.length, high, casesOpened };
}

// ───────────────────────── Visibility ─────────────────────────


/** Students whose success data the caller may see: success.view scope, their mentees and the classes they teach. */
export function successStudentWhere(ctx: AuthContext): Prisma.StudentWhereInput {
  if (isSuperAdmin(ctx)) return { deletedAt: null };
  const scope = scopeOf(ctx, "success.view");
  if (scope === null) return { deletedAt: null };
  const or: Prisma.StudentWhereInput[] = [{ mentors: { some: { mentorId: ctx.user.id, endsOn: null } } }];
  if (scope.length) or.push({ departmentId: { in: scope } });
  return { deletedAt: null, OR: or };
}

export function caseWhere(ctx: AuthContext): Prisma.SupportCaseWhereInput {
  if (ctx.subject.studentId) return { studentId: ctx.subject.studentId, source: "SELF" };
  return { OR: [{ student: successStudentWhere(ctx) }, { assigneeId: ctx.user.id }, { raisedById: ctx.user.id }] };
}

export async function loadCase(ctx: AuthContext, id: string) {
  const c = await db.supportCase.findFirst({
    where: { AND: [{ id }, caseWhere(ctx)] },
    include: {
      student: { select: { id: true, studentNo: true, firstName: true, lastName: true, departmentId: true, userId: true, program: { select: { code: true } } } },
      assignee: { select: { id: true, name: true } }, raisedBy: { select: { id: true, name: true } },
      notes: { orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } },
    },
  });
  if (!c) throw notFound("Case");
  const manage = can(ctx, "success.manage", c.student.departmentId) || isSuperAdmin(ctx);
  return { case: c, manage, assignee: c.assigneeId === ctx.user.id };
}

// ───────────────────────── Cases ─────────────────────────

async function mentorOf(tx: Tx | typeof db, studentId: string) {
  return (await tx.mentorAssignment.findFirst({ where: { studentId, endsOn: null }, select: { mentorId: true } }))?.mentorId ?? null;
}

async function openCaseTx(tx: Tx, by: AuthContext | null, studentId: string, v: { source: "SYSTEM" | "STAFF" | "SELF"; level: RiskLevel; summary: string; reasons: string[] }) {
  const cfg = await getSetting("success");
  const s = await tx.student.findUniqueOrThrow({ where: { id: studentId }, select: { studentNo: true, firstName: true, lastName: true, departmentId: true } });
  const assigneeId = (await mentorOf(tx, studentId)) ?? (await usersWithRole("HOD", s.departmentId, tx))[0] ?? null;
  const number = await nextNumber(tx, "success.case", { prefix: "SC/{YYYY}/", padding: 5 });
  const c = await tx.supportCase.create({ data: { number, studentId, source: v.source, raisedById: by?.user.id ?? null, level: v.level, summary: v.summary, reasons: v.reasons, assigneeId, dueAt: new Date(Date.now() + cfg.caseSlaDays * DAY) } });
  if (assigneeId && assigneeId !== by?.user.id) await notify({ userIds: [assigneeId], type: "success.case", title: `Support case ${number}: ${s.firstName} ${s.lastName}`, body: v.summary, link: `/success/cases/${c.id}` }, tx);
  await audit({ actorId: by?.user.id ?? null, actorName: by?.user.name ?? "Early-warning job", action: "success.case.open", resourceType: "supportCase", resourceId: c.id, summary: `${number} ${s.studentNo} (${v.source.toLowerCase()}, ${v.level.toLowerCase()})` }, tx);
  return c;
}

const caseSchema = z.object({ summary: z.string().trim().min(10).max(500), level: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"), details: z.string().trim().max(4000).nullable().optional() });

/** A teacher of the student, their mentor, or a success viewer opens a case; a student asks for help for themselves. */
export async function openCase(ctx: AuthContext, studentId: string, raw: unknown) {
  const v = caseSchema.parse(raw);
  const self = ctx.subject.studentId === studentId;
  if (!self) {
    const s = await loadStudentFor(ctx, studentId);
    const teaches = await db.courseRegistration.count({ where: { studentId, status: { in: ["REGISTERED", "COMPLETED"] }, offering: { instructors: { some: { userId: ctx.user.id } } } } });
    const mentor = (await mentorOf(db, studentId)) === ctx.user.id;
    if (!teaches && !mentor && !can(ctx, "success.view", s.departmentId) && !isSuperAdmin(ctx)) throw forbidden();
  }
  if (await db.supportCase.findFirst({ where: { studentId, status: { in: ["OPEN", "IN_PROGRESS"] } } })) throw conflict("This student already has an open support case. Add a note to it instead.");
  return db.$transaction(async (tx) => {
    const c = await openCaseTx(tx, ctx, studentId, { source: self ? "SELF" : "STAFF", level: self ? "MEDIUM" : v.level, summary: v.summary, reasons: [] });
    if (v.details) await tx.caseNote.create({ data: { caseId: c.id, authorId: ctx.user.id, body: v.details } });
    return c;
  });
}

export async function addCaseNote(ctx: AuthContext, id: string, raw: unknown) {
  const { case: c, manage, assignee } = await loadCase(ctx, id);
  const v = z.object({ kind: z.enum(["NOTE", "CONTACT", "REFERRAL"]).default("NOTE"), body: z.string().trim().min(3).max(5000) }).parse(raw);
  if (c.status === "CLOSED") throw workflowError("The case is closed.");
  const self = ctx.subject.studentId === c.studentId;
  if (!manage && !assignee && !self && c.raisedById !== ctx.user.id && (await mentorOf(db, c.studentId)) !== ctx.user.id) throw forbidden();
  await db.$transaction(async (tx) => {
    await tx.caseNote.create({ data: { caseId: id, authorId: ctx.user.id, kind: self ? "NOTE" : v.kind, body: v.body } });
    if (c.status === "OPEN" && !self) await tx.supportCase.update({ where: { id }, data: { status: "IN_PROGRESS" } });
  });
}

export async function assignCase(ctx: AuthContext, id: string, userId: string) {
  const { case: c, manage } = await loadCase(ctx, id);
  if (!manage) throw forbidden();
  const u = await db.user.findFirst({ where: { id: userId, userType: "STAFF", status: "ACTIVE" } });
  if (!u) throw invalid("Assign the case to a member of staff.");
  await db.$transaction(async (tx) => {
    await tx.supportCase.update({ where: { id }, data: { assigneeId: userId } });
    await tx.caseNote.create({ data: { caseId: id, authorId: ctx.user.id, kind: "STATUS", body: `Assigned to ${u.name}.` } });
    if (userId !== ctx.user.id) await notify({ userIds: [userId], type: "success.case", title: `Support case ${c.number} assigned to you`, body: c.summary, link: `/success/cases/${id}` }, tx);
  });
  await audit({ ...actor(ctx), action: "success.case.assign", resourceType: "supportCase", resourceId: id, summary: `${c.number} → ${u.name}` });
}

export async function setCaseStatus(ctx: AuthContext, id: string, raw: unknown) {
  const { case: c, manage, assignee } = await loadCase(ctx, id);
  const v = z.object({ status: z.enum(["IN_PROGRESS", "RESOLVED", "CLOSED"]), resolution: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  if (!manage && !assignee) throw forbidden();
  if (c.status === "CLOSED") throw workflowError("The case is closed.");
  if (v.status === "RESOLVED" && (v.resolution ?? "").length < 10) throw invalid("Describe how the case was resolved.");
  if (v.status === "CLOSED" && !manage && c.status !== "RESOLVED") throw forbidden("Resolve the case first; a success manager closes it.");
  await db.$transaction(async (tx) => {
    await tx.supportCase.update({ where: { id }, data: { status: v.status, resolution: v.resolution ?? c.resolution, closedAt: v.status === "CLOSED" ? new Date() : null } });
    await tx.caseNote.create({ data: { caseId: id, authorId: ctx.user.id, kind: "STATUS", body: `${c.status.replace("_", " ").toLowerCase()} → ${v.status.replace("_", " ").toLowerCase()}${v.resolution ? `: ${v.resolution}` : ""}` } });
  });
  if (c.source === "SELF" && c.student.userId && v.status === "RESOLVED") await notify({ userIds: [c.student.userId], type: "success.case", title: "Your request for help was resolved", body: v.resolution ?? undefined, link: "/portal/support" });
  await audit({ ...actor(ctx), action: "success.case.status", resourceType: "supportCase", resourceId: id, summary: `${c.number}: ${c.status} → ${v.status}` });
}

/** Dashboard figures for students in scope. */
export async function successOverview(ctx: AuthContext) {
  const term = await currentTerm();
  if (!term) return null;
  const where = { termId: term.id, student: successStudentWhere(ctx) };
  const [byLevel, openCases, overdueCases] = await Promise.all([
    db.studentRisk.groupBy({ by: ["level"], where, _count: { _all: true } }),
    db.supportCase.count({ where: { AND: [caseWhere(ctx), { status: { in: ["OPEN", "IN_PROGRESS"] } }] } }),
    db.supportCase.count({ where: { AND: [caseWhere(ctx), { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: new Date() } }] } }),
  ]);
  const n = (l: RiskLevel) => byLevel.find((b) => b.level === l)?._count._all ?? 0;
  return { term, high: n("HIGH"), medium: n("MEDIUM"), low: n("LOW"), openCases, overdueCases };
}
