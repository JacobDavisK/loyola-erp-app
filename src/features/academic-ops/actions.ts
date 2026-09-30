"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { deleteCalendarEvent, saveSetup, type SetupKind } from "@/server/services/academic-setup";
import { saveAttendance } from "@/server/services/attendance";
import { newCurriculumVersion, saveCurriculum, setCurriculumStatus, setPrerequisites } from "@/server/services/curriculum";
import { dropRegistration, saveOffering, selfRegister, setInstructors, staffRegister } from "@/server/services/offerings";
import { addSlot, generateClassMeetings, removeSlot } from "@/server/services/timetable";

const PATHS: Record<SetupKind, string> = { batch: "/academics/batches", term: "/academics/terms", calendarEvent: "/academics/terms", building: "/academics/rooms", room: "/academics/rooms" };

export async function saveSetupAction(kind: SetupKind, id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await saveSetup(ctx, kind, id, input);
    revalidatePath(PATHS[kind]);
  }, "Saved");
}

export async function deleteCalendarEventAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.manage");
    await deleteCalendarEvent(ctx, id);
    revalidatePath("/academics/terms");
  }, "Event removed");
}

export async function saveOfferingAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.manage");
    const o = await saveOffering(ctx, id, input);
    revalidatePath("/academics/offerings", "layout");
    return { id: o.id };
  }, "Class saved");
}

export async function setInstructorsAction(offeringId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.manage");
    await setInstructors(ctx, offeringId, input);
    revalidatePath(`/academics/offerings/${offeringId}`);
  }, "Instructors updated");
}

export async function addSlotAction(offeringId: string, input: unknown, force: boolean) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await addSlot(ctx, offeringId, input, !!force);
    revalidatePath(`/academics/offerings/${offeringId}`);
  }, "Timetable slot added");
}

export async function removeSlotAction(slotId: string, offeringId: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    await removeSlot(ctx, slotId);
    revalidatePath(`/academics/offerings/${offeringId}`);
  }, "Timetable slot removed");
}

export async function generateMeetingsAction(offeringId: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const r = await generateClassMeetings(ctx, offeringId);
    revalidatePath(`/academics/offerings/${offeringId}`);
    return r;
  });
}

export async function staffRegisterAction(offeringId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.manage");
    const r = await staffRegister(ctx, offeringId, input);
    revalidatePath(`/academics/offerings/${offeringId}`);
    return r;
  });
}

export async function dropRegistrationAction(registrationId: string, reason?: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const status = await dropRegistration(ctx, registrationId, reason);
    revalidatePath("/academics/offerings", "layout");
    revalidatePath("/portal", "layout");
    return { status };
  }, "Registration updated");
}

export async function selfRegisterAction(offeringId: string) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.self");
    await selfRegister(ctx, offeringId);
    revalidatePath("/portal", "layout");
  }, "You are registered");
}

export async function saveAttendanceAction(meetingId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth();
    const r = await saveAttendance(ctx, meetingId, input);
    revalidatePath("/teaching", "layout");
    return r;
  }, "Attendance saved");
}

export async function saveCurriculumAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("curriculum.manage");
    const c = await saveCurriculum(ctx, id, input);
    revalidatePath("/academics/curricula", "layout");
    return { id: c.id };
  }, "Curriculum saved");
}

export async function setCurriculumStatusAction(id: string, status: "ACTIVE" | "RETIRED") {
  return runAction(async () => {
    const ctx = await requireAuth("curriculum.manage");
    await setCurriculumStatus(ctx, id, status);
    revalidatePath("/academics/curricula", "layout");
  }, status === "ACTIVE" ? "Curriculum activated" : "Curriculum retired");
}

export async function newCurriculumVersionAction(id: string) {
  return runAction(async () => {
    const ctx = await requireAuth("curriculum.manage");
    const c = await newCurriculumVersion(ctx, id);
    revalidatePath("/academics/curricula", "layout");
    return { id: c.id };
  }, "New draft version created");
}

export async function setPrerequisitesAction(courseId: string, ids: string[]) {
  return runAction(async () => {
    const ctx = await requireAuth("curriculum.manage");
    await setPrerequisites(ctx, courseId, ids);
    revalidatePath(`/academics/courses/${courseId}`);
  }, "Prerequisites saved");
}

export async function registerBatchAction(offeringId: string, input: unknown) {
  return runAction(async () => {
    const ctx = await requireAuth("enrollment.manage");
    const { registerBatch } = await import("@/server/services/offerings");
    const r = await registerBatch(ctx, offeringId, input);
    revalidatePath(`/academics/offerings/${offeringId}`);
    return r;
  });
}

/** Student lookup for adding individuals to a class (scoped to what the caller may see). */
export async function searchStudentsAction(q: string) {
  return runAction(async () => {
    const ctx = await requireAuth("student.view");
    const { db } = await import("@/server/db");
    const { studentFilterWhere } = await import("@/server/services/students");
    const term = String(q ?? "").trim();
    if (term.length < 2) return [];
    const rows = await db.student.findMany({ where: studentFilterWhere(ctx, { q: term }), take: 8, orderBy: { studentNo: "asc" }, select: { id: true, studentNo: true, firstName: true, lastName: true, batch: { select: { code: true } } } });
    return rows.map((r) => ({ id: r.id, name: `${r.firstName} ${r.lastName}`, subtitle: `${r.studentNo} · ${r.batch.code}` }));
  });
}
