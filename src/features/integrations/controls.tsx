"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Loader2, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createFeedAction, createTokenAction, rotateSecretAction, saveEndpointAction, saveProviderAction } from "@/features/integrations/actions";

type R = { ok: true; message?: string; data?: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };
const sel = "h-9 rounded-lg border bg-card px-2 text-sm";

/** A secret shown once, with a copy button. */
export function OneTimeSecret({ value, note }: { value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="space-y-1.5 rounded-lg border border-tone-warning/40 bg-tone-warning/5 p-3">
      <p className="text-xs font-medium text-tone-warning">{note}</p>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-card px-2 py-1.5 font-mono text-xs">{value}</code>
        <Button size="sm" variant="outline" aria-label="Copy" onClick={() => { void navigator.clipboard.writeText(value).then(() => setCopied(true)); }}>{copied ? <Check /> : <Copy />}</Button>
      </div>
    </div>
  );
}

function useSubmit() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, after?: (data: unknown) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined }); return; }
      if (r.message) toast.success(r.message);
      after?.(r.data);
      router.refresh();
    });
  return { pending, run };
}

// ───────────────────────── Personal access tokens ─────────────────────────

export function TokenCreator({ scopes }: { scopes: { key: string; label: string }[] }) {
  const { pending, run } = useSubmit();
  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<string[]>(["profile:read", "self:read"].filter((s) => scopes.some((x) => x.key === s)));
  const [days, setDays] = useState("90");
  const [token, setToken] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {token && <OneTimeSecret value={token} note="Copy this token now — it will not be shown again. Keep it secret like a password." />}
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="space-y-1"><Label htmlFor="tok-name">Name</Label><Input id="tok-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude, Power BI, library system" /></div>
        <div className="space-y-1"><Label htmlFor="tok-exp">Expires</Label><select id="tok-exp" className={`${sel} w-full`} value={days} onChange={(e) => setDays(e.target.value)}><option value="30">in 30 days</option><option value="90">in 90 days</option><option value="365">in a year</option><option value="">never</option></select></div>
      </div>
      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-sm font-medium">What it may read</legend>
        {scopes.map((s) => (
          <label key={s.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={chosen.includes(s.key)} onChange={(e) => setChosen(e.target.checked ? [...chosen, s.key] : chosen.filter((x) => x !== s.key))} />
            <span><code className="text-xs">{s.key}</code> — {s.label}</span>
          </label>
        ))}
      </fieldset>
      <Button size="sm" disabled={pending || !name.trim() || !chosen.length} onClick={() => run(() => createTokenAction({ name, scopes: chosen, expiresInDays: days ? Number(days) : null }), (d) => { setToken((d as { token: string }).token); setName(""); })}>
        {pending ? <Loader2 className="animate-spin" /> : <KeyRound />} Create token
      </Button>
    </div>
  );
}

export function CalendarLinkButton({ exists }: { exists: boolean }) {
  const { pending, run } = useSubmit();
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {url && <OneTimeSecret value={url} note="Copy this link into Google Calendar (Other calendars → From URL), Outlook (Add calendar → Subscribe from web) or your phone. Anyone with the link can see your schedule; replace it if it leaks." />}
      <Button size="sm" variant={exists ? "outline" : "default"} disabled={pending} onClick={() => { if (!exists || confirm("Replace the link? Calendars using the old link stop updating.")) run(() => createFeedAction(), (d) => setUrl((d as { url: string }).url)); }}>
        {pending ? <Loader2 className="animate-spin" /> : exists ? <RefreshCw /> : <Plus />} {exists ? "Replace link" : "Create calendar link"}
      </Button>
    </div>
  );
}

// ───────────────────────── Administration ─────────────────────────

