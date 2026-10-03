import "server-only";
import { z } from "zod";
import type { Prisma, VideoMeetingRecording } from "@/generated/prisma/client";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { hmac, safeEqual } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { getSetting } from "@/server/services/settings";
import { log } from "@/server/video/log";
import { type RecordingState, videoProvider, VideoProviderError } from "@/server/video/provider";
import { objectKeyFrom, recordingStorage } from "@/server/video/recording-storage";
import { assertHost, hasOversight, isHostLike, loadMeeting, type MeetingWithParticipants } from "./access";

/**
 * Recordings. Started and stopped by a host through the ERP; OpenVidu records the room and writes the file
 * to private storage; webhooks move the ERP record through STARTING → ACTIVE → PROCESSING → AVAILABLE
 * (or FAILED). Viewing is decided on the server for every request, and the file is streamed through the
 * ERP with a short-lived link bound to the viewer — storage addresses are never exposed.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

export async function startRecording(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m, "Only the host or a co-host can record.");
  if (!can(ctx, "video.enable_recording") && !isSuperAdmin(ctx)) throw forbidden("You cannot record meetings.");
  const s = await getSetting("video");
  if (!m.recordingEnabled || !s.recordingEnabled || env.OPENVIDU_RECORDING_ENABLED !== "true") throw workflowError("Recording is not allowed for this meeting.");
  if (m.status !== "LIVE") throw workflowError("Recording can start once the meeting is live.");
  if (await db.videoMeetingRecording.count({ where: { meetingId: m.id, status: { in: ["STARTING", "ACTIVE"] } } })) throw conflict("A recording is already running.");
  const path = `${env.OPENVIDU_RECORDING_PREFIX.replace(/\/$/, "")}/${m.publicId}/${new Date().toISOString().replace(/[:.]/g, "-")}.mp4`;
  let id: string;
  try {
    id = (await (await videoProvider()).startRecording(m.roomName, path)).id;
  } catch (e) {
    log("error", "video.recording_start_failed", { meeting: m.publicId, detail: e instanceof VideoProviderError ? e.causeDetail ?? e.code : String(e) });
    throw workflowError("Recording could not start. Please try again.");
  }
  const r = await db.videoMeetingRecording.create({
    data: { meetingId: m.id, providerRecordingId: id, storageProvider: recordingStorage().name, storagePath: path, status: "STARTING", access: m.recordingAccess, startedById: ctx.user.id, retainUntil: new Date(Date.now() + s.recordingRetentionDays * 86_400_000) },
  });
  await audit({ ...actor(ctx), action: "video.recording.start", resourceType: "videoMeeting", resourceId: m.id, summary: m.publicId });
  log("info", "video.recording_started", { meeting: m.publicId, recording: r.id });
  return r;
}

export async function stopRecording(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  assertHost(ctx, m, "Only the host or a co-host can stop the recording.");
  const active = await db.videoMeetingRecording.findMany({ where: { meetingId: m.id, status: { in: ["STARTING", "ACTIVE"] } } });
  if (!active.length) throw workflowError("Nothing is being recorded.");
  await stopAllRecordings(m.id);
  await audit({ ...actor(ctx), action: "video.recording.stop", resourceType: "videoMeeting", resourceId: m.id, summary: m.publicId });
}

export async function stopAllRecordings(meetingId: string) {
  const active = await db.videoMeetingRecording.findMany({ where: { meetingId, status: { in: ["STARTING", "ACTIVE"] } } });
  const provider = await videoProvider();
  for (const r of active) {
    await provider.stopRecording(r.providerRecordingId).catch((e) => log("warn", "video.recording_stop_failed", { recording: r.id, detail: String(e) }));
    await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "PROCESSING", endedAt: new Date() } });
  }
}

/** Applies a provider recording update (from a webhook). Safe to apply more than once. */
export async function applyRecordingUpdate(u: { id: string; state: RecordingState; location?: string; filename?: string; durationSeconds?: number; size?: bigint; error?: string }) {
  const r = await db.videoMeetingRecording.findUnique({ where: { providerRecordingId: u.id }, include: { meeting: { include: { participants: true } } } });
  if (!r) return false;
  if (r.status === "DELETED" || r.status === "ARCHIVED" || r.status === "AVAILABLE") return true; // final from the ERP's point of view
  if (u.state === "STARTING" || u.state === "ACTIVE") {
    if (r.status === "STARTING") await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "ACTIVE" } });
    return true;
  }
  if (u.state === "ENDING") {
    await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "PROCESSING", endedAt: r.endedAt ?? new Date() } });
    return true;
  }
  const ok = u.state === "COMPLETE" || (u.state === "LIMIT_REACHED" && !!(u.location || u.filename));
  if (!ok) {
    await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "FAILED", error: (u.error ?? u.state).slice(0, 300), endedAt: r.endedAt ?? new Date() } });
    log("warn", "video.recording_failed", { recording: r.id, state: u.state, detail: u.error });
    await notify({ userIds: [r.meeting.hostUserId], type: "video.recording", title: `Recording failed: ${r.meeting.title}`, body: "The recording could not be completed.", link: `/video/${r.meeting.publicId}` });
    return true;
  }
  const key = objectKeyFrom(u.location, u.filename ?? r.storagePath);
  await db.videoMeetingRecording.update({
    where: { id: r.id },
    data: { status: "AVAILABLE", storagePath: key, durationSeconds: u.durationSeconds ?? null, fileSize: u.size ?? null, availableAt: new Date(), endedAt: r.endedAt ?? new Date() },
  });
  log("info", "video.recording_available", { recording: r.id });
  const viewers = await viewersOf(r, r.meeting);
  await notify({ userIds: viewers, type: "video.recording", title: `Recording available: ${r.meeting.title}`, body: r.meeting.publicId, link: `/video/${r.meeting.publicId}?tab=recordings` });
  return true;
}

