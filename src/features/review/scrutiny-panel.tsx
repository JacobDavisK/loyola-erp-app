"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BadgeCheck, CircleX, Loader2, RefreshCw, TriangleAlert, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { transitionPaperAction } from "@/features/papers/actions";
import type { ScrutinyCheck } from "@/lib/domain/scrutiny";
import { cn } from "@/lib/utils";

export function ScrutinyPanel({ paperId, checks, ready, canAct }: { paperId: string; checks: ScrutinyCheck[]; ready: boolean; canAct: boolean }) {
  const router = useRouter();
  const [remarks, setRemarks] = useState("");
  const [pending, start] = useTransition();
  const blockers = checks.filter((c) => !c.ok && c.severity === "blocker");
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning");

  const act = (action: "scrutiny_pass" | "scrutiny_return") =>
    start(async () => {
      const res = await transitionPaperAction(paperId, action, remarks.trim() || undefined);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(action === "scrutiny_pass" ? "Scrutiny passed — sent for final approval" : "Returned to the setter for correction");
      router.push("/scrutiny");
    });

  return (
    <div className="space-y-4">
      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-[13px] font-semibold tracking-wide">FINAL SCRUTINY</h2>
          <Button variant="ghost" size="xs" onClick={() => router.refresh()} disabled={pending}><RefreshCw /> Re-run</Button>
        </div>
        <ul className="divide-y">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2.5 px-4 py-2">
              {c.ok ? (
                <BadgeCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-success" />
              ) : c.severity === "blocker" ? (
                <CircleX aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-danger" />
              ) : (
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-tone-warning" />
              )}
              <div className="min-w-0 text-[13px]">
                <div className="font-medium">
                  {c.label}
                  <span className="sr-only">: {c.ok ? "passed" : c.severity === "blocker" ? "failed" : "warning"}</span>
                </div>
                <div className="truncate text-xs text-muted-foreground" title={c.detail}>{c.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className={cn("px-4 py-3 text-center text-sm font-semibold tracking-wide", ready ? "bg-tone-success/10 text-tone-success" : "bg-tone-danger/10 text-tone-danger")}>
          {ready ? "READY FOR APPROVAL" : `${blockers.length} BLOCKER${blockers.length === 1 ? "" : "S"} — NOT READY`}
          {ready && warnings.length > 0 && <span className="block text-xs font-normal">{warnings.length} advisory warning(s)</span>}
        </div>
      </section>

      {canAct && (
        <section className="surface-card space-y-3 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="scr-remarks">Scrutiny remarks</Label>
            <Textarea id="scr-remarks" rows={4} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Required when returning the paper for correction." />
          </div>
          <Button className="w-full" disabled={!ready || pending} onClick={() => act("scrutiny_pass")}>
            {pending ? <Loader2 className="animate-spin" /> : <BadgeCheck />} Pass scrutiny
          </Button>
          <Button className="w-full" variant="outline" disabled={pending || !remarks.trim()} onClick={() => act("scrutiny_return")}>
            <Undo2 /> Return for correction
          </Button>
        </section>
      )}
    </div>
  );
}
