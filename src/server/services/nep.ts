import "server-only";
import { z } from "zod";
import { bestExitAward, exitEligibility, transferCreditsAvailable, yearsOfStudy } from "@/lib/domain/compliance";
import { assertStudentPerm, loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";
import { startWorkflow } from "@/server/services/workflow";
import { saveFile } from "@/server/storage";

/**
 * NEP 2020: multiple entry and exit, and credit transfer.
 *
 * A programme lists the awards a student may leave with (certificate, diploma, degree…) and the credits
 * and years each needs. A student (or the office) requests an exit; the HoD and the Registrar approve it
 * through the workflow engine, which sets the status to EXITED and issues a sealed exit certificate with
 * the credits earned. Re-entry within the award's window is a normal status change back to ACTIVE.
 *
 * Credits earned elsewhere (SWAYAM, NPTEL, other MOOCs, other institutions) are submitted with the
 * certificate and reviewed in the student's department, up to the configured share of programme credits.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

// ───────────────────────── Credits ─────────────────────────

/** Credits earned: passed courses (each counted once) plus approved transfer credits not mapped to a passed course. */
export async function creditsEarned(studentId: string, client: Tx | typeof db = db) {
  const [results, external] = await Promise.all([
    client.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: "PASS" }, select: { courseId: true, credits: true } }),
    client.externalCredit.findMany({ where: { studentId, status: "APPROVED" }, select: { credits: true, mappedCourseId: true } }),
  ]);
  const byCourse = new Map(results.map((r) => [r.courseId, r.credits]));
  let ext = 0;
  for (const e of external) {
    if (e.mappedCourseId && byCourse.has(e.mappedCourseId)) continue; // the course itself was passed later
    if (e.mappedCourseId) byCourse.set(e.mappedCourseId, e.credits);
    else ext += e.credits;
  }
  const internal = [...byCourse.values()].reduce((a, c) => a + c, 0);
  return { total: Math.round((internal + ext) * 10) / 10, external: Math.round(external.reduce((a, e) => a + e.credits, 0) * 10) / 10 };
}

/** Total credits of the programme: the batch curriculum, else the programme's active curriculum. */
export async function programmeCredits(studentId: string, client: Tx | typeof db = db): Promise<number | null> {
  const s = await client.student.findUniqueOrThrow({ where: { id: studentId }, select: { programId: true, batch: { select: { curriculum: { select: { totalCredits: true } } } } } });
  if (s.batch.curriculum) return s.batch.curriculum.totalCredits;
  const c = await client.curriculum.findFirst({ where: { programId: s.programId, status: "ACTIVE" }, orderBy: { version: "desc" }, select: { totalCredits: true } });
  return c?.totalCredits ?? null;
}

// ───────────────────────── Exit awards ─────────────────────────

const awardSchema = z.object({
  level: z.number().int().min(1).max(10),
  title: z.string().trim().min(3).max(120),
  minCredits: z.number().min(0).max(400),
  minYears: z.number().min(0).max(10),
  reentryYears: z.number().int().min(0).max(15),
});

export async function saveExitAward(ctx: AuthContext, programId: string, id: string | null, raw: unknown) {
  if (!can(ctx, "nep.manage")) throw forbidden();
  const v = awardSchema.parse(raw);
  const program = await db.program.findUnique({ where: { id: programId } });
  if (!program) throw notFound("Programme");
  const clash = await db.programExitAward.findFirst({ where: { programId, level: v.level, ...(id ? { id: { not: id } } : {}) } });
  if (clash) throw conflict(`Level ${v.level} already exists for ${program.code}.`);
  const a = id ? await db.programExitAward.update({ where: { id }, data: v }) : await db.programExitAward.create({ data: { ...v, programId } });
  await audit({ ...actor(ctx), action: "nep.award.save", resourceType: "program", resourceId: programId, summary: `${program.code} L${v.level}: ${v.title} (${v.minCredits} credits, ${v.minYears} yr)` });
  return a;
}

export async function deleteExitAward(ctx: AuthContext, id: string) {
  if (!can(ctx, "nep.manage")) throw forbidden();
  const a = await db.programExitAward.findUnique({ where: { id }, include: { _count: { select: { requests: true } }, program: { select: { code: true } } } });
  if (!a) throw notFound("Award");
  if (a._count.requests) throw workflowError("Students have requested this award; it cannot be removed.");
  await db.programExitAward.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "nep.award.delete", resourceType: "program", resourceId: a.programId, summary: `${a.program.code} L${a.level}: ${a.title}` });
}

