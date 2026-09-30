"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { issueForStudent, requestCredential, revokeCredential } from "@/server/services/credentials";
import {
  allocateSitting, assignInvigilator, cancelExamRegistration, generateExamRegistrations, issueHallTickets, removeDuty, requestCondonation, setEligibility,
} from "@/server/services/exam-ops";
import { deleteComponent, saveComponent, saveMarks, submitSheet } from "@/server/services/marks";
import { activateGradingScheme, computeRun, createRun, saveGradingScheme, setRegulationScheme, submitRun, withholdResult } from "@/server/services/results";
import { completeRevaluation, rejectRevaluation, requestRevaluation, settleRevaluationFee, startRevaluation, submitRevaluationMarks } from "@/server/services/revaluation";
import { assignValuers, codeScripts, setScriptAttendance, submitValuation } from "@/server/services/valuation";

const ops = () => revalidatePath("/exam-ops", "layout");

// ── Examination operations ──
export async function generateRegistrationsAction(sessionId: string) {
  return runAction(async () => {
    const r = await generateExamRegistrations(await requireAuth("examreg.manage"), sessionId);
    ops();
    return r;
  });
}
export async function issueHallTicketsAction(sessionId: string) {
  return runAction(async () => {
    const r = await issueHallTickets(await requireAuth("examreg.manage"), sessionId);
    ops();
    return { created: r.issued };
  });
}
export async function setEligibilityAction(registrationId: string, input: unknown) {
  return runAction(async () => {
    await setEligibility(await requireAuth("examreg.manage"), registrationId, input);
    ops();
  }, "Eligibility updated");
}
export async function cancelExamRegistrationAction(registrationId: string, reason: string) {
  return runAction(async () => {
    await cancelExamRegistration(await requireAuth("examreg.manage"), registrationId, String(reason ?? ""));
    ops();
  }, "Registration cancelled");
}
export async function requestCondonationAction(registrationId: string, reason: string) {
  return runAction(async () => {
    const inst = await requestCondonation(await requireAuth(), registrationId, reason);
    revalidatePath("/portal/exams");
    ops();
    return { id: inst.id };
  }, "Condonation request submitted");
}
export async function allocateSittingAction(sessionId: string, input: unknown) {
  return runAction(async () => {
    const r = await allocateSitting(await requireAuth("seating.manage"), sessionId, input);
    ops();
    return r;
  });
}
export async function assignInvigilatorAction(sessionId: string, input: unknown) {
  return runAction(async () => {
    await assignInvigilator(await requireAuth("seating.manage"), sessionId, input);
    ops();
  }, "Duty assigned");
}
export async function removeDutyAction(dutyId: string) {
  return runAction(async () => {
    await removeDuty(await requireAuth("seating.manage"), dutyId);
    ops();
  }, "Duty removed");
}

// ── Valuation ──
export async function codeScriptsAction(examinationId: string) {
  return runAction(async () => {
    const r = await codeScripts(await requireAuth("valuation.manage"), examinationId);
    ops();
    return r;
  });
}
export async function setScriptAttendanceAction(scriptId: string, input: unknown) {
  return runAction(async () => {
    await setScriptAttendance(await requireAuth("valuation.manage"), scriptId, input);
    ops();
  }, "Script updated");
}
export async function assignValuersAction(examinationId: string, input: unknown) {
  return runAction(async () => {
    const r = await assignValuers(await requireAuth("valuation.manage"), examinationId, input);
    ops();
    return r;
  }, "Scripts assigned");
}
export async function submitValuationAction(valuationId: string, input: unknown, revaluation: boolean) {
  return runAction(async () => {
    const ctx = await requireAuth("valuation.perform");
    if (revaluation) await submitRevaluationMarks(ctx, valuationId, input);
    else await submitValuation(ctx, valuationId, input);
    revalidatePath("/valuation");
  }, "Marks submitted");
}

// ── Marks ──
export async function saveComponentAction(offeringId: string, componentId: string | null, input: unknown) {
  return runAction(async () => {
    await saveComponent(await requireAuth(), offeringId, componentId, input);
    revalidatePath(`/academics/offerings/${offeringId}`);
  }, "Component saved");
}
export async function deleteComponentAction(componentId: string, offeringId: string) {
  return runAction(async () => {
    await deleteComponent(await requireAuth(), componentId);
    revalidatePath(`/academics/offerings/${offeringId}`);
  }, "Component removed");
}
export async function saveMarksAction(componentId: string, input: unknown) {
  return runAction(async () => {
    const r = await saveMarks(await requireAuth(), componentId, input);
    revalidatePath("/academics/offerings", "layout");
    return r;
  }, "Marks saved");
}
export async function submitSheetAction(componentId: string) {
  return runAction(async () => {
    await submitSheet(await requireAuth("marks.enter"), componentId);
    revalidatePath("/academics/offerings", "layout");
  }, "Submitted for verification");
}

