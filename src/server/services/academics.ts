import "server-only";
import { z } from "zod";
import { AcademicUnitType, BloomLevel, CourseMode, CourseType, ProgramLevel, TermType } from "@/generated/prisma/enums";
import { unitWithDescendants } from "@/lib/domain/org-scope";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

function assertManage(ctx: AuthContext) {
  if (!can(ctx, "academic.manage")) throw forbidden("Only academic administrators can change the academic structure.");
}

const code = (max = 12) => z.string().trim().toUpperCase().regex(new RegExp(`^[A-Z0-9-]{2,${max}}$`), `2–${max} letters, digits or dashes`);

export const courseSchema = z
  .object({
    code: code(12),
    title: z.string().trim().min(3).max(160),
    credits: z.number().int().min(0).max(20),
    departmentId: z.string().min(1),
    programId: z.string().min(1),
    semesterId: z.string().min(1),
    regulationId: z.string().min(1),
    courseType: z.enum(CourseType),
    mode: z.enum(CourseMode),
    maxMarks: z.number().int().min(1).max(500),
    internalMarks: z.number().int().min(0).max(500),
    externalMarks: z.number().int().min(0).max(500),
    durationMinutes: z.number().int().min(15).max(600),
    syllabus: z.string().max(20000).nullable().optional(),
    units: z
      .array(z.object({ id: z.string().optional(), number: z.number().int().min(1).max(20), title: z.string().trim().min(2).max(160), hours: z.number().int().min(0).max(200).nullable().optional(), topics: z.array(z.string().trim().min(1).max(160)).max(30) }))
      .max(20),
    outcomes: z.array(z.object({ id: z.string().optional(), code: z.string().trim().min(2).max(10), description: z.string().trim().min(3).max(400), bloom: z.enum(BloomLevel).nullable().optional() })).max(20),
  })
  .refine((v) => v.internalMarks + v.externalMarks === v.maxMarks, { path: ["maxMarks"], message: "Internal + external marks must equal maximum marks" })
  .refine((v) => new Set(v.units.map((u) => u.number)).size === v.units.length, { path: ["units"], message: "Unit numbers must be unique" })
  .refine((v) => new Set(v.outcomes.map((o) => o.code.toUpperCase())).size === v.outcomes.length, { path: ["outcomes"], message: "Outcome codes must be unique" });

/**
 * Save a course with its units/topics/outcomes. Units and outcomes that already have questions
 * are updated in place (never deleted) so question classification and history remain intact.
 */
export async function saveCourse(ctx: AuthContext, id: string | null, raw: unknown) {
  assertManage(ctx);
  const v = courseSchema.parse(raw);
  const program = await db.program.findUnique({ where: { id: v.programId } });
  if (!program || program.departmentId !== v.departmentId) throw invalid("The programme does not belong to the selected department.");
  const dupe = await db.course.findFirst({ where: { code: v.code, regulationId: v.regulationId, deletedAt: null, ...(id ? { id: { not: id } } : {}) } });
  if (dupe) throw conflict(`${v.code} already exists under this regulation.`);

  return db.$transaction(async (tx) => {
    const base = {
      code: v.code, title: v.title, credits: v.credits, departmentId: v.departmentId, programId: v.programId, semesterId: v.semesterId,
      regulationId: v.regulationId, courseType: v.courseType, mode: v.mode, maxMarks: v.maxMarks, internalMarks: v.internalMarks,
      externalMarks: v.externalMarks, durationMinutes: v.durationMinutes, syllabus: v.syllabus ?? null,
    };
    const course = id ? await tx.course.update({ where: { id }, data: base }) : await tx.course.create({ data: base });

    const existingUnits = await tx.courseUnit.findMany({ where: { courseId: course.id }, include: { _count: { select: { questions: true } }, topics: { include: { _count: { select: { questions: true } } } } } });
    const keepUnitIds = new Set<string>();
    for (const u of v.units) {
      const match = existingUnits.find((e) => e.id === u.id) ?? existingUnits.find((e) => e.number === u.number);
      const unit = match
        ? await tx.courseUnit.update({ where: { id: match.id }, data: { number: u.number, title: u.title, hours: u.hours ?? null } })
        : await tx.courseUnit.create({ data: { courseId: course.id, number: u.number, title: u.title, hours: u.hours ?? null } });
      keepUnitIds.add(unit.id);
      const oldTopics = match?.topics ?? [];
      for (const [order, title] of u.topics.entries()) {
        const t = oldTopics.find((x) => x.title === title);
        if (t) await tx.courseTopic.update({ where: { id: t.id }, data: { order } });
        else await tx.courseTopic.create({ data: { unitId: unit.id, title, order } });
      }
      const removable = oldTopics.filter((t) => !u.topics.includes(t.title) && t._count.questions === 0);
      if (removable.length) await tx.courseTopic.deleteMany({ where: { id: { in: removable.map((t) => t.id) } } });
    }
    const dropUnits = existingUnits.filter((u) => !keepUnitIds.has(u.id));
    if (dropUnits.some((u) => u._count.questions > 0)) throw invalid("A unit that already has questions cannot be removed.");
    if (dropUnits.length) await tx.courseUnit.deleteMany({ where: { id: { in: dropUnits.map((u) => u.id) } } });

    const existingOutcomes = await tx.learningOutcome.findMany({ where: { courseId: course.id }, include: { _count: { select: { questions: true } } } });
    const keepOutcomes = new Set<string>();
    for (const o of v.outcomes) {
      const match = existingOutcomes.find((e) => e.id === o.id) ?? existingOutcomes.find((e) => e.code === o.code.toUpperCase());
      const saved = match
        ? await tx.learningOutcome.update({ where: { id: match.id }, data: { code: o.code.toUpperCase(), description: o.description, bloom: o.bloom ?? null } })
        : await tx.learningOutcome.create({ data: { courseId: course.id, code: o.code.toUpperCase(), description: o.description, bloom: o.bloom ?? null } });
      keepOutcomes.add(saved.id);
    }
    const dropOutcomes = existingOutcomes.filter((o) => !keepOutcomes.has(o.id));
    if (dropOutcomes.some((o) => o._count.questions > 0)) throw invalid("An outcome mapped to questions cannot be removed.");
    if (dropOutcomes.length) await tx.learningOutcome.deleteMany({ where: { id: { in: dropOutcomes.map((o) => o.id) } } });

    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "course.update" : "course.create", resourceType: "course", resourceId: course.id, summary: `${v.code} — ${v.title}`, newValue: { ...base, units: v.units.length, outcomes: v.outcomes.length } }, tx);
    return course;
  });
}