/** Users to tell when a recording becomes available (bounded; others can still find it). */
async function viewersOf(r: VideoMeetingRecording, m: MeetingWithParticipants) {
  const participants = m.participants.filter((p) => p.userId && p.connectionStatus !== "REMOVED").map((p) => p.userId!);
  if (r.access === "HOST_ONLY" || r.access === "ADMINS") return [m.hostUserId, ...m.participants.filter((p) => p.role === "CO_HOST" && p.userId).map((p) => p.userId!)];
  if (r.access === "SPECIFIC") return [m.hostUserId, ...r.allowedUserIds];
  return [...new Set([m.hostUserId, ...participants])].slice(0, 1000);
}

// ───────────────────────── Access ─────────────────────────

export async function canWatch(ctx: AuthContext, r: VideoMeetingRecording, m: MeetingWithParticipants): Promise<boolean> {
  if (r.deletedAt || r.status === "DELETED") return false;
  if (isSuperAdmin(ctx) || isHostLike(ctx, m)) return true;
  if (can(ctx, "video.delete_recording", m.departmentId ?? undefined) && hasOversight(ctx, m)) return true;
  if (r.status === "ARCHIVED" || r.status !== "AVAILABLE") return false;
  if (!can(ctx, "video.view_recording")) return false;
  const p = m.participants.find((x) => x.userId === ctx.user.id);
  if (p?.connectionStatus === "REMOVED") return false;
  switch (r.access) {
    case "HOST_ONLY": return false;
    case "ADMINS": return hasOversight(ctx, m);
    case "SPECIFIC": return r.allowedUserIds.includes(ctx.user.id);
    case "PARTICIPANTS": return !!p;
    case "COURSE":
      if (p) return true;
      if (!m.offeringId) return false;
      return (await db.courseOffering.count({ where: { id: m.offeringId, OR: [{ instructors: { some: { userId: ctx.user.id } } }, ...(ctx.subject.studentId ? [{ registrations: { some: { studentId: ctx.subject.studentId, status: { in: ["REGISTERED" as const, "COMPLETED" as const] } } } }] : [])] } })) > 0;
    case "DEPARTMENT":
      if (p) return true;
      if (!m.departmentId) return false;
      if (ctx.user.departmentId === m.departmentId) return true;
      return !!ctx.subject.studentId && (await db.student.count({ where: { id: ctx.subject.studentId, departmentId: m.departmentId } })) > 0;
  }
}

async function loadRecording(id: string) {
  const r = await db.videoMeetingRecording.findUnique({ where: { id: String(id).slice(0, 40) } });
  if (!r) throw notFound("Recording");
  return { r, m: await loadMeeting(r.meetingId) };
}

export async function recordingsFor(ctx: AuthContext, idOrPublicId: string) {
  const m = await loadMeeting(idOrPublicId);
  const all = await db.videoMeetingRecording.findMany({ where: { meetingId: m.id, deletedAt: null }, orderBy: { startedAt: "asc" } });
  const out = [];
  for (const r of all) if (await canWatch(ctx, r, m)) out.push(r);
  return { meeting: m, recordings: out, manage: isHostLike(ctx, m) || (can(ctx, "video.delete_recording", m.departmentId ?? undefined) && hasOversight(ctx, m)) };
}

/** A short-lived playback address bound to this viewer and recording. */
export async function playbackUrl(ctx: AuthContext, recordingId: string, disposition: "inline" | "attachment" = "inline") {
  const { r, m } = await loadRecording(recordingId);
  if (!(await canWatch(ctx, r, m))) throw notFound("Recording");
  if (r.status !== "AVAILABLE" && r.status !== "ARCHIVED") throw workflowError(r.status === "PROCESSING" || r.status === "ACTIVE" || r.status === "STARTING" ? "Recording is currently being processed." : "This recording is not available.");
  if (disposition === "attachment") {
    const s = await getSetting("video");
    if (!s.allowRecordingDownload && !isHostLike(ctx, m) && !isSuperAdmin(ctx)) throw forbidden("Downloads are not allowed; you can watch the recording here.");
  }
  const exp = Math.floor(Date.now() / 1000) + 2 * 3600;
  const sig = hmac(`rec.${r.id}.${ctx.user.id}.${exp}.${disposition}`);
  await audit({ ...actor(ctx), action: disposition === "attachment" ? "video.recording.download" : "video.recording.view", resourceType: "videoRecording", resourceId: r.id, summary: m.publicId });
  return `/api/video/recordings/${r.id}/media?exp=${exp}&d=${disposition}&sig=${sig}`;
}

