import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma, VideoMeetingParticipant, VideoParticipantRole } from "@/generated/prisma/client";
import { canTransition, identityForGuest, identityForUser, isMeetingType, joinWindowOpen, MEETING_TYPES, NOTE_KINDS, PANEL_ROLES, type MeetingStatus, type MeetingType } from "@/lib/domain/video";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { randomToken, sha256 } from "@/server/security/crypto";
import { hit } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { getInstitution } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";
import { log } from "@/server/video/log";
import { type JoinGrant, videoProvider, VideoProviderError } from "@/server/video/provider";
import { assertHost, assertSee, canJoin, isHostLike, isModerator, isRestricted, loadMeeting, type MeetingWithParticipants, myParticipant, NO_ACCESS } from "./access";
import { computeAttendance } from "./attendance";

/**
 * Meetings: scheduling, instant meetings, the lifecycle (DRAFT → SCHEDULED → STARTING → LIVE → ENDED, with
 * FAILED and CANCELLED), joining (with lobby), participant management, guests and panel notes.
 * The provider is only reached through the VideoConferenceProvider interface.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const link = (publicId: string) => `/video/${publicId}`;
const PUBLISHERS: VideoParticipantRole[] = ["HOST", "CO_HOST", "PRESENTER", "MODERATOR"];

// ───────────────────────── Scheduling ─────────────────────────

const roleList = z.array(z.string().min(5).max(40)).max(1000).default([]);
const meetingSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  meetingType: z.string().refine(isMeetingType, "Choose a meeting type"),
  departmentId: z.string().nullable().optional(),
  offeringId: z.string().nullable().optional(),
  batchId: z.string().nullable().optional(),
  programId: z.string().nullable().optional(),
  academicYearId: z.string().nullable().optional(),
  mentoringStudentId: z.string().nullable().optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date(),
  timezone: z.string().max(60).nullable().optional(),
  visibility: z.enum(["INVITED", "COURSE", "DEPARTMENT", "INSTITUTION"]).nullable().optional(),
  participantIds: roleList,
  coHostIds: roleList,
  presenterIds: roleList,
  /** userId → panel designation, for viva voce and PhD reviews */
  panelRoles: z.record(z.string(), z.string().max(40)).default({}),
  lobbyEnabled: z.boolean().nullable().optional(),
  recordingEnabled: z.boolean().nullable().optional(),
  autoRecord: z.boolean().default(false),
  chatEnabled: z.boolean().nullable().optional(),
  screenShareEnabled: z.boolean().nullable().optional(),
  participantsCanPublish: z.boolean().nullable().optional(),
  participantLimit: z.number().int().min(2).max(1000).nullable().optional(),
  recordingAccess: z.enum(["HOST_ONLY", "PARTICIPANTS", "COURSE", "DEPARTMENT", "ADMINS"]).nullable().optional(),
});

async function newPublicId(tx: Prisma.TransactionClient, type: MeetingType, at: Date) {
  return nextNumber(tx, `video.${MEETING_TYPES[type].code}`, { prefix: `ERP-${MEETING_TYPES[type].code}-{YYYY}-`, padding: 6 }, at);
}
const newRoomName = () => `erp_${randomBytes(12).toString("hex")}`;

async function validateMeeting(ctx: AuthContext, v: z.infer<typeof meetingSchema>) {
  const s = await getSetting("video");
  const type = v.meetingType as MeetingType;
  if (!s.enabledTypes.includes(type)) throw invalid(`${MEETING_TYPES[type].label} meetings are switched off by the administrator.`);
  const minutes = (v.scheduledEnd.getTime() - v.scheduledStart.getTime()) / 60_000;
  if (minutes < 5) throw invalid("The meeting must last at least 5 minutes.");
  if (minutes > s.maxDurationMinutes) throw invalid(`Meetings can last at most ${s.maxDurationMinutes} minutes.`);
  if ((v.participantLimit ?? 0) > s.maxParticipants) throw invalid(`At most ${s.maxParticipants} participants.`);
  if (type === "ONLINE_CLASS") {
    if (!v.offeringId) throw invalid("Choose the class for this online class.");
    const o = await db.courseOffering.findUnique({ where: { id: v.offeringId }, include: { instructors: true, course: true } });
    if (!o) throw notFound("Class");
    if (!o.instructors.some((i) => i.userId === ctx.user.id) && !can(ctx, "academic.manage", o.course.departmentId) && !isSuperAdmin(ctx)) throw forbidden("Only the class's teachers can schedule its online classes.");
    return { s, offering: o };
  }
  if (type === "STUDENT_MENTORING") {
    if (!v.mentoringStudentId) throw invalid("Choose the mentee.");
    const mentor = await db.mentorAssignment.count({ where: { studentId: v.mentoringStudentId, mentorId: ctx.user.id, endsOn: null } });
    if (!mentor && !isSuperAdmin(ctx)) throw forbidden("Only the student's mentor can schedule mentoring sessions.");
  }
  if (type === "DEPARTMENT_MEETING" && !v.departmentId) throw invalid("Choose the department.");
  if ((type === "VIVA_VOCE" || type === "PHD_REVIEW") && !Object.values(v.panelRoles).includes("CANDIDATE")) throw invalid("Mark who the candidate is.");
  return { s, offering: null };
}

