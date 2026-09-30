import "server-only";
import { z } from "zod";
import { examinationWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";

export const assignmentSchema = z.object({
  examinationId: z.string().min(1, "Choose an examination"),
  setterId: z.string().min(1, "Choose a setter"),
  backupSetterId: z.string().nullable().optional(),
  setLabel: z.string().trim().regex(/^[A-Z0-9]{1,3}$/, "Use 1–3 capital letters/digits").default("A"),
  deadline: z.coerce.date(),
  instructions: z.string().max(3000).nullable().optional(),
  blueprintId: z.string().nullable().optional(),
});

async function loadExamInScope(ctx: AuthContext, examinationId: string) {
  const exam = await db.examination.findFirst({
    where: { AND: [examinationWhere(ctx), { id: examinationId }] },
    include: { course: true, session: true },
  });
  if (!exam) throw notFound("Examination");
  return exam;
}

async function assertSetter(userId: string) {
  const ok = await db.userRole.count({
    where: { userId, user: { status: "ACTIVE", deletedAt: null }, role: { permissions: { some: { permission: { key: "paper.edit.own" } } } } },
  });
  if (!ok) throw invalid("The selected person does not hold the Question Setter role.");
}

export async function createAssignment(ctx: AuthContext, raw: unknown) {
  const input = assignmentSchema.parse(raw);
  const exam = await loadExamInScope(ctx, input.examinationId);
  if (!can(ctx, "assignment.manage", exam.course.departmentId)) throw forbidden();
  if (exam.isLocked || ["LOCKED", "PUBLISHED", "ARCHIVED"].includes(exam.session.status)) throw invalid("This examination is locked.");
  if (input.deadline < new Date()) throw invalid("The deadline must be in the future.");
  await assertSetter(input.setterId);
  if (input.backupSetterId) {
    if (input.backupSetterId === input.setterId) throw invalid("The backup setter must be a different person.");
    await assertSetter(input.backupSetterId);
  }
  if (exam.moderatorId && [input.setterId, input.backupSetterId].includes(exam.moderatorId)) {
    throw invalid("The moderator of this examination cannot also be its setter.");
  }
  const dup = await db.setterAssignment.findFirst({ where: { examinationId: exam.id, setLabel: input.setLabel, status: { notIn: ["CANCELLED", "DECLINED"] } } });
  if (dup) throw conflict(`Set ${input.setLabel} is already assigned for this examination.`);
  // Re-using a label that was declined/cancelled: free it.
  await db.setterAssignment.updateMany({ where: { examinationId: exam.id, setLabel: input.setLabel, status: { in: ["CANCELLED", "DECLINED"] } }, data: { setLabel: `${input.setLabel}~${Date.now().toString(36)}`.slice(0, 20) } });

  return db.$transaction(async (tx) => {
    const a = await tx.setterAssignment.create({
      data: {
        examinationId: exam.id,
        setterId: input.setterId,
        backupSetterId: input.backupSetterId || null,
        assignedById: ctx.user.id,
        blueprintId: input.blueprintId || exam.blueprintId,
        setLabel: input.setLabel,
        deadline: input.deadline,
        instructions: input.instructions || null,
      },
    });
    await notify({ userIds: [input.setterId], type: "assignment.received", title: `New assignment: ${exam.course.code}`, body: `${exam.course.title} — ${exam.session.name}. Please accept or decline.`, link: "/assignments" }, tx);
    if (input.backupSetterId) await notify({ userIds: [input.backupSetterId], type: "assignment.backup", title: `Backup setter: ${exam.course.code}`, body: `You are the backup setter for ${exam.course.title}.`, link: "/assignments" }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "assignment.create", resourceType: "assignment", resourceId: a.id, summary: `${exam.course.code} set ${input.setLabel} assigned`, newValue: { setterId: input.setterId, backupSetterId: input.backupSetterId, deadline: input.deadline } }, tx);
    return a;
  });
}

async function createPaperForAssignment(tx: Tx, assignmentId: string) {
  const a = await tx.setterAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: { examination: { include: { course: true, session: true, template: true } }, blueprint: { include: { sections: { orderBy: { order: "asc" } } } } },
  });
  const existing = await tx.questionPaper.findUnique({ where: { assignmentId } });
  if (existing) return existing;
  const bp = a.blueprint ?? (a.examination.blueprintId ? await tx.blueprint.findUnique({ where: { id: a.examination.blueprintId }, include: { sections: { orderBy: { order: "asc" } } } }) : null);
  return tx.questionPaper.create({
    data: {
      code: `${a.examination.course.code}-${a.examination.session.code}-${a.setLabel}`,
      examinationId: a.examinationId,
      assignmentId: a.id,
      setterId: a.setterId,
      blueprintId: bp?.id,
      setLabel: a.setLabel,
      title: `${a.examination.course.code} — End Semester Examination`,
      instructions: a.examination.template?.instructions ?? null,
      sections: {
        create: (bp?.sections ?? [{ order: 0, label: "A", title: "Answer ALL questions", instructions: null, attemptCount: null, marksPerQuestion: null }]).map((s) => ({
          order: s.order,
          label: s.label,
          title: s.title,
          instructions: s.instructions,
          attemptCount: s.attemptCount,
          marksPerQuestion: s.marksPerQuestion,
        })),
      },
    },
  });
}

