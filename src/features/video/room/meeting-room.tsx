"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  ConnectionQuality, createLocalVideoTrack, DisconnectReason, type LocalVideoTrack, type Participant, Room, RoomEvent, supportsAudioOutputSelection, Track, type TrackPublication,
} from "livekit-client";
import {
  Circle, Hand, Info, LayoutGrid, Loader2, LogOut, Maximize, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal, PhoneOff, Pin, Send, Settings2, Smile, Users, Video, VideoOff, Wifi, WifiOff, X,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/components/i18n";
import { qualityLabel } from "@/lib/domain/video";
import { cn } from "@/lib/utils";
import { type JoinResponse, videoApi } from "./client-api";

/**
 * The meeting room. Media runs on OpenVidu (LiveKit client SDK); everything that changes the meeting —
 * joining, chat, host controls, recording, ending — goes through the ERP API, which authorises each call.
 */

export interface RoomMeeting { id: string; publicId: string; title: string; typeLabel: string; scheduledEnd: string; logo: string }
interface ChatLine { id: string; sender: string; senderId: string | null; message: string; at: string }
interface ErpParticipant { id: string; name: string; role: string; panelRole: string | null; isGuest: boolean; status: string; online: boolean; audioMuted: boolean | null; videoMuted: boolean | null; seconds: number | null }

const REACTIONS = ["👍", "👏", "😀", "🎉", "❓"];
const meta = (p: Participant): { role?: string; panelRole?: string | null; participantId?: string } => { try { return JSON.parse(p.metadata || "{}"); } catch { return {}; } };
const ROLE_LABEL: Record<string, string> = { HOST: "Host", CO_HOST: "Co-host", PRESENTER: "Presenter", MODERATOR: "Moderator", PARTICIPANT: "", OBSERVER: "Observer" };

type Phase = { kind: "prejoin" } | { kind: "joining" } | { kind: "waiting"; startsAt: string } | { kind: "lobby" } | { kind: "live"; join: Extract<JoinResponse, { status: "ready" }> } | { kind: "ended"; message: string; canRejoin: boolean } | { kind: "error"; message: string };

export function MeetingRoom({ meeting, joinPath, joinBody, guest = false, exitHref }: { meeting: RoomMeeting; joinPath: string; joinBody?: unknown; guest?: boolean; exitHref: string }) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: "prejoin" });
  const [prefs, setPrefs] = useState({ mic: true, cam: true, micId: "", camId: "" });
  const roomRef = useRef<Room | null>(null);

  const join = useCallback(async () => {
    setPhase({ kind: "joining" });
    try {
      const r = await videoApi<JoinResponse>(joinPath, "POST", joinBody);
      if (r.status === "ready") setPhase({ kind: "live", join: r });
      else if (r.status === "lobby") setPhase({ kind: "lobby" });
      else setPhase({ kind: "waiting", startsAt: r.startsAt });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : t("Unable to join right now. Please try again.") });
    }
  }, [joinPath, joinBody, t]);

  // Waiting room and lobby: ask again every few seconds until the host starts or admits.
  useEffect(() => {
    if (phase.kind !== "waiting" && phase.kind !== "lobby") return;
    const id = setInterval(() => void join(), 5000);
    return () => clearInterval(id);
  }, [phase.kind, join]);

  if (phase.kind === "prejoin") return <PreJoin meeting={meeting} prefs={prefs} onPrefs={setPrefs} onJoin={join} exitHref={exitHref} />;
  if (phase.kind === "joining") return <Center><Loader2 className="size-6 animate-spin text-white/70" aria-hidden /><p className="mt-3 text-white/70">{t("Connecting…")}</p></Center>;
  if (phase.kind === "waiting") return <Center><Circle className="size-8 animate-pulse text-white/40" aria-hidden /><h1 className="mt-4 text-xl font-semibold text-white">{t("Waiting for the host to start")}</h1><p className="mt-2 text-white/60">{meeting.title} · {t("Scheduled for")} {new Date(phase.startsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p><p className="mt-1 text-sm text-white/40">{t("You will join automatically.")}</p><ExitLink href={exitHref} /></Center>;
  if (phase.kind === "lobby") return <Center><Users className="size-8 text-white/50" aria-hidden /><h1 className="mt-4 text-xl font-semibold text-white">{t("You are in the lobby")}</h1><p className="mt-2 text-white/60">{t("The host will let you in shortly.")}</p><ExitLink href={exitHref} /></Center>;
  if (phase.kind === "ended" || phase.kind === "error") {
    return (
      <Center>
        <h1 className="text-xl font-semibold text-white" role="status">{phase.message}</h1>
        <div className="mt-6 flex gap-3">
          {phase.kind === "ended" && phase.canRejoin && <button className="h-11 rounded-full bg-[#3b5bdb] px-5 text-sm font-semibold text-white hover:bg-[#3451c7] focus-visible:outline-2 focus-visible:outline-white" onClick={() => setPhase({ kind: "prejoin" })}>{t("Rejoin")}</button>}
          {phase.kind === "error" && <button className="h-11 rounded-full bg-[#3b5bdb] px-5 text-sm font-semibold text-white hover:bg-[#3451c7] focus-visible:outline-2 focus-visible:outline-white" onClick={() => void join()}>{t("Try again")}</button>}
          <a className="grid h-11 place-items-center rounded-full bg-white/10 px-5 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white" href={exitHref}>{t("Back to meetings")}</a>
        </div>
      </Center>
    );
  }
  return <LiveRoom key={phase.join.token} roomRef={roomRef} meeting={meeting} join={phase.join} prefs={prefs} guest={guest} onEnd={(message, canRejoin) => setPhase({ kind: "ended", message, canRejoin })} />;
}

function Center({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center bg-[#0b0c10] px-6 text-center">{children}</main>;
}
function ExitLink({ href }: { href: string }) {
  const t = useT();
  return <a href={href} className="mt-8 text-sm text-white/60 underline-offset-4 hover:text-white hover:underline">{t("Leave")}</a>;
}

// ───────────────────────── Pre-join ─────────────────────────

function PreJoin({ meeting, prefs, onPrefs, onJoin, exitHref }: { meeting: RoomMeeting; prefs: { mic: boolean; cam: boolean; micId: string; camId: string }; onPrefs: (p: typeof prefs) => void; onJoin: () => void; exitHref: string }) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const [track, setTrack] = useState<LocalVideoTrack | null>(null);
  const [devices, setDevices] = useState<{ cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] }>({ cams: [], mics: [] });
  const [camError, setCamError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let local: LocalVideoTrack | null = null;
    if (prefs.cam) {
      createLocalVideoTrack(prefs.camId ? { deviceId: prefs.camId } : undefined)
        .then((tr) => { if (!alive) { tr.stop(); return; } local = tr; setTrack(tr); setCamError(null); })
        .catch(() => alive && setCamError(t("Camera not available. You can still join with audio.")));
    }
    Room.getLocalDevices("videoinput", false).then((cams) => Room.getLocalDevices("audioinput", false).then((mics) => alive && setDevices({ cams, mics }))).catch(() => undefined);
    return () => { alive = false; local?.stop(); setTrack(null); };
  }, [prefs.cam, prefs.camId, t]);

  useEffect(() => {
    const el = video.current;
    if (track && el) track.attach(el);
    return () => { if (track && el) track.detach(el); };
  }, [track]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0b0c10] p-4 text-white sm:p-8">
      <div className="grid w-full max-w-5xl items-center gap-8 lg:grid-cols-[1.4fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-[#15171d]">
          {prefs.cam && track ? <video ref={video} className="size-full -scale-x-100 object-cover" muted playsInline autoPlay aria-label={t("Your camera preview")} />
            : <div className="grid size-full place-items-center text-white/50"><VideoOff className="size-8" aria-hidden /><span className="sr-only">{t("Camera off")}</span></div>}
          {camError && <p className="absolute inset-x-0 bottom-0 bg-black/60 p-2 text-center text-sm text-amber-200">{camError}</p>}
          <div className="absolute inset-x-0 bottom-4 flex justify-center gap-3">
            <RoundButton label={prefs.mic ? t("Turn off microphone") : t("Turn on microphone")} active={prefs.mic} onClick={() => onPrefs({ ...prefs, mic: !prefs.mic })} icon={prefs.mic ? Mic : MicOff} danger={!prefs.mic} />
            <RoundButton label={prefs.cam ? t("Turn off camera") : t("Turn on camera")} active={prefs.cam} onClick={() => onPrefs({ ...prefs, cam: !prefs.cam })} icon={prefs.cam ? Video : VideoOff} danger={!prefs.cam} />
          </div>
        </div>
        <div>
          <p className="text-sm font-medium text-white/50">{meeting.typeLabel} · {meeting.publicId}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{meeting.title}</h1>
          <div className="mt-6 space-y-3">
            <DeviceSelect label={t("Camera")} value={prefs.camId} devices={devices.cams} onChange={(camId) => onPrefs({ ...prefs, camId })} />
            <DeviceSelect label={t("Microphone")} value={prefs.micId} devices={devices.mics} onChange={(micId) => onPrefs({ ...prefs, micId })} />
          </div>
          <button className="mt-6 h-12 w-full rounded-xl bg-[#3b5bdb] text-[15px] font-semibold text-white transition-colors hover:bg-[#3451c7] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={() => { track?.stop(); onJoin(); }}>{t("Join meeting")}</button>
          <a href={exitHref} className="mt-3 block text-center text-sm text-white/50 hover:text-white">{t("Back to meetings")}</a>
        </div>
      </div>
    </main>
  );
}

