"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { deleteCalendarEventAction } from "@/features/academic-ops/actions";

export function DeleteEventButton({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`Delete ${title}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${title}" from the calendar?`)) return;
        start(async () => {
          const r = await deleteCalendarEventAction(id);
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

/** Generic "run a server action, toast, refresh" button. */
export function ActionButton({
  run,
  label,
  confirmText,
  variant = "outline",
  size = "sm",
  icon,
  ariaLabel,
}: {
  run: () => Promise<{ ok: boolean; error?: string; message?: string; data?: unknown }>;
  label: string;
  confirmText?: string;
  variant?: "outline" | "default" | "ghost" | "destructive";
  size?: "sm" | "xs";
  icon?: React.ReactNode;
  /** Accessible name for icon-only buttons */
  ariaLabel?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size={size}
      variant={variant}
      aria-label={ariaLabel}
      disabled={pending}
      onClick={() => {
        if (confirmText && !confirm(confirmText)) return;
        start(async () => {
          const r = await run();
          if (!r.ok) toast.error(r.error ?? "Failed");
          else {
            const d = r.data as { created?: number; cancelled?: number } | undefined;
            toast.success(r.message ?? (d && "created" in d ? `${d.created} added${d.cancelled ? `, ${d.cancelled} cancelled` : ""}` : "Done"));
            router.refresh();
          }
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : icon} {label}
    </Button>
  );
}
