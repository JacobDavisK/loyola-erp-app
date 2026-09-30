"use server";

import { revalidatePath } from "next/cache";
import { runAction } from "@/server/action";
import { requireAuth } from "@/server/auth/current";
import { requestMeta } from "@/server/request-context";
import { enrolApplicant, makeOffers, respondToOffer, saveCycle, setSeats, submitApplication, verifyApplication } from "@/server/services/admissions";
import { publishAnnouncement, withdrawAnnouncement } from "@/server/services/announcements";
import { assignTicket, raiseTicket, rateTicket, replyTicket, setPriority, setTicketStatus } from "@/server/services/helpdesk";
import { addCopies, cancelHold, issueCopy, placeHold, renewLoan, returnCopy, saveItem, setCopyStatus } from "@/server/services/library";
import { applyToDrive, saveCompany, saveDrive, saveMyAlumniProfile, updateApplication, withdrawApplication } from "@/server/services/placements";
import { addRooms, allocateBed, cancelPass, issuePass, saveHostel, saveRoute, vacateBed } from "@/server/services/residence";
import { uploadDocument, verifyDocument } from "@/server/services/student-documents";
import { getInstitution } from "@/server/services/directory";
import { zonedTimeToUtc } from "@/lib/domain/timetable";

const refresh = (...paths: string[]) => {
  for (const p of paths) revalidatePath(p, "layout");
};

async function zoned(input: Record<string, unknown>, keys: string[]) {
  const { timezone } = await getInstitution();
  const out = { ...input };
  for (const k of keys) {
    const v = out[k];
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) out[k] = zonedTimeToUtc(v.slice(0, 10), v.slice(11, 16), timezone);
    else if (v === "" || v === null) out[k] = null;
  }
  return out;
}

// Library
export async function saveLibraryItemAction(id: string | null, input: unknown) {
  return runAction(async () => { const it = await saveItem(await requireAuth("library.manage"), id, input); refresh("/library"); return { id: it.id }; }, "Saved");
}
export async function addCopiesAction(itemId: string | null, input: unknown) {
  return runAction(async () => { const n = await addCopies(await requireAuth("library.manage"), itemId!, input); refresh("/library"); return n; }, "Copies added");
}
export async function setCopyStatusAction(copyId: string, status: "LOST" | "WITHDRAWN" | "AVAILABLE") {
  return runAction(async () => { await setCopyStatus(await requireAuth("library.manage"), copyId, status); refresh("/library"); }, "Updated");
}
export async function issueCopyAction(input: unknown) {
  return runAction(async () => { const l = await issueCopy(await requireAuth("library.circulate"), input); refresh("/library"); return { dueAt: l.dueAt.toISOString() }; }, "Issued");
}
export async function returnCopyAction(input: unknown) {
  return runAction(async () => { const r = await returnCopy(await requireAuth("library.circulate"), input); refresh("/library"); return r; });
}
export async function renewLoanAction(id: string) {
  return runAction(async () => { const d = await renewLoan(await requireAuth(), id); refresh("/library"); return { dueAt: d.toISOString() }; }, "Renewed");
}
export async function placeHoldAction(itemId: string) {
  return runAction(async () => { await placeHold(await requireAuth(), itemId); refresh("/library"); }, "You are in the queue; we will tell you when a copy is ready.");
}
export async function cancelHoldAction(id: string) {
  return runAction(async () => { await cancelHold(await requireAuth(), id); refresh("/library"); }, "Hold cancelled");
}

// Hostel & transport
export async function saveHostelAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveHostel(await requireAuth("hostel.manage"), id, input); refresh("/hostels"); }, "Hostel saved");
}
export async function addRoomsAction(hostelId: string | null, input: unknown) {
  return runAction(async () => { const r = await addRooms(await requireAuth("hostel.manage"), hostelId!, input); refresh("/hostels"); return r; }, "Rooms added");
}
export async function allocateBedAction(_id: string | null, input: unknown) {
  return runAction(async () => { await allocateBed(await requireAuth("hostel.manage"), input); refresh("/hostels", "/portal"); }, "Bed allotted");
}
export async function vacateBedAction(id: string | null, input: unknown) {
  return runAction(async () => { await vacateBed(await requireAuth("hostel.manage"), id!, input); refresh("/hostels", "/portal"); }, "Bed vacated");
}
export async function saveRouteAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveRoute(await requireAuth("transport.manage"), id, input); refresh("/transport"); }, "Route saved");
}
export async function issuePassAction(_id: string | null, input: unknown) {
  return runAction(async () => { await issuePass(await requireAuth("transport.manage"), input); refresh("/transport", "/portal"); }, "Pass issued");
}
export async function cancelPassAction(id: string, reason: string) {
  return runAction(async () => { await cancelPass(await requireAuth("transport.manage"), id, reason); refresh("/transport", "/portal"); }, "Pass cancelled");
}

