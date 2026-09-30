"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { BookOpenCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openWorkspaceAction } from "@/features/papers/actions";

export function OpenWorkspaceButton({ assignmentId }: { assignmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await openWorkspaceAction(assignmentId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          router.push(`/papers/${res.data.paperId}/builder`);
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <BookOpenCheck />} Open workspace
    </Button>
  );
}
