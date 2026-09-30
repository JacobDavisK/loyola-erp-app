import "server-only";
import { z } from "zod";
import type { Prisma, WorkflowInstance } from "@/generated/prisma/client";
import { dueDate, nextApplicableStep, parseSteps, stepOutcome, stepsSchema, type WorkflowStep } from "@/lib/domain/workflow-engine";
import { type AuthContext, can, isSuperAdmin, scopeOf } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithRole } from "@/server/services/directory";
import { emitEvent } from "@/server/services/events";
import { notify } from "@/server/services/notifications";
import "@/server/workflow/modules";
import { registeredWorkflows, workflowModule } from "@/server/workflow/registry";

export interface Actor {
  id: string;
  name: string;
}
const actorOf = (ctx: AuthContext): Actor => ({ id: ctx.user.id, name: ctx.user.name });

// ───────────────────────── Definitions ─────────────────────────

/** Latest active definition for a key; seeds version 1 from the module default on first use. */
export async function activeDefinition(tx: Tx, key: string) {
  const def = await tx.workflowDefinition.findFirst({ where: { key, isActive: true }, orderBy: { version: "desc" } });
  if (def) return def;
  const m = workflowModule(key);
  if (!m) throw workflowError(`Workflow "${key}" is not configured.`);
  const existing = await tx.workflowDefinition.findFirst({ where: { key }, orderBy: { version: "desc" } });
  if (existing) throw workflowError(`Workflow "${m.name}" is switched off. An administrator can re-activate it under Workflows.`);
  return tx.workflowDefinition.create({
    data: { key, version: 1, name: m.name, module: m.module, description: m.description, steps: m.defaultSteps as unknown as Prisma.InputJsonValue },
  });
}

export async function ensureDefaultDefinitions() {
  for (const m of registeredWorkflows()) await db.$transaction((tx) => activeDefinition(tx, m.key).catch(() => null));
}

const definitionInput = z.object({ name: z.string().trim().min(3).max(120), description: z.string().trim().max(500).nullable().optional(), steps: stepsSchema });

