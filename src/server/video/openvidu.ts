import "server-only";
import {
  AccessToken, DataPacket_Kind, EgressClient, EgressStatus, EncodedFileOutput, EncodedFileType, RoomServiceClient, TrackSource, TrackType, WebhookReceiver,
} from "livekit-server-sdk";
import { env } from "@/server/env";
import { log } from "@/server/video/log";
import { type IceServer, type JoinGrant, type ProviderParticipant, type RecordingState, type VideoConferenceProvider, type VideoEvent, VideoProviderError } from "./provider";

/**
 * OpenVidu 3 provider. OpenVidu 3 speaks the LiveKit protocol, so the official LiveKit server SDK is used
 * (as the OpenVidu documentation prescribes): AccessToken for join tokens, RoomServiceClient for rooms and
 * participants, EgressClient for recording, WebhookReceiver for signed webhooks.
 */

const EGRESS_STATE: Record<number, RecordingState> = {
  [EgressStatus.EGRESS_STARTING]: "STARTING",
  [EgressStatus.EGRESS_ACTIVE]: "ACTIVE",
  [EgressStatus.EGRESS_ENDING]: "ENDING",
  [EgressStatus.EGRESS_COMPLETE]: "COMPLETE",
  [EgressStatus.EGRESS_FAILED]: "FAILED",
  [EgressStatus.EGRESS_ABORTED]: "ABORTED",
  [EgressStatus.EGRESS_LIMIT_REACHED]: "LIMIT_REACHED",
};

/** Retries for idempotent calls when the server is briefly unreachable. */
async function withRetry<T>(op: string, fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Do not retry definite rejections (bad request, not found, permission).
      if (/\b(4\d\d|not found|permission|invalid)\b/i.test(msg)) break;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 250 * 4 ** i));
    }
  }
  const detail = last instanceof Error ? last.message : String(last);
  log("error", "openvidu.call_failed", { op, detail });
  throw new VideoProviderError("UNAVAILABLE", "The video service is not responding. Please try again in a moment.", detail);
}

export class OpenViduProvider implements VideoConferenceProvider {
  readonly name = "openvidu";
  readonly configured = true;
  private readonly key = env.OPENVIDU_API_KEY!;
  private readonly secret = (env.OPENVIDU_API_SECRET ?? env.OPENVIDU_SECRET)!;
  private readonly http = env.OPENVIDU_URL!.replace(/^ws/, "http");
  private rooms = new RoomServiceClient(this.http, this.key, this.secret);
  private egress = new EgressClient(this.http, this.key, this.secret);
  private receiver = new WebhookReceiver(this.key, this.secret);

  clientUrl() {
    return this.http.replace(/^http/, "ws");
  }

  iceServers(): IceServer[] {
    const out: IceServer[] = [];
    if (env.OPENVIDU_STUN_SERVER) out.push({ urls: env.OPENVIDU_STUN_SERVER });
    if (env.OPENVIDU_TURN_SERVER) out.push({ urls: env.OPENVIDU_TURN_SERVER, username: env.OPENVIDU_TURN_USERNAME, credential: env.OPENVIDU_TURN_CREDENTIAL });
    return out;
  }

  async createRoom(room: string, opts: { maxParticipants: number; emptyTimeoutSeconds: number; metadata?: string }) {
    await withRetry("createRoom", () => this.rooms.createRoom({ name: room, maxParticipants: opts.maxParticipants, emptyTimeout: opts.emptyTimeoutSeconds, departureTimeout: 120, metadata: opts.metadata }));
  }

  async deleteRoom(room: string) {
    await withRetry("deleteRoom", async () => {
      try {
        await this.rooms.deleteRoom(room);
      } catch (e) {
        if (/not found/i.test(e instanceof Error ? e.message : "")) return; // already gone
        throw e;
      }
    });
  }

  async listParticipants(room: string): Promise<ProviderParticipant[]> {
    const list = await withRetry("listParticipants", () => this.rooms.listParticipants(room));
    return list.map((p) => {
      const audio = p.tracks.find((t) => t.type === TrackType.AUDIO);
      const video = p.tracks.find((t) => t.type === TrackType.VIDEO && t.source === TrackSource.CAMERA);
      return { sid: p.sid, identity: p.identity, name: p.name, joinedAt: p.joinedAt ? new Date(Number(p.joinedAt) * 1000) : null, audioMuted: audio ? audio.muted : null, videoMuted: video ? video.muted : null };
    });
  }

