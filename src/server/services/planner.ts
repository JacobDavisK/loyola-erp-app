import "server-only";
import { z } from "zod";
import { auditDegree, extraRequirementsSchema, type CurriculumSpec, type RecordEntry } from "@/lib/domain/degree-audit";
import { checkPlan, type PlanCourse } from "@/lib/domain/success";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { passedCourseIds } from "@/server/services/academic-record";
import { getSetting } from "@/server/services/settings";
import { isMentorOf } from "@/server/services/mentoring";

/**
 * Degree planner. Students lay out the courses of their curriculum they still need over the coming
 * semesters; the plan is checked against prerequisites, the per-term credit limit and the remaining
 * mandatory courses, and tells them when they would finish. A "what-if" compares their record with
 * another programme's curriculum. Mentors can edit their mentees' plans.
 */

async function canEdit(ctx: AuthContext, studentId: string) {
  return ctx.subject.studentId === studentId || (await isMentorOf(ctx, studentId)) || isSuperAdmin(ctx);
}

async function curriculumFor(studentId: string) {
  const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { programId: true, currentSemester: true, batch: { select: { curriculumId: true } } } });
  const include = { courses: { include: { course: { select: { id: true, code: true, title: true, credits: true, courseType: true, prerequisites: { select: { prerequisiteId: true } } } }, group: { select: { code: true } } } }, groups: true } as const;
  const c = s.batch.curriculumId
    ? await db.curriculum.findUnique({ where: { id: s.batch.curriculumId }, include })
    : await db.curriculum.findFirst({ where: { programId: s.programId, status: "ACTIVE" }, orderBy: { version: "desc" }, include });
  return { student: s, curriculum: c };
}

export async function plannerData(ctx: AuthContext, studentId: string) {
  const s = await loadStudentFor(ctx, studentId);
  const { curriculum } = await curriculumFor(studentId);
  if (!curriculum) return null;
  const [passed, inProgress, entries, academic] = await Promise.all([
    passedCourseIds(studentId),
    db.courseRegistration.findMany({ where: { studentId, status: "REGISTERED" }, select: { offering: { select: { courseId: true } } } }),
    db.planEntry.findMany({ where: { studentId } }),
    getSetting("academic"),
  ]);
  const external = await db.externalCredit.findMany({ where: { studentId, status: "APPROVED", mappedCourseId: { not: null } }, select: { mappedCourseId: true } });
  for (const e of external) passed.add(e.mappedCourseId!);
  const current = new Set(inProgress.map((r) => r.offering.courseId));
  const byId = new Map(curriculum.courses.map((c) => [c.courseId, c]));
  const planned = new Map(entries.map((e) => [e.courseId, e.semester]));
  // Courses being taken now count as done for planning purposes (their prerequisites are already met).
  const doneOrNow = new Set([...passed, ...current]);
  const plan: PlanCourse[] = entries.filter((e) => byId.has(e.courseId)).map((e) => {
    const c = byId.get(e.courseId)!;
    return { courseId: e.courseId, code: c.course.code, credits: c.course.credits, semester: e.semester, prerequisites: c.course.prerequisites.map((p) => p.prerequisiteId) };
  });
  const remainingMandatory = curriculum.courses.filter((c) => c.category === "MANDATORY" && !doneOrNow.has(c.courseId)).map((c) => ({ courseId: c.courseId, code: c.course.code }));
  const codeOf = (id: string) => byId.get(id)?.course.code ?? "a prerequisite";
  const check = checkPlan({ plan, passed: doneOrNow, currentSemester: s.currentSemester, maxCreditsPerSemester: academic.maxCreditsPerTerm, remainingMandatory, codeOf });
  return {
    student: s,
    curriculum,
    courses: curriculum.courses
      .map((c) => ({ courseId: c.courseId, code: c.course.code, title: c.course.title, credits: c.course.credits, semester: c.semesterNumber, category: c.category, group: c.group?.code ?? null, status: passed.has(c.courseId) ? "PASSED" as const : current.has(c.courseId) ? "IN_PROGRESS" as const : planned.has(c.courseId) ? "PLANNED" as const : "TODO" as const, plannedFor: planned.get(c.courseId) ?? null }))
      .sort((a, b) => a.semester - b.semester || a.code.localeCompare(b.code)),
    check,
    maxCredits: academic.maxCreditsPerTerm,
    editable: await canEdit(ctx, studentId),
  };
}

