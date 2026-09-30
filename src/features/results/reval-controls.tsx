"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeRevaluationAction, rejectRevaluationAction, settleRevaluationFeeAction, startRevaluationAction } from "@/features/results/actions";

type R = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

export function RevalControls({ id, status, type, valuers }: { id: string; status: string; type: "RETOTALLING" | "REVALUATION"; valuers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [valuer, setValuer] = useState("");
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<R>, ok?: (r: R & { ok: true }) => string) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(ok?.(r) ?? r.message ?? "Done");
        router.refresh();
      }
    });
  if (status === "FEE_PENDING")
    return (
      <div className="flex justify-end gap-1">
        <Button size="xs" variant="outline" disabled={pending} onClick={() => { const ref = prompt("Receipt number for the fee?"); if (ref) run(() => settleRevaluationFeeAction(id, { reference: ref })); }}>Fee received</Button>
        <Button size="xs" variant="ghost" disabled={pending} onClick={() => { const ref = prompt("Waiver reference / approval?"); if (ref) run(() => settleRevaluationFeeAction(id, { reference: ref, waived: true })); }}>Waive</Button>
        <Button size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { const why = prompt("Reason for rejecting?"); if (why) run(() => rejectRevaluationAction(id, why)); }}>Reject</Button>
      </div>
    );
  if (status === "REQUESTED")
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {type === "REVALUATION" && (
          <select aria-label="Revaluation valuer" className="h-7 rounded-md border bg-card px-1.5 text-xs" value={valuer} onChange={(e) => setValuer(e.target.value)}>
            <option value="">Choose valuer…</option>
            {valuers.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        )}
        <Button size="xs" disabled={pending || (type === "REVALUATION" && !valuer)} onClick={() => run(() => startRevaluationAction(id, { valuerId: valuer || null }))}>Start</Button>
        <Button size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => { const why = prompt("Reason for rejecting?"); if (why) run(() => rejectRevaluationAction(id, why)); }}>Reject</Button>
      </div>
    );
  if (status === "IN_PROGRESS")
    return (
      <div className="flex justify-end">
        <Button size="xs" disabled={pending} onClick={() => {
          let input: Record<string, unknown> = {};
          if (type === "RETOTALLING") {
            const t = prompt("Recounted total on the script?");
            if (t === null) return;
            input = { recountedMarks: Number(t) };
          } else if (!confirm("Apply the revaluation marks under the configured rule?")) return;
          run(() => completeRevaluationAction(id, input), (r) => `Outcome: ${String((r.data as { outcome: string }).outcome).toLowerCase()}`);
        }}>Complete</Button>
      </div>
    );
  return null;
}