/** Publishing edits creates a new version; running instances keep the version they started with. */
export async function publishDefinition(ctx: AuthContext, key: string, raw: unknown) {
  if (!can(ctx, "workflow.manage")) throw forbidden();
  const m = workflowModule(key);
  if (!m) throw notFound("Workflow");
  const v = definitionInput.parse(raw);
  return db.$transaction(async (tx) => {
    const latest = await tx.workflowDefinition.findFirst({ where: { key }, orderBy: { version: "desc" } });
    await tx.workflowDefinition.updateMany({ where: { key }, data: { isActive: false } });
    const def = await tx.workflowDefinition.create({
      data: {
        key, version: (latest?.version ?? 0) + 1, name: v.name, module: m.module, description: v.description ?? null,
        steps: v.steps as unknown as Prisma.InputJsonValue, createdById: ctx.user.id,
      },
    });
    await audit(
      { actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.definition.publish", resourceType: "workflowDefinition", resourceId: def.id, summary: `${v.name} v${def.version}`, oldValue: latest?.steps, newValue: v.steps },
      tx,
    );
    return def;
  });
}

export async function setDefinitionActive(ctx: AuthContext, key: string, active: boolean) {
  if (!can(ctx, "workflow.manage")) throw forbidden();
  await db.$transaction(async (tx) => {
    const latest = await tx.workflowDefinition.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if (!latest) throw notFound("Workflow");
    await tx.workflowDefinition.update({ where: { id: latest.id }, data: { isActive: active } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: active ? "workflow.definition.activate" : "workflow.definition.deactivate", resourceType: "workflowDefinition", resourceId: latest.id, summary: `${latest.name} v${latest.version}` }, tx);
  });
}

// ───────────────────────── Running workflows ─────────────────────────

export interface StartInput {
  key: string;
  resourceType: string;
  resourceId: string;
  title: string;
  summary?: string;
  departmentId?: string | null;
  subjectUserId?: string | null;
  data?: Record<string, unknown>;
}

async function stepsOf(tx: Tx, definitionId: string): Promise<WorkflowStep[]> {
  const def = await tx.workflowDefinition.findUniqueOrThrow({ where: { id: definitionId } });
  return parseSteps(def.steps);
}

/** Replace approvers who are out of office with their active delegate (same module or all modules). */
async function applyDelegation(tx: Tx, module: string, userIds: string[], exclude: Set<string>) {
  const now = new Date();
  const delegations = await tx.workflowDelegation.findMany({
    where: { fromUserId: { in: userIds }, revokedAt: null, startsAt: { lte: now }, endsAt: { gte: now }, OR: [{ module: null }, { module }] },
  });
  return userIds.map((id) => {
    const d = delegations.find((x) => x.fromUserId === id && !exclude.has(x.toUserId));
    return d ? { assigneeId: d.toUserId, delegatedFromId: id } : { assigneeId: id, delegatedFromId: null };
  });
}

async function resolveApprovers(tx: Tx, step: WorkflowStep, instance: WorkflowInstance): Promise<string[]> {
  const ids = new Set<string>();
  for (const rule of step.approvers) {
    if (rule.type === "user") {
      const u = await tx.user.findFirst({ where: { id: rule.userId, status: "ACTIVE", deletedAt: null }, select: { id: true } });
      if (u) ids.add(u.id);
    } else if (rule.type === "data_user") {
      const v = (instance.data as Record<string, unknown> | null)?.[rule.field];
      if (typeof v === "string" && v) {
        const u = await tx.user.findFirst({ where: { id: v, status: "ACTIVE", deletedAt: null }, select: { id: true } });
        if (u) ids.add(u.id);
      }
    } else {
      for (const id of await usersWithRole(rule.role, rule.scope === "global" ? null : instance.departmentId, tx)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Activate the next applicable step at or after `from`. Steps whose only possible approvers are the
 * requester (or the person the request is about) are skipped and logged — nobody approves their own request.
 * Returns true when the workflow has no further steps (i.e. it is approved).
 */
async function activateFrom(tx: Tx, instance: WorkflowInstance, steps: WorkflowStep[], from: number, actor: Actor | null): Promise<boolean> {
  let idx = nextApplicableStep(steps, from, instance.data);
  while (idx !== null) {
    const step = steps[idx];
    const candidates = await resolveApprovers(tx, step, instance);
    if (!candidates.length) {
      throw workflowError(`No approver is configured for the step "${step.name}". Ask an administrator to grant the required role for this department.`);
    }
    const exclude = new Set([instance.initiatorId, instance.subjectUserId].filter((x): x is string => !!x));
    const eligible = candidates.filter((id) => !exclude.has(id));
    if (!eligible.length) {
      await tx.workflowAction.create({ data: { instanceId: instance.id, actorId: null, action: "skip", stepIndex: idx, comment: `Skipped "${step.name}": the requester is the only approver.` } });
      idx = nextApplicableStep(steps, idx + 1, instance.data);
      continue;
    }
    const assignees = await applyDelegation(tx, instance.module, eligible, exclude);
    const due = dueDate(step, new Date());
    await tx.workflowTask.createMany({
      data: assignees.map((a) => ({ instanceId: instance.id, round: instance.round, stepIndex: idx!, stepKey: step.key, stepName: step.name, assigneeId: a.assigneeId, delegatedFromId: a.delegatedFromId, dueAt: due })),
    });
    await tx.workflowInstance.update({ where: { id: instance.id }, data: { currentStep: idx, status: "IN_PROGRESS" } });
    const tasks = await tx.workflowTask.findMany({ where: { instanceId: instance.id, round: instance.round, stepIndex: idx, status: "PENDING" }, select: { id: true, assigneeId: true } });
    for (const t of tasks) {
      await notify({ userIds: [t.assigneeId], type: "workflow.task", title: `Approval needed: ${instance.title}`, body: `${step.name}${actor ? ` · requested by ${actor.name}` : ""}`, link: `/inbox/${t.id}` }, tx);
    }
    return false;
  }
  return true;
}

async function finish(tx: Tx, instance: WorkflowInstance, status: "APPROVED" | "REJECTED" | "RETURNED" | "CANCELLED", actor: Actor | null, comment?: string | null) {
  const updated = await tx.workflowInstance.update({ where: { id: instance.id }, data: { status, completedAt: status === "RETURNED" ? null : new Date() } });
  await tx.workflowTask.updateMany({ where: { instanceId: instance.id, status: "PENDING" }, data: { status: "CANCELLED", decidedAt: new Date() } });
  await tx.workflowAction.create({ data: { instanceId: instance.id, actorId: actor?.id ?? null, action: status === "APPROVED" ? "complete" : status.toLowerCase(), comment: comment ?? null } });
  const m = workflowModule(instance.key);
  if (status === "APPROVED") await m?.onApproved?.(tx, updated);
  if (status === "REJECTED") await m?.onRejected?.(tx, updated);
  if (status === "RETURNED") await m?.onReturned?.(tx, updated);
  if (status === "CANCELLED") await m?.onCancelled?.(tx, updated);
  await emitEvent(tx, { type: "WorkflowCompleted", aggregateType: instance.resourceType, aggregateId: instance.resourceId, payload: { workflow: instance.key, status, instanceId: instance.id }, actorId: actor?.id });
  const verb = { APPROVED: "approved", REJECTED: "rejected", RETURNED: "returned for correction", CANCELLED: "cancelled" }[status];
  const recipients = [instance.initiatorId, instance.subjectUserId].filter((id) => id && id !== actor?.id);
  await notify({ userIds: recipients, type: `workflow.${status.toLowerCase()}`, title: `${instance.title} — ${verb}`, body: comment ?? undefined, link: `/inbox/requests/${instance.id}` }, tx);
  return updated;
}

/** Start a workflow inside the caller's transaction (the module creates its record and the instance atomically). */
export async function startWorkflow(tx: Tx, actor: Actor, input: StartInput) {
  const def = await activeDefinition(tx, input.key);
  const open = await tx.workflowInstance.findFirst({ where: { resourceType: input.resourceType, resourceId: input.resourceId, status: { in: ["IN_PROGRESS", "RETURNED"] } } });
  if (open) throw workflowError("An approval for this record is already in progress.");
  const instance = await tx.workflowInstance.create({
    data: {
      definitionId: def.id, key: input.key, module: def.module, resourceType: input.resourceType, resourceId: input.resourceId,
      title: input.title, summary: input.summary ?? null, departmentId: input.departmentId ?? null, subjectUserId: input.subjectUserId ?? null,
      data: (input.data ?? {}) as Prisma.InputJsonValue, initiatorId: actor.id,
    },
  });
  await tx.workflowAction.create({ data: { instanceId: instance.id, actorId: actor.id, action: "start" } });
  const done = await activateFrom(tx, instance, parseSteps(def.steps), 0, actor);
  if (done) return finish(tx, instance, "APPROVED", actor, "No approval steps apply.");
  await audit({ actorId: actor.id, actorName: actor.name, action: `workflow.start`, resourceType: input.resourceType, resourceId: input.resourceId, summary: `${def.name}: ${input.title}`, metadata: { workflow: input.key, version: def.version } }, tx);
  return tx.workflowInstance.findUniqueOrThrow({ where: { id: instance.id } });
}

const decisionSchema = z.object({ decision: z.enum(["approve", "reject", "return"]), comment: z.string().trim().max(2000).optional() });

/** The assignee acts on a task; the Super Admin may stand in, but never on a request they raised or that concerns them. */
export function canActOnTask(ctx: AuthContext, task: { assigneeId: string; instance: { initiatorId: string; subjectUserId: string | null } }) {
  if (task.assigneeId === ctx.user.id) return true;
  return isSuperAdmin(ctx) && task.instance.initiatorId !== ctx.user.id && task.instance.subjectUserId !== ctx.user.id;
}

export async function decideTask(ctx: AuthContext, taskId: string, raw: unknown) {
  const { decision, comment } = decisionSchema.parse(raw);
  if (decision !== "approve" && !comment) throw invalid("Please give a reason when rejecting or returning a request.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${taskId}))`;
    const task = await tx.workflowTask.findUnique({ where: { id: taskId }, include: { instance: true } });
    if (!task || !canActOnTask(ctx, task)) throw notFound("Approval task");
    if (task.status !== "PENDING" || task.instance.status !== "IN_PROGRESS") throw workflowError("This task has already been decided.");
    const standIn = task.assigneeId !== ctx.user.id;
    const steps = await stepsOf(tx, task.instance.definitionId);
    const step = steps[task.stepIndex];
    if (decision === "return" && step && !step.allowReturn) throw workflowError("This step does not allow returning the request.");

    const status = decision === "approve" ? "APPROVED" : decision === "reject" ? "REJECTED" : "RETURNED";
    await tx.workflowTask.update({ where: { id: taskId }, data: { status, comment: comment ?? null, decidedAt: new Date() } });
    await tx.workflowAction.create({ data: { instanceId: task.instanceId, taskId, actorId: ctx.user.id, action: decision, stepIndex: task.stepIndex, comment: comment ?? null } });
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `workflow.${decision}`, resourceType: task.instance.resourceType, resourceId: task.instance.resourceId, summary: `${task.stepName}: ${task.instance.title}${standIn ? " (by the Super Admin in place of the assignee)" : ""}`, metadata: { taskId, workflow: task.instance.key, standIn }, newValue: comment ? { comment } : undefined }, tx);

    const siblings = await tx.workflowTask.findMany({ where: { instanceId: task.instanceId, round: task.round, stepIndex: task.stepIndex }, select: { status: true } });
    const outcome = stepOutcome(step?.mode ?? "ANY", siblings.map((s) => s.status));
    if (outcome === "pending") return { status: "IN_PROGRESS" as const };
    if (outcome === "rejected") return { status: (await finish(tx, task.instance, "REJECTED", actorOf(ctx), comment)).status };
    if (outcome === "returned") return { status: (await finish(tx, task.instance, "RETURNED", actorOf(ctx), comment)).status };
    await tx.workflowTask.updateMany({ where: { instanceId: task.instanceId, round: task.round, stepIndex: task.stepIndex, status: "PENDING" }, data: { status: "SKIPPED", decidedAt: new Date() } });
    const done = await activateFrom(tx, task.instance, steps, task.stepIndex + 1, actorOf(ctx));
    if (done) return { status: (await finish(tx, task.instance, "APPROVED", actorOf(ctx), comment)).status };
    return { status: "IN_PROGRESS" as const };
  });
}

export async function delegateTask(ctx: AuthContext, taskId: string, raw: unknown) {
  const v = z.object({ toUserId: z.string().min(1), comment: z.string().trim().max(1000).optional() }).parse(raw);
  return db.$transaction(async (tx) => {
    const task = await tx.workflowTask.findUnique({ where: { id: taskId }, include: { instance: true } });
    if (!task || !canActOnTask(ctx, task)) throw notFound("Approval task");
    if (task.status !== "PENDING") throw workflowError("This task has already been decided.");
    const step = (await stepsOf(tx, task.instance.definitionId))[task.stepIndex];
    if (step && !step.allowDelegate) throw workflowError("This step cannot be delegated.");
    if ([task.instance.initiatorId, task.instance.subjectUserId, ctx.user.id].includes(v.toUserId)) throw invalid("Choose someone other than yourself or the requester.");
    const to = await tx.user.findFirst({ where: { id: v.toUserId, status: "ACTIVE", deletedAt: null, userType: "STAFF" } });
    if (!to) throw notFound("User");
    await tx.workflowTask.update({ where: { id: taskId }, data: { assigneeId: to.id, delegatedFromId: ctx.user.id } });
    await tx.workflowAction.create({ data: { instanceId: task.instanceId, taskId, actorId: ctx.user.id, action: "delegate", stepIndex: task.stepIndex, comment: `Delegated to ${to.name}${v.comment ? ` — ${v.comment}` : ""}` } });
    await notify({ userIds: [to.id], type: "workflow.task", title: `Approval delegated to you: ${task.instance.title}`, body: `${task.stepName} · from ${ctx.user.name}`, link: `/inbox/${task.id}` }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.delegate", resourceType: task.instance.resourceType, resourceId: task.instance.resourceId, summary: `${task.stepName} delegated to ${to.name}` }, tx);
  });
}

/** After a return, the requester corrects the record (module-specific) and resubmits: approval restarts at step 1. */
export async function resubmitWorkflow(tx: Tx, actor: Actor, instanceId: string, data?: Record<string, unknown>) {
  const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!inst || inst.initiatorId !== actor.id) throw notFound("Request");
  if (inst.status !== "RETURNED") throw workflowError("Only requests returned for correction can be resubmitted.");
  const updated = await tx.workflowInstance.update({ where: { id: instanceId }, data: { status: "IN_PROGRESS", currentStep: 0, round: { increment: 1 }, ...(data ? { data: { ...((inst.data as object) ?? {}), ...data } as Prisma.InputJsonValue } : {}) } });
  await tx.workflowAction.create({ data: { instanceId, actorId: actor.id, action: "resubmit" } });
  const done = await activateFrom(tx, updated, await stepsOf(tx, inst.definitionId), 0, actor);
  if (done) await finish(tx, updated, "APPROVED", actor);
}

export async function cancelWorkflow(ctx: AuthContext, instanceId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const inst = await tx.workflowInstance.findUnique({ where: { id: instanceId } });
    if (!inst) throw notFound("Request");
    const monitor = can(ctx, "workflow.monitor", inst.departmentId ?? undefined);
    if (inst.initiatorId !== ctx.user.id && !monitor) throw forbidden();
    if (!["IN_PROGRESS", "RETURNED"].includes(inst.status)) throw workflowError("Only open requests can be withdrawn.");
    await finish(tx, inst, "CANCELLED", actorOf(ctx), reason || "Withdrawn");
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.cancel", resourceType: inst.resourceType, resourceId: inst.resourceId, summary: inst.title, newValue: { reason } }, tx);
  });
}