  async removeParticipant(room: string, identity: string) {
    await withRetry("removeParticipant", async () => {
      try {
        await this.rooms.removeParticipant(room, identity);
      } catch (e) {
        if (/not found/i.test(e instanceof Error ? e.message : "")) return;
        throw e;
      }
    });
  }

  async muteParticipant(room: string, identity: string, kind: "audio" | "video" | "all") {
    const p = await withRetry("getParticipant", () => this.rooms.getParticipant(room, identity));
    let n = 0;
    for (const t of p.tracks) {
      const isAudio = t.type === TrackType.AUDIO;
      const isCamera = t.type === TrackType.VIDEO && t.source === TrackSource.CAMERA;
      if (t.muted || !((kind !== "video" && isAudio) || (kind !== "audio" && isCamera))) continue;
      await withRetry("mutePublishedTrack", () => this.rooms.mutePublishedTrack(room, identity, t.sid, true));
      n++;
    }
    return n;
  }

  async setPermissions(room: string, identity: string, p: { canPublish: boolean; canPublishScreen: boolean; canPublishData: boolean }, metadata?: string) {
    const sources = p.canPublish ? [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(p.canPublishScreen ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [])] : [];
    await withRetry("updateParticipant", () => this.rooms.updateParticipant(room, identity, { metadata, permission: { canSubscribe: true, canPublish: p.canPublish, canPublishData: p.canPublishData, canPublishSources: sources } }));
  }

  async createJoinToken(g: JoinGrant) {
    const at = new AccessToken(this.key, this.secret, { identity: g.identity, name: g.name, metadata: g.metadata, ttl: g.ttlSeconds });
    at.addGrant({
      roomJoin: true,
      room: g.room,
      canSubscribe: true,
      canPublish: g.canPublish,
      canPublishData: g.canPublishData,
      canPublishSources: g.canPublish ? [TrackSource.CAMERA, TrackSource.MICROPHONE, ...(g.canPublishScreen ? [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] : [])] : [],
      canUpdateOwnMetadata: false,
    });
    return at.toJwt();
  }

  async startRecording(room: string, filepath: string) {
    // Written to the storage configured in OpenVidu (its S3/MinIO bucket by default).
    const file = new EncodedFileOutput({ fileType: EncodedFileType.MP4, filepath, disableManifest: true });
    const info = await withRetry("startRoomCompositeEgress", () => this.egress.startRoomCompositeEgress(room, { file }, { layout: "grid" }), 2);
    return { id: info.egressId };
  }

  async stopRecording(id: string) {
    await withRetry("stopEgress", async () => {
      try {
        await this.egress.stopEgress(id);
      } catch (e) {
        if (/not found|cannot be stopped|EGRESS_(COMPLETE|FAILED|ABORTED)/i.test(e instanceof Error ? e.message : "")) return;
        throw e;
      }
    });
  }

  async sendData(room: string, topic: string, payload: unknown, toIdentities?: string[]) {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await withRetry("sendData", () => this.rooms.sendData(room, data, DataPacket_Kind.RELIABLE, { topic, destinationIdentities: toIdentities }), 2);
  }

  async receiveWebhook(rawBody: string, authHeader: string | null): Promise<VideoEvent> {
    let e;
    try {
      e = await this.receiver.receive(rawBody, authHeader ?? undefined);
    } catch (err) {
      throw new VideoProviderError("INVALID_WEBHOOK", "Webhook signature is not valid.", err instanceof Error ? err.message : String(err));
    }
    const r = e.egressInfo;
    const f = r?.fileResults?.[0];
    return {
      id: e.id,
      type: e.event,
      at: e.createdAt ? new Date(Number(e.createdAt) * 1000) : new Date(),
      room: e.room?.name ?? r?.roomName,
      participant: e.participant ? { sid: e.participant.sid, identity: e.participant.identity, name: e.participant.name } : undefined,
      recording: r ? {
        id: r.egressId, room: r.roomName, state: EGRESS_STATE[r.status] ?? "FAILED",
        location: f?.location || undefined, filename: f?.filename || undefined,
        durationSeconds: f?.duration ? Math.round(Number(f.duration) / 1e9) : undefined, size: f?.size ?? undefined, error: r.error || undefined,
      } : undefined,
      numDropped: e.numDropped,
    };
  }

  async health() {
    const t = Date.now();
    try {
      await this.rooms.listRooms([]);
      return { ok: true, latencyMs: Date.now() - t };
    } catch (e) {
      log("warn", "openvidu.health_failed", { detail: e instanceof Error ? e.message : String(e) });
      return { ok: false, latencyMs: Date.now() - t, detail: "unreachable" };
    }
  }
}