/** What a student could exit with now. */
export async function exitOptions(ctx: AuthContext, studentId: string) {
  const s = await loadStudentFor(ctx, studentId);
  const [awards, credits, pending, history] = await Promise.all([
    db.programExitAward.findMany({ where: { programId: s.programId }, orderBy: { level: "asc" } }),
    creditsEarned(studentId),
    db.exitRequest.findFirst({ where: { studentId, status: "PENDING" }, include: { award: true } }),
    db.exitRequest.findMany({ where: { studentId }, include: { award: true }, orderBy: { createdAt: "desc" } }),
  ]);
  const years = yearsOfStudy(s.admittedOn, new Date());
  return {
    student: s,
    credits: credits.total,
    years,
    awards: awards.map((a) => ({ ...a, ...exitEligibility(a, credits.total, years) })),
    best: bestExitAward(awards, credits.total, years),
    pending,
    history,
  };
}

function assertCanActFor(ctx: AuthContext, s: { id: string; departmentId: string }) {
  if (ctx.subject.studentId === s.id) return;
  assertStudentPerm(ctx, "student.status", s.departmentId);
}

export async function requestExit(ctx: AuthContext, studentId: string, raw: unknown) {
  const s = await loadStudentFor(ctx, studentId);
  assertCanActFor(ctx, s);
  const v = z.object({ awardId: z.string(), reason: z.string().trim().min(10, "Give the reason (at least 10 characters)").max(1000) }).parse(raw);
  if (!["ACTIVE", "ON_LEAVE"].includes(s.status)) throw workflowError("Only active students (or students on leave) can exit with an award.");
  const award = await db.programExitAward.findFirst({ where: { id: v.awardId, programId: s.programId } });
  if (!award) throw invalid("Choose an award offered by the student's programme.");
  const credits = await creditsEarned(studentId);
  const check = exitEligibility(award, credits.total, yearsOfStudy(s.admittedOn, new Date()));
  if (!check.eligible) throw workflowError(`Not yet eligible for ${award.title}: ${check.reasons.join(" ")}`);
  if (await db.exitRequest.findFirst({ where: { studentId, status: "PENDING" } })) throw conflict("An exit request is already awaiting approval.");
  const program = await db.program.findUniqueOrThrow({ where: { id: s.programId }, select: { code: true } });
  return db.$transaction(async (tx) => {
    const req = await tx.exitRequest.create({ data: { studentId, awardId: award.id, reason: v.reason, creditsEarned: credits.total, createdById: ctx.user.id } });
    const wf = await startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "student.exit",
      resourceType: "exitRequest",
      resourceId: req.id,
      title: `${s.firstName} ${s.lastName} (${s.studentNo}): exit with ${award.title}`,
      summary: v.reason,
      departmentId: s.departmentId,
      subjectUserId: s.userId,
      data: { requestId: req.id, studentId, studentNo: s.studentNo, studentName: `${s.firstName} ${s.lastName}`, programCode: program.code, award: award.title, level: award.level, credits: credits.total, reason: v.reason },
    });
    await tx.exitRequest.update({ where: { id: req.id }, data: { workflowId: wf.id } });
    await audit({ ...actor(ctx), action: "nep.exit.request", resourceType: "student", resourceId: studentId, summary: `${s.studentNo}: exit with ${award.title} (${credits.total} credits)` }, tx);
    return req;
  });
}

/** Re-entry is allowed while the window of the student's latest approved exit is open. */
export async function reentryWindow(studentId: string, client: Tx | typeof db = db): Promise<Date | null> {
  const last = await client.exitRequest.findFirst({ where: { studentId, status: "APPROVED" }, orderBy: { decidedAt: "desc" }, select: { reentryUntil: true } });
  return last?.reentryUntil ?? null;
}

// ───────────────────────── Credit transfer ─────────────────────────

const externalSchema = z.object({
  source: z.enum(["SWAYAM", "NPTEL", "MOOC", "INSTITUTION"]),
  provider: z.string().trim().min(2).max(120),
  courseTitle: z.string().trim().min(3).max(200),
  courseCode: z.string().trim().max(40).nullable().optional(),
  credits: z.coerce.number().positive().max(40),
  grade: z.string().trim().max(10).nullable().optional(),
  completedOn: z.coerce.date(),
  certificateNo: z.string().trim().max(80).nullable().optional(),
});