export function ProviderForm({ kind, redirectUri, initial }: { kind: "GOOGLE" | "MICROSOFT"; redirectUri: string; initial: { enabled: boolean; clientId: string; tenant: string; allowedDomains: string; configured: boolean } }) {
  const { pending, run } = useSubmit();
  const [v, setV] = useState({ ...initial, clientSecret: "" });
  const id = kind.toLowerCase();
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Register this redirect address with {kind === "GOOGLE" ? "Google Cloud (OAuth client, web application)" : "Microsoft Entra ID (app registration, Web platform)"}: <code className="break-all">{redirectUri}</code></p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Show “Continue with {kind === "GOOGLE" ? "Google" : "Microsoft"}” on the sign-in page</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`${id}-cid`}>Client ID</Label><Input id={`${id}-cid`} value={v.clientId} onChange={(e) => setV({ ...v, clientId: e.target.value })} /></div>
        <div className="space-y-1"><Label htmlFor={`${id}-sec`}>Client secret</Label><Input id={`${id}-sec`} type="password" autoComplete="off" value={v.clientSecret} placeholder={initial.configured ? "Leave blank to keep the current secret" : ""} onChange={(e) => setV({ ...v, clientSecret: e.target.value })} /></div>
        {kind === "MICROSOFT" && <div className="space-y-1"><Label htmlFor={`${id}-ten`}>Directory (tenant) ID</Label><Input id={`${id}-ten`} value={v.tenant} placeholder="organizations" onChange={(e) => setV({ ...v, tenant: e.target.value })} /></div>}
        <div className="space-y-1"><Label htmlFor={`${id}-dom`}>Allowed e-mail domains</Label><Input id={`${id}-dom`} value={v.allowedDomains} placeholder="loyola.edu.in, students.loyola.edu.in" onChange={(e) => setV({ ...v, allowedDomains: e.target.value })} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Only people who already have an account here can sign in this way — the e-mail address must match. Two-step verification still applies.</p>
      <Button size="sm" disabled={pending} onClick={() => run(() => saveProviderAction(kind, { enabled: v.enabled, clientId: v.clientId, clientSecret: v.clientSecret || null, tenant: v.tenant || null, allowedDomains: v.allowedDomains }))}>{pending && <Loader2 className="animate-spin" />} Save</Button>
    </div>
  );
}

export function WebhookForm({ events, initial }: { events: { key: string; label: string }[]; initial?: { id: string; name: string; url: string; events: string[]; active: boolean } }) {
  const { pending, run } = useSubmit();
  const [v, setV] = useState({ name: initial?.name ?? "", url: initial?.url ?? "https://", events: initial?.events ?? ["payment.", "invoice."], active: initial?.active ?? true });
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {secret && <OneTimeSecret value={secret} note="Signing secret — copy it into the receiving system now; it will not be shown again." />}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor={`wh-name-${initial?.id ?? "new"}`}>Name</Label><Input id={`wh-name-${initial?.id ?? "new"}`} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Tally sync" /></div>
        <div className="space-y-1"><Label htmlFor={`wh-url-${initial?.id ?? "new"}`}>URL (https)</Label><Input id={`wh-url-${initial?.id ?? "new"}`} value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} /></div>
      </div>
      <fieldset className="grid gap-1 sm:grid-cols-2">
        <legend className="mb-1 text-sm font-medium">Send these events</legend>
        {events.map((e) => (
          <label key={e.key} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={v.events.includes(e.key)} onChange={(x) => setV({ ...v, events: x.target.checked ? [...v.events, e.key] : v.events.filter((k) => k !== e.key) })} />
            <span><code className="text-xs">{e.key}*</code> {e.label}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /> Active</label>
      <Button size="sm" disabled={pending} onClick={() => run(() => saveEndpointAction(initial?.id ?? null, v), (d) => { const s = (d as { secret: string | null }).secret; if (s) setSecret(s); })}>{pending && <Loader2 className="animate-spin" />} {initial ? "Save" : "Add webhook"}</Button>
    </div>
  );
}

export function RotateSecretButton({ id }: { id: string }) {
  const { pending, run } = useSubmit();
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      {secret && <OneTimeSecret value={secret} note="New signing secret — the old one stops working now." />}
      <Button size="xs" variant="outline" disabled={pending} onClick={() => { if (confirm("Replace the signing secret? The receiving system must be updated.")) run(() => rotateSecretAction(id), (d) => setSecret((d as { secret: string }).secret)); }}><RefreshCw /> New secret</Button>
    </div>
  );
}
