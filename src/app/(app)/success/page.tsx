import Link from "next/link";
import { RefreshCcw } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { recomputeRisksAction } from "@/features/success/actions";
import { CASE_SOURCE, CASE_STATUS, RISK_LEVEL, type RiskFactorView } from "@/features/success/labels";
import { RiskFactors } from "@/features/success/risk-factors";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { caseWhere, successOverview, successStudentWhere } from "@/server/services/success";
import { Activity } from "lucide-react";

export const metadata: Metadata = { title: "Student success" };

export default async function SuccessPage({ searchParams }: { searchParams: Promise<{ tab?: string; level?: string }> }) {
  const ctx = await requirePageAuth();
  const sp = await searchParams;
  const mentor = await db.mentorAssignment.count({ where: { mentorId: ctx.user.id, endsOn: null } });
  if (!can(ctx, "success.view") && !mentor && ctx.user.userType === "STAFF") {
    const assigned = await db.supportCase.count({ where: { assigneeId: ctx.user.id } });
    if (!assigned) return <EmptyState icon={Activity} title="No students to follow" description="You see early-warning information for your mentees and for students in departments you oversee." />;
  }
  const tab = sp.tab ?? "risk";
  const o = await successOverview(ctx);
  if (!o) return <EmptyState icon={Activity} title="No current term" description="Early warning runs for the current term." />;
  const level = (["HIGH", "MEDIUM", "LOW"] as const).find((l) => l === sp.level) ?? null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Student success"
        description={`Early-warning scores for ${o.term.name} from attendance, internal marks, uncleared failures, overdue fees and online engagement — recomputed twice a day — and the support cases opened for students who need help.`}
        actions={can(ctx, "success.manage") ? <ActionButton label="Recompute now" icon={<RefreshCcw />} run={recomputeRisksAction} /> : undefined}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="High risk" value={o.high} tone={o.high ? "danger" : undefined} href="?tab=risk&level=HIGH" />
        <StatCard label="Medium risk" value={o.medium} tone={o.medium ? "warning" : undefined} href="?tab=risk&level=MEDIUM" />
        <StatCard label="Low risk" value={o.low} href="?tab=risk&level=LOW" />
        <StatCard label="Open cases" value={o.openCases} href="?tab=cases" />
        <StatCard label="Cases past due" value={o.overdueCases} tone={o.overdueCases ? "danger" : undefined} href="?tab=cases" />
      </div>
      <LinkTabs tabs={[{ key: "risk", label: "Early warning", href: "?tab=risk" }, { key: "cases", label: "Support cases", href: "?tab=cases" }]} active={tab} />
      {tab === "risk" ? <RiskList termId={o.term.id} ctx={ctx} level={level} /> : <Cases ctx={ctx} />}
    </div>
  );
}

async function RiskList({ termId, ctx, level }: { termId: string; ctx: Awaited<ReturnType<typeof requirePageAuth>>; level: "HIGH" | "MEDIUM" | "LOW" | null }) {
  const rows = await db.studentRisk.findMany({
    where: { termId, student: successStudentWhere(ctx), ...(level ? { level } : { level: { in: ["HIGH", "MEDIUM"] } }) },
    orderBy: { score: "desc" },
    take: 300,
    include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, program: { select: { code: true } }, mentors: { where: { endsOn: null }, select: { mentor: { select: { name: true } } } }, supportCases: { where: { status: { in: ["OPEN", "IN_PROGRESS"] } }, select: { id: true, number: true } } } } },
  });
  return (
    <Section title={level ? `${level.charAt(0) + level.slice(1).toLowerCase()} risk` : "High and medium risk"} description="The strongest signals are listed for each student. Open the student for the full picture." bodyClassName="p-0">
      <DataTable head={[{ label: "Student" }, { label: "Score" }, { label: "Why" }, { label: "Mentor" }, { label: "Case" }]} empty="No students at this level.">
        {rows.map((r) => (
          <tr key={r.id} className="align-top">
            <Td><Link className="font-medium hover:text-primary" href={`/students/${r.student.id}?tab=support`}>{r.student.firstName} {r.student.lastName}</Link><div className="font-mono text-xs text-muted-foreground">{r.student.studentNo} · {r.student.program.code}</div></Td>
            <Td><div className={cn("font-mono font-semibold", r.level === "HIGH" ? "text-tone-danger" : r.level === "MEDIUM" ? "text-tone-warning" : "text-tone-success")}>{r.score}</div><StatusBadge meta={RISK_LEVEL[r.level]} /></Td>
            <Td><RiskFactors factors={r.factors as unknown as RiskFactorView[]} compact /></Td>
            <Td className="text-xs">{r.student.mentors[0]?.mentor.name ?? <span className="text-tone-warning">none</span>}</Td>
            <Td className="text-xs">{r.student.supportCases[0] ? <Link className="text-primary hover:underline" href={`/success/cases/${r.student.supportCases[0].id}`}>{r.student.supportCases[0].number}</Link> : "—"}</Td>
          </tr>
        ))}
      </DataTable>
      <p className="px-5 py-3 text-xs text-muted-foreground">Updated {fmtDateTime(rows[0]?.computedAt)}</p>
    </Section>
  );
}

async function Cases({ ctx }: { ctx: Awaited<ReturnType<typeof requirePageAuth>> }) {
  const now = new Date();
  const rows = await db.supportCase.findMany({
    where: caseWhere(ctx),
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 200,
    include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } }, assignee: { select: { name: true } } },
  });
  return (
    <Section title="Support cases" bodyClassName="p-0">
      <DataTable head={[{ label: "Case" }, { label: "Student" }, { label: "Source" }, { label: "Assigned to" }, { label: "Due" }, { label: "Status" }]} empty="No support cases.">
        {rows.map((c) => {
          const late = ["OPEN", "IN_PROGRESS"].includes(c.status) && c.dueAt < now;
          return (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/success/cases/${c.id}`}>{c.summary}</Link><div className="font-mono text-[11px] text-muted-foreground">{c.number} · {c.level.toLowerCase()}</div></Td>
              <Td className="text-sm">{c.student.firstName} {c.student.lastName} <span className="font-mono text-xs text-muted-foreground">{c.student.studentNo}</span></Td>
              <Td className="text-xs">{CASE_SOURCE[c.source]}</Td>
              <Td className="text-xs">{c.assignee?.name ?? <span className="text-tone-warning">unassigned</span>}</Td>
              <Td className={cn("text-xs", late && "font-medium text-tone-danger")}>{fmtDate(c.dueAt)}{late ? " · overdue" : ""}</Td>
              <Td><StatusBadge meta={CASE_STATUS[c.status]} /></Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}