export async function respondToAssignment(ctx: AuthContext, id: string, accept: boolean, reason?: string) {
  const a = await db.setterAssignment.findFirst({ where: { id, setterId: ctx.user.id }, include: { examination: { include: { course: true } } } });
  if (!a) throw notFound("Assignment");
  if (!can(ctx, "assignment.respond")) throw forbidden();
  if (a.status !== "ASSIGNED") throw invalid("This assignment has already been answered.");
  if (!accept && !reason?.trim()) throw invalid("Please give a reason for declining.");
  const controllers = await usersWithPermission("assignment.manage", a.examination.course.departmentId);
  return db.$transaction(async (tx) => {
    await tx.setterAssignment.update({ where: { id }, data: { status: accept ? "ACCEPTED" : "DECLINED", respondedAt: new Date(), declineReason: accept ? null : reason } });
    const paper = accept ? await createPaperForAssignment(tx, id) : null;
    await notify({ userIds: controllers, type: accept ? "assignment.accepted" : "assignment.declined", title: `Assignment ${accept ? "accepted" : "declined"}: ${a.examination.course.code}`, body: accept ? `${ctx.user.name} accepted.` : `${ctx.user.name}: ${reason}`, link: "/setters", email: !accept }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: accept ? "assignment.accept" : "assignment.decline", resourceType: "assignment", resourceId: id, summary: accept ? `${a.examination.course.code} accepted` : `${a.examination.course.code} declined: ${reason}` }, tx);
    return paper;
  });
}

export async function updateAssignment(ctx: AuthContext, id: string, raw: unknown) {
  const input = z.object({ deadline: z.coerce.date().optional(), instructions: z.string().max(3000).nullable().optional(), backupSetterId: z.string().nullable().optional() }).parse(raw);
  const a = await db.setterAssignment.findUnique({ where: { id }, include: { examination: { include: { course: true } } } });
  if (!a) throw notFound("Assignment");
  await loadExamInScope(ctx, a.examinationId);
  if (!can(ctx, "assignment.manage", a.examination.course.departmentId)) throw forbidden();
  if (input.backupSetterId) await assertSetter(input.backupSetterId);
  const updated = await db.setterAssignment.update({ where: { id }, data: { deadline: input.deadline, instructions: input.instructions, backupSetterId: input.backupSetterId } });
  if (input.deadline && input.deadline.getTime() !== a.deadline.getTime()) {
    await notify({ userIds: [a.setterId], type: "deadline.changed", title: `Deadline changed: ${a.examination.course.code}`, body: `New deadline ${input.deadline.toDateString()}.`, link: "/assignments" });
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "assignment.update", resourceType: "assignment", resourceId: id, summary: a.examination.course.code, oldValue: { deadline: a.deadline, backupSetterId: a.backupSetterId }, newValue: input });
  return updated;
}

export async function cancelAssignment(ctx: AuthContext, id: string, reason: string) {
  const a = await db.setterAssignment.findUnique({ where: { id }, include: { examination: { include: { course: true } }, paper: true } });
  if (!a) throw notFound("Assignment");
  await loadExamInScope(ctx, a.examinationId);
  if (!can(ctx, "assignment.manage", a.examination.course.departmentId)) throw forbidden();
  if (a.paper && a.paper.status !== "DRAFT") throw invalid("A submitted paper exists for this assignment; it cannot be cancelled.");
  if (!reason.trim()) throw invalid("Give a reason for cancelling.");
  await db.$transaction(async (tx) => {
    await tx.setterAssignment.update({ where: { id }, data: { status: "CANCELLED" } });
    if (a.paper) await tx.questionPaper.update({ where: { id: a.paper.id }, data: { deletedAt: new Date() } });
    await notify({ userIds: [a.setterId], type: "assignment.cancelled", title: `Assignment withdrawn: ${a.examination.course.code}`, body: reason, link: "/assignments" }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "assignment.cancel", resourceType: "assignment", resourceId: id, summary: `${a.examination.course.code}: ${reason}` }, tx);
  });
}

export async function recommendSetter(ctx: AuthContext, examinationId: string, setterId: string, note?: string) {
  const exam = await loadExamInScope(ctx, examinationId);
  if (!can(ctx, "assignment.recommend", exam.course.departmentId)) throw forbidden("You can recommend setters only for your department's courses.");
  await assertSetter(setterId);
  const rec = await db.setterRecommendation.upsert({
    where: { examinationId_setterId: { examinationId, setterId } },
    create: { examinationId, setterId, departmentId: exam.course.departmentId, recommenderId: ctx.user.id, note },
    update: { note },
  });
  const controllers = await usersWithPermission("assignment.manage", exam.course.departmentId);
  await notify({ userIds: controllers, type: "setter.recommended", title: `Setter recommended: ${exam.course.code}`, body: `${ctx.user.name} recommended a setter.`, link: "/setters", email: false });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "assignment.recommend", resourceType: "examination", resourceId: examinationId, summary: exam.course.code, newValue: { setterId } });
  return rec;
}

/** Open (create if missing) the paper workspace for an accepted assignment. */
export async function openWorkspace(ctx: AuthContext, assignmentId: string) {
  const a = await db.setterAssignment.findFirst({ where: { id: assignmentId, setterId: ctx.user.id } });
  if (!a) throw notFound("Assignment");
  if (!["ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(a.status)) throw invalid("Accept the assignment first.");
  const paper = await db.$transaction((tx) => createPaperForAssignment(tx, assignmentId));
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.create", resourceType: "paper", resourceId: paper.id, summary: `${paper.code} workspace opened` });
  return paper;
}
