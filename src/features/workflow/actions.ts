"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { requestAccess } from "@/server/services/access-requests";
import {
  cancelWorkflow, decideTask, delegateTask, publishDefinition, reassignTask, revokeDelegation, saveDelegation, setDefinitionActive,
} from "@/server/services/workflow";

const refresh = () => {
  revalidatePath("/inbox", "layout");
  revalidatePath("/", "layout");
};

export async function decideTaskAction(taskId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const r = await decideTask(ctx, taskId, input);
    refresh();
    return r;
  }, "Decision recorded");
}

export async function delegateTaskAction(taskId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await delegateTask(ctx, taskId, input);
    refresh();
  }, "Task delegated");
}

export async function reassignTaskAction(taskId: string, toUserId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("workflow.monitor");
    await reassignTask(ctx, taskId, toUserId);
    refresh();
  }, "Task reassigned");
}

export async function cancelRequestAction(instanceId: string, reason: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await cancelWorkflow(ctx, instanceId, String(reason ?? "").slice(0, 500));
    refresh();
  }, "Request withdrawn");
}

export async function saveDelegationAction(_id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await saveDelegation(ctx, input);
    refresh();
  }, "Delegation saved");
}

export async function revokeDelegationAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await revokeDelegation(ctx, id);
    refresh();
  }, "Delegation ended");
}

export async function requestAccessAction(_id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const inst = await requestAccess(ctx, input);
    refresh();
    return { id: inst.id, status: inst.status };
  }, "Access request submitted");
}

export async function publishDefinitionAction(key: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("workflow.manage");
    const d = await publishDefinition(ctx, key, input);
    revalidatePath("/admin/workflows", "layout");
    return { version: d.version };
  }, "New version published");
}

export async function setDefinitionActiveAction(key: string, active: boolean) {
  return runAction(async () => {
    const ctx = await requireAuth("workflow.manage");
    await setDefinitionActive(ctx, key, active);
    revalidatePath("/admin/workflows", "layout");
  }, active ? "Workflow switched on" : "Workflow switched off");
}

/** Colleague lookup for delegation/reassignment: staff only, name + designation, at most 8 results. */
export async function searchStaffAction(q: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const term = String(q ?? "").trim().slice(0, 60);
    if (term.length < 2) return [];
    if (ctx.user.userType !== "STAFF") return [];
    const { db } = await import("@/server/db");
    const rows = await db.user.findMany({
      where: { status: "ACTIVE", deletedAt: null, userType: "STAFF", id: { not: ctx.user.id }, OR: [{ name: { contains: term, mode: "insensitive" } }, { employeeId: { contains: term, mode: "insensitive" } }] },
      take: 8,
      orderBy: { name: "asc" },
      select: { id: true, name: true, designation: true, department: { select: { code: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.name, subtitle: [r.designation, r.department?.code].filter(Boolean).join(" · ") }));
  });
}
