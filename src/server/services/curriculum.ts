import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { auditDegree, extraRequirementsSchema, type CurriculumSpec, type RecordEntry } from "@/lib/domain/degree-audit";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { attemptsByCourse, currentCgpa, passedCourseIds } from "@/server/services/academic-record";
import { audit } from "@/server/services/audit";

async function assertManage(ctx: AuthContext, programId: string) {
  const p = await db.program.findUnique({ where: { id: programId }, select: { departmentId: true } });
  if (!p) throw notFound("Programme");
  if (!can(ctx, "curriculum.manage", p.departmentId)) throw forbidden();
}

export const curriculumSchema = z.object({
  programId: z.string().min(1),
  regulationId: z.string().min(1),
  name: z.string().trim().min(3).max(160),
  totalCredits: z.number().int().min(1).max(400),
  minCgpa: z.number().min(0).max(10).nullable().optional(),
  groups: z.array(z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/), name: z.string().trim().min(2).max(120), minCredits: z.number().int().min(0).max(200) })).max(20),
  courses: z
    .array(z.object({ courseId: z.string().min(1), semesterNumber: z.number().int().min(1).max(16), category: z.enum(["MANDATORY", "ELECTIVE"]), groupCode: z.string().nullable().optional() }))
    .max(200),
  requirements: extraRequirementsSchema.default([]),
});

/**
 * Save a DRAFT curriculum. Active curricula are immutable (batches depend on them): publish a new
 * version instead, so historical degree audits remain reproducible.
 */
export async function saveCurriculum(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = curriculumSchema.parse(raw);
  await assertManage(ctx, v.programId);
  const codes = new Set(v.groups.map((g) => g.code));
  if (codes.size !== v.groups.length) throw invalid("Elective group codes must be unique.");
  if (new Set(v.courses.map((c) => c.courseId)).size !== v.courses.length) throw invalid("A course can appear only once.");
  for (const c of v.courses) if (c.category === "ELECTIVE" && c.groupCode && !codes.has(c.groupCode)) throw invalid(`Unknown elective group ${c.groupCode}.`);
  return db.$transaction(async (tx) => {
    let cur;
    if (id) {
      const before = await tx.curriculum.findUnique({ where: { id } });
      if (!before) throw notFound("Curriculum");
      if (before.status !== "DRAFT") throw conflict("Only draft curricula can be edited. Create a new version.");
      cur = await tx.curriculum.update({ where: { id }, data: { name: v.name, totalCredits: v.totalCredits, minCgpa: v.minCgpa ?? null, requirements: v.requirements as Prisma.InputJsonValue } });
      await tx.curriculumCourse.deleteMany({ where: { curriculumId: id } });
      await tx.electiveGroup.deleteMany({ where: { curriculumId: id } });
    } else {
      const latest = await tx.curriculum.findFirst({ where: { programId: v.programId, regulationId: v.regulationId }, orderBy: { version: "desc" } });
      cur = await tx.curriculum.create({
        data: { programId: v.programId, regulationId: v.regulationId, version: (latest?.version ?? 0) + 1, name: v.name, totalCredits: v.totalCredits, minCgpa: v.minCgpa ?? null, requirements: v.requirements as Prisma.InputJsonValue },
      });
    }
    const groupIds: Record<string, string> = {};
    for (const g of v.groups) groupIds[g.code] = (await tx.electiveGroup.create({ data: { curriculumId: cur.id, ...g } })).id;
    await tx.curriculumCourse.createMany({ data: v.courses.map((c) => ({ curriculumId: cur.id, courseId: c.courseId, semesterNumber: c.semesterNumber, category: c.category, groupId: c.groupCode ? groupIds[c.groupCode] : null })) });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "curriculum.update" : "curriculum.create", resourceType: "curriculum", resourceId: cur.id, summary: `${v.name} v${cur.version}: ${v.courses.length} courses, ${v.totalCredits} credits` }, tx);
    return cur;
  });
}

export async function setCurriculumStatus(ctx: AuthContext, id: string, status: "ACTIVE" | "RETIRED") {
  const c = await db.curriculum.findUnique({ where: { id }, include: { _count: { select: { courses: true } } } });
  if (!c) throw notFound("Curriculum");
  await assertManage(ctx, c.programId);
  if (status === "ACTIVE" && !c._count.courses) throw invalid("Add courses before activating the curriculum.");
  await db.$transaction(async (tx) => {
    await tx.curriculum.update({ where: { id }, data: { status } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `curriculum.${status.toLowerCase()}`, resourceType: "curriculum", resourceId: id, summary: `${c.name} v${c.version}` }, tx);
  });
}

