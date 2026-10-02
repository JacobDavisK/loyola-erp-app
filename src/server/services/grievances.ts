import "server-only";
import { z } from "zod";
import type { GrievanceLevel, Prisma } from "@/generated/prisma/client";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Student grievance redressal, following the UGC (Redressal of Grievances of Students) Regulations 2023:
 *  - a grievance goes first to the department committee (HoD), and ragging, harassment and
 *    discrimination complaints go straight to the institution committee;
 *  - each level must decide within the set days (15 by default) — an overdue grievance escalates by
 *    itself to the next level;
 *  - the student may appeal a decision within the appeal window, up to the Ombudsperson.
 * Ragging and harassment complaints may be anonymous: the committee does not see who raised them.
 * Every step is recorded in an append-only history.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const DAY = 86_400_000;
const DIRECT_TO_COMMITTEE = new Set(["RAGGING", "HARASSMENT", "DISCRIMINATION"]);

async function dueFor(level: GrievanceLevel, from = new Date()) {
  const c = await getSetting("campus");
  return new Date(from.getTime() + (level === "OMBUDSPERSON" ? c.ombudspersonDays : c.grievanceDays) * DAY);
}

async function handlers(level: GrievanceLevel, departmentId: string | null, tx?: Tx) {
  if (level === "DEPARTMENT") return usersWithPermission("grievance.handle", departmentId ?? undefined, tx);
  return usersWithPermission(level === "INSTITUTION" ? "grievance.committee" : "grievance.ombudsperson", undefined, tx);
}

function canHandle(ctx: AuthContext, g: { level: GrievanceLevel; departmentId: string | null }) {
  if (isSuperAdmin(ctx)) return true;
  if (g.level === "DEPARTMENT") return !!g.departmentId && can(ctx, "grievance.handle", g.departmentId);
  return can(ctx, g.level === "INSTITUTION" ? "grievance.committee" : "grievance.ombudsperson");
}

export function grievanceWhere(ctx: AuthContext): Prisma.GrievanceWhereInput {
  if (isSuperAdmin(ctx)) return {};
  const or: Prisma.GrievanceWhereInput[] = [{ raisedById: ctx.user.id }];
  const dept = scopeOf(ctx, "grievance.handle");
  if (dept === null) or.push({ level: "DEPARTMENT" });
  else if (dept.length) or.push({ level: "DEPARTMENT", departmentId: { in: dept } });
  if (can(ctx, "grievance.committee")) or.push({ level: "INSTITUTION" });
  if (can(ctx, "grievance.ombudsperson")) or.push({ level: "OMBUDSPERSON" });
  return { OR: or };
}

const grievanceSchema = z.object({
  category: z.enum(["ACADEMIC", "EXAMINATION", "FEES", "ADMINISTRATION", "FACILITIES", "HARASSMENT", "RAGGING", "DISCRIMINATION", "OTHER"]),
  subject: z.string().trim().min(5).max(200),
  description: z.string().trim().min(20).max(10_000),
  anonymous: z.boolean().default(false),
});

export async function raiseGrievance(ctx: AuthContext, raw: unknown) {
  const v = grievanceSchema.parse(raw);
  if (v.anonymous && !["RAGGING", "HARASSMENT"].includes(v.category)) throw invalid("Only ragging and harassment complaints can be anonymous.");
  const student = ctx.subject.studentId ? await db.student.findUnique({ where: { id: ctx.subject.studentId }, select: { id: true, departmentId: true } }) : null;
  const departmentId = student?.departmentId ?? ctx.user.departmentId;
  const level: GrievanceLevel = DIRECT_TO_COMMITTEE.has(v.category) || !departmentId ? "INSTITUTION" : "DEPARTMENT";
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "grievance", { prefix: "GR/{YYYY}/", padding: 5 });
    const g = await tx.grievance.create({ data: { number, raisedById: ctx.user.id, studentId: student?.id ?? null, anonymous: v.anonymous, category: v.category, subject: v.subject, description: v.description, departmentId, level, dueAt: await dueFor(level) } });
    await tx.grievanceAction.create({ data: { grievanceId: g.id, actorId: v.anonymous ? null : ctx.user.id, action: "SUBMITTED", note: `Sent to the ${level.toLowerCase()} level.` } });
    const to = (await handlers(level, departmentId, tx)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: to, type: "grievance.update", title: `${v.category === "RAGGING" ? "Ragging complaint" : "Grievance"} ${number}: ${v.subject}`, link: `/grievances/${g.id}`, email: true }, tx);
    await audit({ actorId: v.anonymous ? null : ctx.user.id, actorName: v.anonymous ? "Anonymous complainant" : ctx.user.name, action: "grievance.raise", resourceType: "grievance", resourceId: g.id, summary: `${number} [${v.category}] → ${level}` }, tx);
    return g;
  });
}