/** The participant rows a meeting should have from the form (plus the class roll for online classes). */
async function participantRows(v: z.infer<typeof meetingSchema>, hostUserId: string, offering: { id: string } | null) {
  const type = v.meetingType as MeetingType;
  const ids = new Set([...v.participantIds, ...v.coHostIds, ...v.presenterIds]);
  if (offering) {
    const roll = await db.courseRegistration.findMany({ where: { offeringId: offering.id, status: "REGISTERED", student: { userId: { not: null } } }, select: { student: { select: { userId: true } } } });
    for (const r of roll) ids.add(r.student.userId!);
    for (const i of await db.offeringInstructor.findMany({ where: { offeringId: offering.id }, select: { userId: true } })) {
      if (i.userId === hostUserId) continue;
      v.coHostIds.push(i.userId);
      ids.add(i.userId);
    }
  }
  if (v.mentoringStudentId) {
    const st = await db.student.findUnique({ where: { id: v.mentoringStudentId }, select: { userId: true } });
    if (st?.userId) ids.add(st.userId);
  }
  ids.delete(hostUserId);
  const users = await db.user.findMany({ where: { id: { in: [...ids, hostUserId] }, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true } });
  const allowedPanel: readonly string[] = type === "VIVA_VOCE" ? PANEL_ROLES.VIVA_VOCE : type === "PHD_REVIEW" ? PANEL_ROLES.PHD_REVIEW : [];
  return users.map((u) => {
    const role: VideoParticipantRole = u.id === hostUserId ? "HOST" : v.coHostIds.includes(u.id) ? "CO_HOST" : v.presenterIds.includes(u.id) ? "PRESENTER" : "PARTICIPANT";
    const panel = v.panelRoles[u.id];
    return { userId: u.id, displayName: u.name, role, panelRole: panel && allowedPanel.includes(panel) ? panel : null, invitationStatus: u.id === hostUserId ? ("ACCEPTED" as const) : ("PENDING" as const) };
  });
}

export async function createMeeting(ctx: AuthContext, raw: unknown, opts: { draft?: boolean } = {}) {
  if (!can(ctx, "video.schedule") && !can(ctx, "video.create")) throw forbidden("You cannot schedule meetings.");
  const v = meetingSchema.parse(raw);
  const { s, offering } = await validateMeeting(ctx, v);
  const type = v.meetingType as MeetingType;
  const meta = MEETING_TYPES[type];
  const inst = await getInstitution();
  const webinarLike = type === "WEBINAR" || type === "GUEST_LECTURE";
  const rows = await participantRows(v, ctx.user.id, offering);
  const recordingAllowed = s.recordingEnabled && env.OPENVIDU_RECORDING_ENABLED === "true";
  const m = await db.$transaction(async (tx) => {
    const created = await tx.videoMeeting.create({
      data: {
        publicId: await newPublicId(tx, type, v.scheduledStart),
        title: v.title, description: v.description ?? null, meetingType: type, hostUserId: ctx.user.id,
        departmentId: v.departmentId ?? offering?.course.departmentId ?? ctx.user.departmentId ?? null,
        offeringId: offering?.id ?? null, courseId: offering?.courseId ?? null, batchId: v.batchId ?? offering?.batchId ?? null, programId: v.programId ?? offering?.course.programId ?? null, academicYearId: v.academicYearId ?? null,
        mentoringStudentId: v.mentoringStudentId ?? null,
        scheduledStart: v.scheduledStart, scheduledEnd: v.scheduledEnd, timezone: v.timezone || inst.timezone,
        status: opts.draft ? "DRAFT" : "SCHEDULED",
        visibility: isRestricted(type) ? "INVITED" : (v.visibility ?? meta.defaultVisibility),
        lobbyEnabled: v.lobbyEnabled ?? (meta.lobby || s.lobbyDefault),
        recordingEnabled: recordingAllowed && (v.recordingEnabled ?? false),
        autoRecord: recordingAllowed && !!v.recordingEnabled && v.autoRecord,
        chatEnabled: v.chatEnabled ?? s.chatDefault,
        screenShareEnabled: v.screenShareEnabled ?? s.screenShareDefault,
        participantsCanPublish: v.participantsCanPublish ?? !webinarLike,
        participantLimit: Math.min(v.participantLimit ?? s.maxParticipants, s.maxParticipants),
        recordingAccess: v.recordingAccess ?? (type === "ONLINE_CLASS" ? "COURSE" : isRestricted(type) ? "HOST_ONLY" : s.recordingAccessDefault),
        roomName: newRoomName(),
        createdById: ctx.user.id,
        participants: { create: rows },
      },
    });
    await audit({ ...actor(ctx), action: "video.meeting.create", resourceType: "videoMeeting", resourceId: created.id, summary: `${created.publicId} ${meta.label}: ${v.title} (${rows.length} participant(s))${opts.draft ? " — draft" : ""}` }, tx);
    return created;
  });
  log("info", "video.meeting_created", { meeting: m.publicId, type, participants: rows.length, draft: !!opts.draft });
  if (!opts.draft) await invite(m.id, rows.filter((r) => r.userId !== ctx.user.id).map((r) => r.userId), "invited");
  return m;
}

async function invite(meetingId: string, userIds: string[], kind: "invited" | "rescheduled" | "cancelled" | "started" | "starting") {
  if (!userIds.length) return;
  const m = await db.videoMeeting.findUniqueOrThrow({ where: { id: meetingId }, include: { host: { select: { name: true } } } });
  const when = m.scheduledStart.toLocaleString("en-IN", { timeZone: m.timezone, dateStyle: "medium", timeStyle: "short" });
  const title = { invited: `Invitation: ${m.title}`, rescheduled: `Rescheduled: ${m.title}`, cancelled: `Cancelled: ${m.title}`, started: `${m.title} has started`, starting: `${m.title} starts soon` }[kind];
  const body = kind === "cancelled" ? `${when}${m.cancelReason ? ` — ${m.cancelReason}` : ""}` : kind === "started" ? `Hosted by ${m.host.name}. Join now.` : `${when} · ${MEETING_TYPES[m.meetingType as MeetingType].label} · ${m.host.name}`;
  await notify({ userIds, type: `video.${kind}`, title, body, link: link(m.publicId), email: kind === "invited" || kind === "cancelled" || kind === "rescheduled" });
}

const isEditable = (status: string) => status === "DRAFT" || status === "SCHEDULED" || status === "FAILED";