/** Reassign every open task of a step (monitors only) — e.g. when an approver has left. */
export async function reassignTask(ctx: AuthContext, taskId: string, toUserId: string) {
  return db.$transaction(async (tx) => {
    const task = await tx.workflowTask.findUnique({ where: { id: taskId }, include: { instance: true, assignee: { select: { name: true } } } });
    if (!task) throw notFound("Approval task");
    if (!can(ctx, "workflow.monitor", task.instance.departmentId ?? undefined)) throw forbidden();
    if (task.status !== "PENDING") throw workflowError("This task has already been decided.");
    if ([task.instance.initiatorId, task.instance.subjectUserId].includes(toUserId)) throw invalid("The requester cannot approve their own request.");
    const to = await tx.user.findFirst({ where: { id: toUserId, status: "ACTIVE", deletedAt: null, userType: "STAFF" } });
    if (!to) throw notFound("User");
    await tx.workflowTask.update({ where: { id: taskId }, data: { assigneeId: to.id, delegatedFromId: task.assigneeId } });
    await tx.workflowAction.create({ data: { instanceId: task.instanceId, taskId, actorId: ctx.user.id, action: "reassign", stepIndex: task.stepIndex, comment: `Reassigned from ${task.assignee.name} to ${to.name}` } });
    await notify({ userIds: [to.id], type: "workflow.task", title: `Approval assigned to you: ${task.instance.title}`, body: task.stepName, link: `/inbox/${task.id}` }, tx);
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.reassign", resourceType: task.instance.resourceType, resourceId: task.instance.resourceId, summary: `${task.stepName}: ${task.assignee.name} → ${to.name}` }, tx);
  });
}

