import "server-only";
import Link from "next/link";
import { CalendarPlus, Video } from "lucide-react";
import { Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { GoOnlineButton } from "@/features/video/controls";
import { canSchedule, meetingList } from "@/features/video/data";
import { VideoMeetingCard } from "@/features/video/meeting-card";
import { fmtDateTimeZoned, fmtTime } from "@/lib/format";
import { type AuthContext, can, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { getSetting } from "@/server/services/settings";
import { meetingWhere } from "@/server/services/video/access";
import { canWatch } from "@/server/services/video/recordings";

/**
 * Live classes for one course offering: upcoming and past online classes, recordings the viewer may watch,
 * and — for the class's teachers — "Go online" on the next timetabled sessions that are not online yet.
 * Used on the staff class workspace and the student course page; every list goes through meetingWhere/canWatch.
 */
export async function LiveClassesPanel({ ctx, offeringId, teacher }: { ctx: AuthContext; offeringId: string; teacher: boolean }) {
  if (!can(ctx, "video.join")) return <Section title="Live classes"><p className="text-sm text-muted-foreground">You do not have access to online meetings.</p></Section>;
  const now = new Date();
  const [{ timezone }, s, upcoming, past] = await Promise.all([
    getInstitution(), getSetting("video"),
    meetingList(ctx, "upcoming", { offeringId }, 20),
    meetingList(ctx, "past", { offeringId }, 20),
  ]);
  const hostLike = (m: (typeof upcoming)[number]) => m.hostUserId === ctx.user.id || isSuperAdmin(ctx) || m.participants.some((p) => p.userId === ctx.user.id && p.role === "CO_HOST");
  const sessions = teacher && can(ctx, "video.schedule")
    ? await db.classMeeting.findMany({ where: { offeringId, status: "SCHEDULED", endsAt: { gte: now }, videoMeeting: null }, orderBy: { startsAt: "asc" }, take: 5 })
    : [];
  const recs = await db.videoMeetingRecording.findMany({ where: { deletedAt: null, status: { in: ["AVAILABLE", "ARCHIVED"] }, meeting: { AND: [meetingWhere(ctx), { offeringId }] } }, include: { meeting: { include: { participants: true } } }, orderBy: { startedAt: "desc" }, take: 50 });
  const recordings = [];
  for (const r of recs) if (await canWatch(ctx, r, r.meeting)) recordings.push(r);

  return (
    <div className="space-y-6">
      <Section
        title="Live classes"
        description="Attendance for online classes is recorded automatically from the time each student is connected."
        actions={teacher && canSchedule(ctx) ? <Button size="sm" variant="outline" asChild><Link href={`/video/new?offering=${offeringId}`}><CalendarPlus /> Schedule online class</Link></Button> : undefined}
      >
        {upcoming.length ? (
          <div className="space-y-3">{upcoming.map((m) => <VideoMeetingCard key={m.id} m={m} userId={ctx.user.id} isHostLike={hostLike(m)} now={now} timezone={timezone} joinEarlyMinutes={s.joinEarlyMinutes} />)}</div>
        ) : <p className="text-sm text-muted-foreground">No online classes are scheduled.</p>}
      </Section>
      {sessions.length > 0 && (
        <Section title="Take a timetabled session online" description="Creates the online class for that session and invites the whole class." bodyClassName="p-0">
          <ul className="divide-y">
            {sessions.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <span className="flex-1">{fmtDateTimeZoned(c.startsAt, timezone)} – {fmtTime(c.endsAt, timezone)}{c.topic ? ` · ${c.topic}` : ""}</span>
                <GoOnlineButton classMeetingId={c.id} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Recordings" bodyClassName="p-0">
        {recordings.length ? (
          <ul className="divide-y">
            {recordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Video className="size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1"><Link className="font-medium hover:text-primary" href={`/video/${r.meeting.publicId}?tab=recordings`}>{r.meeting.title}</Link><div className="text-xs text-muted-foreground">{fmtDateTimeZoned(r.startedAt, timezone)}{r.durationSeconds ? ` · ${Math.round(r.durationSeconds / 60)} min` : ""}</div></div>
                <Link className="text-sm font-medium text-primary hover:underline" href={`/video/${r.meeting.publicId}?tab=recordings`}>Watch</Link>
              </li>
            ))}
          </ul>
        ) : <p className="px-5 py-4 text-sm text-muted-foreground">No recordings yet.</p>}
      </Section>
      {past.length > 0 && (
        <Section title="Past online classes">
          <div className="space-y-3">{past.map((m) => <VideoMeetingCard key={m.id} m={m} userId={ctx.user.id} isHostLike={hostLike(m)} now={now} timezone={timezone} joinEarlyMinutes={s.joinEarlyMinutes} />)}</div>
        </Section>
      )}
    </div>
  );
}