export async function updateMeeting(ctx: AuthContext, idOrPublicId: string, raw: unknown) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  if (!isEditable(m.status)) throw workflowError("Only meetings that have not started can be changed.");
  const v = meetingSchema.parse({ ...raw as object, meetingType: m.meetingType, offeringId: m.offeringId, mentoringStudentId: m.mentoringStudentId });
  await validateMeeting(ctx, v);
  const moved = v.scheduledStart.getTime() !== m.scheduledStart.getTime() || v.scheduledEnd.getTime() !== m.scheduledEnd.getTime();
  const wanted = await participantRows(v, m.hostUserId, m.offeringId ? { id: m.offeringId } : null);
  const existing = new Map(m.participants.filter((p) => p.userId).map((p) => [p.userId!, p]));
  const added = wanted.filter((w) => !existing.has(w.userId));
  const kept = new Set(wanted.map((w) => w.userId));
  const dropped = m.participants.filter((p) => p.userId && !kept.has(p.userId) && p.role !== "HOST");
  await db.$transaction(async (tx) => {
    await tx.videoMeeting.update({
      where: { id: m.id },
      data: {
        title: v.title, description: v.description ?? null, scheduledStart: v.scheduledStart, scheduledEnd: v.scheduledEnd, timezone: v.timezone || m.timezone,
        visibility: isRestricted(m.meetingType) ? "INVITED" : (v.visibility ?? m.visibility), lobbyEnabled: v.lobbyEnabled ?? m.lobbyEnabled,
        recordingEnabled: v.recordingEnabled ?? m.recordingEnabled, autoRecord: v.autoRecord, chatEnabled: v.chatEnabled ?? m.chatEnabled, screenShareEnabled: v.screenShareEnabled ?? m.screenShareEnabled,
        participantsCanPublish: v.participantsCanPublish ?? m.participantsCanPublish, participantLimit: v.participantLimit ?? m.participantLimit, recordingAccess: v.recordingAccess ?? m.recordingAccess,
        reminderSentAt: moved ? null : undefined,
      },
    });
    if (added.length) await tx.videoMeetingParticipant.createMany({ data: added.map((a) => ({ ...a, meetingId: m.id })) });
    for (const w of wanted) {
      const e = existing.get(w.userId);
      if (e && (e.role !== w.role || e.panelRole !== w.panelRole) && e.role !== "HOST") await tx.videoMeetingParticipant.update({ where: { id: e.id }, data: { role: w.role, panelRole: w.panelRole } });
    }
    if (dropped.length) await tx.videoMeetingParticipant.deleteMany({ where: { id: { in: dropped.map((d) => d.id) } } });
    await audit({ ...actor(ctx), action: "video.meeting.update", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}${moved ? " rescheduled" : " updated"}; +${added.length} −${dropped.length} participant(s)` }, tx);
  });
  if (m.status !== "DRAFT") {
    await invite(m.id, added.map((a) => a.userId), "invited");
    if (moved) await invite(m.id, wanted.filter((w) => existing.has(w.userId) && w.userId !== m.hostUserId).map((w) => w.userId), "rescheduled");
    if (dropped.length) await notify({ userIds: dropped.map((d) => d.userId), type: "video.removed", title: `You were removed from ${m.title}`, body: m.publicId });
  }
}

async function setStatus(meetingId: string, from: MeetingStatus[], to: MeetingStatus, data: Prisma.VideoMeetingUpdateInput = {}) {
  const ok = from.filter((f) => canTransition(f, to));
  const r = await db.videoMeeting.updateMany({ where: { id: meetingId, status: { in: ok } }, data: { ...(data as Prisma.VideoMeetingUpdateManyMutationInput), status: to } });
  return r.count === 1;
}

export async function publishDraft(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  if (m.status !== "DRAFT") throw workflowError("Only drafts can be scheduled.");
  if (m.scheduledEnd < new Date()) throw invalid("Choose a time in the future first.");
  await setStatus(m.id, ["DRAFT"], "SCHEDULED");
  await audit({ ...actor(ctx), action: "video.meeting.schedule", resourceType: "videoMeeting", resourceId: m.id, summary: m.publicId });
  await invite(m.id, m.participants.filter((p) => p.userId && p.userId !== m.hostUserId).map((p) => p.userId!), "invited");
}

export async function cancelMeeting(ctx: AuthContext, idOrPublicId: string, reason: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  if (!["DRAFT", "SCHEDULED", "FAILED"].includes(m.status)) throw workflowError(m.status === "LIVE" ? "End the meeting instead." : "This meeting can no longer be cancelled.");
  const r = String(reason ?? "").trim().slice(0, 300);
  if (r.length < 3) throw invalid("Give a reason for cancelling.");
  if (!(await setStatus(m.id, ["DRAFT", "SCHEDULED", "FAILED"], "CANCELLED", { cancelledAt: new Date(), cancelReason: r }))) throw conflict("The meeting changed; refresh and try again.");
  await audit({ ...actor(ctx), action: "video.meeting.cancel", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${r}` });
  if (m.status !== "DRAFT") await invite(m.id, m.participants.filter((p) => p.userId && p.userId !== m.hostUserId).map((p) => p.userId!), "cancelled");
}