export async function archiveCourse(ctx: AuthContext, id: string) {
  assertManage(ctx);
  const open = await db.examination.count({ where: { courseId: id, isLocked: false } });
  if (open) throw invalid("The course has open examinations.");
  const c = await db.course.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "course.archive", resourceType: "course", resourceId: id, summary: c.code });
}

// ───────────── Structure: departments, programmes, regulations, years, semesters ─────────────

export const structureSchemas = {
  campus: z.object({ code: code(8), name: z.string().trim().min(3).max(120), address: z.string().trim().max(400).nullable().optional(), isMain: z.boolean().default(false) }),
  academicUnit: z.object({ code: code(10), name: z.string().trim().min(3).max(160), type: z.enum(AcademicUnitType), parentId: z.string().nullable().optional(), campusId: z.string().nullable().optional() }),
  department: z.object({ code: code(8), name: z.string().trim().min(3).max(120), academicUnitId: z.string().nullable().optional(), campusId: z.string().nullable().optional() }),
  program: z.object({ code: code(10), name: z.string().trim().min(3).max(160), departmentId: z.string().min(1), level: z.enum(ProgramLevel), durationYears: z.number().int().min(1).max(8) }),
  regulation: z.object({ code: code(10), name: z.string().trim().min(3).max(160), effectiveFromYear: z.number().int().min(1990).max(2100), description: z.string().max(500).nullable().optional() }),
  academicYear: z
    .object({ label: z.string().trim().regex(/^\d{4}-\d{2}$/, "Format 2026-27"), startDate: z.coerce.date(), endDate: z.coerce.date(), isCurrent: z.boolean().default(false) })
    .refine((v) => v.endDate > v.startDate, { path: ["endDate"], message: "End must be after start" }),
  semester: z.object({ number: z.number().int().min(1).max(12), name: z.string().trim().min(3).max(40), termType: z.enum(TermType) }),
} as const;
export type StructureKind = keyof typeof structureSchemas;

export async function saveStructure(ctx: AuthContext, kind: StructureKind, id: string | null, raw: unknown) {
  assertManage(ctx);
  const inst = await db.institution.findFirst();
  if (!inst) throw notFound("Institution");
  let saved: { id: string };
  switch (kind) {
    case "campus": {
      const v = structureSchemas.campus.parse(raw);
      const data = { ...v, address: v.address ?? null };
      saved = await db.$transaction(async (tx) => {
        if (v.isMain) await tx.campus.updateMany({ where: id ? { id: { not: id } } : {}, data: { isMain: false } });
        return id ? tx.campus.update({ where: { id }, data }) : tx.campus.create({ data: { ...data, institutionId: inst.id } });
      });
      break;
    }
    case "academicUnit": {
      const v = structureSchemas.academicUnit.parse(raw);
      if (id && v.parentId) {
        const units = await db.academicUnit.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true, campusId: true } });
        if (unitWithDescendants({ units, departments: [] }, id).has(v.parentId)) throw invalid("A unit cannot be placed under itself or one of its own sub-units.");
      }
      const data = { code: v.code, name: v.name, type: v.type, parentId: v.parentId || null, campusId: v.campusId || null };
      saved = id ? await db.academicUnit.update({ where: { id }, data }) : await db.academicUnit.create({ data: { ...data, institutionId: inst.id } });
      break;
    }
    case "department": {
      const v = structureSchemas.department.parse(raw);
      const data = { code: v.code, name: v.name, academicUnitId: v.academicUnitId || null, campusId: v.campusId || null };
      saved = id ? await db.department.update({ where: { id }, data }) : await db.department.create({ data: { ...data, institutionId: inst.id } });
      break;
    }
    case "program": {
      const v = structureSchemas.program.parse(raw);
      saved = id ? await db.program.update({ where: { id }, data: v }) : await db.program.create({ data: v });
      break;
    }
    case "regulation": {
      const v = structureSchemas.regulation.parse(raw);
      saved = id ? await db.regulation.update({ where: { id }, data: { ...v, description: v.description ?? null } }) : await db.regulation.create({ data: { ...v, description: v.description ?? null } });
      break;
    }
    case "academicYear": {
      const v = structureSchemas.academicYear.parse(raw);
      saved = await db.$transaction(async (tx) => {
        if (v.isCurrent) await tx.academicYear.updateMany({ data: { isCurrent: false } });
        return id ? tx.academicYear.update({ where: { id }, data: v }) : tx.academicYear.create({ data: v });
      });
      break;
    }
    case "semester": {
      const v = structureSchemas.semester.parse(raw);
      saved = id ? await db.semester.update({ where: { id }, data: v }) : await db.semester.create({ data: v });
      break;
    }
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `${kind}.${id ? "update" : "create"}`, resourceType: kind, resourceId: saved.id, newValue: raw });
  return saved;
}