function DeviceSelect({ label, value, devices, onChange }: { label: string; value: string; devices: MediaDeviceInfo[]; onChange: (v: string) => void }) {
  const id = `dev-${label.replace(/\W/g, "")}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-white/60">{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-lg border border-white/15 bg-[#15171d] px-3 text-sm text-white">
        <option value="">{devices.length ? "Default" : "—"}</option>
        {devices.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || `${label} ${devices.indexOf(d) + 1}`}</option>)}
      </select>
    </div>
  );
}

// ───────────────────────── Live room ─────────────────────────

function LiveRoom({ roomRef, meeting, join, prefs, guest, onEnd }: { roomRef: React.RefObject<Room | null>; meeting: RoomMeeting; join: Extract<JoinResponse, { status: "ready" }>; prefs: { mic: boolean; cam: boolean; micId: string; camId: string }; guest: boolean; onEnd: (message: string, canRejoin: boolean) => void }) {
  const t = useT();
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), []);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const [panel, setPanel] = useState<"chat" | "people" | "info" | null>(null);
  const [view, setView] = useState<"grid" | "speaker">("grid");
  const [pinned, setPinned] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [hands, setHands] = useState<Set<string>>(new Set());
  const [reactions, setReactions] = useState<{ id: number; emoji: string; name: string }[]>([]);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const [unread, setUnread] = useState(0);
  const [people, setPeople] = useState<ErpParticipant[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef(panel);
  useEffect(() => { panelRef.current = panel; }, [panel]);

  const loadPeople = useCallback(async () => {
    if (guest) return;
    try { setPeople((await videoApi<{ participants: ErpParticipant[] }>(`/api/video/meetings/${meeting.id}/participants`)).participants); } catch { /* not critical */ }
  }, [guest, meeting.id]);

  useEffect(() => {
    roomRef.current = room;
    const on = <E extends RoomEvent>(e: E, fn: (...a: never[]) => void) => { room.on(e, fn as never); return () => { room.off(e, fn as never); }; };
    const offs = [
      RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged, RoomEvent.ConnectionQualityChanged, RoomEvent.ParticipantMetadataChanged, RoomEvent.ParticipantPermissionsChanged,
    ].map((e) => on(e, () => bump()));
    offs.push(on(RoomEvent.ParticipantConnected, ((p: Participant) => { toast(`${p.name || t("Someone")} ${t("joined the meeting.")}`, { duration: 2500 }); void loadPeople(); }) as never));
    offs.push(on(RoomEvent.ParticipantDisconnected, ((p: Participant) => { setHands((h) => { const n = new Set(h); n.delete(p.identity); return n; }); void loadPeople(); }) as never));
    offs.push(on(RoomEvent.RecordingStatusChanged, ((r: boolean) => { setRecording(r); toast(r ? t("Recording started.") : t("Recording stopped."), { duration: 3000 }); }) as never));
    offs.push(on(RoomEvent.Reconnecting, (() => { setReconnecting(true); toast.warning(t("Your connection appears unstable."), { id: "net" }); }) as never));
    offs.push(on(RoomEvent.Reconnected, (() => { setReconnecting(false); toast.success(t("Reconnected."), { id: "net", duration: 2000 }); }) as never));
    offs.push(on(RoomEvent.Disconnected, ((reason?: DisconnectReason) => {
      const msg = reason === DisconnectReason.PARTICIPANT_REMOVED ? t("You were removed from the meeting.")
        : reason === DisconnectReason.ROOM_DELETED ? t("Your meeting has ended.")
        : reason === DisconnectReason.DUPLICATE_IDENTITY ? t("You joined this meeting from another device or tab.")
        : reason === DisconnectReason.CLIENT_INITIATED ? t("You left the meeting.") : t("You were disconnected.");
      onEnd(msg, reason !== DisconnectReason.PARTICIPANT_REMOVED && reason !== DisconnectReason.ROOM_DELETED);
    }) as never));
    offs.push(on(RoomEvent.DataReceived, ((payload: Uint8Array, participant?: Participant, _k?: unknown, topic?: string) => {
      let d: Record<string, unknown>;
      try { d = JSON.parse(new TextDecoder().decode(payload)); } catch { return; }
      if (topic === "chat" && !participant) {
        setChat((c) => (c.some((x) => x.id === d.id) ? c : [...c, d as unknown as ChatLine]));
        if (panelRef.current !== "chat") setUnread((n) => n + 1);
      } else if (topic === "chat-delete" && !participant) setChat((c) => c.filter((x) => x.id !== d.id));
      else if (topic === "lobby" && !participant) { toast(`${String(d.name)} ${t("is waiting in the lobby.")}`, { action: { label: t("Review"), onClick: () => setPanel("people") } }); void loadPeople(); }
      else if (topic === "signal" && participant) {
        if (d.type === "hand") {
          setHands((h) => { const n = new Set(h); if (d.up) n.add(participant.identity); else n.delete(participant.identity); return n; });
          if (d.up) toast(`${participant.name} ${t("raised their hand.")}`, { duration: 3000 });
        } else if (d.type === "react" && typeof d.emoji === "string" && REACTIONS.includes(d.emoji)) {
          const id = Date.now() + Math.random();
          setReactions((r) => [...r, { id, emoji: d.emoji as string, name: participant.name || "" }]);
          setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 3500);
        }
      }
    }) as never));

    let cancelled = false;
    room.connect(join.serverUrl, join.token, { rtcConfig: join.iceServers.length ? { iceServers: join.iceServers } : undefined })
      .then(async () => {
        if (cancelled) return;
        setRecording(room.isRecording);
        if (join.canPublish) {
          await room.localParticipant.setMicrophoneEnabled(prefs.mic, prefs.micId ? { deviceId: prefs.micId } : undefined).catch(() => toast.error(t("Microphone not available.")));
          await room.localParticipant.setCameraEnabled(prefs.cam, prefs.camId ? { deviceId: prefs.camId } : undefined).catch(() => toast.error(t("Camera not available.")));
        }
        bump();
        void loadPeople();
        if (join.chatEnabled && !guest) videoApi<ChatLine[]>(`/api/video/meetings/${meeting.id}/chat`).then(setChat).catch(() => undefined);
      })
      .catch(() => onEnd(t("Unable to connect to the meeting. Please try again."), true));
    return () => { cancelled = true; offs.forEach((o) => o()); void room.disconnect(); };
  }, [room, join, prefs, meeting.id, guest, onEnd, loadPeople, roomRef, t]);

  useEffect(() => { const id = setInterval(() => setElapsed((e) => e + 1), 1000); return () => clearInterval(id); }, []);
  useEffect(() => {
    if (panel !== "people" || guest) return;
    const first = setTimeout(() => void loadPeople(), 0);
    const id = setInterval(() => void loadPeople(), 8000);
    return () => { clearTimeout(first); clearInterval(id); };
  }, [panel, guest, loadPeople]);

  const lp = room.localParticipant;
  const canPublish = join.canPublish || !!lp.permissions?.canPublish;
  const canScreen = join.canPublishScreen || !!lp.permissions?.canPublishSources?.includes(3);
  const all: Participant[] = [lp, ...room.remoteParticipants.values()];
  const screens = all.map((p) => ({ p, pub: p.getTrackPublication(Track.Source.ScreenShare) })).filter((x) => x.pub?.track && !x.pub.isMuted);
  const speaker = (pinned && all.find((p) => p.identity === pinned)) || room.activeSpeakers[0] || all.find((p) => p !== lp) || lp;
  const quality = qualityLabel(lp.connectionQuality, reconnecting);
  const handUp = hands.has(lp.identity);

  const send = (data: unknown) => lp.publishData(new TextEncoder().encode(JSON.stringify(data)), { reliable: true, topic: "signal" }).catch(() => undefined);
  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try { await fn(); if (ok) toast.success(ok, { duration: 2000 }); } catch (e) { toast.error(e instanceof Error ? e.message : t("Something went wrong.")); } finally { setBusy(false); bump(); }
  };

  return (
    <div className="flex h-dvh flex-col bg-[#0b0c10] text-white">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3 sm:px-5">
        <span aria-hidden className="grid size-8 place-items-center rounded-lg border border-white/10 bg-white/5 text-[11px] font-semibold text-white/80">{meeting.logo}</span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold">{meeting.title}</h1>
          <p className="text-xs text-white/50 tabular-nums">{fmtElapsed(elapsed)} · {meeting.publicId}</p>
        </div>
        {recording && <span className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-300" role="status"><span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden />{t("Recording in progress")}</span>}
        <span className={cn("hidden items-center gap-1.5 text-xs sm:flex", quality === "Poor" || quality === "Reconnecting" ? "text-amber-300" : "text-white/50")} title={t("Connection quality")}>
          {quality === "Reconnecting" ? <WifiOff className="size-4" aria-hidden /> : <Wifi className="size-4" aria-hidden />} {t(quality)}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Stage */}
        <div ref={stageRef} className="relative min-w-0 flex-1 p-2 sm:p-3">
          {screens.length ? (
            <div className="grid h-full grid-rows-[1fr_auto] gap-2 lg:grid-cols-[1fr_220px] lg:grid-rows-1">
              <Tile participant={screens[0].p} publication={screens[0].pub} screen hand={false} />
              <div className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-y-auto">
                {all.map((p) => <div key={p.identity} className="h-28 w-44 shrink-0 lg:h-32 lg:w-full"><Tile participant={p} hand={hands.has(p.identity)} small /></div>)}
              </div>
            </div>
          ) : view === "speaker" && all.length > 1 ? (
            <div className="grid h-full grid-rows-[1fr_auto] gap-2">
              <Tile participant={speaker} hand={hands.has(speaker.identity)} />
              <div className="flex gap-2 overflow-x-auto">
                {all.filter((p) => p !== speaker).map((p) => <button key={p.identity} onClick={() => setPinned(p.identity)} className="h-28 w-44 shrink-0 rounded-xl focus-visible:outline-2 focus-visible:outline-white" aria-label={`${t("Pin")} ${p.name}`}><Tile participant={p} hand={hands.has(p.identity)} small /></button>)}
              </div>
            </div>
          ) : (
            <div className="grid h-full auto-rows-fr gap-2" style={{ gridTemplateColumns: `repeat(${cols(all.length)}, minmax(0, 1fr))` }}>
              {all.map((p) => <Tile key={p.identity} participant={p} hand={hands.has(p.identity)} />)}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-6 left-6 flex flex-col gap-1" aria-live="polite">
            {reactions.map((r) => <span key={r.id} className="animate-in fade-in slide-in-from-bottom-2 rounded-full bg-black/50 px-3 py-1 text-sm">{r.emoji} <span className="text-white/70">{r.name}</span></span>)}
          </div>
          <RemoteAudio room={room} />
        </div>

        {/* Side panel */}
        {panel && (
          <aside className="absolute inset-0 z-20 flex flex-col border-l border-white/[0.06] bg-[#111318] sm:static sm:w-[340px]" aria-label={panel === "chat" ? t("Chat") : panel === "people" ? t("Participants") : t("Meeting information")}>
            <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-4">
              <h2 className="text-sm font-semibold">{panel === "chat" ? t("Chat") : panel === "people" ? `${t("Participants")} (${all.length})` : t("Meeting information")}</h2>
              <button className="grid size-9 place-items-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" onClick={() => setPanel(null)} aria-label={t("Close panel")}><X className="size-4" /></button>
            </div>
            {panel === "chat" && <ChatPanel meetingId={meeting.id} lines={chat} enabled={join.chatEnabled && !guest} moderator={join.isModerator} me={join.identity} />}
            {panel === "people" && <PeoplePanel meetingId={meeting.id} live={all} hands={hands} erp={people} moderator={join.isModerator} host={join.isHost} reload={loadPeople} busy={busy} act={act} />}
            {panel === "info" && <InfoPanel meeting={meeting} role={join.role} />}
          </aside>
        )}
      </div>

      {/* Controls */}
      <nav aria-label={t("Meeting controls")} className="flex shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/[0.06] px-2 py-3 sm:gap-3">
        <RoundButton label={lp.isMicrophoneEnabled ? t("Mute") : t("Unmute")} icon={lp.isMicrophoneEnabled ? Mic : MicOff} active={lp.isMicrophoneEnabled} danger={!lp.isMicrophoneEnabled} disabled={!canPublish} hint={!canPublish ? t("The host has not allowed you to speak.") : undefined}
          onClick={() => act(() => lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled))} />
        <RoundButton label={lp.isCameraEnabled ? t("Stop video") : t("Start video")} icon={lp.isCameraEnabled ? Video : VideoOff} active={lp.isCameraEnabled} danger={!lp.isCameraEnabled} disabled={!canPublish}
          onClick={() => act(() => lp.setCameraEnabled(!lp.isCameraEnabled))} />
        {canScreen && <RoundButton label={lp.isScreenShareEnabled ? t("Stop sharing") : t("Share screen")} icon={MonitorUp} active={lp.isScreenShareEnabled} highlight={lp.isScreenShareEnabled} onClick={() => act(() => lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true }))} />}
        <RoundButton label={handUp ? t("Lower hand") : t("Raise hand")} icon={Hand} highlight={handUp} onClick={() => { void send({ type: "hand", up: !handUp }); setHands((h) => { const n = new Set(h); if (handUp) n.delete(lp.identity); else n.add(lp.identity); return n; }); }} />
        <ReactionButton onReact={(emoji) => { void send({ type: "react", emoji }); const id = Date.now(); setReactions((r) => [...r, { id, emoji, name: t("You") }]); setTimeout(() => setReactions((r) => r.filter((x) => x.id !== id)), 3500); }} />
        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" aria-hidden />
        {join.chatEnabled && !guest && <RoundButton label={t("Chat")} icon={MessageSquare} highlight={panel === "chat"} badge={unread} onClick={() => { setPanel(panel === "chat" ? null : "chat"); setUnread(0); }} />}
        <RoundButton label={t("Participants")} icon={Users} highlight={panel === "people"} badge={join.isModerator ? people.filter((p) => p.status === "IN_LOBBY").length : 0} onClick={() => setPanel(panel === "people" ? null : "people")} />
        <MoreMenu
          view={view} setView={(v) => { setView(v); setPinned(null); }} onInfo={() => setPanel("info")} onFullscreen={() => void (document.fullscreenElement ? document.exitFullscreen() : stageRef.current?.requestFullscreen())}
          room={room} isHost={join.isHost} recording={recording}
          onRecord={() => act(() => videoApi(`/api/video/meetings/${meeting.id}/recordings${recording ? "/stop" : ""}`, "POST"), recording ? t("Stopping the recording…") : t("Starting the recording…"))}
        />
        <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" aria-hidden />
        <button onClick={() => void room.disconnect()} className="flex h-12 items-center gap-2 rounded-full bg-white/10 px-4 text-sm font-medium hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"><LogOut className="size-4" aria-hidden />{t("Leave")}</button>
        {join.isHost && <button disabled={busy} onClick={() => { if (confirm(t("End the meeting for everyone?"))) void act(() => videoApi(`/api/video/meetings/${meeting.id}/end`, "POST")); }} className="flex h-12 items-center gap-2 rounded-full bg-red-600 px-4 text-sm font-semibold hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50"><PhoneOff className="size-4" aria-hidden />{t("End meeting")}</button>}
      </nav>
    </div>
  );
}

const cols = (n: number) => (n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : n <= 16 ? 4 : 5);
const fmtElapsed = (s: number) => `${Math.floor(s / 3600) ? `${Math.floor(s / 3600)}:` : ""}${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// ───────────────────────── Tiles and audio ─────────────────────────

function Tile({ participant, publication, screen = false, hand, small = false }: { participant: Participant; publication?: TrackPublication; screen?: boolean; hand: boolean; small?: boolean }) {
  const t = useT();
  const pub = publication ?? participant.getTrackPublication(Track.Source.Camera);
  const track = pub && !pub.isMuted ? pub.track : undefined;
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!track || !el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  const m = meta(participant);
  const local = participant.isLocal;
  const q = participant.connectionQuality;
  return (
    <div className={cn("relative size-full overflow-hidden rounded-xl bg-[#171920] ring-1 ring-white/[0.06]", participant.isSpeaking && !screen && "ring-2 ring-[#5b7cfa]")}>
      {track ? <video ref={ref} className={cn("size-full", screen ? "object-contain" : "object-cover", local && !screen && "-scale-x-100")} autoPlay playsInline muted />
        : <div className="grid size-full place-items-center"><span className={cn("grid place-items-center rounded-full bg-white/10 font-semibold text-white/80", small ? "size-10 text-sm" : "size-20 text-2xl")}>{initials(participant.name || participant.identity)}</span></div>}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2.5 pt-6 pb-2 text-xs">
        {!participant.isMicrophoneEnabled && <MicOff className="size-3.5 text-red-300" aria-label={t("Muted")} />}
        <span className="truncate font-medium">{participant.name || t("Guest")}{local ? ` (${t("You")})` : ""}{screen ? ` — ${t("screen")}` : ""}</span>
        {m.role && ROLE_LABEL[m.role] && <span className="rounded bg-white/15 px-1.5 py-px text-[10px]">{t(ROLE_LABEL[m.role])}</span>}
        {(q === ConnectionQuality.Poor || q === ConnectionQuality.Lost) && <WifiOff className="ml-auto size-3.5 text-amber-300" aria-label={t("Weak connection")} />}
      </div>
      {hand && <span className="absolute top-2 left-2 grid size-8 place-items-center rounded-full bg-amber-400 text-black" aria-label={t("Hand raised")}><Hand className="size-4" /></span>}
    </div>
  );
}

function RemoteAudio({ room }: { room: Room }) {
  const tracks = [...room.remoteParticipants.values()].flatMap((p) => [p.getTrackPublication(Track.Source.Microphone), p.getTrackPublication(Track.Source.ScreenShareAudio)]).filter((pub) => !!pub?.track) as TrackPublication[];
  return <div className="hidden">{tracks.map((pub) => <AudioEl key={pub.trackSid} pub={pub} />)}</div>;
}
function AudioEl({ pub }: { pub: TrackPublication }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    const tr = pub.track;
    if (!el || !tr) return;
    tr.attach(el);
    return () => { tr.detach(el); };
  }, [pub.track]);
  return <audio ref={ref} autoPlay />;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

// ───────────────────────── Controls ─────────────────────────

function RoundButton({ label, icon: Icon, onClick, active, danger, highlight, disabled, badge, hint }: { label: string; icon: typeof Mic; onClick: () => void; active?: boolean; danger?: boolean; highlight?: boolean; disabled?: boolean; badge?: number; hint?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active ?? highlight} aria-label={label} title={hint ?? label}
      className={cn("relative grid size-12 place-items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-not-allowed disabled:opacity-40",
        danger ? "bg-red-500/90 text-white hover:bg-red-500" : highlight ? "bg-[#3b5bdb] text-white hover:bg-[#3451c7]" : "bg-white/10 text-white hover:bg-white/15")}>
      <Icon className="size-5" aria-hidden />
      {!!badge && <span className="absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-full bg-[#5b7cfa] px-1 text-[11px] font-semibold">{badge}</span>}
    </button>
  );
}