// ── Results ──
export async function saveGradingSchemeAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const g = await saveGradingScheme(await requireAuth("grading.manage"), id, input);
    revalidatePath("/results/grading");
    return { id: g.id };
  }, "Grading scheme saved");
}
export async function activateGradingSchemeAction(id: string) {
  return runAction(async () => {
    await activateGradingScheme(await requireAuth("grading.manage"), id);
    revalidatePath("/results/grading");
  }, "Scheme activated");
}
export async function setRegulationSchemeAction(regulationId: string, schemeId: string) {
  return runAction(async () => {
    await setRegulationScheme(await requireAuth("grading.manage"), regulationId, schemeId);
    revalidatePath("/results/grading");
  }, "Regulation updated");
}
export async function createRunAction(_id: string | null, input: unknown) {
  return runAction(async () => {
    const r = await createRun(await requireAuth("result.process"), input);
    revalidatePath("/results");
    return { id: r.id };
  }, "Result run created");
}
export async function computeRunAction(runId: string) {
  return runAction(async () => {
    const s = await computeRun(await requireAuth("result.process"), runId);
    revalidatePath(`/results/${runId}`);
    return s;
  }, "Results computed");
}
export async function submitRunAction(runId: string) {
  return runAction(async () => {
    await submitRun(await requireAuth("result.process"), runId);
    revalidatePath(`/results/${runId}`);
  }, "Sent for approval");
}
export async function withholdResultAction(courseResultId: string, reason: string | null, runId: string) {
  return runAction(async () => {
    await withholdResult(await requireAuth("result.withhold"), courseResultId, reason);
    revalidatePath(`/results/${runId}`);
  }, reason ? "Result withheld" : "Withhold released");
}

// ── Revaluation ──
export async function requestRevaluationAction(courseResultId: string, type: "RETOTALLING" | "REVALUATION") {
  return runAction(async () => {
    await requestRevaluation(await requireAuth(), courseResultId, { type });
    revalidatePath("/portal/results");
  }, "Request submitted");
}
export async function settleRevaluationFeeAction(id: string, input: unknown) {
  return runAction(async () => {
    await settleRevaluationFee(await requireAuth("revaluation.manage"), id, input);
    revalidatePath("/results/revaluation");
  }, "Fee recorded");
}
export async function startRevaluationAction(id: string, input: unknown) {
  return runAction(async () => {
    await startRevaluation(await requireAuth("revaluation.manage"), id, input);
    revalidatePath("/results/revaluation");
  }, "Started");
}
export async function completeRevaluationAction(id: string, input: unknown) {
  return runAction(async () => {
    const r = await completeRevaluation(await requireAuth("revaluation.manage"), id, input);
    revalidatePath("/results/revaluation");
    return r;
  });
}
export async function rejectRevaluationAction(id: string, reason: string) {
  return runAction(async () => {
    await rejectRevaluation(await requireAuth("revaluation.manage"), id, reason);
    revalidatePath("/results/revaluation");
  }, "Request rejected");
}

// ── Credentials ──
export async function issueCredentialAction(studentId: string, input: unknown) {
  return runAction(async () => {
    const c = await issueForStudent(await requireAuth("credential.issue"), studentId, input);
    revalidatePath(`/students/${studentId}`);
    return { id: c.id, serialNo: c.serialNo };
  }, "Issued");
}
export async function revokeCredentialAction(id: string, reason: string) {
  return runAction(async () => {
    await revokeCredential(await requireAuth("credential.revoke"), id, reason);
    revalidatePath("/credentials", "layout");
    revalidatePath("/students", "layout");
  }, "Credential revoked");
}
export async function requestCredentialAction(_id: string | null, input: unknown) {
  return runAction(async () => {
    const inst = await requestCredential(await requireAuth("credential.request"), input);
    revalidatePath("/portal/results");
    return { id: inst.id };
  }, "Request sent to the Registrar's office");
}