/** A copy as a draft, one week later, with the same participants and settings. */
export async function duplicateMeeting(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  const week = 7 * 86_400_000;
  let start = m.scheduledStart.getTime() + week;
  while (start < Date.now()) start += week;
  const panelRoles = Object.fromEntries(m.participants.filter((p) => p.userId && p.panelRole).map((p) => [p.userId!, p.panelRole!]));
  return createMeeting(ctx, {
    title: m.title, description: m.description, meetingType: m.meetingType, departmentId: m.departmentId, offeringId: m.offeringId, batchId: m.batchId, programId: m.programId, academicYearId: m.academicYearId, mentoringStudentId: m.mentoringStudentId,
    scheduledStart: new Date(start), scheduledEnd: new Date(start + (m.scheduledEnd.getTime() - m.scheduledStart.getTime())), timezone: m.timezone, visibility: m.visibility,
    participantIds: m.participants.filter((p) => p.userId && p.role === "PARTICIPANT").map((p) => p.userId!),
    coHostIds: m.participants.filter((p) => p.userId && p.role === "CO_HOST").map((p) => p.userId!),
    presenterIds: m.participants.filter((p) => p.userId && p.role === "PRESENTER").map((p) => p.userId!),
    panelRoles, lobbyEnabled: m.lobbyEnabled, recordingEnabled: m.recordingEnabled, autoRecord: m.autoRecord, chatEnabled: m.chatEnabled, screenShareEnabled: m.screenShareEnabled, participantsCanPublish: m.participantsCanPublish, participantLimit: m.participantLimit,
    recordingAccess: m.recordingAccess === "SPECIFIC" ? "HOST_ONLY" : m.recordingAccess,
  }, { draft: true });
}

export async function respondToInvitation(ctx: AuthContext, idOrPublicId: string, response: "ACCEPTED" | "DECLINED" | "TENTATIVE") {
  const m = await loadMeeting(idOrPublicId);
  const p = myParticipant(ctx, m);
  if (!p || p.role === "HOST") throw notFound("Invitation");
  if (!["ACCEPTED", "DECLINED", "TENTATIVE"].includes(response)) throw invalid("Unknown response.");
  await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { invitationStatus: response, respondedAt: new Date() } });
}

/** Start now: an instant meeting the caller hosts, then straight into the room. */
export async function instantMeeting(ctx: AuthContext, raw: unknown) {
  if (!can(ctx, "video.create")) throw forbidden("You cannot start meetings.");
  const v = z.object({ title: z.string().trim().max(200).nullable().optional(), meetingType: z.string().refine(isMeetingType).default("GENERAL_MEETING"), participantIds: roleList }).parse(raw ?? {});
  const s = await getSetting("video");
  const now = new Date();
  const type = v.meetingType as MeetingType;
  const m = await createMeeting(ctx, {
    title: v.title || `${ctx.user.name}'s meeting`, meetingType: isRestricted(type) || type === "ONLINE_CLASS" ? "GENERAL_MEETING" : type,
    scheduledStart: now, scheduledEnd: new Date(now.getTime() + s.defaultDurationMinutes * 60_000), participantIds: v.participantIds, visibility: "INVITED", lobbyEnabled: false,
  });
  await startMeeting(ctx, m.id);
  return m;
}

/** Online class for a timetable session: one meeting per class session, never a duplicate timetable entry. */
export async function goOnlineForClass(ctx: AuthContext, classMeetingId: string) {
  const cm = await db.classMeeting.findUnique({ where: { id: classMeetingId }, include: { videoMeeting: true, offering: { include: { course: true } } } });
  if (!cm) throw notFound("Class session");
  if (cm.status === "CANCELLED") throw workflowError("This class session was cancelled.");
  if (cm.videoMeeting) return cm.videoMeeting;
  const m = await createMeeting(ctx, { title: `${cm.offering.course.code} ${cm.offering.course.title} — Section ${cm.offering.section}`, meetingType: "ONLINE_CLASS", offeringId: cm.offeringId, scheduledStart: cm.startsAt, scheduledEnd: cm.endsAt, visibility: "COURSE" });
  await db.videoMeeting.update({ where: { id: m.id }, data: { classMeetingId: cm.id } });
  return m;
}

// ───────────────────────── Lifecycle ─────────────────────────

