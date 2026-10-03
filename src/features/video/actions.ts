"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { studentWhere } from "@/server/auth/access";
import { can, requireAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { zonedTimeToUtc } from "@/lib/domain/timetable";
import { getInstitution } from "@/server/services/directory";
import { adjustAttendance, applyToClassRegister } from "@/server/services/video/attendance";
import {
  addMeetingNote, addParticipants, cancelMeeting, createGuestInvite, createMeeting, duplicateMeeting, endMeeting, goOnlineForClass, instantMeeting, publishDraft, removeParticipant, respondToInvitation, revokeGuest, startMeeting, updateMeeting,
} from "@/server/services/video/meetings";
import { deleteRecording, playbackUrl, updateRecording } from "@/server/services/video/recordings";
import { saveVideoSettings } from "@/server/services/video/settings";

/** The scheduler sends local "YYYY-MM-DDTHH:MM" times in the institution's time zone. */
async function withTimes(input: unknown) {
  const v = { ...(input as Record<string, unknown>) };
  const { timezone } = await getInstitution();
  for (const [from, to] of [["startLocal", "scheduledStart"], ["endLocal", "scheduledEnd"]] as const) {
    const x = v[from];
    if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(x)) v[to] = zonedTimeToUtc(x.slice(0, 10), x.slice(11, 16), timezone);
    delete v[from];
  }
  return v;
}

const refresh = (publicId?: string) => {
  revalidatePath("/video", "layout");
  if (publicId) revalidatePath(`/video/${publicId}`);
};

export async function scheduleMeetingAction(input: unknown, draft = false) {
  return runAction(async () => { const m = await createMeeting(await requireAuth(), await withTimes(input), { draft }); refresh(); return { publicId: m.publicId }; }, draft ? "Draft saved" : "Meeting scheduled — invitations sent");
}
export async function updateMeetingAction(id: string, input: unknown) {
  return runAction(async () => { await updateMeeting(await requireAuth(), id, await withTimes(input)); refresh(); }, "Meeting updated");
}
export async function instantMeetingAction(input: unknown) {
  return runAction(async () => { const m = await instantMeeting(await requireAuth(), input); return { publicId: m.publicId }; });
}
export async function startMeetingAction(id: string) {
  return runAction(async () => { const m = await startMeeting(await requireAuth(), id); refresh(m.publicId); return { publicId: m.publicId }; }, "Meeting started");
}
export async function endMeetingAction(id: string) {
  return runAction(async () => { await endMeeting(await requireAuth(), id); refresh(); }, "Meeting ended");
}
export async function cancelMeetingAction(id: string, reason: string) {
  return runAction(async () => { await cancelMeeting(await requireAuth(), id, reason); refresh(); }, "Meeting cancelled — participants told");
}
export async function duplicateMeetingAction(id: string) {
  return runAction(async () => { const m = await duplicateMeeting(await requireAuth(), id); refresh(); return { publicId: m.publicId }; }, "Copied as a draft for next week");
}
export async function publishDraftAction(id: string) {
  return runAction(async () => { await publishDraft(await requireAuth(), id); refresh(); }, "Meeting scheduled — invitations sent");
}
export async function respondInvitationAction(id: string, response: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
  return runAction(async () => { await respondToInvitation(await requireAuth(), id, response); refresh(); }, "Response saved");
}
export async function goOnlineAction(classMeetingId: string) {
  return runAction(async () => { const m = await goOnlineForClass(await requireAuth(), classMeetingId); refresh(); return { publicId: m.publicId }; }, "Online class ready");
}
export async function applyToRegisterAction(id: string) {
  return runAction(async () => { const n = await applyToClassRegister(await requireAuth(), id); refresh(); return n; }, "Copied to the class register");
}
export async function addParticipantsAction(id: string, userIds: string[], role = "PARTICIPANT") {
  return runAction(async () => { const n = await addParticipants(await requireAuth(), id, { userIds, role }); refresh(); return n; }, "Invited");
}
export async function removeParticipantAction(id: string, participantId: string) {
  return runAction(async () => { await removeParticipant(await requireAuth(), id, participantId); refresh(); }, "Removed");
}
export async function guestInviteAction(id: string | null, input: unknown) {
  return runAction(async () => { const g = await createGuestInvite(await requireAuth(), id!, input); refresh(); return { url: g.url, expiresAt: g.expiresAt.toISOString() }; }, "Guest invited — copy the link now");
}
export async function revokeGuestAction(id: string, guestId: string) {
  return runAction(async () => { await revokeGuest(await requireAuth(), id, guestId); refresh(); }, "Guest link withdrawn");
}
export async function addNoteAction(id: string | null, input: unknown) {
  return runAction(async () => { await addMeetingNote(await requireAuth(), id!, input); refresh(); }, "Note saved");
}
export async function adjustAttendanceAction(attendanceId: string | null, input: unknown) {
  return runAction(async () => { await adjustAttendance(await requireAuth(), attendanceId!, input); refresh(); }, "Attendance corrected");
}
export async function playbackAction(recordingId: string, download = false) {
  return runAction(async () => playbackUrl(await requireAuth(), recordingId, download ? "attachment" : "inline"));
}
export async function updateRecordingAction(recordingId: string, input: unknown) {
  return runAction(async () => { await updateRecording(await requireAuth(), recordingId, input); refresh(); }, "Recording updated");
}
export async function deleteRecordingAction(recordingId: string, reason: string) {
  return runAction(async () => { await deleteRecording(await requireAuth(), recordingId, reason); refresh(); }, "Recording deleted");
}

/**
 * People the scheduler may invite: active staff, plus students the caller may already see (their own
 * classes and mentees, or their department/institution scope). Name and number only, at most 12.
 */
export async function searchMeetingPeopleAction(q: string) {
  return runAction(async () => {
    const ctx = await requireAuth();
    if (!can(ctx, "video.schedule") && !can(ctx, "video.create")) return [];
    const term = String(q ?? "").trim().slice(0, 60);
    if (term.length < 2) return [];
    const nameMatch = { OR: [{ name: { contains: term, mode: "insensitive" as const } }, { employeeId: { contains: term, mode: "insensitive" as const } }, { email: { contains: term, mode: "insensitive" as const } }] };
    const studentScope = can(ctx, "student.view")
      ? studentWhere(ctx)
      : { OR: [{ registrations: { some: { offering: { instructors: { some: { userId: ctx.user.id } } } } } }, { mentorAssignments: { some: { mentorId: ctx.user.id, endsOn: null } } }] };
    const [staff, students] = await Promise.all([
      db.user.findMany({ where: { ...nameMatch, status: "ACTIVE", deletedAt: null, userType: "STAFF", id: { not: ctx.user.id } }, take: 8, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true, department: { select: { code: true } } } }),
      db.student.findMany({ where: { AND: [studentScope, { userId: { not: null } }, { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }, { studentNo: { contains: term, mode: "insensitive" } }] }] }, take: 6, orderBy: { studentNo: "asc" }, select: { userId: true, firstName: true, lastName: true, studentNo: true } }),
    ]);
    return [
      ...staff.map((r) => ({ id: r.id, name: r.name, subtitle: [r.designation, r.department?.code].filter(Boolean).join(" · ") })),
      ...students.map((s) => ({ id: s.userId!, name: `${s.firstName} ${s.lastName}`, subtitle: `Student · ${s.studentNo}` })),
    ];
  });
}

export async function saveVideoSettingsAction(values: Record<string, unknown>) {
  return runAction(async () => { await saveVideoSettings(await requireAuth(), values); revalidatePath("/admin/video"); }, "Video settings saved");
}
