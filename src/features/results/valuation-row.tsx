"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { submitValuationAction } from "@/features/results/actions";

/** Marks entry for one script. Submission is final for the valuer (the office resolves disagreements). */
export function ValuationEntry({ valuationId, max, revaluation }: { valuationId: string; max: number; revaluation: boolean }) {
  const router = useRouter();
  const [marks, setMarks] = useState("");
  const [pending, start] = useTransition();
  const value = marks === "" ? NaN : Number(marks);
  const valid = !isNaN(value) && value >= 0 && value <= max && Math.round(value * 2) === value * 2;
  return (
    <form
      className="flex items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid || !confirm(`Submit ${value} / ${max}? Submitted marks cannot be changed.`)) return;
        start(async () => {
          const r = await submitValuationAction(valuationId, { marks: value }, revaluation);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Submitted");
            router.refresh();
          }
        });
      }}
    >
      <Input aria-label={`Marks out of ${max}`} inputMode="decimal" className="h-8 w-20 text-right tabular" value={marks} onChange={(e) => setMarks(e.target.value)} placeholder={`/ ${max}`} aria-invalid={marks !== "" && !valid} />
      <Button size="xs" disabled={!valid || pending}>{pending && <Loader2 className="animate-spin" />} Submit</Button>
    </form>
  );
}
