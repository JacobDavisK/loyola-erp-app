"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  appealGrievanceAction, bookSlotAction, grievanceNoteAction, markEventAttendanceAction, resolveGrievanceAction, selfCheckInAction, submitUndertakingAction, subscribePushAction,
  unsubscribePushAction,
} from "@/features/campuslife/actions";

// ───────────────────────── Push notifications ─────────────────────────

const toBytes = (b64: string) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export function PushToggle({ publicKey }: { publicKey: string }) {
  const [state, setState] = useState<"unsupported" | "loading" | "on" | "off" | "blocked">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    // Browser capabilities are only known on the client; resolve them asynchronously after mount.
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    Promise.resolve()
      .then(async () => {
        if (!supported) return "unsupported" as const;
        if (Notification.permission === "denied") return "blocked" as const;
        const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
        return sub ? ("on" as const) : ("off" as const);
      })
      .then(setState)
      .catch(() => setState("off"));
  }, []);
  const on = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "blocked" : "off"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(publicKey) });
      const r = await subscribePushAction(sub.toJSON());
      if (!r.ok) { toast.error(r.error); await sub.unsubscribe(); return; }
      toast.success(r.message ?? "On");
      setState("on");
    } catch {
      toast.error("This browser could not turn on notifications.");
    } finally {
      setBusy(false);
    }
  };
  const off = async () => {
    setBusy(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await unsubscribePushAction(sub.endpoint); await sub.unsubscribe(); }
    setState("off");
    setBusy(false);
  };
  if (state === "unsupported") return <p className="text-sm text-muted-foreground">This browser does not support notifications. On an iPhone, add the site to your home screen first.</p>;
  if (state === "blocked") return <p className="text-sm text-tone-warning">Notifications are blocked for this site in the browser settings.</p>;
  if (state === "loading") return <Loader2 className="size-4 animate-spin" />;
  return state === "on"
    ? <Button size="sm" variant="outline" disabled={busy} onClick={off}><BellOff /> Turn off on this device</Button>
    : <Button size="sm" disabled={busy} onClick={on}>{busy ? <Loader2 className="animate-spin" /> : <Bell />} Turn on notifications on this device</Button>;
}

// ───────────────────────── Counselling ─────────────────────────

export function BookSlot({ slotId }: { slotId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  if (!open) return <Button size="xs" onClick={() => setOpen(true)}>Book</Button>;
  return (
    <div className="space-y-2">
      <Textarea aria-label="What would you like to talk about? (optional)" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional: what you would like to talk about. Only the counsellor sees this." />
      <div className="flex gap-2">
        <Button size="xs" disabled={pending} onClick={() => run(() => bookSlotAction(slotId, { reason: reason || null }))}>{pending && <Loader2 className="animate-spin" />} Confirm booking</Button>
        <Button size="xs" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

// ───────────────────────── Grievances ─────────────────────────

export function GrievanceControls({ id, handler, own, status, canAppeal }: { id: string; handler: boolean; own: boolean; status: string; canAppeal: boolean }) {
  const { pending, run } = useRun();
  const [text, setText] = useState("");
  if (status === "CLOSED") return null;
  return (
    <div className="space-y-2">
      <Textarea aria-label="Text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={handler && !own ? "Note to the complainant, or the committee's decision and reasons" : status === "RESOLVED" ? "If you are not satisfied, explain why you are appealing" : "Add information"} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={pending || text.trim().length < 3} onClick={() => run(() => grievanceNoteAction(id, text), () => setText(""))}><Send /> Add note</Button>
        {handler && !own && status !== "RESOLVED" && <Button size="sm" disabled={pending || text.trim().length < 20} onClick={() => run(() => resolveGrievanceAction(id, text), () => setText(""))}><CheckCircle2 /> Record decision</Button>}
        {own && canAppeal && <Button size="sm" disabled={pending || text.trim().length < 20} onClick={() => run(() => appealGrievanceAction(id, text), () => setText(""))}>Appeal to the next level</Button>}
      </div>
    </div>
  );
}

export function UndertakingForm() {
  const { pending, run } = useRun();
  const [ref, setRef] = useState("");
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => submitUndertakingAction(ref)); }}>
      <Input aria-label="Undertaking reference number" className="w-64" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference no. from antiragging.in" />
      <Button size="sm" disabled={pending || ref.trim().length < 6}>Save</Button>
    </form>
  );
}

// ───────────────────────── Events ─────────────────────────

export function AttendanceList({ eventId, rows }: { eventId: string; rows: { id: string; name: string; detail: string; attended: boolean }[] }) {
  const { pending, run } = useRun();
  const [sel, setSel] = useState(new Set(rows.filter((r) => r.attended).map((r) => r.id)));
  const changed = rows.some((r) => r.attended !== sel.has(r.id));
  return (
    <div className="space-y-3">
      <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
        {rows.map((r) => (
          <li key={r.id}><label className="flex items-center gap-3 px-3 py-1.5 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={sel.has(r.id)} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(r.id); else n.delete(r.id); setSel(n); }} /> <span className="flex-1">{r.name}</span><span className="text-xs text-muted-foreground">{r.detail}</span></label></li>
        ))}
      </ul>
      <Button size="sm" disabled={pending || !changed} onClick={async () => {
        const add = rows.filter((r) => !r.attended && sel.has(r.id)).map((r) => r.id);
        const remove = rows.filter((r) => r.attended && !sel.has(r.id)).map((r) => r.id);
        if (add.length) await markEventAttendanceAction(eventId, { registrationIds: add, attended: true });
        run(() => markEventAttendanceAction(eventId, { registrationIds: remove, attended: false }));
      }}>Save attendance</Button>
    </div>
  );
}

export function EventCheckIn({ eventId, k }: { eventId: string; k: string }) {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (state) return <p role="status" className={state.ok ? "flex items-center gap-2 text-lg font-medium text-tone-success" : "text-sm text-tone-danger"}>{state.ok && <CheckCircle2 className="size-6" />}{state.text}</p>;
  return <Button size="lg" disabled={busy} onClick={async () => { setBusy(true); const r = await selfCheckInAction(eventId, k); setBusy(false); setState(r.ok ? { ok: true, text: `You are marked present at ${r.data}.` } : { ok: false, text: r.error }); }}>{busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Mark me present</Button>;
}
