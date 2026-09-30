import "server-only";
import { z } from "zod";
import { canTakeAttendance } from "@/server/auth/access";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { resubmitWorkflow, startWorkflow } from "@/server/services/workflow";
import type { MarkSheetData } from "@/server/workflow/modules/exam";

/**
 * Internal assessment marks. Components (tests, assignments, practicals…) are scaled by weight into the
 * course's internal maximum. The end-semester examination is not a component here: it comes from
 * answer-script valuation.
 */

async function offeringAccess(ctx: AuthContext, offeringId: string) {
  const o = await db.courseOffering.findUnique({
    where: { id: offeringId },
    include: { course: { select: { id: true, code: true, title: true, internalMarks: true, departmentId: true } }, instructors: { select: { userId: true } }, term: { select: { status: true } } },
  });
  if (!o) throw notFound("Class");
  const instructor = (o.instructors.some((i) => i.userId === ctx.user.id) || isSuperAdmin(ctx)) && can(ctx, "marks.enter");
  const manage = can(ctx, "enrollment.manage", o.course.departmentId);
  const verify = can(ctx, "marks.verify", o.course.departmentId) || can(ctx, "marks.approve");
  if (!instructor && !manage && !verify && !canTakeAttendance(ctx, { courseDepartmentId: o.course.departmentId, instructorIds: o.instructors.map((i) => i.userId) })) throw notFound("Class");
  return { offering: o, instructor, manage, verify };
}

export const componentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["INTERNAL", "PRACTICAL", "VIVA", "PROJECT"]),
  maxMarks: z.number().positive().max(1000),
  weight: z.number().min(0).max(1000),
  order: z.number().int().min(0).max(50).default(0),
});

export async function saveComponent(ctx: AuthContext, offeringId: string, componentId: string | null, raw: unknown) {
  const { offering, instructor, manage } = await offeringAccess(ctx, offeringId);
  if (!instructor && !manage) throw forbidden();
  const v = componentSchema.parse(raw);
  const others = await db.assessmentComponent.findMany({ where: { offeringId, kind: { not: "EXTERNAL" }, ...(componentId ? { id: { not: componentId } } : {}) }, select: { weight: true } });
  const total = others.reduce((a, c) => a + c.weight, 0) + v.weight;
  if (total > offering.course.internalMarks + 1e-9) throw invalid(`Component weights would total ${total}, more than the course's ${offering.course.internalMarks} internal marks.`);
  if (componentId) {
    const c = await db.assessmentComponent.findFirst({ where: { id: componentId, offeringId }, include: { sheet: true } });
    if (!c) throw notFound("Component");
    if (c.sheet && !["DRAFT", "RETURNED"].includes(c.sheet.status)) throw workflowError("Marks for this component are submitted; it can no longer be changed.");
    const maxMark = await db.mark.aggregate({ where: { componentId }, _max: { marks: true } });
    if ((maxMark._max.marks ?? 0) > v.maxMarks) throw invalid("Some entered marks exceed the new maximum.");
  }
  const saved = await db.$transaction(async (tx) => {
    const c = componentId ? await tx.assessmentComponent.update({ where: { id: componentId }, data: v }) : await tx.assessmentComponent.create({ data: { ...v, offeringId, sheet: { create: {} } } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: componentId ? "marks.component.update" : "marks.component.create", resourceType: "offering", resourceId: offeringId, summary: `${offering.course.code}: ${v.name} (${v.maxMarks} → ${v.weight})`, newValue: v }, tx);
    return c;
  });
  return saved;
}

export async function deleteComponent(ctx: AuthContext, componentId: string) {
  const c = await db.assessmentComponent.findUnique({ where: { id: componentId }, include: { _count: { select: { marks: true } } } });
  if (!c) throw notFound("Component");
  const { instructor, manage } = await offeringAccess(ctx, c.offeringId);
  if (!instructor && !manage) throw forbidden();
  if (c._count.marks) throw conflict("Marks have been entered for this component.");
  await db.assessmentComponent.delete({ where: { id: componentId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "marks.component.delete", resourceType: "offering", resourceId: c.offeringId, summary: c.name });
}

/** Marks grid for one component: every registered student with their current mark. */
export async function markGrid(ctx: AuthContext, componentId: string) {
  const c = await db.assessmentComponent.findUnique({ where: { id: componentId }, include: { sheet: true } });
  if (!c) throw notFound("Component");
  const access = await offeringAccess(ctx, c.offeringId);
  const [regs, marks] = await Promise.all([
    db.courseRegistration.findMany({ where: { offeringId: c.offeringId, status: { in: ["REGISTERED", "COMPLETED"] } }, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } }, orderBy: { student: { studentNo: "asc" } } }),
    db.mark.findMany({ where: { componentId }, include: { _count: { select: { revisions: true } } } }),
  ]);
  const by = new Map(marks.map((m) => [m.studentId, m]));
  const status = c.sheet?.status ?? "DRAFT";
  return {
    component: c,
    status,
    editable: access.instructor && (status === "DRAFT" || status === "RETURNED"),
    canRevise: can(ctx, "marks.approve") && status === "APPROVED",
    ...access,
    rows: regs.map((r) => ({ student: r.student, marks: by.get(r.student.id)?.marks ?? null, status: by.get(r.student.id)?.status ?? null, revisions: by.get(r.student.id)?._count.revisions ?? 0 })),
  };
}

