"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, LocateFixed, Play, QrCode, Send, ShieldAlert, Square } from "lucide-react";
import { toast } from "sonner";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { startAttemptAction } from "@/features/lms/actions";
import {
  checkInAction, closeCheckInAction, currentQrAction, openCheckInAction, proctorEventsAction, proctorFrameAction, respondPublicSurveyAction, respondSurveyAction,
} from "@/features/teaching/actions";
import { cn } from "@/lib/utils";

// ───────────────────────── QR check-in: teacher ─────────────────────────

type Qr = { open: false } | { open: true; svg: string; url: string; count: number; registered: number; closesAt: string; refreshInMs: number };

export function CheckInPanel({ meetingId, initiallyOpen }: { meetingId: string; initiallyOpen: boolean }) {
  const { pending, run } = useRun();
  const [minutes, setMinutes] = useState(10);
  const [late, setLate] = useState(10);
  const [geo, setGeo] = useState(false);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(80);
  const [qr, setQr] = useState<Qr | null>(null);
  const [polling, setPolling] = useState(initiallyOpen);

  useEffect(() => {
    if (!polling) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await currentQrAction(meetingId);
      if (stop) return;
      if (!r.ok) { toast.error(r.error); setPolling(false); return; }
      const d = r.data as Qr;
      setQr(d);
      if (!d.open) { setPolling(false); return; }
      timer = setTimeout(tick, Math.min(Math.max(d.refreshInMs, 1000), 20_000) + 200);
    };
    tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [polling, meetingId]);

  const locate = () => {
    if (!("geolocation" in navigator)) { toast.error("This device cannot share its location."); return; }
    navigator.geolocation.getCurrentPosition((p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }), () => toast.error("Location permission was refused."), { enableHighAccuracy: true, timeout: 15_000 });
  };

  if (qr?.open) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="w-full max-w-sm rounded-xl border bg-white p-3" aria-label="Check-in QR code" dangerouslySetInnerHTML={{ __html: qr.svg }} />
        <p className="text-sm"><span className="text-2xl font-semibold tabular-nums">{qr.count}</span> of {qr.registered} checked in · closes {new Date(qr.closesAt).toLocaleTimeString()}</p>
        <p className="text-xs text-muted-foreground">The code changes every 20 seconds, so a forwarded photo stops working.</p>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => closeCheckInAction(meetingId), () => { setPolling(false); setQr({ open: false }); })}><Square /> Close check-in</Button>
      </div>
    );
  }
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      run(() => openCheckInAction(meetingId, { minutes, lateAfterMinutes: late, requireLocation: geo, latitude: pos?.lat ?? null, longitude: pos?.lng ?? null, radiusMeters: geo ? radius : null }), () => setPolling(true));
    }}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="ci-min" className="text-xs">Open for (minutes)</Label><Input id="ci-min" type="number" min={2} max={90} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /></div>
        <div className="space-y-1"><Label htmlFor="ci-late" className="text-xs">Mark late after (minutes from start)</Label><Input id="ci-late" type="number" min={0} max={90} value={late} onChange={(e) => setLate(Number(e.target.value))} /></div>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={geo} onChange={(e) => setGeo(e.target.checked)} /> Students must be in the classroom (location check)</label>
      {geo && (
        <div className="flex flex-wrap items-end gap-2">
          <Button type="button" size="sm" variant="outline" onClick={locate}><LocateFixed /> {pos ? "Location set" : "Use this device's location"}</Button>
          <div className="space-y-1"><Label htmlFor="ci-rad" className="text-xs">Radius (m)</Label><Input id="ci-rad" className="w-24" type="number" min={10} max={5000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} /></div>
          {pos && <span className="text-xs text-muted-foreground">{pos.lat.toFixed(5)}, {pos.lng.toFixed(5)}</span>}
        </div>
      )}
      <Button size="sm" disabled={pending || (geo && !pos)}>{pending ? <Loader2 className="animate-spin" /> : <QrCode />} Show QR code</Button>
    </form>
  );
}

// ───────────────────────── QR check-in: student ─────────────────────────

