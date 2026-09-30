import {
  Archive, BadgeCheck, Ban, Check, CircleDot, CircleX, Compass, Inbox, ListChecks, Lock, Megaphone,
  PackageCheck, Pencil, PencilRuler, ScanSearch, Send, Stamp, Undo2, type LucideIcon,
} from "lucide-react";
import type { StatusMeta, Tone } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  archive: Archive, "badge-check": BadgeCheck, ban: Ban, check: Check, "circle-dot": CircleDot, "circle-x": CircleX,
  compass: Compass, inbox: Inbox, "list-checks": ListChecks, lock: Lock, megaphone: Megaphone,
  "package-check": PackageCheck, pencil: Pencil, "pencil-ruler": PencilRuler, "scan-search": ScanSearch,
  send: Send, stamp: Stamp, "undo-2": Undo2,
};

export const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-tone-neutral bg-tone-neutral/8 ring-tone-neutral/15",
  info: "text-tone-info bg-tone-info/8 ring-tone-info/20",
  progress: "text-tone-progress bg-tone-progress/8 ring-tone-progress/20",
  warning: "text-tone-warning bg-tone-warning/10 ring-tone-warning/25",
  success: "text-tone-success bg-tone-success/8 ring-tone-success/20",
  danger: "text-tone-danger bg-tone-danger/8 ring-tone-danger/20",
  locked: "text-tone-locked bg-tone-locked/8 ring-tone-locked/20",
};

/** Status is conveyed by icon + text, never colour alone (WCAG 1.4.1). */
export function StatusBadge({ meta, className, size = "sm" }: { meta: StatusMeta; className?: string; size?: "sm" | "md" }) {
  const Icon = ICONS[meta.icon] ?? CircleDot;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full font-medium whitespace-nowrap ring-1 ring-inset",
        size === "sm" ? "h-5.5 px-2 text-[11.5px]" : "h-7 px-2.5 text-xs",
        TONE_CLASS[meta.tone],
        className,
      )}
    >
      <Icon aria-hidden className={size === "sm" ? "size-3" : "size-3.5"} />
      {meta.label}
    </span>
  );
}

export function ToneDot({ tone, className }: { tone: Tone; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 rounded-full bg-current", TONE_CLASS[tone].split(" ")[0], className)} />;
}
