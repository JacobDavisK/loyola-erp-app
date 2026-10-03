"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, Download, Loader2, Play, Plus, Radio, Video } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { goOnlineAction, guestInviteAction, instantMeetingAction, playbackAction, respondInvitationAction, startMeetingAction } from "@/features/video/actions";

type R<T = unknown> = { ok: true; data: T; message?: string } | { ok: false; error: string };

function useAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: <T,>(fn: () => Promise<R<T>>, then?: (d: T) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) { toast.error(r.error); return; }
        if (r.message) toast.success(r.message);
        if (then) then(r.data);
        else router.refresh();
      }),
  };
}

/** "Start" for hosts (starts, then opens the room); "Join" / "Enter" for everyone else. */
export function MeetingPrimaryButton({ meetingId, publicId, mode, size = "sm" }: { meetingId: string; publicId: string; mode: "start" | "enter" | "join"; size?: "sm" | "default" }) {
  const router = useRouter();
  const { pending, run } = useAction();
  if (mode === "start") {
    return <Button size={size} disabled={pending} onClick={() => run(() => startMeetingAction(meetingId), () => router.push(`/meet/${publicId}`))}>{pending ? <Loader2 className="animate-spin" /> : <Play />} Start</Button>;
  }
  return <Button size={size} variant={mode === "enter" ? "default" : "default"} onClick={() => router.push(`/meet/${publicId}`)}><Video /> {mode === "enter" ? "Enter meeting" : "Join"}</Button>;
}

export function InstantMeetingButton() {
  const router = useRouter();
  const { pending, run } = useAction();
  return <Button size="sm" disabled={pending} onClick={() => run(() => instantMeetingAction({}), (d) => router.push(`/meet/${(d as { publicId: string }).publicId}`))}>{pending ? <Loader2 className="animate-spin" /> : <Radio />} Start meeting</Button>;
}

/** Timetable: turn a scheduled class session into an online class (one meeting per session). */
export function GoOnlineButton({ classMeetingId, label = "Go online" }: { classMeetingId: string; label?: string }) {
  const router = useRouter();
  const { pending, run } = useAction();
  return <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => goOnlineAction(classMeetingId), (d) => router.push(`/video/${(d as { publicId: string }).publicId}`))}>{pending ? <Loader2 className="animate-spin" /> : <Video />} {label}</Button>;
}

export function RespondButtons({ meetingId, current }: { meetingId: string; current: string }) {
  const { pending, run } = useAction();
  const opts = [["ACCEPTED", "Accept"], ["TENTATIVE", "Maybe"], ["DECLINED", "Decline"]] as const;
  return (
    <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Your response">
      {opts.map(([k, l]) => <button key={k} disabled={pending} aria-pressed={current === k} onClick={() => run(() => respondInvitationAction(meetingId, k))} className={`min-h-9 rounded-md px-3 text-xs font-medium ${current === k ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{l}</button>)}
    </div>
  );
}

/** Loads a short-lived, viewer-bound playback link only when asked; the file streams through the ERP. */
export function RecordingPlayer({ recordingId, canDownload }: { recordingId: string; canDownload: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const { pending, run } = useAction();
  if (url) return <video className="aspect-video w-full rounded-xl bg-black" src={url} controls autoPlay preload="metadata" />;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending} onClick={() => run(() => playbackAction(recordingId), (d) => setUrl(d as string))}>{pending ? <Loader2 className="animate-spin" /> : <Play />} Watch</Button>
      {canDownload && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => playbackAction(recordingId, true), (d) => { window.location.href = d as string; })}><Download /> Download</Button>}
    </div>
  );
}

export function GuestInviteDialog({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ name: "", email: "", role: "PARTICIPANT", panelRole: "" });
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) { setLink(null); setCopied(false); setV({ name: "", email: "", role: "PARTICIPANT", panelRole: "" }); } }}>
      <DialogTrigger asChild><Button size="xs" variant="outline"><Plus /> Invite a guest</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a guest</DialogTitle>
          <DialogDescription>For someone without a university account, such as an external examiner or guest speaker. The link works only for this meeting, until shortly after it ends, and you can withdraw it.</DialogDescription>
        </DialogHeader>
        {link ? (
          <div className="space-y-3">
            <p className="text-sm">We have e-mailed the link. You can also copy it now; it will not be shown again.</p>
            <div className="flex gap-2"><code className="min-w-0 flex-1 break-all rounded-md bg-muted px-2 py-1.5 text-xs">{link.url}</code><Button size="sm" variant="outline" aria-label="Copy link" onClick={() => void navigator.clipboard.writeText(link.url).then(() => setCopied(true))}>{copied ? <Check /> : <Copy />}</Button></div>
            <p className="text-xs text-muted-foreground">Valid until {new Date(link.expiresAt).toLocaleString()}.</p>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => guestInviteAction(meetingId, { ...v, panelRole: v.panelRole || null }), (d) => setLink(d as { url: string; expiresAt: string })); }}>
            <div className="space-y-1"><Label htmlFor="g-name">Name</Label><Input id="g-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
            <div className="space-y-1"><Label htmlFor="g-email">E-mail</Label><Input id="g-email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required /></div>
            <div className="space-y-1"><Label htmlFor="g-role">Role</Label>
              <select id="g-role" className="h-10 w-full rounded-lg border bg-card px-2 text-sm" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value })}><option value="PARTICIPANT">Participant</option><option value="PRESENTER">Presenter (can share and speak)</option><option value="OBSERVER">Observer (watch only)</option></select>
            </div>
            <div className="space-y-1"><Label htmlFor="g-panel">Panel role <span className="font-normal text-muted-foreground">(viva / PhD review)</span></Label>
              <select id="g-panel" className="h-10 w-full rounded-lg border bg-card px-2 text-sm" value={v.panelRole} onChange={(e) => setV({ ...v, panelRole: e.target.value })}><option value="">None</option><option value="EXTERNAL_EXAMINER">External examiner</option><option value="EXTERNAL_EXPERT">External expert</option><option value="COMMITTEE_MEMBER">Committee member</option></select>
            </div>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Create link</Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
