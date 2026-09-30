"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAllNotificationsRead } from "@/features/shell/actions";

export function MarkAllRead({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" size="sm" disabled={disabled || pending} onClick={() => start(async () => { await markAllNotificationsRead(); router.refresh(); })}>
      <CheckCheck /> Mark all as read
    </Button>
  );
}
