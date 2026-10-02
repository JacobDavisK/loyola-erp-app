"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

export type ActionResponse = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Run a server action from a client control: toast the outcome and refresh the page on success. */
export function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<ActionResponse>, after?: (r: Extract<ActionResponse, { ok: true }>) => void) =>
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