export async function startMeeting(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m, "Only the host or a co-host can start this meeting.");
  if (!can(ctx, "video.start") && !isSuperAdmin(ctx)) throw forbidden("You cannot start meetings.");
  if (m.status === "LIVE" || m.status === "STARTING") return m;
  if (m.status === "DRAFT") throw workflowError("Schedule the meeting first.");
  if (m.status === "ENDED" || m.status === "CANCELLED") throw workflowError(m.status === "ENDED" ? "This meeting has ended." : "This meeting was cancelled.");
  const s = await getSetting("video");
  const now = new Date();
  if (now.getTime() < m.scheduledStart.getTime() - s.joinEarlyMinutes * 60_000) throw workflowError(`You can start this meeting from ${s.joinEarlyMinutes} minutes before its scheduled time.`);
  if (now > m.scheduledEnd) throw workflowError("This meeting's scheduled time has passed. Reschedule it to start again.");
  if (!(await setStatus(m.id, ["SCHEDULED", "FAILED"], "STARTING", { failureReason: null }))) return loadMeeting(m.id);
  const provider = await videoProvider();
  try {
    await provider.createRoom(m.roomName, { maxParticipants: m.participantLimit + 2, emptyTimeoutSeconds: 15 * 60, metadata: JSON.stringify({ publicId: m.publicId }) });
  } catch (e) {
    const reason = e instanceof VideoProviderError ? e.message : "Unable to start the meeting.";
    await setStatus(m.id, ["STARTING"], "FAILED", { failureReason: reason });
    log("error", "video.meeting_start_failed", { meeting: m.publicId, detail: e instanceof VideoProviderError ? e.causeDetail ?? e.code : String(e) });
    await audit({ ...actor(ctx), action: "video.meeting.failed", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${reason}` });
    throw workflowError(e instanceof VideoProviderError && e.code === "NOT_CONFIGURED" ? e.message : "Unable to start the meeting. Please try again.");
  }
  await setStatus(m.id, ["STARTING"], "LIVE", { actualStart: new Date() });
  await audit({ ...actor(ctx), action: "video.meeting.start", resourceType: "videoMeeting", resourceId: m.id, summary: m.publicId });
  log("info", "video.meeting_started", { meeting: m.publicId });
  if (m.offeringId) await refreshClassRoll(m.id, m.offeringId);
  await invite(m.id, m.participants.filter((p) => p.userId && p.userId !== ctx.user.id && p.connectionStatus !== "REMOVED").map((p) => p.userId!), "started");
  if (m.autoRecord && m.recordingEnabled) {
    const { startRecording } = await import("./recordings");
    await startRecording(ctx, m.id).catch((e) => log("warn", "video.autorecord_failed", { meeting: m.publicId, detail: String(e) }));
  }
  return loadMeeting(m.id);
}

/** Students who registered after scheduling are added when the class starts. */
async function refreshClassRoll(meetingId: string, offeringId: string) {
  const roll = await db.courseRegistration.findMany({ where: { offeringId, status: "REGISTERED", student: { userId: { not: null } } }, select: { student: { select: { userId: true, firstName: true, lastName: true } } } });
  await db.videoMeetingParticipant.createMany({ data: roll.map((r) => ({ meetingId, userId: r.student.userId!, displayName: `${r.student.firstName} ${r.student.lastName}`, role: "PARTICIPANT" as const, invitationStatus: "ACCEPTED" as const })), skipDuplicates: true });
}

export async function endMeeting(ctx: AuthContext | null, idOrPublicId: string, at = new Date()) {
  const m = await loadMeeting(idOrPublicId);
  if (ctx) {
    assertHost(ctx, m, "Only the host or a co-host can end this meeting.");
    if (!can(ctx, "video.end") && !isSuperAdmin(ctx)) throw forbidden("You cannot end meetings.");
  }
  if (m.status === "ENDED") return;
  if (m.status !== "LIVE" && m.status !== "STARTING") throw workflowError("This meeting is not running.");
  if (!(await setStatus(m.id, ["LIVE", "STARTING"], "ENDED", { actualEnd: at }))) return;
  const provider = await videoProvider();
  const { stopAllRecordings } = await import("./recordings");
  await stopAllRecordings(m.id);
  await provider.deleteRoom(m.roomName).catch((e) => log("warn", "video.delete_room_failed", { meeting: m.publicId, detail: String(e) }));
  await db.videoPresence.updateMany({ where: { meetingId: m.id, leftAt: null }, data: { leftAt: at } });
  await db.videoMeetingParticipant.updateMany({ where: { meetingId: m.id, connectionStatus: { in: ["CONNECTED", "IN_LOBBY", "ADMITTED"] } }, data: { connectionStatus: "DISCONNECTED", lastLeftAt: at } });
  await computeAttendance(m.id);
  await audit({ ...(ctx ? actor(ctx) : { actorName: "Video service" }), action: "video.meeting.end", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}${ctx ? "" : " (room closed)"}` });
  log("info", "video.meeting_ended", { meeting: m.publicId, byUser: !!ctx });
}

// ───────────────────────── Joining ─────────────────────────

export type JoinResult =
  | { status: "ready"; serverUrl: string; token: string; iceServers: { urls: string; username?: string; credential?: string }[]; identity: string; role: VideoParticipantRole; canPublish: boolean; canPublishScreen: boolean; chatEnabled: boolean; isHost: boolean; isModerator: boolean }
  | { status: "lobby" }
  | { status: "waiting"; startsAt: string };

function grantsFor(m: MeetingWithParticipants, role: VideoParticipantRole) {
  const host = PUBLISHERS.includes(role);
  const canPublish = host || (role === "PARTICIPANT" && m.participantsCanPublish);
  const canPublishScreen = m.screenShareEnabled && (role === "HOST" || role === "CO_HOST" || role === "PRESENTER" || (role === "PARTICIPANT" && m.participantsCanPublish));
  return { canPublish, canPublishScreen, canPublishData: role !== "OBSERVER" };
}

async function issueToken(m: MeetingWithParticipants, p: { id: string; role: VideoParticipantRole; panelRole: string | null; displayName: string }, identity: string) {
  const provider = await videoProvider();
  const g = grantsFor(m, p.role);
  const grant: JoinGrant = { room: m.roomName, identity, name: p.displayName, metadata: JSON.stringify({ role: p.role, panelRole: p.panelRole, participantId: p.id }), ...g, ttlSeconds: 15 * 60 };
  const token = await provider.createJoinToken(grant);
  log("info", "video.token_issued", { meeting: m.publicId, participant: p.id, role: p.role });
  return { serverUrl: provider.clientUrl(), token, iceServers: provider.iceServers(), identity, role: p.role, ...g };
}