export function verifyPlayback(recordingId: string, userId: string, exp: string | null, d: string | null, sig: string | null) {
  if (!exp || !sig || (d !== "inline" && d !== "attachment")) return false;
  if (Number(exp) < Date.now() / 1000) return false;
  return safeEqual(hmac(`rec.${recordingId}.${userId}.${exp}.${d}`), sig);
}

/** For the media route: re-checks access on every request (Range requests included). */
export async function recordingForStreaming(ctx: AuthContext, recordingId: string) {
  const { r, m } = await loadRecording(recordingId);
  if (!(await canWatch(ctx, r, m)) || !r.storagePath) throw notFound("Recording");
  return { r, m };
}

export async function updateRecording(ctx: AuthContext, recordingId: string, raw: unknown) {
  const { r, m } = await loadRecording(recordingId);
  const manager = isHostLike(ctx, m) || (can(ctx, "video.delete_recording", m.departmentId ?? undefined) && hasOversight(ctx, m));
  if (!manager) throw notFound("Recording");
  const v = z.object({ access: z.enum(["HOST_ONLY", "PARTICIPANTS", "COURSE", "DEPARTMENT", "SPECIFIC", "ADMINS"]).optional(), allowedUserIds: z.array(z.string()).max(500).optional(), archived: z.boolean().optional() }).parse(raw);
  if (r.status === "DELETED") throw workflowError("This recording was deleted.");
  if (v.access === "COURSE" && !m.offeringId) throw invalid("This meeting is not linked to a class.");
  const data: Prisma.VideoMeetingRecordingUpdateInput = {};
  if (v.access) data.access = v.access;
  if (v.allowedUserIds) data.allowedUserIds = (await db.user.findMany({ where: { id: { in: v.allowedUserIds } }, select: { id: true } })).map((u) => u.id);
  if (v.archived !== undefined) {
    if (v.archived && r.status !== "AVAILABLE") throw workflowError("Only available recordings can be archived.");
    if (!v.archived && r.status !== "ARCHIVED") throw workflowError("This recording is not archived.");
    data.status = v.archived ? "ARCHIVED" : "AVAILABLE";
    data.archivedAt = v.archived ? new Date() : null;
  }
  await db.videoMeetingRecording.update({ where: { id: r.id }, data });
  await audit({ ...actor(ctx), action: "video.recording.update", resourceType: "videoRecording", resourceId: r.id, summary: `${m.publicId}: ${[v.access && `access ${v.access}`, v.archived !== undefined && (v.archived ? "archived" : "restored")].filter(Boolean).join(", ")}`, oldValue: { access: r.access, status: r.status }, newValue: { access: data.access ?? r.access, status: data.status ?? r.status } });
}

/** Deletion needs video.delete_recording in the meeting's department; the file is removed, the record kept. */
export async function deleteRecording(ctx: AuthContext, recordingId: string, reason: string) {
  const { r, m } = await loadRecording(recordingId);
  if (!(isSuperAdmin(ctx) || (can(ctx, "video.delete_recording", m.departmentId ?? undefined) && (hasOversight(ctx, m) || isHostLike(ctx, m))))) throw forbidden("You cannot delete recordings.");
  if (r.status === "DELETED") return;
  if (r.status === "STARTING" || r.status === "ACTIVE") throw workflowError("Stop the recording first.");
  const why = String(reason ?? "").trim();
  if (why.length < 5) throw invalid("Give a reason for deleting.");
  if (r.storagePath) await recordingStorage().remove(r.storagePath).catch((e) => log("warn", "video.recording_delete_failed", { recording: r.id, detail: String(e) }));
  await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "DELETED", deletedAt: new Date(), deletedById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "video.recording.delete", resourceType: "videoRecording", resourceId: r.id, summary: `${m.publicId}: ${why}` });
}

/** Retention (background job): recordings past their retention date are removed; chat older than policy too. */
export async function applyVideoRetention(now = new Date()) {
  const s = await getSetting("video");
  const due = await db.videoMeetingRecording.findMany({ where: { retainUntil: { lt: now }, status: { in: ["AVAILABLE", "ARCHIVED", "FAILED"] } }, take: 200 });
  for (const r of due) {
    if (r.storagePath) await recordingStorage().remove(r.storagePath).catch(() => undefined);
    await db.videoMeetingRecording.update({ where: { id: r.id }, data: { status: "DELETED", deletedAt: now } });
    await audit({ actorName: "Retention policy", action: "video.recording.expire", resourceType: "videoRecording", resourceId: r.id, summary: `Removed after the ${s.recordingRetentionDays}-day retention period` });
  }
  const chat = await db.videoChatMessage.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - s.chatRetentionDays * 86_400_000) }, meeting: { status: { in: ["ENDED", "CANCELLED"] } } } });
  const hooks = await db.videoWebhookEvent.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
  return { recordings: due.length, chat: chat.count, webhooks: hooks.count };
}
