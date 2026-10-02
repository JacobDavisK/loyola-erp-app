import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { CaseControls, CaseNoteForm } from "@/features/success/controls";
import { CASE_SOURCE, CASE_STATUS, NOTE_KIND, RISK_LEVEL, type RiskFactorView } from "@/features/success/labels";
import { RiskFactors } from "@/features/success/risk-factors";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { loadCase } from "@/server/services/success";

export const metadata: Metadata = { title: "Support case" };

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const data = await loadCase(ctx, id).catch(() => null);
  if (!data) notFound();
  const { case: c, manage } = data;
  const staff = ctx.user.userType === "STAFF";
  const term = await currentTerm();
  const [risk, staffList] = await Promise.all([
    staff && term ? db.studentRisk.findUnique({ where: { studentId_termId: { studentId: c.studentId, termId: term.id } } }) : null,
    manage ? db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null, departmentId: c.student.departmentId }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [],
  ]);
  const reasons = (c.reasons as string[]) ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={staff ? [{ label: "Student success", href: "/success?tab=cases" }, { label: c.number }] : [{ label: "Mentoring & support", href: "/portal/support" }, { label: c.number }]}
        eyebrow={<span className="font-mono">{c.number}</span>}
        title={c.summary}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="History">
            <ol className="space-y-4">
              {reasons.length > 0 && <li className="text-sm"><p className="font-medium">Reasons</p><ul className="ml-5 list-disc text-muted-foreground">{reasons.map((r, i) => <li key={i}>{r}</li>)}</ul></li>}
              {c.notes.map((n) => (
                <li key={n.id} className="border-l-2 pl-3">
                  <p className="text-xs text-muted-foreground">{n.author.name} · {NOTE_KIND[n.kind]} · {fmtDateTime(n.createdAt)}</p>
                  <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                </li>
              ))}
              {!c.notes.length && !reasons.length && <li className="text-sm text-muted-foreground">No notes yet.</li>}
            </ol>
            {c.status !== "CLOSED" && <div className="mt-5 border-t pt-4"><CaseNoteForm id={c.id} staff={staff} /></div>}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Case">
            <KeyValue items={[
              ["Student", staff ? <Link key="s" className="text-primary hover:underline" href={`/students/${c.student.id}?tab=support`}>{c.student.firstName} {c.student.lastName} ({c.student.studentNo})</Link> : `${c.student.firstName} ${c.student.lastName}`],
              ["Status", <StatusBadge key="st" meta={CASE_STATUS[c.status]} />],
              ["Level", <StatusBadge key="l" meta={RISK_LEVEL[c.level]} />],
              ["Source", CASE_SOURCE[c.source]],
              ["Raised by", c.raisedBy?.name ?? "Early-warning job"],
              ["Assigned to", c.assignee?.name ?? "—"],
              ["Respond by", fmtDateTime(c.dueAt)],
              ...(c.resolution ? ([["Resolution", c.resolution]] as [string, string][]) : []),
            ]} />
            {staff && <div className="mt-4"><CaseControls id={c.id} status={c.status} manage={manage} assignee={c.assigneeId} staff={staffList} /></div>}
          </Section>
          {risk && (
            <Section title={`Current risk: ${risk.score}`}>
              <RiskFactors factors={risk.factors as unknown as RiskFactorView[]} />
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
