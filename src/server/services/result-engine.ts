import "server-only";
import type { CourseResult, Prisma } from "@/generated/prisma/client";
import { aggregateComponents, bandsSchema, cgpa, computeCourse, gpa, type GradingSpec } from "@/lib/domain/grading";
import type { Tx } from "@/server/db";
import { invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { emitEvent } from "@/server/services/events";
import { notify } from "@/server/services/notifications";

/**
 * Result processing inside a transaction. Free of workflow imports so the result-publication workflow
 * can call `publishRunInTx` from its approval hook.
 */

export async function gradingSpec(tx: Tx, schemeId: string): Promise<GradingSpec> {
  const g = await tx.gradingScheme.findUnique({ where: { id: schemeId } });
  if (!g) throw notFound("Grading scheme");
  return {
    bands: bandsSchema.parse(g.bands), passPercent: g.passPercent, minExternalPercent: g.minExternalPercent, minInternalPercent: g.minInternalPercent,
    absentGrade: g.absentGrade, failGrade: g.failGrade, withheldGrade: g.withheldGrade, graceMaxPerCourse: g.graceMaxPerCourse, gpaDecimals: g.gpaDecimals,
  };
}

type Input = {
  studentId: string;
  courseId: string;
  credits: number;
  internalMax: number;
  externalMax: number;
  internal: number | null;
  external: number | null;
  externalAbsent: boolean;
  malpractice: boolean;
  attemptType: "REGULAR" | "REPEAT" | "IMPROVEMENT";
};

/** Gather the marks for every registered candidate of the run's examinations. */
async function inputsForRun(tx: Tx, runId: string): Promise<{ inputs: Input[]; warnings: string[] }> {
  const run = await tx.resultRun.findUniqueOrThrow({ where: { id: runId } });
  const exams = await tx.examination.findMany({
    where: { sessionId: run.sessionId, ...(run.programId ? { course: { programId: run.programId } } : {}) },
    include: { course: { select: { id: true, code: true, credits: true, internalMarks: true, externalMarks: true } } },
  });
  const warnings: string[] = [];
  const inputs: Input[] = [];
  for (const exam of exams) {
    const regs = await tx.examRegistration.findMany({ where: { examinationId: exam.id, status: "REGISTERED" }, include: { script: true } });
    if (!regs.length) continue;
    const offerings = await tx.courseOffering.findMany({ where: { courseId: exam.courseId, termId: run.termId }, select: { id: true } });
    const components = await tx.assessmentComponent.findMany({
      where: { offeringId: { in: offerings.map((o) => o.id) }, kind: { not: "EXTERNAL" } },
      include: { sheet: true, marks: { where: { studentId: { in: regs.map((r) => r.studentId) } } }, offering: { select: { id: true, registrations: { select: { studentId: true } } } } },
    });
    const unapproved = components.filter((c) => c.sheet?.status !== "APPROVED");
    if (unapproved.length) warnings.push(`${exam.course.code}: ${unapproved.length} internal mark sheet(s) not approved yet`);
    const unvalued = regs.filter((r) => !r.script || (!r.script.absent && r.script.finalMarks === null));
    if (unvalued.length) warnings.push(`${exam.course.code}: ${unvalued.length} answer script(s) not finally valued`);
    for (const reg of regs) {
      // The student's own section: components of the offering they were registered in.
      const mine = components.filter((c) => c.offering.registrations.some((x) => x.studentId === reg.studentId));
      const internal = exam.course.internalMarks === 0
        ? { marks: 0, malpractice: false }
        : mine.length === 0 || mine.some((c) => c.sheet?.status !== "APPROVED")
          ? { marks: null, malpractice: false }
          : aggregateComponents(mine.map((c) => {
              const m = c.marks.find((x) => x.studentId === reg.studentId);
              return { maxMarks: c.maxMarks, weight: c.weight, marks: m?.marks ?? null, status: m?.status ?? "PRESENT" };
            }));
      const scaledInternal = internal.marks === null ? null : Math.min(exam.course.internalMarks, internal.marks);
      const s = reg.script;
      const external = !s || s.absent || s.finalMarks === null ? null : Math.round((s.finalMarks / exam.maxMarks) * exam.course.externalMarks * 100) / 100;
      inputs.push({
        studentId: reg.studentId, courseId: exam.courseId, credits: exam.course.credits, internalMax: exam.course.internalMarks, externalMax: exam.course.externalMarks,
        internal: scaledInternal, external, externalAbsent: !!s?.absent, malpractice: internal.malpractice || !!s?.malpractice, attemptType: reg.attemptType,
      });
    }
  }
  return { inputs, warnings };
}

/** Recompute an unpublished run from current marks. Replaces the run's draft rows; published runs are refused. */
export async function computeRunInTx(tx: Tx, runId: string, actor: { id: string; name: string }) {
  const run = await tx.resultRun.findUniqueOrThrow({ where: { id: runId } });
  if (!["DRAFT", "COMPUTED"].includes(run.status)) throw workflowError("Results can be recomputed only before they are submitted for approval.");
  const spec = await gradingSpec(tx, run.gradingSchemeId);
  const { graceMaxTotal } = await tx.gradingScheme.findUniqueOrThrow({ where: { id: run.gradingSchemeId }, select: { graceMaxTotal: true } });
  const { inputs, warnings } = await inputsForRun(tx, runId);
  // Withholds recorded before publication survive a recompute.
  const withheld = new Map((await tx.courseResult.findMany({ where: { runId, status: "WITHHELD" }, select: { studentId: true, courseId: true, withheldReason: true } })).map((r) => [`${r.studentId}:${r.courseId}`, r.withheldReason ?? "Withheld"] as const));
  await tx.termResult.deleteMany({ where: { runId } });
  await tx.courseResult.deleteMany({ where: { runId } });
  const byStudent = new Map<string, Input[]>();
  for (const i of inputs) (byStudent.get(i.studentId) ?? byStudent.set(i.studentId, []).get(i.studentId)!).push(i);
  const counts = { students: byStudent.size, courses: inputs.length, pass: 0, fail: 0, absent: 0, incomplete: 0, withheld: 0, graceUsed: 0 };
  for (const [studentId, list] of byStudent) {
    let graceLeft = graceMaxTotal;
    // Attempt number: one more than earlier current results for the course.
    for (const i of list.sort((a, b) => a.courseId.localeCompare(b.courseId))) {
      const prior = await tx.courseResult.count({ where: { studentId, courseId: i.courseId, isCurrent: true, runId: { not: runId } } });
      const withheldReason = withheld.get(`${studentId}:${i.courseId}`) ?? null;
      const outcome = computeCourse({ ...i, withheld: withheldReason }, spec, graceLeft);
      graceLeft -= outcome.graceMarks;
      counts.graceUsed += outcome.graceMarks;
      counts[outcome.status === "PASS" ? "pass" : outcome.status === "FAIL" ? "fail" : outcome.status === "ABSENT" ? "absent" : outcome.status === "WITHHELD" ? "withheld" : "incomplete"]++;
      await tx.courseResult.create({
        data: {
          runId, studentId, courseId: i.courseId, termId: run.termId, attempt: prior + 1, attemptType: prior ? (i.attemptType === "IMPROVEMENT" ? "IMPROVEMENT" : "REPEAT") : "REGULAR",
          internalMarks: outcome.internalMarks, externalMarks: outcome.externalMarks, graceMarks: outcome.graceMarks, totalMarks: outcome.totalMarks, maxMarks: outcome.maxMarks,
          percent: outcome.percent, grade: outcome.grade, gradePoint: outcome.gradePoint, credits: i.credits, creditPoints: outcome.creditPoints, status: outcome.status,
          withheldReason,
        },
      });
    }
    await writeTermResult(tx, studentId, run.termId, runId, spec.gpaDecimals, false);
  }
  const stats = { ...counts, passPercent: counts.courses ? Math.round((counts.pass / counts.courses) * 1000) / 10 : 0, warnings };
  await tx.resultRun.update({ where: { id: runId }, data: { status: "COMPUTED", computedAt: new Date(), computedById: actor.id, stats: stats as Prisma.InputJsonValue } });
  await audit({ actorId: actor.id, actorName: actor.name, action: "result.compute", resourceType: "resultRun", resourceId: runId, summary: `${counts.courses} course results for ${counts.students} students; ${warnings.length} warning(s)`, newValue: stats }, tx);
  return stats;
}

/** (Re)write the student's term result from their current course results. */
async function writeTermResult(tx: Tx, studentId: string, termId: string, runId: string, decimals: number, publish: boolean) {
  const all = await tx.courseResult.findMany({ where: { studentId, isCurrent: true } });
  const term = all.filter((r) => r.termId === termId);
  if (!term.length) return null;
  const t = gpa(term.map((r) => ({ courseId: r.courseId, credits: r.credits, gradePoint: r.gradePoint, status: r.status })), decimals);
  const c = cgpa(all.map((r) => ({ courseId: r.courseId, credits: r.credits, gradePoint: r.gradePoint, status: r.status, attempt: r.attempt })), decimals);
  const status = term.some((r) => r.status === "WITHHELD") ? "WITHHELD" : term.every((r) => r.status === "PASS") ? "PASS" : "FAIL_SOME";
  const prev = await tx.termResult.findFirst({ where: { studentId, termId, isCurrent: true } });
  if (prev && prev.runId === runId && !prev.publishedAt) {
    return tx.termResult.update({ where: { id: prev.id }, data: { creditsRegistered: t.credits, creditsEarned: t.creditsEarned, creditPoints: t.creditPoints, sgpa: t.gpa, cgpa: c.gpa, cumulativeCredits: c.creditsEarned, status } });
  }
  if (prev) await tx.termResult.update({ where: { id: prev.id }, data: { isCurrent: false } });
  return tx.termResult.create({
    data: {
      runId, studentId, termId, version: (prev?.version ?? 0) + 1, creditsRegistered: t.credits, creditsEarned: t.creditsEarned, creditPoints: t.creditPoints,
      sgpa: t.gpa, cgpa: c.gpa, cumulativeCredits: c.creditsEarned, status, publishedAt: publish ? new Date() : null,
    },
  });
}

/** Publish an approved run: stamp every row, complete the registrations, tell the students. */
export async function publishRunInTx(tx: Tx, runId: string) {
  const run = await tx.resultRun.findUniqueOrThrow({ where: { id: runId }, include: { session: { select: { name: true } }, term: { select: { id: true } } } });
  const incomplete = await tx.courseResult.count({ where: { runId, status: "INCOMPLETE" } });
  if (incomplete) throw workflowError(`${incomplete} result(s) are incomplete. Complete the marks or withhold those results before publishing.`);
  const now = new Date();
  await tx.courseResult.updateMany({ where: { runId, publishedAt: null }, data: { publishedAt: now } });
  await tx.termResult.updateMany({ where: { runId, publishedAt: null }, data: { publishedAt: now } });
  await tx.resultRun.update({ where: { id: runId }, data: { status: "PUBLISHED", publishedAt: now } });
  const results = await tx.courseResult.findMany({ where: { runId }, select: { studentId: true, courseId: true } });
  for (const r of results) {
    await tx.courseRegistration.updateMany({ where: { studentId: r.studentId, status: "REGISTERED", offering: { courseId: r.courseId, termId: run.termId } }, data: { status: "COMPLETED" } });
  }
  const students = [...new Set(results.map((r) => r.studentId))];
  const accounts = await tx.student.findMany({ where: { id: { in: students } }, select: { userId: true, guardians: { where: { canViewAcademic: true, userId: { not: null } }, select: { userId: true } } } });
  await notify({ userIds: accounts.flatMap((a) => [a.userId, ...a.guardians.map((g) => g.userId)]), type: "result.published", title: `Results published: ${run.session.name}`, body: "Your results are now available in the portal.", link: "/portal/results" }, tx);
  await emitEvent(tx, { type: "ResultPublished", aggregateType: "resultRun", aggregateId: runId, payload: { students: students.length } });
  await audit({ actorId: null, actorName: "Workflow", action: "result.publish", resourceType: "resultRun", resourceId: runId, summary: `${run.session.name}: ${results.length} results published for ${students.length} students` }, tx);
}

/**
 * Revise a published (or draft) course result. A new version is inserted and becomes current; the
 * previous version stays in history. The term result (SGPA/CGPA) is re-derived as a new version too.
 */
export async function reviseCourseResult(
  tx: Tx,
  courseResultId: string,
  change: { externalMarks?: number; withheldReason?: string | null },
  reason: string,
  actor: { id: string; name: string },
): Promise<CourseResult> {
  const cur = await tx.courseResult.findUnique({ where: { id: courseResultId }, include: { run: true, course: { select: { code: true, internalMarks: true, externalMarks: true } } } });
  if (!cur || !cur.isCurrent) throw notFound("Current result");
  const spec = await gradingSpec(tx, cur.run.gradingSchemeId);
  const withheld = change.withheldReason === undefined ? (cur.status === "WITHHELD" ? cur.withheldReason : null) : change.withheldReason;
  const external = change.externalMarks ?? cur.externalMarks;
  if (external !== null && (external < 0 || external > cur.course.externalMarks)) throw invalid(`External marks must be between 0 and ${cur.course.externalMarks}.`);
  const outcome = computeCourse(
    { credits: cur.credits, internalMax: cur.course.internalMarks, externalMax: cur.course.externalMarks, internal: cur.internalMarks, external, externalAbsent: cur.status === "ABSENT" && change.externalMarks === undefined, withheld },
    spec,
    cur.graceMarks, // a revision may keep, but never increase, the grace already granted
  );
  await tx.courseResult.update({ where: { id: cur.id }, data: { isCurrent: false } });
  const next = await tx.courseResult.create({
    data: {
      runId: cur.runId, studentId: cur.studentId, courseId: cur.courseId, termId: cur.termId, attempt: cur.attempt, attemptType: cur.attemptType, version: cur.version + 1,
      internalMarks: outcome.internalMarks, externalMarks: outcome.externalMarks, graceMarks: outcome.graceMarks, totalMarks: outcome.totalMarks, maxMarks: outcome.maxMarks,
      percent: outcome.percent, grade: outcome.grade, gradePoint: outcome.gradePoint, credits: cur.credits, creditPoints: outcome.creditPoints, status: outcome.status,
      withheldReason: withheld ?? null, revisionReason: reason, publishedAt: cur.publishedAt ? new Date() : null,
    },
  });
  await writeTermResult(tx, cur.studentId, cur.termId, cur.runId, spec.gpaDecimals, !!cur.publishedAt);
  await audit(
    {
      actorId: actor.id, actorName: actor.name, action: "result.revise", resourceType: "student", resourceId: cur.studentId,
      summary: `${cur.course.code}: ${cur.grade} → ${outcome.grade} (v${next.version}) — ${reason}`,
      oldValue: { version: cur.version, grade: cur.grade, externalMarks: cur.externalMarks, status: cur.status },
      newValue: { version: next.version, grade: outcome.grade, externalMarks: outcome.externalMarks, status: outcome.status },
    },
    tx,
  );
  return next;
}