/**
 * SLA escalation (run by the worker). Overdue tasks are flagged once; when the step names an escalation
 * role, its holders (scoped to the request's department) get an additional task for the same step.
 */
export async function escalateOverdueTasks(now = new Date()) {
  const overdue = await db.workflowTask.findMany({ where: { status: "PENDING", escalatedAt: null, dueAt: { lt: now } }, include: { instance: true }, take: 200 });
  let escalated = 0;
  for (const t of overdue) {
    await db.$transaction(async (tx) => {
      const step = (await stepsOf(tx, t.instance.definitionId))[t.stepIndex];
      await tx.workflowTask.update({ where: { id: t.id }, data: { escalatedAt: now } });
      const extra = step?.escalateToRole ? (await usersWithRole(step.escalateToRole, t.instance.departmentId, tx)).filter((id) => ![t.instance.initiatorId, t.instance.subjectUserId, t.assigneeId].includes(id)) : [];
      const already = new Set((await tx.workflowTask.findMany({ where: { instanceId: t.instanceId, round: t.round, stepIndex: t.stepIndex, status: "PENDING" }, select: { assigneeId: true } })).map((x) => x.assigneeId));
      const fresh = extra.filter((id) => !already.has(id));
      if (fresh.length) {
        await tx.workflowTask.createMany({ data: fresh.map((assigneeId) => ({ instanceId: t.instanceId, round: t.round, stepIndex: t.stepIndex, stepKey: t.stepKey, stepName: `${t.stepName} (escalated)`, assigneeId, escalatedAt: now })) });
      }
      await tx.workflowAction.create({ data: { instanceId: t.instanceId, taskId: t.id, action: "escalate", stepIndex: t.stepIndex, comment: fresh.length ? `SLA missed; escalated to ${step?.escalateToRole}` : "SLA missed" } });
      await notify({ userIds: [t.assigneeId, ...fresh], type: "workflow.overdue", title: `Overdue approval: ${t.instance.title}`, body: t.stepName, link: "/inbox" }, tx);
    });
    escalated++;
  }
  return escalated;
}