export async function setPlanEntry(ctx: AuthContext, studentId: string, raw: unknown) {
  await loadStudentFor(ctx, studentId);
  if (!(await canEdit(ctx, studentId))) throw forbidden();
  const v = z.object({ courseId: z.string(), semester: z.number().int().min(1).max(16).nullable() }).parse(raw);
  const { curriculum, student } = await curriculumFor(studentId);
  if (!curriculum?.courses.some((c) => c.courseId === v.courseId)) throw invalid("Plan courses from your curriculum.");
  if (v.semester === null) {
    await db.planEntry.deleteMany({ where: { studentId, courseId: v.courseId } });
    return;
  }
  if (v.semester <= student.currentSemester) throw invalid(`Plan for semester ${student.currentSemester + 1} or later.`);
  await db.planEntry.upsert({ where: { studentId_courseId: { studentId, courseId: v.courseId } }, create: { studentId, courseId: v.courseId, semester: v.semester }, update: { semester: v.semester } });
}

/** Fill the plan with every remaining mandatory course, respecting prerequisites and the credit limit. */
export async function autoPlan(ctx: AuthContext, studentId: string) {
  const data = await plannerData(ctx, studentId);
  if (!data) throw notFound("Curriculum");
  if (!data.editable) throw forbidden();
  const prereq = new Map(data.curriculum.courses.map((c) => [c.courseId, c.course.prerequisites.map((p) => p.prerequisiteId)]));
  const when = new Map<string, number>();
  for (const c of data.courses) if (c.status === "PLANNED") when.set(c.courseId, c.plannedFor!);
  const load = new Map<number, number>();
  for (const c of data.courses) if (c.status === "PLANNED") load.set(c.plannedFor!, (load.get(c.plannedFor!) ?? 0) + c.credits);
  const done = new Set(data.courses.filter((c) => c.status === "PASSED" || c.status === "IN_PROGRESS").map((c) => c.courseId));
  const todo = data.courses.filter((c) => c.status === "TODO" && c.category === "MANDATORY");
  const created: { courseId: string; semester: number }[] = [];
  // Repeatedly place courses whose prerequisites are placed, earliest curriculum semester first.
  for (let guard = 0; todo.length && guard < 200; guard++) {
    const idx = todo.findIndex((c) => (prereq.get(c.courseId) ?? []).every((p) => done.has(p) || when.has(p) || !prereq.has(p)));
    if (idx < 0) break; // a prerequisite outside the curriculum or a cycle: leave the rest for the student
    const c = todo.splice(idx, 1)[0];
    let sem = Math.max(c.semester, data.student.currentSemester + 1, ...(prereq.get(c.courseId) ?? []).map((p) => (when.get(p) ?? 0) + 1));
    while ((load.get(sem) ?? 0) + c.credits > data.maxCredits && sem < 16) sem++;
    when.set(c.courseId, sem);
    load.set(sem, (load.get(sem) ?? 0) + c.credits);
    created.push({ courseId: c.courseId, semester: sem });
  }
  if (created.length) await db.planEntry.createMany({ data: created.map((x) => ({ studentId, ...x })), skipDuplicates: true });
  return created.length;
}

/** What-if: how the student's record would stand against another programme's curriculum. */
export async function whatIf(ctx: AuthContext, studentId: string, programId: string) {
  await loadStudentFor(ctx, studentId);
  if (ctx.subject.studentId !== studentId && !can(ctx, "student.view") && !(await isMentorOf(ctx, studentId))) throw forbidden();
  const c = await db.curriculum.findFirst({
    where: { programId, status: "ACTIVE" }, orderBy: { version: "desc" },
    include: { program: { select: { code: true, name: true } }, courses: { include: { course: { select: { code: true, title: true, credits: true, courseType: true } }, group: { select: { code: true } } } }, groups: true },
  });
  if (!c) throw notFound("Curriculum");
  const spec: CurriculumSpec = {
    totalCredits: c.totalCredits, minCgpa: c.minCgpa,
    courses: c.courses.map((x) => ({ courseId: x.courseId, code: x.course.code, title: x.course.title, credits: x.course.credits, semester: x.semesterNumber, category: x.category, groupCode: x.group?.code ?? null, courseType: x.course.courseType })),
    groups: c.groups.map((g) => ({ code: g.code, name: g.name, minCredits: g.minCredits })),
    requirements: extraRequirementsSchema.catch([]).parse(c.requirements ?? []),
  };
  const passed = await db.courseResult.findMany({ where: { studentId, isCurrent: true, publishedAt: { not: null }, status: "PASS" }, select: { courseId: true, credits: true, course: { select: { code: true, courseType: true } } } });
  const record: RecordEntry[] = passed.map((p) => ({ courseId: p.courseId, code: p.course.code, credits: p.credits, courseType: p.course.courseType, passed: true, attempts: 1 }));
  return { program: c.program, curriculum: { name: c.name, version: c.version }, audit: auditDegree(spec, record, null), transferable: record.filter((r) => spec.courses.some((x) => x.courseId === r.courseId)).length };
}