export async function submitExternalCredit(ctx: AuthContext, studentId: string, form: FormData) {
  const s = await loadStudentFor(ctx, studentId);
  if (ctx.subject.studentId !== studentId) assertStudentPerm(ctx, "student.update", s.departmentId);
  const blank = (k: string) => { const x = form.get(k); return x === null || x === "" ? null : String(x); };
  const v = externalSchema.parse({ source: blank("source"), provider: blank("provider"), courseTitle: blank("courseTitle"), courseCode: blank("courseCode"), credits: blank("credits"), grade: blank("grade"), completedOn: blank("completedOn"), certificateNo: blank("certificateNo") });
  if (v.completedOn > new Date()) throw invalid("The completion date cannot be in the future.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw invalid("Attach the certificate (PDF or image).");
  const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: file.name, kind: "STUDENT_DOCUMENT", ownerId: ctx.user.id });
  const e = await db.externalCredit.create({ data: { ...v, courseCode: v.courseCode ?? null, grade: v.grade ?? null, certificateNo: v.certificateNo ?? null, studentId, certificateAssetId: asset.id } });
  const reviewers = (await usersWithPermission("credittransfer.review", s.departmentId)).filter((u) => u !== ctx.user.id);
  await notify({ userIds: reviewers, type: "nep.credit", title: `Credit transfer to review: ${s.studentNo}`, body: `${v.courseTitle} (${v.provider}, ${v.credits} credits)`, link: "/academics/credit-transfer", email: false });
  await audit({ ...actor(ctx), action: "nep.credit.submit", resourceType: "student", resourceId: studentId, summary: `${s.studentNo}: ${v.source} ${v.courseTitle} (${v.credits} cr)` });
  return e;
}

export async function reviewExternalCredit(ctx: AuthContext, id: string, raw: unknown) {
  const v = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), credits: z.number().positive().max(40).optional(), mappedCourseId: z.string().nullable().optional(), remarks: z.string().trim().max(1000).nullable().optional() }).parse(raw);
  const e = await db.externalCredit.findUnique({ where: { id }, include: { student: { select: { id: true, studentNo: true, departmentId: true, userId: true, programId: true } } } });
  if (!e) throw notFound("Credit transfer");
  if (!can(ctx, "credittransfer.review", e.student.departmentId)) throw forbidden();
  if (e.status !== "PENDING") throw workflowError("This request has already been decided.");
  if (e.student.userId === ctx.user.id) throw forbidden("You cannot decide your own request.");
  if (v.decision === "REJECTED" && (v.remarks ?? "").length < 5) throw invalid("Say why the credits were not accepted.");
  const credits = v.credits ?? e.credits;
  if (v.decision === "APPROVED") {
    const [total, approved] = await Promise.all([programmeCredits(e.studentId), db.externalCredit.aggregate({ where: { studentId: e.studentId, status: "APPROVED" }, _sum: { credits: true } })]);
    const cfg = await getSetting("nep");
    if (total !== null) {
      const left = transferCreditsAvailable(total, cfg.externalCreditMaxPercent, approved._sum.credits ?? 0);
      if (credits > left) throw workflowError(`Only ${left} more transfer credit(s) can be accepted (${cfg.externalCreditMaxPercent}% of ${total}).`);
    }
    if (v.mappedCourseId) {
      const course = await db.course.findUnique({ where: { id: v.mappedCourseId }, select: { programId: true } });
      if (!course) throw invalid("Choose a course of the institution.");
    }
  }
  await db.externalCredit.update({ where: { id }, data: { status: v.decision, credits, mappedCourseId: v.decision === "APPROVED" ? v.mappedCourseId ?? null : null, remarks: v.remarks ?? null, reviewedById: ctx.user.id, reviewedAt: new Date() } });
  if (e.student.userId) await notify({ userIds: [e.student.userId], type: "nep.credit", title: `${e.courseTitle}: transfer credits ${v.decision === "APPROVED" ? "accepted" : "not accepted"}`, body: v.remarks ?? undefined, link: "/portal/services" });
  await audit({ ...actor(ctx), action: `nep.credit.${v.decision.toLowerCase()}`, resourceType: "student", resourceId: e.studentId, summary: `${e.student.studentNo}: ${e.courseTitle} (${credits} cr)${v.remarks ? ` — ${v.remarks}` : ""}` });
}
