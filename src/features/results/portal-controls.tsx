"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { requestCondonationAction, requestRevaluationAction } from "@/features/results/actions";

export function CondonationButton({ registrationId }: { registrationId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="xs" variant="outline" disabled={pending} onClick={() => {
      const reason = prompt("Why was your attendance short? Mention any medical certificate or event.");
      if (!reason) return;
      start(async () => {
        const r = await requestCondonationAction(registrationId, reason);
        if (!r.ok) toast.error(r.error);
        else { toast.success("Request sent to your Head of Department"); router.refresh(); }
      });
    }}>Request condonation</Button>
  );
}

export function RevaluationButtons({ courseResultId, fees }: { courseResultId: string; fees: { revaluation: number; retotalling: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const ask = (type: "RETOTALLING" | "REVALUATION") => {
    const fee = type === "REVALUATION" ? fees.revaluation : fees.retotalling;
    if (!confirm(`Apply for ${type === "REVALUATION" ? "revaluation" : "retotalling"}?${fee ? ` A fee of ${fee} applies.` : ""} The result can go up or down.`)) return;
    start(async () => {
      const r = await requestRevaluationAction(courseResultId, type);
      if (!r.ok) toast.error(r.error);
      else { toast.success("Request submitted"); router.refresh(); }
    });
  };
  return (
    <div className="flex justify-end gap-1">
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => ask("RETOTALLING")}>Retotal</Button>
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => ask("REVALUATION")}>Revalue</Button>
    </div>
  );
}
