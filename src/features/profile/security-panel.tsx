"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, Loader2, LogOut, MonitorSmartphone, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changePasswordAction, confirmMfaEnrollmentAction, disableMfaAction, revokeSessionAction, startMfaEnrollmentAction,
} from "@/features/auth/actions";
import { fmtDateTime, fmtRelative } from "@/lib/format";

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (next !== confirm) return void toast.error("New passwords do not match.");
        start(async () => {
          const res = await changePasswordAction(current, next);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(res.message ?? "Password updated");
          setCurrent("");
          setNext("");
          setConfirm("");
        });
      }}
    >
      <div className="space-y-1.5"><Label htmlFor="pw-current">Current password</Label><Input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></div>
      <div className="space-y-1.5"><Label htmlFor="pw-new">New password</Label><Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required /></div>
      <div className="space-y-1.5"><Label htmlFor="pw-confirm">Confirm new password</Label><Input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required /></div>
      <div className="flex items-center justify-between gap-3 sm:col-span-3">
        <p className="text-xs text-muted-foreground">Changing your password signs you out of every other device.</p>
        <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Update password</Button>
      </div>
    </form>
  );
}

export function MfaPanel({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  if (enabled) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-tone-success" /> Two-step verification is <b>on</b>. You&apos;ll be asked for a code from your authenticator app at sign-in.</div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await disableMfaAction(password); if (!r.ok) { toast.error(r.error); return; } toast.success(r.message ?? "Turned off"); router.refresh(); }); }}>
          <div className="space-y-1.5"><Label htmlFor="mfa-pw">Confirm with password</Label><Input id="mfa-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <Button type="submit" variant="outline" disabled={pending}><ShieldOff /> Turn off</Button>
        </form>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Protect your account with a time-based code from an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
      {!setup ? (
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await startMfaEnrollmentAction();
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              setSetup({ secret: r.data.secret, qr: await QRCode.toDataURL(r.data.uri, { margin: 1, width: 180 }) });
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Set up two-step verification
        </Button>
      ) : (
        <div className="flex flex-wrap gap-6 rounded-xl border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} alt="QR code for your authenticator app" className="size-[180px] rounded-lg border bg-white p-1" />
          <form
            className="min-w-[240px] flex-1 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await confirmMfaEnrollmentAction(code);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.message ?? "Enabled");
                setSetup(null);
                router.refresh();
              });
            }}
          >
            <ol className="list-decimal space-y-1 pl-4 text-sm">
              <li>Scan the QR code with your authenticator app.</li>
              <li>Or enter this key manually: <code className="rounded bg-muted px-1.5 font-mono text-xs break-all">{setup.secret}</code></li>
              <li>Enter the 6-digit code it shows.</li>
            </ol>
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} placeholder="123 456" aria-label="Verification code" className="w-36 font-mono tracking-widest" />
              <Button type="submit" disabled={pending || code.replace(/\s/g, "").length !== 6}>Verify & enable</Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function SessionsList({ sessions }: { sessions: { id: string; device: string; ip: string | null; lastSeen: string; created: string; current: boolean; remember: boolean }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ul className="divide-y">
      {sessions.map((s) => (
        <li key={s.id} className="flex items-center gap-3 py-3">
          <MonitorSmartphone className="size-5 text-muted-foreground" />
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{s.device}{s.current && <span className="ml-2 rounded-full bg-tone-success/10 px-2 text-[11px] font-semibold text-tone-success">This device</span>}</div>
            <div className="text-xs text-muted-foreground">{s.ip ?? "Unknown IP"} · signed in {fmtDateTime(s.created)} · active {fmtRelative(s.lastSeen)}{s.remember ? " · remembered" : ""}</div>
          </div>
          {!s.current && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const r = await revokeSessionAction(s.id); if (r.ok) { toast.success(r.message ?? "Signed out"); router.refresh(); } else toast.error(r.error); })}>
              <LogOut /> Sign out
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
