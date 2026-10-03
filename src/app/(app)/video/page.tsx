import Link from "next/link";
import { CalendarPlus, Video } from "lucide-react";
import type { Metadata } from "next";
import { LinkTabs } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { InstantMeetingButton } from "@/features/video/controls";
import { canSchedule, meetingList } from "@/features/video/data";
import { VideoMeetingCard } from "@/features/video/meeting-card";
import { fmtDateTimeZoned } from "@/lib/format";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { getT } from "@/server/i18n";
import { getSetting } from "@/server/services/settings";
import { meetingWhere } from "@/server/services/video/access";
import { canWatch } from "@/server/services/video/recordings";

export const metadata: Metadata = { title: "Meetings" };

const VIEWS = ["today", "upcoming", "past", "cancelled", "drafts", "recordings"] as const;

export default async function VideoHome({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requirePageAuth("video.join");
  const t = await getT();
  const raw = (await searchParams).view;
  const view = (VIEWS as readonly string[]).includes(raw ?? "") ? (raw as (typeof VIEWS)[number]) : "today";
  const [{ timezone }, s] = await Promise.all([getInstitution(), getSetting("video")]);
  const now = new Date();
  const scheduler = canSchedule(ctx);
  const rows = view === "recordings" ? [] : await meetingList(ctx, view);
  const hostLike = (m: (typeof rows)[number]) => m.hostUserId === ctx.user.id || isSuperAdmin(ctx) || m.participants.some((p) => p.userId === ctx.user.id && p.role === "CO_HOST");

  let recordings: { id: string; title: string; publicId: string; at: Date; minutes: number | null }[] = [];
  if (view === "recordings") {
    const candidates = await db.videoMeetingRecording.findMany({ where: { deletedAt: null, status: { in: ["AVAILABLE", "ARCHIVED"] }, meeting: meetingWhere(ctx) }, include: { meeting: { include: { participants: true } } }, orderBy: { startedAt: "desc" }, take: 100 });
    for (const r of candidates) if (await canWatch(ctx, r, r.meeting)) recordings.push({ id: r.id, title: r.meeting.title, publicId: r.meeting.publicId, at: r.startedAt, minutes: r.durationSeconds ? Math.round(r.durationSeconds / 60) : null });
    recordings = recordings.slice(0, 50);
  }

  const tabs = [
    { key: "today", label: t("Today"), href: "/video" },
    { key: "upcoming", label: t("Upcoming"), href: "/video?view=upcoming" },
    { key: "past", label: t("Past"), href: "/video?view=past" },
    { key: "recordings", label: t("Recordings"), href: "/video?view=recordings" },
    { key: "cancelled", label: t("Cancelled"), href: "/video?view=cancelled" },
    ...(scheduler ? [{ key: "drafts", label: t("Drafts"), href: "/video?view=drafts" }] : []),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Meetings")}
        description={t("Online classes, mentoring, faculty and department meetings, vivas and webinars — attendance is recorded automatically.")}
        actions={scheduler ? (
          <div className="flex flex-wrap gap-2">
            {can(ctx, "video.create") && <InstantMeetingButton />}
            <Button size="sm" variant="outline" asChild><Link href="/video/new"><CalendarPlus /> {t("Schedule meeting")}</Link></Button>
          </div>
        ) : undefined}
      />
      <LinkTabs tabs={tabs} active={view} />
      {view === "recordings" ? (
        recordings.length ? (
          <ul className="divide-y rounded-2xl border bg-card">
            {recordings.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <Video className="size-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1"><Link className="font-medium hover:text-primary" href={`/video/${r.publicId}?tab=recordings`}>{r.title}</Link><div className="text-xs text-muted-foreground">{fmtDateTimeZoned(r.at, timezone)}{r.minutes ? ` · ${r.minutes} min` : ""}</div></div>
                <Link className="text-sm font-medium text-primary hover:underline" href={`/video/${r.publicId}?tab=recordings`}>{t("Watch")}</Link>
              </li>
            ))}
          </ul>
        ) : <EmptyState icon={Video} title={t("No recordings yet")} description={t("Recordings of meetings you can watch appear here once they are processed.")} />
      ) : rows.length ? (
        <div className="space-y-3">{rows.map((m) => <VideoMeetingCard key={m.id} m={m} userId={ctx.user.id} isHostLike={hostLike(m)} now={now} timezone={timezone} joinEarlyMinutes={s.joinEarlyMinutes} />)}</div>
      ) : (
        <EmptyState icon={Video} title={view === "today" ? t("Nothing scheduled today") : t("No meetings here")} description={scheduler ? t("Start a meeting now, or schedule one and the participants are invited automatically.") : t("Meetings you are invited to appear here.")} />
      )}
    </div>
  );
}