const entrySchema = z.object({
  entries: z.array(z.object({ studentId: z.string(), marks: z.number().min(0).nullable(), status: z.enum(["PRESENT", "ABSENT", "MALPRACTICE", "EXEMPT"]).default("PRESENT") })).max(2000),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Save marks. Instructors edit while the sheet is a draft or returned. After approval only holders of
 * marks.approve can change marks, with a reason; every such change is kept as a MarkRevision.
 */
export async function saveMarks(ctx: AuthContext, componentId: string, raw: unknown) {
  const v = entrySchema.parse(raw);
  const grid = await markGrid(ctx, componentId);
  const c = grid.component;
  const revising = grid.canRevise;
  if (!grid.editable && !revising) throw workflowError(grid.status === "SUBMITTED" || grid.status === "VERIFIED" ? "The mark sheet is awaiting approval and cannot be edited." : "You cannot edit these marks.");
  if (revising && !v.reason) throw invalid("Give a reason for changing approved marks.");
  const roll = new Set(grid.rows.map((r) => r.student.id));
  for (const e of v.entries) {
    if (!roll.has(e.studentId)) throw invalid("A student is not registered in this class.");
    if (e.marks !== null && e.marks > c.maxMarks) throw invalid(`Marks cannot exceed ${c.maxMarks}.`);
    if (e.status === "PRESENT" && e.marks === null) continue;
  }
  let changed = 0;
  await db.$transaction(async (tx) => {
    for (const e of v.entries) {
      const marks = e.status === "PRESENT" ? e.marks : null;
      const prev = await tx.mark.findUnique({ where: { componentId_studentId: { componentId, studentId: e.studentId } } });
      if (prev && prev.marks === marks && prev.status === e.status) continue;
      if (!prev && marks === null && e.status === "PRESENT") continue;
      const m = prev
        ? await tx.mark.update({ where: { id: prev.id }, data: { marks, status: e.status, enteredById: ctx.user.id } })
        : await tx.mark.create({ data: { componentId, studentId: e.studentId, marks, status: e.status, enteredById: ctx.user.id } });
      if (revising) await tx.markRevision.create({ data: { markId: m.id, oldMarks: prev?.marks ?? null, newMarks: marks, oldStatus: prev?.status ?? "PRESENT", newStatus: e.status, reason: v.reason!, changedById: ctx.user.id } });
      changed++;
    }
    if (changed) await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: revising ? "marks.revise" : "marks.enter", resourceType: "assessmentComponent", resourceId: componentId, summary: `${c.name}: ${changed} mark(s) ${revising ? "revised" : "saved"}`, newValue: revising ? { reason: v.reason } : undefined }, tx);
  });
  return { changed };
}

/** Submit for verification (HoD) — and Controller approval for external-type components. */
export async function submitSheet(ctx: AuthContext, componentId: string) {
  const grid = await markGrid(ctx, componentId);
  if (!grid.instructor) throw forbidden("Only the class instructor submits marks.");
  if (!grid.editable) throw workflowError("This mark sheet has already been submitted.");
  const missing = grid.rows.filter((r) => r.status === null || (r.status === "PRESENT" && r.marks === null));
  if (missing.length) throw workflowError(`${missing.length} student(s) have no mark. Enter a mark or mark them absent.`);
  const o = grid.offering;
  const entered = grid.rows.filter((r) => r.marks !== null);
  const data: MarkSheetData = {
    sheetId: grid.component.sheet!.id, offeringId: o.id, component: grid.component.name, kind: grid.component.kind, course: o.course.code, section: o.section,
    students: grid.rows.length, entered: entered.length, absent: grid.rows.filter((r) => r.status === "ABSENT").length,
    average: entered.length ? Math.round((entered.reduce((a, r) => a + (r.marks ?? 0), 0) / entered.length) * 10) / 10 : null,
  };
  return db.$transaction(async (tx) => {
    await tx.markSheet.update({ where: { id: data.sheetId }, data: { status: "SUBMITTED", submittedAt: new Date(), submittedById: ctx.user.id } });
    const returned = await tx.workflowInstance.findFirst({ where: { resourceType: "markSheet", resourceId: data.sheetId, status: "RETURNED" } });
    if (returned) {
      await resubmitWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, returned.id, data as unknown as Record<string, unknown>);
      return returned;
    }
    return startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "marks.sheet", resourceType: "markSheet", resourceId: data.sheetId, title: `Marks: ${data.course}-${data.section} ${data.component}`,
      summary: `${data.entered} of ${data.students} entered · average ${data.average ?? "—"}`, departmentId: o.course.departmentId, data: data as unknown as Record<string, unknown>,
    });
  });
}

/** Components with their sheet status for a class. */
export async function componentsFor(ctx: AuthContext, offeringId: string) {
  const access = await offeringAccess(ctx, offeringId);
  const comps = await db.assessmentComponent.findMany({ where: { offeringId, kind: { not: "EXTERNAL" } }, include: { sheet: true, _count: { select: { marks: true } } }, orderBy: [{ order: "asc" }, { name: "asc" }] });
  return { ...access, components: comps, weightTotal: comps.reduce((a, c) => a + c.weight, 0) };
}
