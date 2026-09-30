"use server";

import { revalidatePath } from "next/cache";
import { BUDGET_HEADS } from "@/lib/domain/quality";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { invalid } from "@/server/errors";
import {
  addEvidence, adoptComputed, assignMetrics, closeCycle, createCycle, importMetrics, removeEvidence, reopenResponse, reviewResponse, saveFramework, saveResponse, submitResponse,
} from "@/server/services/iqac";
import { completeProject, createProject, deletePublication, recordExpense, recordSanction, savePublication, submitProject, updateProject, verifyPublication } from "@/server/services/research";

const refresh = () => {
  revalidatePath("/research", "layout");
  revalidatePath("/iqac", "layout");
  revalidatePath("/me", "layout");
};

/** Employee numbers typed as "EMP2201, EMP2202" → employee ids. */
async function employeesByNo(text: unknown): Promise<string[]> {
  const nos = String(text ?? "").split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  if (!nos.length) return [];
  const found = await db.employee.findMany({ where: { employeeNo: { in: nos }, deletedAt: null }, select: { id: true, employeeNo: true } });
  const missing = nos.filter((n) => !found.some((f) => f.employeeNo === n));
  if (missing.length) throw invalid(`Unknown employee number(s): ${missing.join(", ")}`);
  return nos.map((n) => found.find((f) => f.employeeNo === n)!.id);
}

/** The project form has one amount field per budget head (budget_EQUIPMENT …). */
function budgetFrom(input: Record<string, unknown>) {
  return BUDGET_HEADS.map((head) => ({ head, amount: Number(input[`budget_${head}`] ?? 0) || 0 })).filter((b) => b.amount > 0);
}

async function projectPayload(input: Record<string, unknown>) {
  return {
    title: input.title, abstract: input.abstract, fundingAgency: input.fundingAgency, scheme: input.scheme, durationMonths: input.durationMonths, budget: budgetFrom(input),
    members: [
      ...(await employeesByNo(input.coPis)).map((employeeId) => ({ employeeId, role: "CO_PI" as const })),
      ...(await employeesByNo(input.team)).map((employeeId) => ({ employeeId, role: "MEMBER" as const })),
    ],
  };
}

export async function saveProjectAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const payload = await projectPayload(input);
    const p = id ? (await updateProject(ctx, id, payload), { id }) : await createProject(ctx, payload);
    refresh();
    return { id: p.id };
  }, "Proposal saved");
}
export async function submitProjectAction(id: string) {
  return runAction(async () => { await submitProject(await requireAuth(), id); refresh(); revalidatePath("/inbox"); }, "Sent for institutional clearance");
}
export async function recordSanctionAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await recordSanction(await requireAuth("research.manage"), id!, { grantRef: input.grantRef, startDate: input.startDate, budget: budgetFrom(input) }); refresh(); }, "Sanction recorded");
}
export async function recordExpenseAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await recordExpense(await requireAuth(), id!, input); refresh(); }, "Expense recorded");
}
export async function completeProjectAction(id: string, outcome: string) {
  return runAction(async () => { await completeProject(await requireAuth(), id, outcome); refresh(); }, "Project completed");
}
export async function savePublicationAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await savePublication(ctx, id, { ...input, authorIds: await employeesByNo(input.coAuthors) });
    refresh();
  }, "Publication saved");
}
export async function verifyPublicationAction(id: string) {
  return runAction(async () => { await verifyPublication(await requireAuth("research.manage"), id); refresh(); }, "Verified");
}
export async function deletePublicationAction(id: string) {
  return runAction(async () => { await deletePublication(await requireAuth(), id); refresh(); }, "Publication deleted");
}

export async function saveFrameworkAction(id: string | null, input: unknown) {
  return runAction(async () => { const f = await saveFramework(await requireAuth("iqac.manage"), id, input); refresh(); return { id: f.id }; }, "Framework saved");
}
export async function importMetricsAction(frameworkId: string, text: string) {
  return runAction(async () => { const r = await importMetrics(await requireAuth("iqac.manage"), frameworkId, text); refresh(); return r; });
}
export async function createCycleAction(_id: string | null, input: unknown) {
  return runAction(async () => { const c = await createCycle(await requireAuth("iqac.manage"), input); refresh(); return { id: c.id }; }, "Cycle opened");
}
export async function closeCycleAction(id: string, closed: boolean) {
  return runAction(async () => { await closeCycle(await requireAuth("iqac.manage"), id, closed); refresh(); }, closed ? "Cycle closed" : "Cycle reopened");
}
export async function assignMetricsAction(cycleId: string | null, input: unknown) {
  return runAction(async () => { const r = await assignMetrics(await requireAuth("iqac.manage"), cycleId!, input); refresh(); return r; }, "Assigned");
}
export async function saveResponseAction(id: string, input: unknown) {
  return runAction(async () => { await saveResponse(await requireAuth(), id, input); refresh(); }, "Saved");
}
export async function adoptComputedAction(id: string) {
  return runAction(async () => { const s = await adoptComputed(await requireAuth(), id); refresh(); return s; }, "Value computed from platform records");
}
export async function addEvidenceAction(id: string, form: FormData) {
  return runAction(async () => { await addEvidence(await requireAuth(), id, form); refresh(); }, "Evidence added");
}
export async function removeEvidenceAction(id: string) {
  return runAction(async () => { await removeEvidence(await requireAuth(), id); refresh(); }, "Evidence removed");
}
export async function submitResponseAction(id: string) {
  return runAction(async () => { await submitResponse(await requireAuth(), id); refresh(); }, "Submitted to IQAC");
}
export async function reviewResponseAction(id: string, input: unknown) {
  return runAction(async () => { await reviewResponse(await requireAuth("iqac.manage"), id, input); refresh(); }, "Review recorded");
}
export async function reopenResponseAction(id: string, note: string) {
  return runAction(async () => { await reopenResponse(await requireAuth("iqac.manage"), id, note); refresh(); }, "Reopened");
}
