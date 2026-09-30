import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { bandsSchema } from "@/lib/domain/grading";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { computeRunInTx, reviseCourseResult } from "@/server/services/result-engine";
import { startWorkflow } from "@/server/services/workflow";
import type { ResultRunData } from "@/server/workflow/modules/exam";

// ───────────────────────── Grading schemes ─────────────────────────

export const gradingSchemeSchema = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,16}$/),
    name: z.string().trim().min(3).max(120),
    bands: bandsSchema,
    passPercent: z.number().min(0).max(100),
    minExternalPercent: z.number().min(0).max(100),
    minInternalPercent: z.number().min(0).max(100),
    absentGrade: z.string().trim().min(1).max(4),
    failGrade: z.string().trim().min(1).max(4),
    withheldGrade: z.string().trim().min(1).max(4),
    graceMaxPerCourse: z.number().min(0).max(20),
    graceMaxTotal: z.number().min(0).max(100),
    gpaDecimals: z.number().int().min(0).max(4),
  })
  .refine((v) => v.bands.filter((b) => b.pass).every((b) => b.minPercent >= v.passPercent), { path: ["bands"], message: "Passing grades must start at or above the pass percentage" });

/** Draft schemes are edited in place; saving an active scheme creates the next version as a draft. */
export async function saveGradingScheme(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "grading.manage")) throw forbidden();
  const v = gradingSchemeSchema.parse(raw);
  const data = { ...v, bands: v.bands as Prisma.InputJsonValue };
  return db.$transaction(async (tx) => {
    let saved;
    if (id) {
      const cur = await tx.gradingScheme.findUnique({ where: { id } });
      if (!cur) throw notFound("Grading scheme");
      if (cur.code !== v.code) throw invalid("The code of a scheme cannot change.");
      if (cur.status === "DRAFT") saved = await tx.gradingScheme.update({ where: { id }, data });
      else {
        const latest = await tx.gradingScheme.findFirst({ where: { code: v.code }, orderBy: { version: "desc" } });
        saved = await tx.gradingScheme.create({ data: { ...data, version: (latest?.version ?? 0) + 1, status: "DRAFT" } });
      }
    } else {
      if (await tx.gradingScheme.findFirst({ where: { code: v.code } })) throw conflict("A scheme with this code exists; edit it to create a new version.");
      saved = await tx.gradingScheme.create({ data: { ...data, version: 1 } });
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "grading.save", resourceType: "gradingScheme", resourceId: saved.id, summary: `${v.code} v${saved.version}`, newValue: v }, tx);
    return saved;
  });
}

export async function activateGradingScheme(ctx: AuthContext, id: string) {
  if (!can(ctx, "grading.manage")) throw forbidden();
  const g = await db.gradingScheme.findUnique({ where: { id } });
  if (!g) throw notFound("Grading scheme");
  await db.$transaction(async (tx) => {
    await tx.gradingScheme.updateMany({ where: { code: g.code, status: "ACTIVE", id: { not: id } }, data: { status: "RETIRED" } });
    await tx.gradingScheme.update({ where: { id }, data: { status: "ACTIVE" } });
    // Regulations using an older version of the same scheme move to the new version.
    await tx.regulation.updateMany({ where: { gradingScheme: { code: g.code } }, data: { gradingSchemeId: id } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "grading.activate", resourceType: "gradingScheme", resourceId: id, summary: `${g.code} v${g.version}` }, tx);
  });
}

