"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { zonedTimeToUtc } from "@/lib/domain/timetable";
import { requestMeta } from "@/server/request-context";
import { addMembers, cancelEvent, cancelRegistration, completeEvent, joinClub, leaveClub, markAttendance, registerForEvent, saveClub, saveEvent, selfCheckIn } from "@/server/services/campus-events";
import { addEligibleGraduates, markHandover, registerForConvocation, saveConvocation, setConvocationStatus } from "@/server/services/convocation";
import { addSlots, bookSlot, cancelBooking, cancelSlot, recordSession } from "@/server/services/counselling";
import { getInstitution } from "@/server/services/directory";
import { appealGrievance, closeGrievance, grievanceNote, raiseGrievance, resolveGrievance, submitUndertaking } from "@/server/services/grievances";
import { savePreferences, subscribePush, unsubscribePush } from "@/server/services/messaging";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

/** datetime-local fields are in the institution's time zone. */
async function zoned(input: unknown, keys: string[]) {
  const { timezone } = await getInstitution();
  const out = { ...(input as Record<string, unknown>) };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string" && v.length >= 16 && v[10] === "T") out[k] = zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), timezone);
    else if (v === "") out[k] = null;
  }
  return out;
}

// Messaging and the app
export async function subscribePushAction(subscription: unknown) {
  return runAction(async () => { await subscribePush(await requireAuth(), subscription, (await requestMeta()).userAgent); }, "Notifications are on for this device");
}
export async function unsubscribePushAction(endpoint: string) {
  return runAction(async () => { await unsubscribePush(await requireAuth(), endpoint); }, "Notifications are off for this device");
}
export async function savePreferencesAction(_id: string | null, input: unknown) {
  return runAction(async () => { await savePreferences(await requireAuth(), input); refresh("/me/messages"); }, "Preferences saved");
}

// Counselling
export async function addSlotsAction(_id: string | null, input: unknown) {
  return runAction(async () => { const n = await addSlots(await requireAuth("counselling.provide"), input); refresh("/counselling"); return n; }, "Slots published");
}
export async function cancelSlotAction(id: string) {
  return runAction(async () => { await cancelSlot(await requireAuth(), id); refresh("/counselling", "/portal/counselling"); }, "Slot cancelled");
}
export async function bookSlotAction(id: string, input: unknown) {
  return runAction(async () => { await bookSlot(await requireAuth(), id, input); refresh("/portal/counselling", "/counselling"); }, "Session booked");
}
export async function cancelBookingAction(id: string) {
  return runAction(async () => { await cancelBooking(await requireAuth(), id); refresh("/portal/counselling", "/counselling"); }, "Session cancelled");
}
export async function recordSessionAction(id: string, _id: string | null, input: unknown) {
  return runAction(async () => { await recordSession(await requireAuth(), id, input); refresh("/counselling"); }, "Session recorded");
}

// Grievances
export async function raiseGrievanceAction(_id: string | null, input: unknown) {
  return runAction(async () => { const g = await raiseGrievance(await requireAuth(), input); refresh("/grievances"); return { id: g.id }; }, "Grievance submitted");
}
export async function grievanceNoteAction(id: string, note: string) {
  return runAction(async () => { await grievanceNote(await requireAuth(), id, note); refresh("/grievances"); }, "Added");
}
export async function resolveGrievanceAction(id: string, resolution: string) {
  return runAction(async () => { await resolveGrievance(await requireAuth(), id, resolution); refresh("/grievances"); }, "Decision recorded");
}
export async function appealGrievanceAction(id: string, reason: string) {
  return runAction(async () => { await appealGrievance(await requireAuth(), id, reason); refresh("/grievances"); }, "Appeal submitted");
}
export async function closeGrievanceAction(id: string) {
  return runAction(async () => { await closeGrievance(await requireAuth(), id); refresh("/grievances"); }, "Closed");
}
export async function submitUndertakingAction(referenceNo: string) {
  return runAction(async () => { await submitUndertaking(await requireAuth(), referenceNo); refresh("/grievances"); }, "Undertaking recorded");
}

// Clubs and events
export async function saveClubAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveClub(await requireAuth("events.manage"), id, input); refresh("/events"); }, "Club saved");
}
export async function joinClubAction(id: string) {
  return runAction(async () => { await joinClub(await requireAuth(), id); refresh("/events"); }, "Joined");
}
export async function leaveClubAction(id: string) {
  return runAction(async () => { await leaveClub(await requireAuth(), id); refresh("/events"); }, "Left the club");
}
export async function addMembersAction(clubId: string, _id: string | null, input: unknown) {
  return runAction(async () => { const n = await addMembers(await requireAuth(), clubId, input); refresh("/events"); return n; }, "Members added");
}
export async function saveEventAction(id: string | null, input: unknown) {
  return runAction(async () => { const e = await saveEvent(await requireAuth(), id, await zoned(input, ["startsAt", "endsAt", "registrationCloses"])); refresh("/events"); return { id: e.id }; }, "Event saved");
}
export async function registerEventAction(id: string) {
  return runAction(async () => { await registerForEvent(await requireAuth(), id); refresh("/events"); }, "You are registered");
}
export async function cancelEventRegistrationAction(id: string) {
  return runAction(async () => { await cancelRegistration(await requireAuth(), id); refresh("/events"); }, "Registration cancelled");
}
export async function selfCheckInAction(id: string, key: string) {
  return runAction(async () => { const t = await selfCheckIn(await requireAuth(), id, key); refresh("/events"); return t; });
}
export async function markEventAttendanceAction(id: string, input: unknown) {
  return runAction(async () => { await markAttendance(await requireAuth(), id, input); refresh("/events"); }, "Attendance saved");
}
export async function completeEventAction(id: string) {
  return runAction(async () => { const r = await completeEvent(await requireAuth(), id); refresh("/events"); return r; }, "Event completed");
}
export async function cancelEventAction(id: string, reason: string) {
  return runAction(async () => { await cancelEvent(await requireAuth(), id, reason); refresh("/events"); }, "Event cancelled");
}

// Convocation
export async function saveConvocationAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveConvocation(await requireAuth("convocation.manage"), id, await zoned(input, ["heldOn", "registrationCloses"])); refresh("/convocation"); }, "Convocation saved");
}
export async function addGraduatesAction(id: string) {
  return runAction(async () => { const r = await addEligibleGraduates(await requireAuth("convocation.manage"), id); refresh("/convocation"); return r; });
}
export async function setConvocationStatusAction(id: string, status: "REGISTRATION_OPEN" | "REGISTRATION_CLOSED" | "HELD") {
  return runAction(async () => { await setConvocationStatus(await requireAuth("convocation.manage"), id, status); refresh("/convocation"); }, "Updated");
}
export async function registerConvocationAction(id: string, _id: string | null, input: unknown) {
  return runAction(async () => { await registerForConvocation(await requireAuth(), id, input); refresh("/portal/convocation"); }, "Registration saved");
}
export async function markHandoverAction(id: string, what: "gown" | "degree") {
  return runAction(async () => { await markHandover(await requireAuth("convocation.manage"), id, what); refresh("/convocation"); });
}
