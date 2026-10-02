import { notFound } from "next/navigation";
import { Check, X } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { WeekGrid } from "@/components/app/week-grid";
import { ActionButton } from "@/features/academic-ops/controls";
import { applyTimetableRunAction, discardTimetableRunAction } from "@/features/teaching/actions";
import { DAY_NAMES } from "@/lib/domain/timetable";
import { requirePageAuth } from "@/server/auth/current";
import { loadRun } from "@/server/services/timetable-generator";

export const metadata: Metadata = { title: "Timetable proposal" };

export default async function TimetableRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cls?: string }> }) {
  const { id } = await params;
  const { cls } = await searchParams;
  const ctx = await requirePageAuth("timetable.manage");
  const data = await loadRun(ctx, id).catch(() => null);
  if (!data) notFound();
  const { run, placements, unplaced } = data;
  const stats = run.stats as { placed: number; requested: number; classes: number; periodsUsed: number };
  const labels = [...new Set(placements.map((p) => p.label))].sort();
  const shown = cls ? placements.filter((p) => p.label === cls) : placements;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Timetable", href: "/academics/timetable" }, { label: "Proposal" }]}
        title={`Timetable proposal — ${run.term.name}`}
        description={run.status === "DRAFT" ? "Review the proposed slots. Applying adds them to the classes; it is refused if anything now clashes." : `This proposal was ${run.status.toLowerCase()}.`}
        actions={run.status === "DRAFT" ? (
          <>
            <ActionButton label="Apply to the timetable" variant="default" icon={<Check />} run={applyTimetableRunAction.bind(null, run.id)} confirmText={`Add ${placements.length} slot(s) to the timetable?`} />
            <ActionButton label="Discard" icon={<X />} run={discardTimetableRunAction.bind(null, run.id)} />
          </>
        ) : undefined}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Classes" value={stats.classes} />
        <StatCard label="Sessions placed" value={`${stats.placed} / ${stats.requested}`} tone={stats.placed < stats.requested ? "warning" : "success"} />
        <StatCard label="Periods used" value={stats.periodsUsed} />
        <StatCard label="Not placed" value={unplaced.length} tone={unplaced.length ? "danger" : undefined} />
      </div>
      {unplaced.length > 0 && (
        <Section title="Could not be placed" description="Place these by hand on the class page, add rooms, or relax the teacher's daily limit in settings." bodyClassName="p-0">
          <DataTable head={[{ label: "Class" }, { label: "Session" }, { label: "Why" }]}>
            {unplaced.map((u, i) => <tr key={i}><Td className="font-mono text-sm">{u.label}</Td><Td className="text-xs">{u.kind.toLowerCase()}</Td><Td className="text-xs text-tone-danger">{u.reason}</Td></tr>)}
          </DataTable>
        </Section>
      )}
      <form className="flex items-center gap-2">
        <label htmlFor="cls" className="text-xs text-muted-foreground">Show</label>
        <select id="cls" name="cls" defaultValue={cls ?? ""} className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All classes</option>{labels.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        <button className="h-8 rounded-lg border px-3 text-[13px]">Filter</button>
      </form>
      <Section title={cls ?? "All proposed slots"}>
        <WeekGrid items={shown.map((p, i) => ({ id: String(i), dayOfWeek: p.day, startTime: p.startTime, endTime: p.endTime, tone: p.kind === "LAB" ? "lab" : "default", title: p.label, subtitle: p.roomCode }))} />
      </Section>
      <Section title="List" bodyClassName="p-0">
        <DataTable head={[{ label: "Day" }, { label: "Time" }, { label: "Class" }, { label: "Kind" }, { label: "Room" }]}>
          {shown.map((p, i) => <tr key={i}><Td>{DAY_NAMES[p.day]}</Td><Td className="font-mono text-xs">{p.startTime}–{p.endTime}</Td><Td className="font-mono">{p.label}</Td><Td className="text-xs">{p.kind.toLowerCase()}</Td><Td>{p.roomCode}</Td></tr>)}
        </DataTable>
      </Section>
    </div>
  );
}
