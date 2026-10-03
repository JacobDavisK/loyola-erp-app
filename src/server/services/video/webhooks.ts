import "server-only";
import { parseIdentity } from "@/lib/domain/video";
import { db } from "@/server/db";
import { log } from "@/server/video/log";
import { type VideoEvent, videoProvider, VideoProviderError } from "@/server/video/provider";
import { computeAttendance } from "./attendance";
import { endMeeting } from "./meetings";
import { applyRecordingUpdate } from "./recordings";

/**
 * OpenVidu webhooks. Each delivery is verified (signed JWT over the body's SHA-256), recorded once by its
 * event id — so retries and duplicates are acknowledged without being applied twice — and then applied:
 * joins and leaves become presence intervals (keyed by the connection id, again idempotent), room start /
 * finish move the meeting, and egress events move recordings. Failures are logged and kept for retry.
 */

export type WebhookOutcome = { status: "processed" | "duplicate" | "ignored" } | { status: "rejected"; reason: string };

export async function receiveVideoWebhook(rawBody: string, authHeader: string | null): Promise<WebhookOutcome> {
  const provider = await videoProvider();
  let e: VideoEvent;
  try {
    e = await provider.receiveWebhook(rawBody, authHeader);
  } catch (err) {
    log("warn", "video.webhook_rejected", { detail: err instanceof VideoProviderError ? err.causeDetail ?? err.message : String(err) });
    return { status: "rejected", reason: "invalid signature" };
  }
  return processVideoEvent(e);
}

export async function processVideoEvent(e: VideoEvent): Promise<WebhookOutcome> {
  if (!e.id) return { status: "ignored" };
  const seen = await db.videoWebhookEvent.findUnique({ where: { eventId: e.id }, select: { processedAt: true } });
  if (seen?.processedAt) return { status: "duplicate" };
  if (!seen) try {
    await db.videoWebhookEvent.create({ data: { eventId: e.id, event: e.type, roomName: e.room ?? null, payload: JSON.parse(JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) } });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      const prior = await db.videoWebhookEvent.findUnique({ where: { eventId: e.id } });
      if (prior?.processedAt) return { status: "duplicate" };
      // a previous attempt failed: fall through and try again
    } else throw err;
  }
  if (e.numDropped) log("warn", "video.webhook_dropped", { numDropped: e.numDropped });
  try {
    const applied = await apply(e);
    await db.videoWebhookEvent.update({ where: { eventId: e.id }, data: { processedAt: new Date(), error: null } });
    log("info", "video.webhook", { event: e.type, applied });
    return { status: applied ? "processed" : "ignored" };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    await db.videoWebhookEvent.update({ where: { eventId: e.id }, data: { error: detail.slice(0, 500) } }).catch(() => undefined);
    log("error", "video.webhook_failed", { event: e.type, detail });
    throw err; // non-2xx: OpenVidu retries with backoff
  }
}

async function apply(e: VideoEvent): Promise<boolean> {
  if (e.type.startsWith("egress_")) return e.recording ? applyRecordingUpdate(e.recording) : false;
  if (!e.room) return false;
  const m = await db.videoMeeting.findUnique({ where: { roomName: e.room } });
  if (!m) return false;

  switch (e.type) {
    case "room_started":
      if (m.status === "STARTING") await db.videoMeeting.updateMany({ where: { id: m.id, status: "STARTING" }, data: { status: "LIVE", actualStart: m.actualStart ?? e.at } });
      return true;
    case "room_finished":
      // Everyone left and the room closed (or the meeting ran out): end it as the host would.
      if (m.status === "LIVE" || m.status === "STARTING") await endMeeting(null, m.id, e.at);
      return true;
    case "participant_joined": {
      const who = e.participant && parseIdentity(e.participant.identity);
      if (!who || !e.participant) return false;
      const p = await db.videoMeetingParticipant.findFirst({ where: { meetingId: m.id, ...(who.kind === "user" ? { userId: who.id } : { guestId: who.id }) } });
      if (!p) return false;
      await db.videoPresence.upsert({ where: { connectionSid: e.participant.sid }, create: { meetingId: m.id, participantId: p.id, connectionSid: e.participant.sid, joinedAt: e.at }, update: {} });
      if (p.connectionStatus !== "REMOVED") await db.videoMeetingParticipant.update({ where: { id: p.id }, data: { connectionStatus: "CONNECTED", lastJoinedAt: e.at, invitationStatus: p.invitationStatus === "PENDING" ? "ACCEPTED" : undefined } });
      return true;
    }
    case "participant_left":
    case "participant_connection_aborted": {
      if (!e.participant) return false;
      const presence = await db.videoPresence.findUnique({ where: { connectionSid: e.participant.sid } });
      if (!presence) return false;
      if (!presence.leftAt) await db.videoPresence.update({ where: { id: presence.id }, data: { leftAt: e.at < presence.joinedAt ? presence.joinedAt : e.at } });
      const stillIn = await db.videoPresence.count({ where: { participantId: presence.participantId, leftAt: null } });
      if (!stillIn) await db.videoMeetingParticipant.updateMany({ where: { id: presence.participantId, connectionStatus: { not: "REMOVED" } }, data: { connectionStatus: "DISCONNECTED", lastLeftAt: e.at } });
      // A late leave after the meeting ended corrects the attendance already computed.
      if (m.status === "ENDED") await computeAttendance(m.id);
      return true;
    }
    default:
      return false; // track events etc. are not needed for ERP records
  }
}
