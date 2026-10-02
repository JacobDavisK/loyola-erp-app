"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { generateNadBatch, setApaarId, setNadBatchStatus, verifyApaarId } from "@/server/services/nad";
import { deleteExitAward, requestExit, reviewExternalCredit, saveExitAward, submitExternalCredit } from "@/server/services/nep";
import { deleteCourseOutcome, deleteProgramOutcome, saveCourseOutcome, saveProgramOutcome, setComponentOutcomes, setCoPoMatrix } from "@/server/services/obe";
import {
  decideConsent, fulfilAccessRequest, publishNotice, raiseDataRequest, reportBreach, retireNotice, saveRetentionRule, updateBreach, updateDataRequest,
} from "@/server/services/privacy";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

// APAAR / ABC / NAD
export async function setApaarAction(studentId: string, apaarId: string | null) {
  return runAction(async () => { await setApaarId(await requireAuth(), studentId, apaarId); refresh("/students", "/portal"); }, apaarId ? "APAAR ID saved" : "APAAR ID removed");
}
export async function verifyApaarAction(studentId: string, verified: boolean) {
  return runAction(async () => { await verifyApaarId(await requireAuth("apaar.manage"), studentId, verified); refresh("/students", "/compliance"); }, verified ? "APAAR ID verified" : "Verification withdrawn");
}
export async function generateNadBatchAction(_id: string | null, input: unknown) {
  return runAction(async () => { const b = await generateNadBatch(await requireAuth("apaar.manage"), input); refresh("/compliance"); return { id: b.id }; }, "Upload file prepared");
}
export async function setNadBatchStatusAction(id: string, input: unknown) {
  return runAction(async () => { await setNadBatchStatus(await requireAuth("apaar.manage"), id, input); refresh("/compliance"); }, "Batch updated");
}

// NEP 2020
export async function saveExitAwardAction(programId: string, id: string | null, input: unknown) {
  return runAction(async () => { await saveExitAward(await requireAuth("nep.manage"), programId, id, input); refresh("/academics/nep"); }, "Award saved");
}
export async function deleteExitAwardAction(id: string) {
  return runAction(async () => { await deleteExitAward(await requireAuth("nep.manage"), id); refresh("/academics/nep"); }, "Award removed");
}
export async function requestExitAction(studentId: string, input: unknown) {
  return runAction(async () => { await requestExit(await requireAuth(), studentId, input); refresh("/students", "/portal", "/inbox"); }, "Exit request sent for approval");
}
export async function submitExternalCreditAction(studentId: string, form: FormData) {
  return runAction(async () => { await submitExternalCredit(await requireAuth(), studentId, form); refresh("/students", "/portal", "/academics/credit-transfer"); }, "Submitted for review");
}
export async function reviewExternalCreditAction(id: string, input: unknown) {
  return runAction(async () => { await reviewExternalCredit(await requireAuth("credittransfer.review"), id, input); refresh("/academics/credit-transfer", "/students"); }, "Decision recorded");
}

// Outcome-based education
export async function saveProgramOutcomeAction(programId: string, id: string | null, input: unknown) {
  return runAction(async () => { await saveProgramOutcome(await requireAuth("obe.manage"), programId, id, input); refresh("/obe"); }, "Outcome saved");
}
export async function deleteProgramOutcomeAction(id: string) {
  return runAction(async () => { await deleteProgramOutcome(await requireAuth("obe.manage"), id); refresh("/obe"); }, "Outcome removed");
}
export async function saveCourseOutcomeAction(courseId: string, id: string | null, input: unknown) {
  return runAction(async () => { await saveCourseOutcome(await requireAuth("obe.manage"), courseId, id, input); refresh("/obe"); }, "Course outcome saved");
}
export async function deleteCourseOutcomeAction(id: string) {
  return runAction(async () => { await deleteCourseOutcome(await requireAuth("obe.manage"), id); refresh("/obe"); }, "Course outcome removed");
}
export async function setCoPoMatrixAction(courseId: string, cells: Record<string, number>) {
  return runAction(async () => { await setCoPoMatrix(await requireAuth("obe.manage"), courseId, cells); refresh("/obe"); }, "CO–PO matrix saved");
}
export async function setComponentOutcomesAction(componentId: string, outcomeIds: string[]) {
  return runAction(async () => { await setComponentOutcomes(await requireAuth(), componentId, outcomeIds); refresh("/obe", "/teaching"); }, "Mapping saved");
}

// Data protection
export async function publishNoticeAction(_id: string | null, input: unknown) {
  return runAction(async () => { await publishNotice(await requireAuth("privacy.manage"), input); refresh("/privacy", "/me/privacy"); }, "Notice published");
}
export async function retireNoticeAction(id: string) {
  return runAction(async () => { await retireNotice(await requireAuth("privacy.manage"), id); refresh("/privacy", "/me/privacy"); }, "Notice retired");
}
export async function decideConsentAction(input: unknown) {
  return runAction(async () => { await decideConsent(await requireAuth(), input); refresh("/", "/me/privacy"); }, "Your choice was recorded");
}
export async function raiseDataRequestAction(_id: string | null, input: unknown) {
  return runAction(async () => { await raiseDataRequest(await requireAuth(), input); refresh("/me/privacy", "/privacy"); }, "Request sent to the Data Protection Officer");
}
export async function updateDataRequestAction(id: string, input: unknown) {
  return runAction(async () => { await updateDataRequest(await requireAuth("privacy.manage"), id, input); refresh("/privacy", "/me/privacy"); }, "Request updated");
}
export async function fulfilAccessRequestAction(id: string) {
  return runAction(async () => { await fulfilAccessRequest(await requireAuth("privacy.manage"), id); refresh("/privacy", "/me/privacy"); }, "Export prepared and attached to the request");
}
export async function reportBreachAction(_id: string | null, input: unknown) {
  return runAction(async () => { await reportBreach(await requireAuth(), input); refresh("/privacy"); }, "Reported to the Data Protection Officer");
}
export async function updateBreachAction(id: string, input: unknown) {
  return runAction(async () => { await updateBreach(await requireAuth("privacy.manage"), id, input); refresh("/privacy"); }, "Breach updated");
}
export async function saveRetentionRuleAction(_id: string | null, input: unknown) {
  return runAction(async () => { await saveRetentionRule(await requireAuth("privacy.manage"), input); refresh("/privacy"); }, "Retention rule saved");
}
