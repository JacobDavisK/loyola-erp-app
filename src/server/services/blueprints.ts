import "server-only";
import { z } from "zod";
import { BlueprintDimension, QuestionType } from "@/generated/prisma/enums";
import { blueprintMarks } from "@/lib/domain/blueprint";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";

export const blueprintSchema = z
  .object({
    name: z.string().trim().min(3).max(120),
    description: z.string().max(1000).nullable().optional(),
    courseId: z.string().nullable().optional(),
    isPattern: z.boolean(),
    totalMarks: z.number().int().min(1).max(500),
    durationMinutes: z.number().int().min(15).max(600),
    sections: z
      .array(
        z.object({
          label: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9]{0,3}$/, "Section labels are letters, e.g. A"),
          title: z.string().trim().min(1).max(120),
          instructions: z.string().max(500).nullable().optional(),
          questionCount: z.number().int().min(1).max(100),
          attemptCount: z.number().int().min(1).max(100),
          marksPerQuestion: z.number().int().min(1).max(100),
          questionTypes: z.array(z.enum(QuestionType)).default([]),
          units: z.array(z.number().int().min(1).max(20)).default([]),
        }),
      )
      .min(1)
      .max(10),
    rules: z
      .array(z.object({ dimension: z.enum(BlueprintDimension), key: z.string().trim().min(1).max(40), targetPercent: z.number().min(0).max(100), tolerance: z.number().min(0).max(50) }))
      .max(60),
  })
  .superRefine((v, ctx) => {
    v.sections.forEach((s, i) => {
      if (s.attemptCount > s.questionCount) ctx.addIssue({ code: "custom", path: ["sections", i, "attemptCount"], message: "Cannot attempt more questions than are set" });
    });
    const labels = v.sections.map((s) => s.label);
    if (new Set(labels).size !== labels.length) ctx.addIssue({ code: "custom", path: ["sections"], message: "Section labels must be unique" });
    const marks = blueprintMarks(v);
    if (marks !== v.totalMarks) ctx.addIssue({ code: "custom", path: ["totalMarks"], message: `Sections add up to ${marks} marks, not ${v.totalMarks}` });
    for (const dim of ["DIFFICULTY", "BLOOM", "UNIT"] as const) {
      const rules = v.rules.filter((r) => r.dimension === dim);
      if (!rules.length) continue;
      const sum = rules.reduce((s, r) => s + r.targetPercent, 0);
      if (Math.abs(sum - 100) > 0.5) ctx.addIssue({ code: "custom", path: ["rules"], message: `${dim.toLowerCase()} targets add up to ${sum}%, not 100%` });
    }
  });

async function assertEditable(id: string) {
  const inReview = await db.questionPaper.count({ where: { blueprintId: id, deletedAt: null, status: { notIn: ["DRAFT"] } } });
  if (inReview) throw invalid(`This blueprint governs ${inReview} submitted or finalised paper(s). Duplicate it and edit the copy instead.`);
}

export async function saveBlueprint(ctx: AuthContext, id: string | null, raw: unknown) {
  if (!can(ctx, "blueprint.manage")) throw forbidden();
  const v = blueprintSchema.parse(raw);
  if (id) await assertEditable(id);
  const data = {
    name: v.name,
    description: v.description ?? null,
    courseId: v.isPattern ? null : (v.courseId ?? null),
    isPattern: v.isPattern,
    totalMarks: v.totalMarks,
    durationMinutes: v.durationMinutes,
  };
  const sections = v.sections.map((s, order) => ({ ...s, order, instructions: s.instructions ?? null }));
  const bp = await db.$transaction(async (tx) => {
    const saved = id
      ? await tx.blueprint.update({ where: { id }, data: { ...data, sections: { deleteMany: {}, create: sections }, rules: { deleteMany: {}, create: v.rules } } })
      : await tx.blueprint.create({ data: { ...data, createdById: ctx.user.id, sections: { create: sections }, rules: { create: v.rules } } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: id ? "blueprint.update" : "blueprint.create", resourceType: "blueprint", resourceId: saved.id, summary: v.name, newValue: v }, tx);
    return saved;
  });
  return bp;
}

export async function duplicateBlueprint(ctx: AuthContext, id: string) {
  if (!can(ctx, "blueprint.manage")) throw forbidden();
  const src = await db.blueprint.findUnique({ where: { id }, include: { sections: true, rules: true } });
  if (!src) throw notFound("Blueprint");
  const copy = await db.blueprint.create({
    data: {
      name: `${src.name} (copy)`,
      description: src.description,
      courseId: src.courseId,
      isPattern: src.isPattern,
      totalMarks: src.totalMarks,
      durationMinutes: src.durationMinutes,
      createdById: ctx.user.id,
      sections: { create: src.sections.map(({ id: _i, blueprintId: _b, ...s }) => s) },
      rules: { create: src.rules.map(({ id: _i, blueprintId: _b, ...r }) => r) },
    },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "blueprint.duplicate", resourceType: "blueprint", resourceId: copy.id, summary: `Copied from ${src.name}` });
  return copy;
}

export async function archiveBlueprint(ctx: AuthContext, id: string) {
  if (!can(ctx, "blueprint.manage")) throw forbidden();
  const used = await db.examination.count({ where: { blueprintId: id, isLocked: false } });
  if (used) throw invalid(`This blueprint is assigned to ${used} open examination(s).`);
  await db.blueprint.update({ where: { id }, data: { deletedAt: new Date() } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "blueprint.archive", resourceType: "blueprint", resourceId: id });
}
