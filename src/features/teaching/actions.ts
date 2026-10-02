"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requestMeta } from "@/server/request-context";
import { assertRate } from "@/server/security/rate-limit";
import { requireAuth } from "@/server/auth/current";
import { checkIn, closeCheckIn, currentQr, openCheckIn } from "@/server/services/checkin";
import { addLink, saveTool } from "@/server/services/lti";
import { recordProctorEvents, uploadProctorFrame } from "@/server/services/proctoring";
import { checkAssignmentSimilarity } from "@/server/services/submission-similarity";
import { createSurvey, createTermSurveys, respond, respondPublic, setSurveyStatus } from "@/server/services/surveys";
import { applyRun, discardRun, generateTimetable } from "@/server/services/timetable-generator";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

// Timetable generator
export async function generateTimetableAction(_id: string | null, input: unknown) {
  return runAction(async () => { const r = await generateTimetable(await requireAuth("timetable.manage"), input); refresh("/academics/timetable"); return { id: r.id }; }, "Proposal ready for review");
}
export async function applyTimetableRunAction(id: string) {
  return runAction(async () => { const n = await applyRun(await requireAuth("timetable.manage"), id); refresh("/academics"); return n; }, "Timetable applied");
}
export async function discardTimetableRunAction(id: string) {
  return runAction(async () => { await discardRun(await requireAuth("timetable.manage"), id); refresh("/academics/timetable"); }, "Proposal discarded");
}

// QR check-in
export async function openCheckInAction(meetingId: string, input: unknown) {
  return runAction(async () => { await openCheckIn(await requireAuth(), meetingId, input); refresh("/teaching"); }, "Check-in is open");
}
export async function closeCheckInAction(meetingId: string) {
  return runAction(async () => { await closeCheckIn(await requireAuth(), meetingId); refresh("/teaching"); }, "Check-in closed");
}
export async function currentQrAction(meetingId: string) {
  return runAction(async () => currentQr(await requireAuth(), meetingId));
}
export async function checkInAction(windowId: string, input: unknown) {
  return runAction(async () => checkIn(await requireAuth(), windowId, input));
}

// Proctoring
export async function proctorEventsAction(attemptId: string, events: unknown) {
  return runAction(async () => recordProctorEvents(await requireAuth(), attemptId, events));
}
export async function proctorFrameAction(attemptId: string, form: FormData) {
  return runAction(async () => { await uploadProctorFrame(await requireAuth(), attemptId, form); });
}

// Similarity
export async function checkSimilarityAction(assignmentId: string) {
  return runAction(async () => { const r = await checkAssignmentSimilarity(await requireAuth(), assignmentId); refresh("/teaching"); return { compared: r.compared }; }, "Similarity check finished");
}

// LTI
export async function saveLtiToolAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveTool(await requireAuth("lti.manage"), id, input); refresh("/admin/lti"); }, "Tool saved");
}
export async function addLtiLinkAction(moduleId: string, _id: string | null, input: unknown) {
  return runAction(async () => { await addLink(await requireAuth(), moduleId, input); refresh("/teaching", "/portal/courses"); }, "Tool added to the module");
}

// Surveys
export async function createSurveyAction(_id: string | null, input: unknown) {
  return runAction(async () => { const r = await createSurvey(await requireAuth(), input); refresh("/surveys"); return { id: r.survey.id, publicToken: r.publicToken }; }, "Survey created");
}
export async function createTermSurveysAction(_id: string | null, input: unknown) {
  return runAction(async () => { const n = await createTermSurveys(await requireAuth("survey.manage"), input); refresh("/surveys"); return { created: n }; });
}
export async function setSurveyStatusAction(id: string, status: "OPEN" | "CLOSED") {
  return runAction(async () => { await setSurveyStatus(await requireAuth(), id, status); refresh("/surveys", "/portal"); }, status === "OPEN" ? "Survey opened" : "Survey closed");
}
export async function respondSurveyAction(id: string, answers: unknown) {
  return runAction(async () => { await respond(await requireAuth(), id, answers); refresh("/surveys", "/portal"); }, "Thank you for your feedback");
}
export async function respondPublicSurveyAction(token: string, browserId: string, answers: unknown) {
  return runAction(async () => {
    assertRate(`survey-public:${(await requestMeta()).ip ?? "unknown"}`, 20, 10 * 60_000);
    await respondPublic(token, browserId, answers);
  }, "Thank you for your feedback");
}