function ReactionButton({ onReact }: { onReact: (emoji: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <RoundButton label={t("Reactions")} icon={Smile} highlight={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="absolute bottom-14 left-1/2 flex -translate-x-1/2 gap-1 rounded-full border border-white/10 bg-[#1a1d24] p-1.5 shadow-xl" role="menu">
          {REACTIONS.map((e) => <button key={e} role="menuitem" className="grid size-10 place-items-center rounded-full text-xl hover:bg-white/10" onClick={() => { onReact(e); setOpen(false); }} aria-label={`${t("React")} ${e}`}>{e}</button>)}
        </div>
      )}
    </div>
  );
}

function MoreMenu({ view, setView, onInfo, onFullscreen, room, isHost, recording, onRecord }: { view: "grid" | "speaker"; setView: (v: "grid" | "speaker") => void; onInfo: () => void; onFullscreen: () => void; room: Room; isHost: boolean; recording: boolean; onRecord: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<{ speakers: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; mics: MediaDeviceInfo[] } | null>(null);
  const loadDevices = async () => setDevices({ speakers: supportsAudioOutputSelection() ? await Room.getLocalDevices("audiooutput") : [], cams: await Room.getLocalDevices("videoinput"), mics: await Room.getLocalDevices("audioinput") });
  const item = "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none";
  return (
    <div className="relative">
      <RoundButton label={t("More options")} icon={MoreHorizontal} highlight={open} onClick={() => setOpen(!open)} />
      {open && (
        <div className="absolute right-0 bottom-14 z-30 w-72 rounded-xl border border-white/10 bg-[#1a1d24] p-1.5 shadow-2xl" role="menu">
          <button role="menuitem" className={item} onClick={() => { setView(view === "grid" ? "speaker" : "grid"); setOpen(false); }}>{view === "grid" ? <Pin className="size-4" /> : <LayoutGrid className="size-4" />}{view === "grid" ? t("Speaker view") : t("Grid view")}</button>
          <button role="menuitem" className={item} onClick={() => { onFullscreen(); setOpen(false); }}><Maximize className="size-4" />{t("Full screen")}</button>
          {isHost && <button role="menuitem" className={item} onClick={() => { onRecord(); setOpen(false); }}><Circle className={cn("size-4", recording ? "fill-red-500 text-red-500" : "")} />{recording ? t("Stop recording") : t("Start recording")}</button>}
          <button role="menuitem" className={item} onClick={() => void loadDevices()}><Settings2 className="size-4" />{t("Audio and video settings")}</button>
          {devices && (
            <div className="space-y-2 border-t border-white/10 p-2">
              {(["videoinput", "audioinput", "audiooutput"] as const).map((kind) => {
                const list = kind === "videoinput" ? devices.cams : kind === "audioinput" ? devices.mics : devices.speakers;
                if (!list.length) return null;
                return (
                  <label key={kind} className="block text-xs text-white/60">{kind === "videoinput" ? t("Camera") : kind === "audioinput" ? t("Microphone") : t("Speaker")}
                    <select className="mt-1 h-10 w-full rounded-md border border-white/15 bg-[#111318] px-2 text-sm text-white" defaultValue={room.getActiveDevice(kind) ?? ""} onChange={(e) => void room.switchActiveDevice(kind, e.target.value)}>
                      {list.map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || kind}</option>)}
                    </select>
                  </label>
                );
              })}
            </div>
          )}
          <button role="menuitem" className={item} onClick={() => { onInfo(); setOpen(false); }}><Info className="size-4" />{t("Meeting information")}</button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Panels ─────────────────────────

function ChatPanel({ meetingId, lines, enabled, moderator, me }: { meetingId: string; lines: ChatLine[]; enabled: boolean; moderator: boolean; me: string }) {
  const t = useT();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines.length]);
  const myId = me.replace(/^u_/, "");
  return (
    <>
      <div className="flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite">
        {!lines.length && <p className="text-center text-sm text-white/40">{t("No messages yet.")}</p>}
        {lines.map((l) => (
          <div key={l.id} className="group">
            <div className="flex items-baseline gap-2 text-xs"><span className="font-semibold text-white/90">{l.senderId === myId ? t("You") : l.sender}</span><span className="text-white/40">{new Date(l.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              {moderator && <button className="ml-auto text-white/30 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-300" onClick={() => void videoApi(`/api/video/meetings/${meetingId}/chat/${l.id}`, "DELETE").catch((e) => toast.error(e.message))} aria-label={t("Remove message")}><X className="size-3.5" /></button>}
            </div>
            <p className="mt-0.5 text-sm break-words whitespace-pre-wrap text-white/80">{l.message}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
      {enabled ? (
        <form className="flex gap-2 border-t border-white/[0.06] p-3" onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          setSending(true);
          videoApi(`/api/video/meetings/${meetingId}/chat`, "POST", { message: text }).then(() => setText("")).catch((err) => toast.error(err.message)).finally(() => setSending(false));
        }}>
          <label htmlFor="chat-input" className="sr-only">{t("Message")}</label>
          <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={t("Send a message")} className="h-11 min-w-0 flex-1 rounded-lg border border-white/15 bg-[#0b0c10] px-3 text-sm text-white placeholder:text-white/30 focus:border-[#5b7cfa] focus:outline-none" />
          <button disabled={sending || !text.trim()} className="grid size-11 place-items-center rounded-lg bg-[#3b5bdb] disabled:opacity-40" aria-label={t("Send")}><Send className="size-4" /></button>
        </form>
      ) : <p className="border-t border-white/[0.06] p-3 text-center text-xs text-white/40">{t("Chat is switched off for this meeting.")}</p>}
    </>
  );
}

function PeoplePanel({ meetingId, live, hands, erp, moderator, host, reload, busy, act }: { meetingId: string; live: Participant[]; hands: Set<string>; erp: ErpParticipant[]; moderator: boolean; host: boolean; reload: () => Promise<void>; busy: boolean; act: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const t = useT();
  const lobby = erp.filter((p) => p.status === "IN_LOBBY");
  const byPid = new Map(erp.map((p) => [p.id, p]));
  const patch = (pid: string, body: unknown, ok: string) => act(async () => { await videoApi(`/api/video/meetings/${meetingId}/participants/${pid}`, "PATCH", body); await reload(); }, ok);
  return (
    <div className="flex-1 overflow-y-auto p-3">
      {moderator && lobby.length > 0 && (
        <section className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3" aria-label={t("Lobby")}>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-amber-200 uppercase">{t("Waiting in the lobby")} ({lobby.length})</h3>
          {lobby.map((p) => (
            <div key={p.id} className="flex items-center gap-2 py-1.5 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <button disabled={busy} className="rounded-md bg-[#3b5bdb] px-3 py-1.5 text-xs font-medium" onClick={() => void patch(p.id, { action: "admit" }, t("Admitted."))}>{t("Admit")}</button>
              <button disabled={busy} className="rounded-md bg-white/10 px-3 py-1.5 text-xs" onClick={() => void patch(p.id, { action: "deny" }, t("Declined."))}>{t("Decline")}</button>
            </div>
          ))}
        </section>
      )}
      <ul className="space-y-1">
        {live.map((p) => {
          const m = meta(p);
          const e = m.participantId ? byPid.get(m.participantId) : undefined;
          const isHostRow = m.role === "HOST";
          return (
            <li key={p.identity} className="group flex items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-white/[0.04]">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-semibold">{initials(p.name || "?")}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{p.name}{p.isLocal ? ` (${t("You")})` : ""}</div>
                <div className="text-[11px] text-white/45">{[m.role && ROLE_LABEL[m.role] ? t(ROLE_LABEL[m.role]) : t("Participant"), m.panelRole?.toLowerCase().replace(/_/g, " "), e?.seconds != null ? `${Math.round(e.seconds / 60)} min` : null].filter(Boolean).join(" · ")}</div>
              </div>
              {hands.has(p.identity) && <Hand className="size-4 text-amber-300" aria-label={t("Hand raised")} />}
              {p.isMicrophoneEnabled ? <Mic className="size-4 text-white/50" aria-label={t("Microphone on")} /> : <MicOff className="size-4 text-red-300" aria-label={t("Muted")} />}
              {p.isCameraEnabled ? <Video className="size-4 text-white/50" aria-label={t("Camera on")} /> : <VideoOff className="size-4 text-white/30" aria-label={t("Camera off")} />}
              {moderator && !p.isLocal && !isHostRow && m.participantId && (
                <details className="relative">
                  <summary className="grid size-8 cursor-pointer list-none place-items-center rounded-md text-white/50 hover:bg-white/10 hover:text-white" aria-label={`${t("Manage")} ${p.name}`}><MoreHorizontal className="size-4" /></summary>
                  <div className="absolute right-0 z-10 mt-1 w-48 rounded-lg border border-white/10 bg-[#1a1d24] p-1 text-sm shadow-xl">
                    <button className="w-full rounded-md px-3 py-2 text-left hover:bg-white/10" onClick={() => void patch(m.participantId!, { action: "mute", kind: "audio" }, t("Muted."))}>{t("Mute")}</button>
                    {host && m.role !== "PRESENTER" && <button className="w-full rounded-md px-3 py-2 text-left hover:bg-white/10" onClick={() => void patch(m.participantId!, { action: "role", role: "PRESENTER" }, t("Now a presenter."))}>{t("Make presenter")}</button>}
                    {host && m.role !== "CO_HOST" && !e?.isGuest && <button className="w-full rounded-md px-3 py-2 text-left hover:bg-white/10" onClick={() => void patch(m.participantId!, { action: "role", role: "CO_HOST" }, t("Now a co-host."))}>{t("Make co-host")}</button>}
                    {host && m.role !== "PARTICIPANT" && <button className="w-full rounded-md px-3 py-2 text-left hover:bg-white/10" onClick={() => void patch(m.participantId!, { action: "role", role: "PARTICIPANT" }, t("Now a participant."))}>{t("Make participant")}</button>}
                    <button className="w-full rounded-md px-3 py-2 text-left text-red-300 hover:bg-red-500/10" onClick={() => { if (confirm(`${t("Remove")} ${p.name}?`)) void act(async () => { await videoApi(`/api/video/meetings/${meetingId}/participants/${m.participantId}`, "DELETE"); await reload(); }, t("Removed.")); }}>{t("Remove from meeting")}</button>
                  </div>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InfoPanel({ meeting, role }: { meeting: RoomMeeting; role: string }) {
  const t = useT();
  return (
    <dl className="space-y-4 p-4 text-sm">
      <div><dt className="text-xs text-white/45">{t("Meeting")}</dt><dd className="mt-0.5">{meeting.title}</dd></div>
      <div><dt className="text-xs text-white/45">{t("Type")}</dt><dd className="mt-0.5">{meeting.typeLabel}</dd></div>
      <div><dt className="text-xs text-white/45">{t("Meeting ID")}</dt><dd className="mt-0.5 font-mono">{meeting.publicId}</dd></div>
      <div><dt className="text-xs text-white/45">{t("Your role")}</dt><dd className="mt-0.5">{t(ROLE_LABEL[role] || "Participant")}</dd></div>
      <div><dt className="text-xs text-white/45">{t("Scheduled to end")}</dt><dd className="mt-0.5">{new Date(meeting.scheduledEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</dd></div>
      <p className="text-xs leading-relaxed text-white/45">{t("Attendance is recorded automatically from when you are connected. Only people invited or allowed by the university can join.")}</p>
    </dl>
  );
}
