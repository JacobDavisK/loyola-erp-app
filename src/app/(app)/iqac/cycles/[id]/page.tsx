import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Lock, Unlock } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { assignMetricsAction, closeCycleAction } from "@/features/quality/actions";
import { RESPONSE_STATUS } from "@/features/quality/fields";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { progressFor } from "@/server/services/iqac";

export const metadata: Metadata = { title: "Accreditation cycle" };

export default async function CyclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageAuth("iqac.view");
  const cycle = await db.accreditationCycle.findUnique({ where: { id }, include: { framework: { include: { metrics: { where: { parentId: null }, orderBy: { order: "asc" } } } }, academicYear: true } });
  if (!cycle) notFound();
  const manage = can(ctx, "iqac.manage");
  const [responses, progress, staff] = await Promise.all([
    db.metricResponse.findMany({ where: { cycleId: id, ...(sp.status && sp.status in RESPONSE_STATUS ? { status: sp.status as keyof typeof RESPONSE_STATUS } : {}) }, include: { metric: true, assignee: { select: { name: true } }, _count: { select: { evidence: true } } }, orderBy: { metric: { order: "asc" } } }),
    progressFor(id),
    manage ? db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, designation: true } }) : [],
  ]);
  const groups = cycle.framework.metrics.map((top) => ({ top, rows: responses.filter((r) => r.metric.code === top.code || r.metric.code.startsWith(`${top.code}.`)) }));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${cycle.framework.code} · ${cycle.academicYear.label}${cycle.yearsCovered > 1 ? ` · ${cycle.yearsCovered} years of data` : ""}`}
        title={cycle.name}
        breadcrumbs={[{ label: "IQAC", href: "/iqac" }, { label: cycle.name }]}
        description={`${cycle.isClosed ? "Closed" : "Open"}${cycle.dueDate ? ` · due ${fmtDate(cycle.dueDate)}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline"><Link href={`/iqac/cycles/${id}/report`}><FileText /> Compiled report</Link></Button>
            {manage && !cycle.isClosed && (
              <FormDialog title="Assignment" id={id} action={assignMetricsAction} submitLabel="Assign" trigger={<Button size="sm">Assign metrics</Button>}
                fields={[{ name: "codePrefix", label: "Metric or criterion code", type: "text", placeholder: "3 or 3.3 or 3.3.1", hint: "Assigns every open metric under this code." }, { name: "userId", label: "Data owner", type: "select", options: staff.map((u) => ({ value: u.id, label: `${u.name}${u.designation ? ` — ${u.designation}` : ""}` })) }]} />
            )}
            {manage && <ActionButton label={cycle.isClosed ? "Reopen" : "Close cycle"} icon={cycle.isClosed ? <Unlock /> : <Lock />} run={closeCycleAction.bind(null, id, !cycle.isClosed)} confirmText={cycle.isClosed ? "Reopen this cycle for changes?" : "Close this cycle? Responses can no longer be edited."} />}
          </div>
        }
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <StatCard label="Weighted progress" value={`${progress.percent}%`} />
        <StatCard label="Approved" value={`${progress.approved}/${progress.total}`} href="?status=APPROVED" />
        <StatCard label="To review" value={progress.submitted} tone={progress.submitted ? "warning" : undefined} href="?status=SUBMITTED" />
        <StatCard label="In progress" value={progress.draft} href="?status=DRAFT" />
        <StatCard label="Not started" value={progress.notStarted} href="?status=NOT_STARTED" />
      </div>
      {groups.filter((g) => g.rows.length).map(({ top, rows }) => (
        <Section key={top.id} title={`${top.code}. ${top.title}`} bodyClassName="p-0">
          <DataTable head={[{ label: "Metric" }, { label: "Owner" }, { label: "Value", className: "text-right" }, { label: "Evidence", className: "text-right" }, { label: "Status" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="max-w-xl"><Link className="hover:text-primary" href={`/iqac/responses/${r.id}`}><span className="font-mono text-xs text-muted-foreground">{r.metric.code}</span> {r.metric.title}</Link></Td>
                <Td className="text-xs">{r.assignee?.name ?? <span className="text-tone-warning">unassigned</span>}</Td>
                <Td className="text-right tabular">{r.value ?? (r.narrative ? "text" : "—")}</Td>
                <Td className="text-right tabular">{r._count.evidence}</Td>
                <Td><StatusBadge meta={RESPONSE_STATUS[r.status]} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      ))}
      {responses.length === 0 && <p className="text-sm text-muted-foreground">No metrics match.</p>}
    </div>
  );
}
