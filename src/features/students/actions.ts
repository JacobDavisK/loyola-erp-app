"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { commitStudentImport, previewStudentImport } from "@/server/services/student-import";
import {
  createStudent, provisionGuardianAccount, provisionStudentAccount, removeGuardian, requestStatusChange, saveGuardian, updateStudent,
} from "@/server/services/students";

export async function createStudentAction(input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("student.create");
    const s = await createStudent(ctx, input);
    revalidatePath("/students");
    return { id: s.id, studentNo: s.studentNo };
  }, "Student created");
}

export async function updateStudentAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("student.update");
    await updateStudent(ctx, id, input);
    revalidatePath(`/students/${id}`);
  }, "Student updated");
}

export async function requestStatusChangeAction(id: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("student.status");
    const inst = await requestStatusChange(ctx, id, input);
    revalidatePath(`/students/${id}`);
    return { instanceId: inst.id, status: inst.status };
  }, "Status change sent for approval");
}

export async function saveGuardianAction(studentId: string, guardianId: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("student.update");
    await saveGuardian(ctx, studentId, guardianId, input);
    revalidatePath(`/students/${studentId}`);
  }, "Guardian saved");
}

export async function removeGuardianAction(studentId: string, guardianId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.update");
    await removeGuardian(ctx, studentId, guardianId);
    revalidatePath(`/students/${studentId}`);
  }, "Guardian removed");
}

export async function provisionStudentAccountAction(studentId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.update");
    await provisionStudentAccount(ctx, studentId);
    revalidatePath(`/students/${studentId}`);
  }, "Portal account created — an invitation e-mail was sent");
}

export async function provisionGuardianAccountAction(studentId: string, guardianId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.update");
    await provisionGuardianAccount(ctx, studentId, guardianId);
    revalidatePath(`/students/${studentId}`);
  }, "Guardian portal access set up");
}

export async function previewImportAction(text: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.create");
    return previewStudentImport(ctx, String(text ?? ""));
  });
}

export async function commitImportAction(text: string, fileName: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.create");
    const job = await commitStudentImport(ctx, String(text ?? ""), String(fileName ?? "upload.csv").slice(0, 120));
    return { jobId: job.id };
  }, "Import queued");
}

export async function jobStatusAction(jobId: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const { getJobFor } = await import("@/server/services/jobs");
    const j = await getJobFor(ctx, jobId);
    return { status: j.status, progress: j.progress, error: j.error, result: j.result as Record<string, unknown> | null };
  });
}