export async function joinMeeting(ctx: AuthContext, idOrPublicId: string): Promise<JoinResult> {
  if (!hit(`video-join:${ctx.user.id}`, 30, 60_000)) throw workflowError("Too many join attempts; wait a minute.");
  let m = await loadMeeting(idOrPublicId);
  if (!(await canJoin(ctx, m))) {
    log("warn", "video.access_denied", { userId: ctx.user.id, meeting: m.publicId, action: "join" });
    throw forbidden(NO_ACCESS);
  }
  if (m.status === "ENDED") throw workflowError("This meeting has ended.");
  if (m.status === "CANCELLED") throw workflowError("This meeting was cancelled.");
  if (m.status === "DRAFT") throw workflowError("This meeting has not been scheduled yet.");
  const host = isHostLike(ctx, m);
  const s = await getSetting("video");
  if (m.status !== "LIVE") {
    if (host && joinWindowOpen(new Date(), m.scheduledStart, m.scheduledEnd, m.status === "FAILED" ? "SCHEDULED" : m.status, s.joinEarlyMinutes)) m = await startMeeting(ctx, m.id);
    else if (host) throw workflowError(new Date() > m.scheduledEnd ? "This meeting's scheduled time has passed." : `You can start this meeting from ${s.joinEarlyMinutes} minutes before its scheduled time.`);
    else return { status: "waiting", startsAt: m.scheduledStart.toISOString() };
  }
  let p = myParticipant(ctx, m);
  if (!p) {
    if (m.status === "LIVE" && (await db.videoMeetingParticipant.count({ where: { meetingId: m.id, connectionStatus: "CONNECTED" } })) >= m.participantLimit) throw workflowError("This meeting is full.");
    p = await db.videoMeetingParticipant.upsert({
      where: { meetingId_userId: { meetingId: m.id, userId: ctx.user.id } },
      create: { meetingId: m.id, userId: ctx.user.id, displayName: ctx.user.name, role: isSuperAdmin(ctx) && m.hostUserId !== ctx.user.id ? "OBSERVER" : "PARTICIPANT", invitationStatus: "ACCEPTED" },
      update: {},
    });
  }
  if (p.connectionStatus === "REMOVED") throw forbidden(NO_ACCESS);
  const needsLobby = m.lobbyEnabled && !PUBLISHERS.includes(p.role) && (p.connectionStatus === "INVITED" || p.connectionStatus === "IN_LOBBY");
  if (needsLobby) {
    if (p.connectionStatus !== "IN_LOBBY") {
      await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { connectionStatus: "IN_LOBBY", lobbyRequestedAt: new Date() } });
      const provider = await videoProvider();
      const hosts = m.participants.filter((x) => x.userId && (x.role === "HOST" || x.role === "CO_HOST")).map((x) => identityForUser(x.userId!));
      await provider.sendData(m.roomName, "lobby", { name: p.displayName }, hosts).catch(() => undefined);
    }
    return { status: "lobby" };
  }
  try {
    const t = await issueToken(m, p, identityForUser(ctx.user.id));
    if (p.connectionStatus === "IN_LOBBY" || p.connectionStatus === "INVITED") await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { connectionStatus: "ADMITTED" } });
    await audit({ ...actor(ctx), action: "video.meeting.join", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId} as ${p.role.toLowerCase()}` });
    return { status: "ready", ...t, chatEnabled: m.chatEnabled, isHost: isHostLike(ctx, m), isModerator: isModerator(ctx, m) };
  } catch (e) {
    if (e instanceof VideoProviderError) throw workflowError(e.code === "NOT_CONFIGURED" ? e.message : "Unable to connect to the meeting. Please try again.");
    throw e;
  }
}

// ───────────────────────── Participants ─────────────────────────

/** Participants with live status (from the provider) and time present so far. Hosts and moderators see everyone. */
export async function participantsView(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  await assertSee(ctx, m);
  const moderator = isModerator(ctx, m);
  const provider = await videoProvider();
  const live = m.status === "LIVE" ? await provider.listParticipants(m.roomName).catch(() => []) : [];
  const liveBy = new Map(live.map((l) => [l.identity, l]));
  const presence = await db.videoPresence.findMany({ where: { meetingId: m.id } });
  const now = Date.now();
  const rows = m.participants
    .filter((p) => moderator || p.connectionStatus === "CONNECTED" || p.role === "HOST")
    .map((p) => {
      const ident = p.userId ? identityForUser(p.userId) : p.guestId ? identityForGuest(p.guestId) : "";
      const l = liveBy.get(ident);
      const secs = presence.filter((x) => x.participantId === p.id).reduce((a, x) => a + ((x.leftAt?.getTime() ?? now) - x.joinedAt.getTime()) / 1000, 0);
      return { id: p.id, name: p.displayName, role: p.role, panelRole: p.panelRole, isGuest: !!p.guestId, invitation: p.invitationStatus, status: p.connectionStatus, lobbyRequestedAt: p.lobbyRequestedAt, joinedAt: p.lastJoinedAt, online: !!l, audioMuted: l?.audioMuted ?? null, videoMuted: l?.videoMuted ?? null, seconds: moderator ? Math.round(secs) : null };
    });
  return { meeting: m, moderator, rows };
}

export async function addParticipants(ctx: AuthContext, idOrPublicId: string, raw: unknown) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  if (!can(ctx, "video.manage_participants") && !isSuperAdmin(ctx)) throw forbidden();
  if (m.status === "ENDED" || m.status === "CANCELLED") throw workflowError("This meeting is over.");
  const v = z.object({ userIds: z.array(z.string()).min(1).max(500), role: z.enum(["PARTICIPANT", "PRESENTER", "OBSERVER", "MODERATOR"]).default("PARTICIPANT") }).parse(raw);
  const users = await db.user.findMany({ where: { id: { in: v.userIds }, deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true } });
  const r = await db.videoMeetingParticipant.createMany({ data: users.map((u) => ({ meetingId: m.id, userId: u.id, displayName: u.name, role: v.role })), skipDuplicates: true });
  // Adding someone who was removed earlier lets them back in (a deliberate host decision, audited).
  const restored = await db.videoMeetingParticipant.updateMany({ where: { meetingId: m.id, userId: { in: users.map((u) => u.id) }, connectionStatus: "REMOVED" }, data: { connectionStatus: "INVITED", removedAt: null, removedById: null, role: v.role } });
  await audit({ ...actor(ctx), action: "video.participant.add", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: +${r.count} ${v.role.toLowerCase()}(s)${restored.count ? `, ${restored.count} removed participant(s) re-admitted` : ""}` });
  if (m.status !== "DRAFT") await invite(m.id, users.map((u) => u.id), m.status === "LIVE" ? "started" : "invited");
  return r.count + restored.count;
}

async function participantOf(m: MeetingWithParticipants, participantId: string) {
  const p = m.participants.find((x) => x.id === participantId);
  if (!p) throw notFound("Participant");
  return p;
}
const identityOf = (p: VideoMeetingParticipant) => (p.userId ? identityForUser(p.userId) : identityForGuest(p.guestId!));

