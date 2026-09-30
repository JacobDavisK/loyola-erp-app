"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { Calculator, Loader2, Paperclip, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  addEvidenceAction, adoptComputedAction, completeProjectAction, importMetricsAction, reopenResponseAction, reviewResponseAction, saveResponseAction, submitResponseAction,
} from "@/features/quality/actions";

type R = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<R>, after?: (r: R & { ok: true }) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined });
          return;
        }
        if (r.message) toast.success(r.message);
        after?.(r);
        router.refresh();
      }),
  };
}

export function CompleteProjectButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => {
      const outcome = prompt("Summarise the project's outcomes (deliverables, publications, patents, people trained):");
      if (outcome) run(() => completeProjectAction(id, outcome));
    }}>{pending && <Loader2 className="animate-spin" />} Mark completed</Button>
  );
}

export function ImportMetricsForm({ frameworkId }: { frameworkId: string }) {
  const { pending, run } = useRun();
  const [text, setText] = useState("");
  return (
    <div className="space-y-2">
      <Label htmlFor="im-text">Metrics outline</Label>
      <Textarea id="im-text" rows={8} className="font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder={"# code | title | Q (quantitative) or N (narrative) | weight | data source | unit\n3 | Research, innovations and extension | N | 110\n3.3.1 | Research papers per teacher | Q | 10 | publications.perFaculty | papers"} />
      <p className="text-xs text-muted-foreground">Existing codes are updated in place; nothing is removed. Parents are found from the code (3.3.1 → 3.3 → 3).</p>
      <Button size="sm" disabled={pending || !text.trim()} onClick={() => run(() => importMetricsAction(frameworkId, text), (r) => {
        const d = r.data as { created: number; updated: number };
        toast.success(`${d.created} added, ${d.updated} updated`);
        setText("");
      })}>{pending && <Loader2 className="animate-spin" />} Import</Button>
    </div>
  );
}

export function ResponseEditor({ id, kind, value, narrative, hasSource, unit }: { id: string; kind: "QUANTITATIVE" | "QUALITATIVE"; value: number | null; narrative: string | null; hasSource: boolean; unit: string | null }) {
  const { pending, run } = useRun();
  const [v, setV] = useState(value === null ? "" : String(value));
  const [n, setN] = useState(narrative ?? "");
  const save = () => saveResponseAction(id, { value: v === "" ? null : Number(v), narrative: n });
  return (
    <div className="space-y-3">
      {kind === "QUANTITATIVE" && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5"><Label htmlFor="re-value">Value{unit ? ` (${unit})` : ""}</Label><Input id="re-value" type="number" step="any" className="w-48" value={v} onChange={(e) => setV(e.target.value)} /></div>
          {hasSource && <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => adoptComputedAction(id), (r) => setV(String((r.data as { value: number }).value)))}><Calculator /> Compute from platform records</Button>}
        </div>
      )}
      <div className="space-y-1.5"><Label htmlFor="re-narrative">{kind === "QUALITATIVE" ? "Narrative" : "Notes and data definition"}</Label><Textarea id="re-narrative" rows={kind === "QUALITATIVE" ? 10 : 4} value={n} onChange={(e) => setN(e.target.value)} /></div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" disabled={pending} onClick={() => run(save)}><Save /> Save draft</Button>
        <Button size="sm" disabled={pending} onClick={() => {
          if (!confirm("Submit this metric to IQAC for review? You cannot edit it unless it is returned.")) return;
          run(async () => { const s = await save(); return s.ok ? submitResponseAction(id) : s; });
        }}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button>
      </div>
    </div>
  );
}

export function EvidenceForm({ id }: { id: string }) {
  const { pending, run } = useRun();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); run(() => addEvidenceAction(id, new FormData(ref.current!)), () => ref.current?.reset()); }}>
      <div className="space-y-1"><Label htmlFor="ev-label" className="text-xs">Description</Label><Input id="ev-label" name="label" required minLength={3} /></div>
      <div className="space-y-1"><Label htmlFor="ev-file" className="text-xs">File (max 15 MB) or link</Label><div className="flex gap-2"><Input id="ev-file" name="file" type="file" className="text-xs" /><Input name="url" aria-label="Link" placeholder="https://" /></div></div>
      <Button size="sm" variant="outline" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Paperclip />} Add</Button>
    </form>
  );
}

export function ReviewForm({ id }: { id: string }) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <Textarea aria-label="Review note" rows={2} placeholder="Note to the data owner (required when returning)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex gap-2">
        <Button size="sm" disabled={pending} onClick={() => run(() => reviewResponseAction(id, { decision: "approve", note }))}>Approve</Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewResponseAction(id, { decision: "return", note }))}>Return</Button>
      </div>
    </div>
  );
}

export function ReopenButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="outline" disabled={pending} onClick={() => { const n = prompt("Why is this approved response being reopened?"); if (n) run(() => reopenResponseAction(id, n)); }}>Reopen for correction</Button>;
}
