"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { withholdResultAction } from "@/features/results/actions";

export function WithholdButton({ courseResultId, runId, withheld }: { courseResultId: string; runId: string; withheld: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        const reason = withheld ? null : prompt("Reason for withholding this result (the student sees WH)?");
        if (!withheld && !reason) return;
        if (withheld && !confirm("Release this result?")) return;
        start(async () => {
          const r = await withholdResultAction(courseResultId, reason, runId);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(r.message ?? "Done");
            router.refresh();
          }
        });
      }}
    >
      {withheld ? "Release" : "Withhold"}
    </Button>
  );
}
