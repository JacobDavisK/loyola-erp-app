"use server";

import { revalidatePath } from "next/cache";
import { zonedTimeToUtc } from "@/lib/domain/timetable";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { getInstitution } from "@/server/services/directory";
import {
  deleteAnnouncement, deleteAssignment, deleteItem, deleteModule, deleteQuestion, gradeSubmission, postAnnouncement, releaseGrades, saveAnswers, saveAssignment, saveItem,
  saveModule, saveQuestion, saveQuiz, startAttempt, submitAssignment, submitAttempt, transferToComponent, uploadMaterial,
} from "@/server/services/lms";

const refresh = () => {
  revalidatePath("/teaching", "layout");
  revalidatePath("/portal/courses", "layout");
  revalidatePath("/courses", "layout");
};

/** Date-time inputs arrive as wall-clock "YYYY-MM-DDTHH:mm" in the institution's time zone. */
async function zoned(input: Record<string, unknown>, keys: string[]) {
  const { timezone } = await getInstitution();
  const out = { ...input };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) out[k] = zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), timezone);
    else if (v === "") out[k] = null;
  }
  return out;
}

export async function saveModuleAction(offeringId: string, id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await saveModule(await requireAuth(), offeringId, id, input); refresh(); }, "Module saved");
}
export async function deleteModuleAction(id: string) {
  return runAction(async () => { await deleteModule(await requireAuth(), id); refresh(); }, "Module deleted");
}
export async function saveItemAction(moduleId: string, id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await saveItem(await requireAuth(), moduleId, id, await zoned(input, ["availableFrom"])); refresh(); }, "Item saved");
}
export async function uploadMaterialAction(moduleId: string, form: FormData) {
  return runAction(async () => { const it = await uploadMaterial(await requireAuth(), moduleId, form); refresh(); return { id: it.id }; }, "File uploaded");
}
export async function deleteItemAction(id: string) {
  return runAction(async () => { await deleteItem(await requireAuth(), id); refresh(); }, "Item deleted");
}
export async function postAnnouncementAction(offeringId: string, _id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await postAnnouncement(await requireAuth(), offeringId, input); refresh(); }, "Announcement posted");
}
export async function deleteAnnouncementAction(id: string) {
  return runAction(async () => { await deleteAnnouncement(await requireAuth(), id); refresh(); }, "Announcement deleted");
}
export async function saveAssignmentAction(offeringId: string, id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { const a = await saveAssignment(await requireAuth(), offeringId, id, await zoned(input, ["dueAt", "closesAt"])); refresh(); return { id: a.id }; }, "Assignment saved");
}
export async function deleteAssignmentAction(id: string) {
  return runAction(async () => { await deleteAssignment(await requireAuth(), id); refresh(); }, "Assignment deleted");
}
export async function submitAssignmentAction(assignmentId: string, form: FormData) {
  return runAction(async () => { const s = await submitAssignment(await requireAuth(), assignmentId, form); refresh(); return { attempt: s.attempt, late: s.isLate }; }, "Submitted");
}
export async function gradeSubmissionAction(id: string, input: unknown) {
  return runAction(async () => { await gradeSubmission(await requireAuth(), id, input); refresh(); }, "Saved");
}
export async function releaseGradesAction(assignmentId: string) {
  return runAction(async () => { await releaseGrades(await requireAuth(), assignmentId); refresh(); }, "Marks released to students");
}
export async function saveQuizAction(offeringId: string, id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { const q = await saveQuiz(await requireAuth(), offeringId, id, await zoned(input, ["opensAt", "closesAt"])); refresh(); return { id: q.id }; }, "Quiz saved");
}
export async function saveQuestionAction(quizId: string, id: string | null, input: unknown) {
  return runAction(async () => { await saveQuestion(await requireAuth(), quizId, id, input); refresh(); }, "Question saved");
}
export async function deleteQuestionAction(id: string) {
  return runAction(async () => { await deleteQuestion(await requireAuth(), id); refresh(); }, "Question deleted");
}
export async function startAttemptAction(quizId: string, proctorConsent = false) {
  return runAction(async () => { const a = await startAttempt(await requireAuth(), quizId, { proctorConsent }); refresh(); return { id: a.id }; });
}
export async function saveAnswersAction(attemptId: string, answers: unknown) {
  return runAction(async () => { await saveAnswers(await requireAuth(), attemptId, answers); });
}
export async function submitAttemptAction(attemptId: string, answers: unknown) {
  return runAction(async () => { const a = await submitAttempt(await requireAuth(), attemptId, answers); refresh(); return { score: a.score }; }, "Quiz submitted");
}
export async function transferAction(offeringId: string, input: unknown) {
  return runAction(async () => { const r = await transferToComponent(await requireAuth(), offeringId, input); refresh(); return r; });
}
