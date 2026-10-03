import Link from "next/link";
import { Download, Settings } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { MEETING_TYPES, type MeetingType } from "@/lib/domain/video";
import { fmtDateTimeZoned } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { getInstitution } from "@/server/services/directory";
import { videoDashboard } from "@/server/services/video/analytics";
import { videoProvider } from "@/server/video/provider";

export const metadata: Metadata = { title: "Video administration" };

function Bars({ rows, unit = "" }: { rows: { label: string; count: number }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  return (
    <ul className="space-y-2" role="list">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(90px,30%)_1fr_auto] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground" title={r.label}>{r.label}</span>
          <span className="h-2 rounded-full bg-muted" aria-hidden><span className="block h-2 rounded-full bg-primary" style={{ width: `${(r.count / max) * 100}%` }} /></span>
          <span className="tabular-nums">{r.count}{unit}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function VideoAdminPage() {
  const ctx = await requirePageAuth("video.view_analytics");
  const [d, { timezone }, provider] = await Promise.all([videoDashboard(ctx), getInstitution(), videoProvider()]);
  const health = await provider.health();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Video conference administration"
        description="Meetings across the departments you oversee. Restricted meetings (vivas, interviews, mentoring) count in the totals but are listed only to their participants."
        actions={
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild><a href="/api/video/analytics/export"><Download /> Export CSV</a></Button>
            {(can(ctx, "video.manage_settings") || can(ctx, "video.manage_global_settings")) && <Button size="sm" variant="outline" asChild><Link href="/admin/video"><Settings /> Settings</Link></Button>}
          </div>
        }
      />
      <div role="status" className={`rounded-xl border px-4 py-3 text-sm ${!provider.configured ? "bg-muted/40" : health.ok ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        Video service: {!provider.configured ? "not connected — scheduling and records work; meetings cannot start until OpenVidu is configured (see docs/openvidu-setup.md)." : health.ok ? `connected (${health.latencyMs} ms).` : "not responding — meetings cannot start right now."}
      </div>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard label="Total meetings" value={d.cards.total} />
        <StatCard label="Today" value={d.cards.today} />
        <StatCard label="Live now" value={d.cards.active} tone={d.cards.active ? "warning" : undefined} />
        <StatCard label="Upcoming" value={d.cards.upcoming} />
        <StatCard label="Recorded" value={d.cards.recorded} />
        <StatCard label="People who joined" value={d.cards.participants} />
        <StatCard label="Meeting hours (12 months)" value={d.cards.hours} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Meetings by type"><Bars rows={d.byType} /></Section>
        <Section title="Meetings by department"><Bars rows={d.byDepartment} /></Section>
        <Section title="Meetings held by month"><Bars rows={d.byMonth} /></Section>
        <Section title="Attendance">
          <Bars rows={d.attendance.map((a) => ({ label: a.status.toLowerCase().replace("_", " "), count: a.count }))} />
          <p className="mt-3 text-xs text-muted-foreground">Recordings: {d.recordings.count} · {d.recordings.hours} h · {d.recordings.gigabytes} GB</p>
        </Section>
      </div>
      <Section title="Live now" bodyClassName="p-0">
        <DataTable head={[{ label: "Meeting" }, { label: "Type" }, { label: "Host" }, { label: "Started" }, { label: "Connected", className: "text-right" }]} empty="No meetings are live.">
          {d.activeList.map((m) => (
            <tr key={m.id}><Td><Link className="font-medium hover:text-primary" href={`/video/${m.publicId}`}>{m.title}</Link><div className="font-mono text-[11px] text-muted-foreground">{m.publicId}</div></Td><Td className="text-xs">{MEETING_TYPES[m.meetingType as MeetingType].label}</Td><Td className="text-xs">{m.host.name}</Td><Td className="text-xs">{m.actualStart ? fmtDateTimeZoned(m.actualStart, timezone) : "starting"}</Td><Td className="text-right tabular-nums">{m._count.participants}</Td></tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Recent meetings" bodyClassName="p-0">
        <DataTable head={[{ label: "Meeting" }, { label: "Type" }, { label: "Host" }, { label: "Ended" }, { label: "Invited", className: "text-right" }]} empty="No meetings yet.">
          {d.recent.map((m) => (
            <tr key={m.id}><Td><Link className="font-medium hover:text-primary" href={`/video/${m.publicId}`}>{m.title}</Link><div className="font-mono text-[11px] text-muted-foreground">{m.publicId}</div></Td><Td className="text-xs">{MEETING_TYPES[m.meetingType as MeetingType].label}</Td><Td className="text-xs">{m.host.name}</Td><Td className="text-xs">{m.actualEnd ? fmtDateTimeZoned(m.actualEnd, timezone) : "—"}</Td><Td className="text-right tabular-nums">{m._count.participants}</Td></tr>
          ))}
        </DataTable>
      </Section>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Failed to start" bodyClassName="p-0">
          <DataTable head={[{ label: "Meeting" }, { label: "Reason" }]} empty="None.">
            {d.failed.map((m) => <tr key={m.id}><Td><Link className="font-medium hover:text-primary" href={`/video/${m.publicId}`}>{m.title}</Link></Td><Td className="text-xs">{m.failureReason ?? "—"}</Td></tr>)}
          </DataTable>
        </Section>
        <Section title="Recent recordings" bodyClassName="p-0">
          <DataTable head={[{ label: "Meeting" }, { label: "Status" }, { label: "Minutes", className: "text-right" }]} empty="None.">
            {d.recentRecordings.map((r) => <tr key={r.id}><Td><Link className="hover:text-primary" href={`/video/${r.meeting.publicId}?tab=recordings`}>{r.meeting.title}</Link></Td><Td className="text-xs">{r.status.toLowerCase()}</Td><Td className="text-right tabular-nums">{r.durationSeconds ? Math.round(r.durationSeconds / 60) : "—"}</Td></tr>)}
          </DataTable>
        </Section>
      </div>
    </div>
  );
}