export async function removeParticipant(ctx: AuthContext, idOrPublicId: string, participantId: string) {
  const m = await loadMeeting(idOrPublicId);
  if (!isModerator(ctx, m) || !(can(ctx, "video.remove_participant") || isSuperAdmin(ctx) || isHostLike(ctx, m))) throw forbidden("You cannot remove participants.");
  const p = await participantOf(m, participantId);
  if (p.role === "HOST") throw forbidden("The host cannot be removed.");
  if (p.role === "CO_HOST" && !isHostLike(ctx, m)) throw forbidden("Only the host can remove a co-host.");
  await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { connectionStatus: "REMOVED", removedAt: new Date(), removedById: ctx.user.id } });
  if (m.status === "LIVE") await (await videoProvider()).removeParticipant(m.roomName, identityOf(p)).catch((e) => log("warn", "video.remove_failed", { meeting: m.publicId, detail: String(e) }));
  if (p.guestId) await db.videoMeetingGuest.update({ where: { id: p.guestId }, data: { revokedAt: new Date() } });
  await audit({ ...actor(ctx), action: "video.participant.remove", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${p.displayName} removed` });
  if (p.userId) await notify({ userIds: [p.userId], type: "video.removed", title: `You were removed from ${m.title}`, body: m.publicId });
}

export async function setParticipantRole(ctx: AuthContext, idOrPublicId: string, participantId: string, role: VideoParticipantRole) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  const allowed: VideoParticipantRole[] = ["CO_HOST", "PRESENTER", "PARTICIPANT", "MODERATOR", "OBSERVER"];
  if (!allowed.includes(role)) throw invalid("Unknown role.");
  if (role === "CO_HOST" && !(can(ctx, "video.assign_cohost") || isSuperAdmin(ctx))) throw forbidden("You cannot assign co-hosts.");
  if (role !== "CO_HOST" && !(can(ctx, "video.manage_participants") || isSuperAdmin(ctx))) throw forbidden();
  const p = await participantOf(m, participantId);
  if (p.role === "HOST") throw forbidden("The host's role cannot change.");
  if (p.guestId && (role === "CO_HOST" || role === "MODERATOR")) throw forbidden("Guests cannot be co-hosts or moderators.");
  if (p.connectionStatus === "REMOVED") throw workflowError("This person was removed.");
  await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { role } });
  if (m.status === "LIVE" && p.connectionStatus === "CONNECTED") {
    const g = grantsFor(m, role);
    await (await videoProvider()).setPermissions(m.roomName, identityOf(p), g, JSON.stringify({ role, panelRole: p.panelRole, participantId: p.id })).catch((e) => log("warn", "video.permission_update_failed", { meeting: m.publicId, detail: String(e) }));
  }
  await audit({ ...actor(ctx), action: "video.participant.role", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${p.displayName} ${p.role} → ${role}` });
}

export async function muteParticipant(ctx: AuthContext, idOrPublicId: string, participantId: string, kind: "audio" | "video" | "all" = "audio") {
  const m = await loadMeeting(idOrPublicId);
  if (!isModerator(ctx, m) || !(can(ctx, "video.mute_participants") || isSuperAdmin(ctx) || isHostLike(ctx, m))) throw forbidden("You cannot mute participants.");
  if (m.status !== "LIVE") throw workflowError("The meeting is not live.");
  const p = await participantOf(m, participantId);
  const n = await (await videoProvider()).muteParticipant(m.roomName, identityOf(p), kind);
  await audit({ ...actor(ctx), action: "video.participant.mute", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${p.displayName} (${kind})` });
  return n;
}

export async function decideLobby(ctx: AuthContext, idOrPublicId: string, participantId: string, admit: boolean) {
  const m = await loadMeeting(idOrPublicId);
  if (!isModerator(ctx, m)) throw forbidden("Only the host and moderators manage the lobby.");
  const p = await participantOf(m, participantId);
  if (p.connectionStatus !== "IN_LOBBY") throw workflowError("This person is no longer waiting.");
  await db.videoMeetingParticipant.update({ where: { id: p.id }, data: admit ? { connectionStatus: "ADMITTED" } : { connectionStatus: "REMOVED", removedAt: new Date(), removedById: ctx.user.id } });
  await audit({ ...actor(ctx), action: admit ? "video.lobby.admit" : "video.lobby.deny", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${p.displayName}` });
}

// ───────────────────────── Guests ─────────────────────────