export async function loadGrievance(ctx: AuthContext, id: string) {
  const g = await db.grievance.findFirst({ where: { AND: [{ id }, grievanceWhere(ctx)] }, include: { raisedBy: { select: { id: true, name: true, email: true } }, student: { select: { id: true, studentNo: true } }, actions: { orderBy: { createdAt: "asc" } } } });
  if (!g) throw notFound("Grievance");
  const own = g.raisedById === ctx.user.id;
  const handler = canHandle(ctx, g);
  // Anonymous complaints never reveal the complainant to the committee.
  const hidden = g.anonymous && !own;
  return { grievance: { ...g, raisedBy: hidden ? null : g.raisedBy, student: hidden ? null : g.student }, own, handler };
}

export async function grievanceNote(ctx: AuthContext, id: string, note: string) {
  const { grievance: g, own, handler } = await loadGrievance(ctx, id);
  if (!own && !handler) throw forbidden();
  if (g.status === "CLOSED") throw workflowError("The grievance is closed.");
  if (note.trim().length < 3) throw invalid("Write a note.");
  await db.$transaction(async (tx) => {
    await tx.grievanceAction.create({ data: { grievanceId: id, actorId: own && g.anonymous ? null : ctx.user.id, action: own ? "STUDENT_NOTE" : "COMMITTEE_NOTE", note: note.trim().slice(0, 5000) } });
    if (handler && !own && g.status === "SUBMITTED") await tx.grievance.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
    if (!own) await notify({ userIds: [g.raisedById], type: "grievance.update", title: `Update on your grievance`, body: note.slice(0, 200), link: `/grievances/${id}` }, tx);
  });
}

export async function resolveGrievance(ctx: AuthContext, id: string, resolution: string) {
  const { grievance: g, handler, own } = await loadGrievance(ctx, id);
  if (!handler || own) throw forbidden();
  if (!["SUBMITTED", "UNDER_REVIEW", "APPEALED"].includes(g.status)) throw workflowError("This grievance is not open.");
  if (resolution.trim().length < 20) throw invalid("Write the committee's decision and the reasons (at least 20 characters).");
  await db.$transaction(async (tx) => {
    await tx.grievance.update({ where: { id }, data: { status: "RESOLVED", resolution: resolution.trim(), resolvedAt: new Date() } });
    await tx.grievanceAction.create({ data: { grievanceId: id, actorId: ctx.user.id, action: "RESOLVED", note: resolution.trim() } });
    await notify({ userIds: [g.raisedById], type: "grievance.update", title: `Decision on your grievance ${g.number}`, body: "Read the decision. If you are not satisfied you can appeal.", link: `/grievances/${id}` }, tx);
    await audit({ ...actor(ctx), action: "grievance.resolve", resourceType: "grievance", resourceId: id, summary: `${g.number} at ${g.level}` }, tx);
  });
}

const NEXT: Record<GrievanceLevel, GrievanceLevel | null> = { DEPARTMENT: "INSTITUTION", INSTITUTION: "OMBUDSPERSON", OMBUDSPERSON: null };

/** The student appeals a decision to the next level, within the appeal window. */
export async function appealGrievance(ctx: AuthContext, id: string, reason: string) {
  const { grievance: g, own } = await loadGrievance(ctx, id);
  if (!own) throw forbidden();
  if (g.status !== "RESOLVED") throw workflowError("You can appeal once a decision has been given.");
  const next = NEXT[g.level];
  if (!next) throw workflowError("The Ombudsperson's decision is final within the institution.");
  const { appealDays } = await getSetting("campus");
  if (g.resolvedAt && Date.now() - g.resolvedAt.getTime() > appealDays * DAY) throw workflowError(`Appeals must be made within ${appealDays} days of the decision.`);
  if (reason.trim().length < 20) throw invalid("Explain why you are appealing (at least 20 characters).");
  await escalate(id, next, `Appeal: ${reason.trim()}`, own && g.anonymous ? null : ctx.user.id, "APPEALED");
}