// ───────────────────────── Delegations (out of office) ─────────────────────────

const delegationSchema = z
  .object({
    toUserId: z.string().min(1, "Choose a colleague"),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    module: z.string().trim().max(60).nullable().optional(),
    reason: z.string().trim().max(300).nullable().optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, { path: ["endsAt"], message: "The end must be after the start" })
  .refine((v) => v.endsAt.getTime() - v.startsAt.getTime() <= 180 * 86_400_000, { path: ["endsAt"], message: "At most 180 days" });

/** Delegate one's own future approval tasks while away. Existing tasks can be delegated individually. */
export async function saveDelegation(ctx: AuthContext, raw: unknown) {
  const v = delegationSchema.parse(raw);
  if (v.toUserId === ctx.user.id) throw invalid("Choose someone other than yourself.");
  const to = await db.user.findFirst({ where: { id: v.toUserId, status: "ACTIVE", deletedAt: null, userType: "STAFF" } });
  if (!to) throw notFound("User");
  const d = await db.workflowDelegation.create({ data: { fromUserId: ctx.user.id, toUserId: to.id, startsAt: v.startsAt, endsAt: v.endsAt, module: v.module || null, reason: v.reason ?? null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.delegation.create", resourceType: "workflowDelegation", resourceId: d.id, summary: `Approvals delegated to ${to.name}`, newValue: v });
  await notify({ userIds: [to.id], type: "workflow.delegation", title: `${ctx.user.name} delegated approvals to you`, body: `${v.startsAt.toDateString()} – ${v.endsAt.toDateString()}`, link: "/inbox" });
  return d;
}

export async function revokeDelegation(ctx: AuthContext, id: string) {
  const d = await db.workflowDelegation.findUnique({ where: { id } });
  if (!d || d.fromUserId !== ctx.user.id) throw notFound("Delegation");
  await db.workflowDelegation.update({ where: { id }, data: { revokedAt: new Date() } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "workflow.delegation.revoke", resourceType: "workflowDelegation", resourceId: id });
}

// ───────────────────────── Queries ─────────────────────────

/** Instances the user may see: own requests, requests about them, tasks assigned to them, or monitored scope. */
export function instanceWhere(ctx: AuthContext): Prisma.WorkflowInstanceWhereInput {
  const or: Prisma.WorkflowInstanceWhereInput[] = [
    { initiatorId: ctx.user.id },
    { subjectUserId: ctx.user.id },
    { tasks: { some: { OR: [{ assigneeId: ctx.user.id }, { delegatedFromId: ctx.user.id }] } } },
  ];
  const scope = scopeOf(ctx, "workflow.monitor");
  if (scope === null) return {};
  if (scope.length) or.push({ departmentId: { in: scope } });
  return { OR: or };
}

export async function loadInstanceFor(ctx: AuthContext, id: string) {
  const inst = await db.workflowInstance.findFirst({
    where: { AND: [{ id }, instanceWhere(ctx)] },
    include: {
      definition: { select: { name: true, version: true, steps: true } },
      initiator: { select: { name: true, designation: true } },
      tasks: { orderBy: [{ stepIndex: "asc" }, { createdAt: "asc" }], include: { assignee: { select: { name: true, designation: true } }, delegatedFrom: { select: { name: true } } } },
      actions: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } },
    },
  });
  if (!inst) throw notFound("Request");
  const m = workflowModule(inst.key);
  return { instance: inst, steps: parseSteps(inst.definition.steps), href: m?.href?.(inst) ?? null, details: m?.details?.(inst.data) ?? null };
}

export async function inboxCounts(ctx: AuthContext) {
  const [tasks, overdue, returned] = await Promise.all([
    db.workflowTask.count({ where: { assigneeId: ctx.user.id, status: "PENDING", instance: { status: "IN_PROGRESS" } } }),
    db.workflowTask.count({ where: { assigneeId: ctx.user.id, status: "PENDING", dueAt: { lt: new Date() }, instance: { status: "IN_PROGRESS" } } }),
    db.workflowInstance.count({ where: { initiatorId: ctx.user.id, status: "RETURNED" } }),
  ]);
  return { tasks, overdue, returned };
}
