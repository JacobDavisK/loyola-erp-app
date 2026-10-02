"use client";

import { useState } from "react";
import { BadgeCheck, CircleX, Copy, Loader2, Share2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createShareAction, verifyVcAction } from "@/features/wallet/actions";

export function ShareControl({ vcId }: { vcId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(30);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState<string | null>(null);
  if (url) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Input aria-label="Share link" readOnly value={url} className="w-80 font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="xs" variant="outline" onClick={() => { void navigator.clipboard?.writeText(url).then(() => toast.success("Link copied")); }}><Copy /> Copy</Button>
      </div>
    );
  }
  if (!open) return <Button size="xs" variant="outline" onClick={() => setOpen(true)}><Share2 /> Share</Button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => createShareAction(vcId, { days, label: label || null }), (r) => setUrl((r.data as { url: string }).url)); }}>
      <div className="space-y-1"><Label htmlFor={`sh-l-${vcId}`} className="text-xs">For (optional)</Label><Input id={`sh-l-${vcId}`} className="w-44" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Employer name" /></div>
      <div className="space-y-1"><Label htmlFor={`sh-d-${vcId}`} className="text-xs">Valid for (days)</Label><Input id={`sh-d-${vcId}`} className="w-20" type="number" min={1} max={365} value={days} onChange={(e) => setDays(Number(e.target.value))} /></div>
      <Button size="xs" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Share2 />} Create link</Button>
    </form>
  );
}

export function VerifyVcForm() {
  const [jwt, setJwt] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ valid: boolean; problems: string[]; name: string | null; subject: string | null; issuedAt: string | null } | null>(null);
  return (
    <div className="space-y-3">
      <Textarea aria-label="Credential" rows={5} className="font-mono text-xs" value={jwt} onChange={(e) => setJwt(e.target.value)} placeholder="Paste the credential (the long text starting with eyJ…)" />
      <Button disabled={busy || jwt.trim().length < 20} onClick={async () => {
        setBusy(true);
        const r = await verifyVcAction(jwt);
        setBusy(false);
        if (!r.ok) { toast.error(r.error); return; }
        setRes(r.data as typeof res);
      }}>{busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} Verify</Button>
      {res && (
        <div role="status" className={res.valid ? "rounded-lg border border-tone-success/40 bg-tone-success/5 p-4 text-sm" : "rounded-lg border border-tone-danger/40 bg-tone-danger/5 p-4 text-sm"}>
          <p className="flex items-center gap-2 font-semibold">{res.valid ? <><BadgeCheck className="size-5 text-tone-success" /> Genuine and current</> : <><CircleX className="size-5 text-tone-danger" /> Not valid</>}</p>
          {res.name && <p className="mt-1">{res.name}{res.subject ? ` — ${res.subject}` : ""}{res.issuedAt ? ` · issued ${res.issuedAt.slice(0, 10)}` : ""}</p>}
          {res.problems.length > 0 && <ul className="mt-2 list-disc pl-5">{res.problems.map((p) => <li key={p}>{p}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