async function escalate(id: string, to: GrievanceLevel, note: string, actorId: string | null, status: "APPEALED" | "UNDER_REVIEW") {
  const g = await db.grievance.findUniqueOrThrow({ where: { id } });
  await db.$transaction(async (tx) => {
    await tx.grievance.update({ where: { id }, data: { level: to, status, dueAt: await dueFor(to), resolution: null, resolvedAt: null } });
    await tx.grievanceAction.create({ data: { grievanceId: id, actorId, action: status === "APPEALED" ? "APPEALED" : "ESCALATED", note } });
    await notify({ userIds: await handlers(to, g.departmentId, tx), type: "grievance.update", title: `Grievance ${g.number} ${status === "APPEALED" ? "appealed" : "escalated"} to you`, link: `/grievances/${id}`, email: true }, tx);
    await notify({ userIds: [g.raisedById], type: "grievance.update", title: `Your grievance ${g.number} moved to the ${to.toLowerCase()} level`, link: `/grievances/${id}` }, tx);
  });
}

export async function closeGrievance(ctx: AuthContext, id: string) {
  const { grievance: g, own } = await loadGrievance(ctx, id);
  if (!own) throw forbidden();
  if (g.status === "CLOSED") throw conflict("Already closed.");
  await db.$transaction(async (tx) => {
    await tx.grievance.update({ where: { id }, data: { status: "CLOSED", closedAt: new Date() } });
    await tx.grievanceAction.create({ data: { grievanceId: id, actorId: g.anonymous ? null : ctx.user.id, action: "CLOSED", note: g.status === "RESOLVED" ? "Accepted the decision." : "Withdrawn by the complainant." } });
  });
}

/** Overdue grievances move up a level by themselves (worker job). */
export async function escalateOverdueGrievances(now = new Date()): Promise<number> {
  const overdue = await db.grievance.findMany({ where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "APPEALED"] }, dueAt: { lt: now }, level: { not: "OMBUDSPERSON" } }, select: { id: true, level: true } });
  for (const g of overdue) await escalate(g.id, NEXT[g.level]!, "No decision within the time limit; escalated automatically.", null, "UNDER_REVIEW");
  return overdue.length;
}

// ───────────────────────── Anti-ragging undertakings ─────────────────────────

export async function submitUndertaking(ctx: AuthContext, referenceNo: string) {
  const studentId = ctx.subject.studentId;
  if (!studentId) throw forbidden();
  const ref = referenceNo.trim();
  if (!/^[A-Za-z0-9/-]{6,40}$/.test(ref)) throw invalid("Enter the reference number from the anti-ragging undertaking e-mail.");
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  await db.antiRaggingUndertaking.upsert({ where: { studentId_academicYearId: { studentId, academicYearId: year.id } }, create: { studentId, academicYearId: year.id, referenceNo: ref }, update: { referenceNo: ref, submittedAt: new Date() } });
  await audit({ ...actor(ctx), action: "antiragging.undertaking", resourceType: "student", resourceId: studentId, summary: `${year.label}: ${ref}` });
}

export async function undertakingCompliance(ctx: AuthContext) {
  if (!can(ctx, "antiragging.manage")) throw forbidden();
  const year = await db.academicYear.findFirstOrThrow({ where: { isCurrent: true } });
  const [students, done] = await Promise.all([
    db.student.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, studentNo: true, firstName: true, lastName: true, program: { select: { code: true } } }, orderBy: { studentNo: "asc" } }),
    db.antiRaggingUndertaking.findMany({ where: { academicYearId: year.id }, select: { studentId: true, referenceNo: true, submittedAt: true } }),
  ]);
  const byStudent = new Map(done.map((d) => [d.studentId, d]));
  return { year, total: students.length, submitted: done.length, missing: students.filter((s) => !byStudent.has(s.id)) };
}
