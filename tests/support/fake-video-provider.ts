import type { IceServer, JoinGrant, ProviderParticipant, VideoConferenceProvider, VideoEvent } from "@/server/video/provider";
import { VideoProviderError } from "@/server/video/provider";

/**
 * In-memory stand-in for OpenVidu used by the integration tests: records calls, issues inspectable tokens,
 * and accepts webhooks signed with "Bearer test-signature".
 */
export class FakeVideoProvider implements VideoConferenceProvider {
  readonly name = "fake";
  readonly configured = true;
  rooms = new Map<string, { participants: ProviderParticipant[] }>();
  calls: { op: string; args: unknown[] }[] = [];
  tokens: JoinGrant[] = [];
  down = false;
  recordingSeq = 0;

  private record(op: string, ...args: unknown[]) {
    this.calls.push({ op, args });
    if (this.down && op !== "deleteRoom") throw new VideoProviderError("UNAVAILABLE", "The video service is not responding. Please try again in a moment.", "fake outage");
  }
  clientUrl() { return "wss://video.test"; }
  iceServers(): IceServer[] { return []; }
  async createRoom(room: string) { this.record("createRoom", room); this.rooms.set(room, { participants: [] }); }
  async deleteRoom(room: string) { this.record("deleteRoom", room); this.rooms.delete(room); }
  async listParticipants(room: string) { this.record("listParticipants", room); return this.rooms.get(room)?.participants ?? []; }
  async removeParticipant(room: string, identity: string) { this.record("removeParticipant", room, identity); }
  async muteParticipant(room: string, identity: string, kind: string) { this.record("muteParticipant", room, identity, kind); return 1; }
  async setPermissions(room: string, identity: string, p: unknown) { this.record("setPermissions", room, identity, p); }
  async createJoinToken(g: JoinGrant) { this.record("createJoinToken", g.room, g.identity); this.tokens.push(g); return `fake.${Buffer.from(JSON.stringify(g)).toString("base64url")}`; }
  async startRecording(room: string, filepath: string) { this.record("startRecording", room, filepath); return { id: `EG_${++this.recordingSeq}` }; }
  async stopRecording(id: string) { this.record("stopRecording", id); }
  async sendData(room: string, topic: string, payload: unknown) { this.record("sendData", room, topic, payload); }
  async receiveWebhook(raw: string, auth: string | null): Promise<VideoEvent> {
    if (auth !== "Bearer test-signature") throw new VideoProviderError("INVALID_WEBHOOK", "Webhook signature is not valid.");
    const e = JSON.parse(raw) as VideoEvent & { at: string };
    return { ...e, at: new Date(e.at) };
  }
  async health() { return { ok: !this.down }; }
}