export async function setRegulationScheme(ctx: AuthContext, regulationId: string, schemeId: string) {
  if (!can(ctx, "grading.manage")) throw forbidden();
  const g = await db.gradingScheme.findUnique({ where: { id: schemeId } });
  if (!g || g.status !== "ACTIVE") throw invalid("Choose an active grading scheme.");
  const r = await db.regulation.update({ where: { id: regulationId }, data: { gradingSchemeId: schemeId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "regulation.grading", resourceType: "regulation", resourceId: regulationId, summary: `${r.code} uses ${g.code} v${g.version}` });
}

// ───────────────────────── Result runs ─────────────────────────

export async function createRun(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "result.process")) throw forbidden();
  const v = z.object({ sessionId: z.string().min(1), programId: z.string().min(1, "Choose a programme") }).parse(raw);
  const [session, program] = await Promise.all([
    db.examinationSession.findUnique({ where: { id: v.sessionId } }),
    db.program.findUnique({ where: { id: v.programId }, include: { courses: { where: { deletedAt: null }, select: { regulation: { select: { gradingSchemeId: true, code: true } } }, take: 1 } } }),
  ]);
  if (!session) throw notFound("Session");
  if (!program) throw notFound("Programme");
  if (!session.termId) throw invalid("Link the session to its teaching term first.");
  const schemeId = program.courses[0]?.regulation.gradingSchemeId ?? (await db.gradingScheme.findFirst({ where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" } }))?.id;
  if (!schemeId) throw invalid("No active grading scheme. Create one under Results → Grading schemes.");
  if (await db.resultRun.findFirst({ where: { sessionId: v.sessionId, programId: v.programId } })) throw conflict("A result run already exists for this session and programme.");
  const run = await db.resultRun.create({ data: { sessionId: v.sessionId, programId: v.programId, termId: session.termId, gradingSchemeId: schemeId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "result.run.create", resourceType: "resultRun", resourceId: run.id, summary: `${session.code} · ${program.code}` });
  return run;
}

export async function computeRun(ctx: AuthContext, runId: string) {
  if (!can(ctx, "result.process")) throw forbidden();
  return db.$transaction((tx) => computeRunInTx(tx, runId, { id: ctx.user.id, name: ctx.user.name }), { timeout: 10 * 60_000, maxWait: 30_000 });
}

/** Send computed results into the publication workflow (department → Controller → Registrar). */
export async function submitRun(ctx: AuthContext, runId: string) {
  if (!can(ctx, "result.process")) throw forbidden();
  const run = await db.resultRun.findUnique({ where: { id: runId }, include: { session: true, program: true } });
  if (!run || !run.program) throw notFound("Result run");
  if (run.status !== "COMPUTED") throw workflowError("Compute the results before submitting them.");
  const incomplete = await db.courseResult.count({ where: { runId, status: "INCOMPLETE" } });
  if (incomplete) throw workflowError(`${incomplete} result(s) are incomplete. Finish the marks or withhold those results first.`);
  const stats = (run.stats ?? {}) as { students?: number; courses?: number; passPercent?: number; warnings?: string[] };
  const data: ResultRunData = { runId, session: run.session.name, program: `${run.program.code} — ${run.program.name}`, students: stats.students ?? 0, courses: stats.courses ?? 0, passPercent: stats.passPercent ?? 0, warnings: stats.warnings?.length ?? 0 };
  return db.$transaction(async (tx) => {
    await tx.resultRun.update({ where: { id: runId }, data: { status: "IN_APPROVAL" } });
    const inst = await startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "result.publication", resourceType: "resultRun", resourceId: runId, title: `Results: ${run.session.code} · ${run.program!.code}`,
      summary: `${data.students} students · pass rate ${data.passPercent}%`, departmentId: run.program!.departmentId, data: data as unknown as Record<string, unknown>,
    });
    return inst;
  });
}

/** Withhold one result (e.g. malpractice enquiry, dues). Before publication the row is marked; after, a revision is recorded. */
export async function withholdResult(ctx: AuthContext, courseResultId: string, reason: string | null) {
  if (!can(ctx, "result.withhold")) throw forbidden();
  const r = await db.courseResult.findUnique({ where: { id: courseResultId }, include: { run: true } });
  if (!r || !r.isCurrent) throw notFound("Result");
  const actor = { id: ctx.user.id, name: ctx.user.name };
  if (reason !== null && String(reason).trim().length < 5) throw invalid("Give the reason for withholding.");
  if (!r.publishedAt) {
    if (!["DRAFT", "COMPUTED"].includes(r.run.status)) throw workflowError("The results are in approval. Withdraw the approval request first.");
    if (reason === null) {
      // Releasing a pre-publication withhold: recompute the run so the result is graded normally.
      await db.courseResult.update({ where: { id: r.id }, data: { status: "INCOMPLETE", withheldReason: null } });
      return computeRun(ctx, r.runId);
    }
    await db.$transaction(async (tx) => {
      await tx.courseResult.update({ where: { id: r.id }, data: { status: "WITHHELD", withheldReason: reason, grade: "WH", gradePoint: 0, creditPoints: 0 } });
      await audit({ actorId: actor.id, actorName: actor.name, action: "result.withhold", resourceType: "student", resourceId: r.studentId, summary: `Result withheld before publication — ${reason}` }, tx);
    });
    return null;
  }
  return db.$transaction((tx) => reviseCourseResult(tx, courseResultId, { withheldReason: reason }, reason ? `Withheld: ${reason}` : "Withhold released", actor));
}

// ───────────────────────── Queries ─────────────────────────

/** Current results visible to the caller: own/ward (published only) or staff scope. */
export function resultWhere(ctx: AuthContext): Prisma.CourseResultWhereInput {
  const self = [ctx.subject.studentId, ...ctx.subject.wardStudentIds].filter((x): x is string => !!x);
  const scope = scopeOf(ctx, "result.view");
  if (scope === null) return {};
  const or: Prisma.CourseResultWhereInput[] = [];
  if (self.length) or.push({ studentId: { in: self }, publishedAt: { not: null } });
  if (scope.length) or.push({ student: { departmentId: { in: scope } } });
  return { OR: or.length ? or : [{ id: "__none__" }] };
}

export async function studentResults(ctx: AuthContext, studentId: string) {
  const [courses, terms] = await Promise.all([
    db.courseResult.findMany({
      where: { AND: [resultWhere(ctx), { studentId, isCurrent: true }] },
      include: { course: { select: { code: true, title: true } }, run: { select: { status: true, publishedAt: true, session: { select: { name: true, revaluationUntil: true } }, term: { select: { id: true, name: true, startDate: true } } } }, revaluations: { orderBy: { requestedAt: "desc" }, take: 1 } },
      orderBy: [{ run: { term: { startDate: "desc" } } }, { course: { code: "asc" } }],
    }),
    db.termResult.findMany({ where: { studentId, isCurrent: true, ...(ctx.subject.studentId === studentId || ctx.subject.wardStudentIds.includes(studentId) ? { publishedAt: { not: null } } : {}) }, orderBy: { createdAt: "desc" } }),
  ]);
  return { courses, terms, cgpa: terms[0]?.cgpa ?? null };
}
