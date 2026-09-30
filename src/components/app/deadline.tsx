import { AlarmClock, CalendarClock } from "lucide-react";
import { deadlineText, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Deadline({ date, compact, className }: { date: Date | string; compact?: boolean; className?: string }) {
  const d = deadlineText(date);
  const Icon = d.tone === "danger" ? AlarmClock : CalendarClock;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        d.tone === "danger" ? "font-semibold text-tone-danger" : d.tone === "warning" ? "font-medium text-tone-warning" : "text-muted-foreground",
        className,
      )}
      title={fmtDate(date)}
    >
      <Icon aria-hidden className="size-3.5" />
      {compact ? d.text : `${fmtDate(date)} · ${d.text}`}
    </span>
  );
}
