import "server-only";

/**
 * The video provider abstraction. The ERP talks only to this interface; OpenVidu (LiveKit protocol) is one
 * implementation (./openvidu.ts). Replacing the media infrastructure means writing another implementation,
 * not touching meetings, attendance or recordings.
 */

export interface JoinGrant {
  room: string;
  identity: string;
  name: string;
  /** Public, non-sensitive JSON the room shows about the person (role, display name) */
  metadata: string;
  canPublish: boolean;
  canPublishScreen: boolean;
  canPublishData: boolean;
  /** Room admin rights are never given to browsers; moderation goes through the ERP. */
  ttlSeconds: number;
}

export interface ProviderParticipant {
  sid: string;
  identity: string;
  name: string;
  joinedAt: Date | null;
  audioMuted: boolean | null;
  videoMuted: boolean | null;
}

export type RecordingState = "STARTING" | "ACTIVE" | "ENDING" | "COMPLETE" | "FAILED" | "ABORTED" | "LIMIT_REACHED";

/** A provider webhook, normalised. */
export interface VideoEvent {
  id: string;
  type: string;
  at: Date;
  room?: string;
  participant?: { sid: string; identity: string; name: string };
  recording?: { id: string; room: string; state: RecordingState; location?: string; filename?: string; durationSeconds?: number; size?: bigint; error?: string };
  numDropped?: number;
}

export interface IceServer { urls: string; username?: string; credential?: string }

export interface VideoConferenceProvider {
  readonly name: string;
  readonly configured: boolean;
  /** The address browsers connect to (no credentials) */
  clientUrl(): string;
  iceServers(): IceServer[];
  createRoom(room: string, opts: { maxParticipants: number; emptyTimeoutSeconds: number; metadata?: string }): Promise<void>;
  deleteRoom(room: string): Promise<void>;
  listParticipants(room: string): Promise<ProviderParticipant[]>;
  removeParticipant(room: string, identity: string): Promise<void>;
  /** Mutes published tracks; returns how many were muted. */
  muteParticipant(room: string, identity: string, kind: "audio" | "video" | "all"): Promise<number>;
  setPermissions(room: string, identity: string, p: { canPublish: boolean; canPublishScreen: boolean; canPublishData: boolean }, metadata?: string): Promise<void>;
  createJoinToken(grant: JoinGrant): Promise<string>;
  startRecording(room: string, filepath: string): Promise<{ id: string }>;
  stopRecording(id: string): Promise<void>;
  sendData(room: string, topic: string, payload: unknown, toIdentities?: string[]): Promise<void>;
  receiveWebhook(rawBody: string, authHeader: string | null): Promise<VideoEvent>;
  health(): Promise<{ ok: boolean; latencyMs?: number; detail?: string }>;
}

/** Errors from the provider carry a safe, user-facing message; the cause is only logged. */
export class VideoProviderError extends Error {
  constructor(public code: "NOT_CONFIGURED" | "UNAVAILABLE" | "REJECTED" | "INVALID_WEBHOOK", message: string, public causeDetail?: string) {
    super(message);
  }
}

/** Used when no provider is configured: everything except media works (scheduling, records, attendance). */
export class DisabledProvider implements VideoConferenceProvider {
  readonly name = "none";
  readonly configured = false;
  private notConfigured() {
    return new VideoProviderError("NOT_CONFIGURED", "Video meetings are not set up on this installation yet. Ask the IT office to connect the video service.");
  }
  clientUrl() { return ""; }
  iceServers() { return []; }
  createRoom(): Promise<void> { return Promise.reject(this.notConfigured()); }
  deleteRoom(): Promise<void> { return Promise.resolve(); }
  listParticipants(): Promise<ProviderParticipant[]> { return Promise.resolve([]); }
  removeParticipant(): Promise<void> { return Promise.resolve(); }
  muteParticipant(): Promise<number> { return Promise.resolve(0); }
  setPermissions(): Promise<void> { return Promise.resolve(); }
  createJoinToken(): Promise<string> { return Promise.reject(this.notConfigured()); }
  startRecording(): Promise<{ id: string }> { return Promise.reject(this.notConfigured()); }
  stopRecording(): Promise<void> { return Promise.resolve(); }
  sendData(): Promise<void> { return Promise.resolve(); }
  receiveWebhook(): Promise<VideoEvent> { return Promise.reject(new VideoProviderError("INVALID_WEBHOOK", "No video provider is configured.")); }
  health() { return Promise.resolve({ ok: false, detail: "not configured" }); }
}

let override: VideoConferenceProvider | null = null;
let instance: VideoConferenceProvider | null = null;

/** The configured provider (created lazily). Tests may substitute a fake with setVideoProvider. */
export async function videoProvider(): Promise<VideoConferenceProvider> {
  if (override) return override;
  if (!instance) {
    const { env } = await import("@/server/env");
    if (env.VIDEO_PROVIDER === "openvidu") {
      const { OpenViduProvider } = await import("./openvidu");
      instance = new OpenViduProvider();
    } else instance = new DisabledProvider();
  }
  return instance;
}

export function setVideoProvider(p: VideoConferenceProvider | null) {
  override = p;
}
