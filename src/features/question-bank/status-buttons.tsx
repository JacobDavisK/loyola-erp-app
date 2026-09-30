"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Archive, BadgeCheck, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setQuestionStatusAction } from "@/features/question-bank/actions";
import type { QuestionStatus } from "@/generated/prisma/enums";

export function QuestionStatusButtons({ id, status, canRetire, canReview }: { id: string; status: QuestionStatus; canRetire: boolean; canReview: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (s: "ACTIVE" | "RETIRED") =>
    start(async () => {
      const res = await setQuestionStatusAction(id, s);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Updated");
      router.refresh();
    });
  return (
    <>
      {status === "PENDING_REVIEW" && canReview && <Button size="sm" variant="outline" disabled={pending} onClick={() => set("ACTIVE")}><BadgeCheck /> Approve into bank</Button>}
      {status === "RETIRED" && canRetire && <Button size="sm" variant="outline" disabled={pending} onClick={() => set("ACTIVE")}><RotateCcw /> Restore</Button>}
      {status !== "RETIRED" && canRetire && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => { if (confirm("Retire this question? It stays in historical papers but can't be used in new ones.")) set("RETIRED"); }}>
          <Archive /> Retire
        </Button>
      )}
    </>
  );
}