function deviceId(): string {
  try {
    const k = "ec_device";
    const cur = localStorage.getItem(k);
    if (cur && cur.length >= 16) return cur;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(k, id);
    return id;
  } catch {
    return Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

export function CheckInClient({ windowId, token, needsLocation }: { windowId: string; token: string; needsLocation: boolean }) {
  const [state, setState] = useState<"idle" | "locating" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");
  const send = async (coords: GeolocationCoordinates | null) => {
    setState("sending");
    const r = await checkInAction(windowId, { token, deviceId: deviceId(), latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, accuracy: coords?.accuracy ?? null });
    if (!r.ok) { setState("error"); setMsg(r.error); return; }
    const d = r.data as { course: string; late: boolean };
    setState("done");
    setMsg(`You are marked ${d.late ? "late" : "present"} in ${d.course}.`);
  };
  const go = () => {
    if (!needsLocation) return send(null);
    if (!("geolocation" in navigator)) { setState("error"); setMsg("This phone cannot share its location."); return; }
    setState("locating");
    navigator.geolocation.getCurrentPosition((p) => send(p.coords), () => { setState("error"); setMsg("Allow location access to check in to this class."); }, { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 });
  };
  if (state === "done") return <p role="status" className="flex items-center gap-2 text-lg font-medium text-tone-success"><CheckCircle2 className="size-6" /> {msg}</p>;
  return (
    <div className="space-y-3">
      {state === "error" && <p role="alert" className="text-sm text-tone-danger">{msg}</p>}
      <Button size="lg" onClick={go} disabled={state === "locating" || state === "sending"}>{state === "locating" || state === "sending" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {state === "locating" ? "Getting your location…" : "Check in"}</Button>
      {needsLocation && <p className="text-xs text-muted-foreground">This class checks that you are in the classroom; your location is compared once and kept with the check-in.</p>}
    </div>
  );
}

// ───────────────────────── Proctored quizzes ─────────────────────────

export function StartProctoredQuiz({ quizId, label, mode }: { quizId: string; label: string; mode: "BASIC" | "WEBCAM" }) {
  const router = useRouter();
  const { pending, run } = useRun();
  const [agree, setAgree] = useState(false);
  return (
    <div className="space-y-3 rounded-xl border border-tone-warning/40 bg-tone-warning/5 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4" /> This quiz is proctored</p>
      <ul className="ml-5 list-disc space-y-1 text-muted-foreground">
        <li>The quiz opens in full screen. Leaving full screen, switching tabs or windows, and copying or pasting are recorded with the time.</li>
        {mode === "WEBCAM" && <li>Your webcam takes a still picture every few minutes. Pictures are seen only by your teachers, used only to review this quiz, and deleted after the retention period.</li>}
        <li>Nothing is decided automatically: your teacher reviews the record and talks to you if something needs explaining.</li>
      </ul>
      <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read this and agree to start the proctored quiz.</label>
      <Button disabled={!agree || pending} onClick={() => {
        document.documentElement.requestFullscreen?.().catch(() => undefined);
        run(() => startAttemptAction(quizId, true), () => router.refresh());
      }}>{pending ? <Loader2 className="animate-spin" /> : <Play />} {label}</Button>
    </div>
  );
}

/** Records integrity events during a proctored attempt (and webcam frames in webcam mode). */
export function ProctorGuard({ attemptId, mode, intervalMinutes }: { attemptId: string; mode: "BASIC" | "WEBCAM"; intervalMinutes: number }) {
  const queue = useRef<{ kind: string; detail?: string; at: string }[]>([]);
  const video = useRef<HTMLVideoElement>(null);
  const [cam, setCam] = useState<"off" | "on" | "denied">("off");
  const [fullscreen, setFullscreen] = useState(true);

  useEffect(() => {
    const push = (kind: string, detail?: string) => queue.current.push({ kind, detail, at: new Date().toISOString() });
    const onVis = () => push(document.hidden ? "TAB_HIDDEN" : "RESUMED");
    const onBlur = () => push("WINDOW_BLUR");
    const onFs = () => { const fs = !!document.fullscreenElement; setFullscreen(fs); if (!fs) push("FULLSCREEN_EXIT"); };
    const onCopy = () => push("COPY");
    const onPaste = () => push("PASTE");
    const onMenu = () => push("CONTEXT_MENU");
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("copy", onCopy);
    document.addEventListener("paste", onPaste);
    document.addEventListener("contextmenu", onMenu);
    const flush = setInterval(async () => {
      if (!queue.current.length) return;
      const batch = queue.current.splice(0, 50);
      const r = await proctorEventsAction(attemptId, batch);
      if (!r.ok) queue.current.unshift(...batch);
    }, 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("paste", onPaste);
      document.removeEventListener("contextmenu", onMenu);
      clearInterval(flush);
    };
  }, [attemptId]);

  useEffect(() => {
    if (mode !== "WEBCAM") return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;
    const snap = () => {
      const v = video.current;
      if (!v || !v.videoWidth) return;
      const c = document.createElement("canvas");
      c.width = 320;
      c.height = Math.round((v.videoHeight / v.videoWidth) * 320);
      c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
      c.toBlob(async (b) => {
        if (!b) return;
        const f = new FormData();
        f.set("frame", new File([b], "frame.jpg", { type: "image/jpeg" }));
        await proctorFrameAction(attemptId, f);
      }, "image/jpeg", 0.7);
    };
    navigator.mediaDevices?.getUserMedia({ video: { width: 640 }, audio: false })
      .then((s) => {
        stream = s;
        if (video.current) { video.current.srcObject = s; void video.current.play(); }
        setCam("on");
        setTimeout(snap, 5000);
        timer = setInterval(snap, intervalMinutes * 60_000);
      })
      .catch(() => { setCam("denied"); queue.current.push({ kind: "WEBCAM_DENIED", at: new Date().toISOString() }); });
    return () => { clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [attemptId, mode, intervalMinutes]);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
      <ShieldAlert className="size-4 text-tone-warning" aria-hidden /> Proctored quiz
      {!fullscreen && <Button size="xs" variant="outline" onClick={() => document.documentElement.requestFullscreen?.().catch(() => undefined)}>Return to full screen</Button>}
      {mode === "WEBCAM" && (
        <span className="flex items-center gap-2">
          <Camera className="size-4" aria-hidden /> {cam === "on" ? "Webcam on" : cam === "denied" ? "Webcam blocked — allow it in the browser" : "Starting webcam…"}
          <video ref={video} muted playsInline className={cn("h-12 w-16 rounded bg-black object-cover", cam !== "on" && "hidden")} aria-label="Your webcam" />
        </span>
      )}
    </div>
  );
}

// ───────────────────────── Surveys ─────────────────────────

type Q = { id: string; type: "LIKERT" | "CHOICE" | "TEXT"; text: string; options?: string[] };
const LIKERT = ["Strongly disagree", "Disagree", "Neutral", "Agree", "Strongly agree"];

export function SurveyForm({ surveyId, questions, publicToken }: { surveyId: string; questions: Q[]; publicToken?: string }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, number | string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const submit = async () => {
    setBusy(true);
    let r;
    if (publicToken) {
      let id = "";
      try { id = localStorage.getItem("ec_survey_browser") ?? ""; if (!id) { id = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("ec_survey_browser", id); } } catch { id = crypto.randomUUID().replace(/-/g, ""); }
      r = await respondPublicSurveyAction(publicToken, id, v);
    } else r = await respondSurveyAction(surveyId, v);
    setBusy(false);
    if (!r.ok) { toast.error(r.error); return; }
    toast.success(r.message ?? "Thank you");
    setDone(true);
    router.refresh();
  };
  if (done) return <p role="status" className="flex items-center gap-2 text-tone-success"><CheckCircle2 className="size-5" /> Thank you — your answers were recorded.</p>;
  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      {questions.map((q, i) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="text-sm font-medium">{i + 1}. {q.text}</legend>
          {q.type === "LIKERT" && (
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.text}>
              {LIKERT.map((l, k) => (
                <label key={l} className={cn("flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", v[q.id] === k + 1 && "border-primary bg-primary/5")}>
                  <input type="radio" name={q.id} className="size-3.5 accent-[var(--primary)]" checked={v[q.id] === k + 1} onChange={() => setV({ ...v, [q.id]: k + 1 })} /> {l}
                </label>
              ))}
            </div>
          )}
          {q.type === "CHOICE" && (
            <div className="flex flex-wrap gap-2">
              {(q.options ?? []).map((o) => <label key={o} className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm", v[q.id] === o && "border-primary bg-primary/5")}><input type="radio" name={q.id} className="size-3.5 accent-[var(--primary)]" checked={v[q.id] === o} onChange={() => setV({ ...v, [q.id]: o })} /> {o}</label>)}
            </div>
          )}
          {q.type === "TEXT" && <Textarea aria-label={q.text} rows={3} maxLength={2000} value={String(v[q.id] ?? "")} onChange={(e) => setV({ ...v, [q.id]: e.target.value })} />}
        </fieldset>
      ))}
      <Button disabled={busy || !Object.keys(v).length}>{busy ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>
    </form>
  );
}

// ───────────────────────── LTI launch ─────────────────────────

/** Posts the OIDC login initiation to the tool as soon as the page loads. */
export function LtiAutoPost({ action, params }: { action: string; params: Record<string, string> }) {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { ref.current?.submit(); }, []);
  return (
    <form ref={ref} method="post" action={action} className="space-y-3">
      {Object.entries(params).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />)}
      <p className="text-sm text-muted-foreground">Opening the tool…</p>
      <Button size="sm" variant="outline">Continue</Button>
    </form>
  );
}
