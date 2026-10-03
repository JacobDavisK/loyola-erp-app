import Link from "next/link";
import { CalendarClock, Circle, Users, Video } from "lucide-react";
import { joinWindowOpen, MEETING_TYPES, type MeetingStatus, type MeetingType, relativeStart } from "@/lib/domain/video";
import { fmtDateTimeZoned, fmtTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MeetingPrimaryButton } from "./controls";
import type { MeetingCardRow } from "./data";

const STATUS_STYLE: Record<string, string> = {
  LIVE: "bg-red-500/10 text-red-600 dark:text-red-400",
  STARTING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  SCHEDULED: "bg-primary/10 text-primary",
  DRAFT: "bg-muted text-muted-foreground",
  ENDED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground line-through",
  FAILED: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

/** One meeting in a list: what, when, who — and the one action that matters now. */
export function VideoMeetingCard({ m, userId, isHostLike, now, timezone, joinEarlyMinutes }: { m: MeetingCardRow; userId: string; isHostLike: boolean; now: Date; timezone: string; joinEarlyMinutes: number }) {
  const status = m.status as MeetingStatus;
  const open = joinWindowOpen(now, m.scheduledStart, m.scheduledEnd, status, joinEarlyMinutes);
  const mine = m.participants.find((p) => p.userId === userId);
  const removed = mine?.connectionStatus === "REMOVED";
  const action = removed ? null : status === "LIVE" || status === "STARTING" ? (isHostLike ? "enter" : "join") : isHostLike && open && (status === "SCHEDULED" || status === "FAILED") ? "start" : null;
  const rel = relativeStart(now, m.scheduledStart, status);
  const minutes = Math.round((m.scheduledEnd.getTime() - m.scheduledStart.getTime()) / 60_000);
  return (
    <article className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card px-5 py-4 transition-colors hover:border-primary/30">
      <div className="grid w-16 shrink-0 text-center">
        <span className="text-lg font-semibold tabular-nums">{fmtTime(m.scheduledStart, timezone)}</span>
        <span className="text-[11px] text-muted-foreground">{minutes} min</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/video/${m.publicId}`} className="truncate font-semibold hover:text-primary">{m.title}</Link>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[status])}>{status === "LIVE" ? <><Circle className="mr-1 inline size-2 fill-current" aria-hidden />Live</> : status.toLowerCase()}</span>
          {rel && status !== "LIVE" && <span className="text-xs font-medium text-primary">{rel}</span>}
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>{MEETING_TYPES[m.meetingType as MeetingType].label}</span>
          {m.offering && <span>{m.offering.course.code}-{m.offering.section} {m.offering.course.title}</span>}
          <span>{m.host.name}</span>
          <span className="inline-flex items-center gap-1"><Users className="size-3" aria-hidden />{m._count.participants}</span>
          <span className="inline-flex items-center gap-1"><CalendarClock className="size-3" aria-hidden />{fmtDateTimeZoned(m.scheduledStart, timezone)}</span>
          {m._count.recordings > 0 && <span className="inline-flex items-center gap-1"><Video className="size-3" aria-hidden />{m._count.recordings} recording{m._count.recordings > 1 ? "s" : ""}</span>}
        </p>
      </div>
      {action ? <MeetingPrimaryButton meetingId={m.id} publicId={m.publicId} mode={action} /> : <Link href={`/video/${m.publicId}`} className="text-sm font-medium text-primary hover:underline">Details</Link>}
    </article>
  );
}