export async function createGuestInvite(ctx: AuthContext, idOrPublicId: string, raw: unknown) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  const s = await getSetting("video");
  if (!s.guestAccessEnabled) throw forbidden("Guest access is switched off by the administrator.");
  if (m.status === "ENDED" || m.status === "CANCELLED") throw workflowError("This meeting is over.");
  const v = z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email().max(200), role: z.enum(["PARTICIPANT", "PRESENTER", "OBSERVER"]).default("PARTICIPANT"), panelRole: z.string().max(40).nullable().optional() }).parse(raw);
  const token = randomToken(32);
  const expiresAt = new Date(m.scheduledEnd.getTime() + s.guestGraceHours * 3_600_000);
  const g = await db.$transaction(async (tx) => {
    const guest = await tx.videoMeetingGuest.create({ data: { meetingId: m.id, name: v.name, email: v.email, tokenHash: sha256(token), role: v.role, panelRole: v.panelRole ?? null, expiresAt, createdById: ctx.user.id } });
    await tx.videoMeetingParticipant.create({ data: { meetingId: m.id, guestId: guest.id, displayName: `${v.name} (guest)`, role: v.role, panelRole: v.panelRole ?? null, invitationStatus: "PENDING" } });
    await tx.emailOutbox.create({ data: { to: v.email, subject: `Invitation: ${m.title}`, text: `You are invited to "${m.title}" on ${m.scheduledStart.toLocaleString("en-IN", { timeZone: m.timezone, dateStyle: "full", timeStyle: "short" })}.\n\nJoin with this personal link (do not share it; it works until ${expiresAt.toLocaleString("en-IN", { timeZone: m.timezone })}):\n${env.APP_URL}/meet/guest/${token}\n` } });
    await audit({ ...actor(ctx), action: "video.guest.invite", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: guest ${v.name} <${v.email}> until ${expiresAt.toISOString()}` }, tx);
    return guest;
  });
  return { id: g.id, url: `${env.APP_URL}/meet/guest/${token}`, expiresAt };
}

export async function revokeGuest(ctx: AuthContext, idOrPublicId: string, guestId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m);
  const p = m.participants.find((x) => x.guestId === guestId);
  if (!p) throw notFound("Guest");
  await removeParticipant(ctx, m.id, p.id);
}

async function guestFromToken(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return null;
  const g = await db.videoMeetingGuest.findUnique({ where: { tokenHash: sha256(token) } });
  if (!g || g.revokedAt || g.expiresAt < new Date()) return null;
  return g;
}

export async function guestMeetingInfo(token: string) {
  const g = await guestFromToken(token);
  if (!g) return null;
  const m = await db.videoMeeting.findUniqueOrThrow({ where: { id: g.meetingId }, include: { host: { select: { name: true } } } });
  return { name: g.name, title: m.title, type: MEETING_TYPES[m.meetingType as MeetingType].label, scheduledStart: m.scheduledStart, scheduledEnd: m.scheduledEnd, timezone: m.timezone, host: m.host.name, status: m.status };
}

/** A guest joins with their link — meeting-specific, time-limited, revocable and audited. */
export async function joinAsGuest(token: string, ip: string | null): Promise<JoinResult> {
  if (!hit(`video-guest:${ip ?? "?"}`, 20, 60_000)) throw workflowError("Too many attempts; wait a minute.");
  const g = await guestFromToken(token);
  if (!g) throw forbidden("This invitation link is not valid, has expired or was withdrawn.");
  const m = await loadMeeting(g.meetingId);
  const p = m.participants.find((x) => x.guestId === g.id);
  if (!p || p.connectionStatus === "REMOVED") throw forbidden("This invitation was withdrawn.");
  if (m.status === "ENDED") throw workflowError("This meeting has ended.");
  if (m.status === "CANCELLED") throw workflowError("This meeting was cancelled.");
  if (m.status !== "LIVE") return { status: "waiting", startsAt: m.scheduledStart.toISOString() };
  await db.videoMeetingGuest.update({ where: { id: g.id }, data: { lastUsedAt: new Date() } });
  if (m.lobbyEnabled && (p.connectionStatus === "INVITED" || p.connectionStatus === "IN_LOBBY")) {
    if (p.connectionStatus !== "IN_LOBBY") await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { connectionStatus: "IN_LOBBY", lobbyRequestedAt: new Date(), invitationStatus: "ACCEPTED" } });
    return { status: "lobby" };
  }
  const t = await issueToken(m, p, identityForGuest(g.id));
  await audit({ actorName: `${g.name} (guest)`, action: "video.meeting.join", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: guest ${g.email}` });
  return { status: "ready", ...t, chatEnabled: false, isHost: false, isModerator: false };
}

// ───────────────────────── Panel notes (viva, PhD review, mentoring) ─────────────────────────

function canUseNotes(ctx: AuthContext, m: MeetingWithParticipants) {
  if (!(m.meetingType in NOTE_KINDS)) return false;
  if (isHostLike(ctx, m)) return true;
  const p = myParticipant(ctx, m);
  // Candidates and mentees never see panel notes.
  return !!p && p.connectionStatus !== "REMOVED" && !!p.panelRole && p.panelRole !== "CANDIDATE";
}

export async function meetingNotes(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  if (!canUseNotes(ctx, m)) throw notFound("Notes");
  const notes = await db.videoMeetingNote.findMany({ where: { meetingId: m.id }, orderBy: { createdAt: "asc" } });
  const authors = new Map((await db.user.findMany({ where: { id: { in: notes.map((n) => n.authorUserId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return notes.map((n) => ({ ...n, author: authors.get(n.authorUserId) ?? "—" }));
}

export async function addMeetingNote(ctx: AuthContext, idOrPublicId: string, raw: unknown) {
  const m = await loadMeeting(idOrPublicId);
  if (!canUseNotes(ctx, m)) throw forbidden("Only the panel can write notes for this meeting.");
  const kinds = NOTE_KINDS[m.meetingType as keyof typeof NOTE_KINDS] as readonly string[];
  const v = z.object({ kind: z.string().refine((k) => kinds.includes(k), "Choose a note type"), body: z.string().trim().min(3).max(8000), followUpOn: z.coerce.date().nullable().optional() }).parse(raw);
  const n = await db.videoMeetingNote.create({ data: { meetingId: m.id, authorUserId: ctx.user.id, kind: v.kind, body: v.body, followUpOn: v.followUpOn ?? null } });
  await audit({ ...actor(ctx), action: "video.note.add", resourceType: "videoMeeting", resourceId: m.id, summary: `${m.publicId}: ${v.kind.toLowerCase().replace("_", " ")}` });
  return n;
}

// ───────────────────────── Lists and jobs ─────────────────────────

export async function canCreateMeetings(ctx: AuthContext) {
  return can(ctx, "video.create") || can(ctx, "video.schedule");
}

/** Reminders shortly before scheduled meetings (background job). */
export async function sendMeetingReminders(now = new Date()) {
  const s = await getSetting("video");
  if (!s.reminderMinutes) return 0;
  const due = await db.videoMeeting.findMany({ where: { status: "SCHEDULED", reminderSentAt: null, scheduledStart: { gt: now, lte: new Date(now.getTime() + s.reminderMinutes * 60_000) } }, include: { participants: { select: { userId: true, invitationStatus: true, connectionStatus: true } } } });
  for (const m of due) {
    await db.videoMeeting.update({ where: { id: m.id }, data: { reminderSentAt: now } });
    await invite(m.id, m.participants.filter((p) => p.userId && p.invitationStatus !== "DECLINED" && p.connectionStatus !== "REMOVED").map((p) => p.userId!), "starting");
  }
  return due.length;
}