/** Copy a curriculum into a new DRAFT version. */
export async function newCurriculumVersion(ctx: AuthContext, id: string) {
  const c = await db.curriculum.findUnique({ where: { id }, include: { courses: { include: { group: true } }, groups: true } });
  if (!c) throw notFound("Curriculum");
  return saveCurriculum(ctx, null, {
    programId: c.programId, regulationId: c.regulationId, name: c.name, totalCredits: c.totalCredits, minCgpa: c.minCgpa,
    groups: c.groups.map((g) => ({ code: g.code, name: g.name, minCredits: g.minCredits })),
    courses: c.courses.map((x) => ({ courseId: x.courseId, semesterNumber: x.semesterNumber, category: x.category, groupCode: x.group?.code ?? null })),
    requirements: c.requirements ?? [],
  });
}

export async function setPrerequisites(ctx: AuthContext, courseId: string, prerequisiteIds: string[]) {
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) throw notFound("Course");
  if (!can(ctx, "curriculum.manage", course.departmentId)) throw forbidden();
  const ids = [...new Set(prerequisiteIds)].filter((x) => x !== courseId);
  // Refuse cycles: none of the new prerequisites may (transitively) require this course.
  const all = await db.coursePrerequisite.findMany();
  const graph = new Map<string, string[]>();
  for (const e of all) (graph.get(e.courseId) ?? graph.set(e.courseId, []).get(e.courseId)!).push(e.prerequisiteId);
  const reaches = (from: string, target: string, seen = new Set<string>()): boolean => {
    if (from === target) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (graph.get(from) ?? []).some((n) => reaches(n, target, seen));
  };
  const cyclic = ids.filter((p) => reaches(p, courseId));
  if (cyclic.length) throw invalid("That would create a circular prerequisite chain.");
  await db.$transaction(async (tx) => {
    await tx.coursePrerequisite.deleteMany({ where: { courseId } });
    if (ids.length) await tx.coursePrerequisite.createMany({ data: ids.map((prerequisiteId) => ({ courseId, prerequisiteId })) });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "course.prerequisites", resourceType: "course", resourceId: courseId, summary: `${course.code}: ${ids.length} prerequisite(s)`, newValue: ids }, tx);
  });
}

/** Degree progress for a student against their batch's curriculum. */
export async function degreeProgress(ctx: AuthContext, studentId: string) {
  const s = await loadStudentFor(ctx, studentId);
  const batch = await db.batch.findUniqueOrThrow({ where: { id: s.batchId }, select: { curriculumId: true } });
  const curriculum = batch.curriculumId
    ? await db.curriculum.findUnique({ where: { id: batch.curriculumId }, include: { courses: { include: { course: { select: { code: true, title: true, credits: true, courseType: true } }, group: { select: { code: true } } } }, groups: true } })
    : await db.curriculum.findFirst({ where: { programId: s.programId, status: "ACTIVE" }, orderBy: { version: "desc" }, include: { courses: { include: { course: { select: { code: true, title: true, credits: true, courseType: true } }, group: { select: { code: true } } } }, groups: true } });
  if (!curriculum) return null;
  const spec: CurriculumSpec = {
    totalCredits: curriculum.totalCredits,
    minCgpa: curriculum.minCgpa,
    courses: curriculum.courses.map((c) => ({ courseId: c.courseId, code: c.course.code, title: c.course.title, credits: c.course.credits, semester: c.semesterNumber, category: c.category, groupCode: c.group?.code ?? null, courseType: c.course.courseType })),
    groups: curriculum.groups.map((g) => ({ code: g.code, name: g.name, minCredits: g.minCredits })),
    requirements: extraRequirementsSchema.catch([]).parse(curriculum.requirements ?? []),
  };
  const [passed, attempts, cgpa] = await Promise.all([passedCourseIds(studentId), attemptsByCourse(studentId), currentCgpa(studentId)]);
  const regs = await db.courseRegistration.findMany({ where: { studentId, status: { in: ["COMPLETED", "REGISTERED"] } }, include: { offering: { include: { course: { select: { code: true, credits: true, courseType: true } } } } } });
  const byCourse = new Map<string, RecordEntry>();
  for (const r of regs) {
    const cur = byCourse.get(r.offering.courseId);
    const graded = attempts.get(r.offering.courseId);
    // Only courses with an outcome (a result or a completed registration) count as attempts; ongoing ones do not.
    if (!graded && r.status !== "COMPLETED") continue;
    const entry: RecordEntry = {
      courseId: r.offering.courseId, code: r.offering.course.code, credits: r.offering.course.credits, courseType: r.offering.course.courseType,
      passed: passed.has(r.offering.courseId), attempts: graded?.attempts ?? (cur?.attempts ?? 0) + 1,
    };
    byCourse.set(r.offering.courseId, entry);
  }
  return { curriculum: { id: curriculum.id, name: curriculum.name, version: curriculum.version }, audit: auditDegree(spec, [...byCourse.values()], cgpa), cgpa };
}