// Helpdesk
export async function raiseTicketAction(_id: string | null, input: unknown) {
  return runAction(async () => { const t = await raiseTicket(await requireAuth(), input); refresh("/helpdesk"); return { id: t.id, number: t.number }; }, "Ticket raised");
}
export async function replyTicketAction(id: string, input: unknown) {
  return runAction(async () => { await replyTicket(await requireAuth(), id, input); refresh("/helpdesk"); }, "Sent");
}
export async function setTicketStatusAction(id: string, status: "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED") {
  return runAction(async () => { await setTicketStatus(await requireAuth(), id, status); refresh("/helpdesk"); }, "Status updated");
}
export async function assignTicketAction(id: string, userId: string | null) {
  return runAction(async () => { await assignTicket(await requireAuth(), id, userId); refresh("/helpdesk"); }, "Assigned");
}
export async function setPriorityAction(id: string, p: "LOW" | "NORMAL" | "HIGH" | "URGENT") {
  return runAction(async () => { await setPriority(await requireAuth(), id, p); refresh("/helpdesk"); }, "Priority updated");
}
export async function rateTicketAction(id: string, rating: number) {
  return runAction(async () => { await rateTicket(await requireAuth(), id, rating); refresh("/helpdesk"); }, "Thank you for the feedback");
}

// Announcements
export async function publishAnnouncementAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await publishAnnouncement(await requireAuth("announcement.publish"), id, await zoned(input, ["publishAt", "expiresAt"])); refresh("/announcements", "/dashboard", "/portal"); }, "Announcement saved");
}
export async function withdrawAnnouncementAction(id: string) {
  return runAction(async () => { await withdrawAnnouncement(await requireAuth("announcement.publish"), id); refresh("/announcements"); }, "Withdrawn");
}

// Student documents
export async function uploadDocumentAction(studentId: string, form: FormData) {
  return runAction(async () => { await uploadDocument(await requireAuth(), studentId, form); refresh("/portal", "/students"); }, "Document uploaded");
}
export async function verifyDocumentAction(id: string, input: unknown) {
  return runAction(async () => { await verifyDocument(await requireAuth(), id, input); refresh("/portal", "/students"); }, "Recorded");
}

// Admissions
export async function saveAdmissionCycleAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => { await saveCycle(await requireAuth("admission.manage"), id, await zoned(input, ["opensAt", "closesAt"])); refresh("/admissions"); }, "Cycle saved");
}
export async function setSeatsAction(cycleId: string | null, input: unknown) {
  return runAction(async () => { await setSeats(await requireAuth("admission.manage"), cycleId!, input); refresh("/admissions"); }, "Seats saved");
}
export async function verifyApplicationAction(id: string | null, input: unknown) {
  return runAction(async () => { await verifyApplication(await requireAuth("admission.manage"), id!, input); refresh("/admissions"); }, "Recorded");
}
export async function makeOffersAction(cycleId: string, programId: string) {
  return runAction(async () => { const r = await makeOffers(await requireAuth("admission.manage"), cycleId, programId); refresh("/admissions"); return r; });
}
export async function enrolApplicantAction(id: string) {
  return runAction(async () => { const s = await enrolApplicant(await requireAuth("admission.manage"), id); refresh("/admissions", "/students"); return { studentId: s.id, studentNo: s.studentNo }; }, "Enrolled");
}
/** Public (no sign-in): the online application. */
export async function submitApplicationAction(input: unknown) {
  return runAction(async () => { const { ip } = await requestMeta(); const r = await submitApplication(input, ip ?? "unknown"); return { number: r.number, token: r.token }; });
}
/** Public: accept or decline an offer with the applicant's private token. */
export async function respondToOfferAction(number: string, token: string, accept: boolean) {
  return runAction(async () => { await respondToOffer(number, token, accept); revalidatePath("/apply/status"); }, accept ? "Offer accepted" : "Offer declined");
}

// Placements & alumni
export async function saveCompanyAction(id: string | null, input: unknown) {
  return runAction(async () => { await saveCompany(await requireAuth("placement.manage"), id, input); refresh("/placements"); }, "Company saved");
}
export async function saveDriveAction(id: string | null, input: Record<string, unknown>) {
  return runAction(async () => {
    const e: Record<string, unknown> = {};
    if (input.minCgpa !== null && input.minCgpa !== undefined && input.minCgpa !== "") e.minCgpa = Number(input.minCgpa);
    if (input.maxActiveBacklogs !== null && input.maxActiveBacklogs !== undefined && input.maxActiveBacklogs !== "") e.maxActiveBacklogs = Number(input.maxActiveBacklogs);
    const codes = String(input.programCodes ?? "").split(/[\s,]+/).filter(Boolean).map((c) => c.toUpperCase());
    if (codes.length) e.programCodes = codes;
    const years = String(input.batchYears ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter(Number.isFinite);
    if (years.length) e.batchYears = years;
    const z = await zoned(input, ["applyBy", "driveDate"]);
    const d = await saveDrive(await requireAuth("placement.manage"), id, { ...z, eligibility: e });
    refresh("/placements", "/portal");
    return { id: d.id };
  }, "Drive saved");
}
export async function updatePlacementAction(id: string, input: unknown) {
  return runAction(async () => { await updateApplication(await requireAuth("placement.manage"), id, input); refresh("/placements"); }, "Updated");
}
export async function applyToDriveAction(driveId: string) {
  return runAction(async () => { await applyToDrive(await requireAuth(), driveId); refresh("/portal"); }, "Applied");
}
export async function withdrawPlacementAction(id: string) {
  return runAction(async () => { await withdrawApplication(await requireAuth(), id); refresh("/portal"); }, "Withdrawn");
}
export async function saveAlumniProfileAction(_id: string | null, input: unknown) {
  return runAction(async () => { await saveMyAlumniProfile(await requireAuth(), input); refresh("/portal", "/alumni"); }, "Profile saved");
}
