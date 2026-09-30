import Link from "next/link";
import { ChartLine } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { Bars, Trend } from "@/features/insight/charts";
import { formatMoney } from "@/lib/domain/money";
import { requirePageAuth } from "@/server/auth/current";
import { getInstitution } from "@/server/services/directory";
import {
  admissionInsights, attendanceInsights, enrolmentInsights, financeInsights, libraryInsights, operationsInsights, payrollInsights, researchInsights, resultInsights,
} from "@/server/services/insights";

export const metadata: Metadata = { title: "Institution analytics" };

/** Cross-module dashboard. Sections appear only for the areas the viewer is authorised for, within their scope. */
export default async function InsightsPage() {
  const ctx = await requirePageAuth();
  const [inst, enrol, att, results, fin, payroll, research, library, admissions, ops] = await Promise.all([
    getInstitution(), enrolmentInsights(ctx), attendanceInsights(ctx), resultInsights(ctx), financeInsights(ctx), payrollInsights(ctx), researchInsights(ctx), libraryInsights(ctx), admissionInsights(ctx), operationsInsights(ctx),
  ]);
  const money = (n: number) => formatMoney(Math.round(n * 100), inst.currency, inst.locale);
  const nothing = !enrol && !att && !results && !fin && !payroll && !research && !library && !admissions && !ops.helpdesk && !ops.placements;
  return (
    <div className="space-y-6">
      <PageHeader title="Institution analytics" breadcrumbs={[{ label: "Insight" }, { label: "Analytics" }]} description="Live figures from every module you have access to. Build your own tables in the report builder." actions={<Link className="text-sm text-primary hover:underline" href="/reports/builder">Report builder →</Link>} />
      {nothing && <EmptyState icon={ChartLine} title="Nothing to show" description="Your roles do not include access to institutional data." />}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {enrol && <StatCard label="Active students" value={enrol.active} />}
        {att && <StatCard label="Attendance this term" value={att.percent === null ? "—" : `${att.percent}%`} hint={`Minimum ${att.minimum}%`} tone={att.percent !== null && att.percent < att.minimum ? "warning" : undefined} />}
        {fin && <StatCard label="Fees outstanding" value={money(fin.outstanding)} hint={`${money(fin.overdue)} overdue · ${fin.overdueInvoices} invoice(s)`} tone={fin.overdue ? "warning" : undefined} />}
        {research && <StatCard label="Research grants" value={money(research.grants)} hint={`${research.projects} project(s)`} />}
        {library && <StatCard label="Library items on loan" value={library.onLoan} hint={`${library.overdue} overdue`} />}
        {ops.helpdesk && <StatCard label="Helpdesk on-time" value={ops.helpdesk.slaPercent === null ? "—" : `${ops.helpdesk.slaPercent}%`} hint={`${ops.helpdesk.open} open · ${ops.helpdesk.breached} past SLA`} tone={ops.helpdesk.breached ? "warning" : undefined} />}
        {ops.placements && <StatCard label="Students placed" value={ops.placements.placedStudents} hint={ops.placements.median ? `median ${money(ops.placements.median)}` : undefined} />}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {enrol && <Section title="Active students by programme"><Bars data={enrol.byProgram} x="program" y="students" label="Active students by programme" horizontal /></Section>}
        {results && <Section title="Pass percentage by term"><Trend data={results} x="term" y="passPercent" label="Pass percentage by term" percent /></Section>}
        {fin && <Section title="Fee collections, last 12 months"><Bars data={fin.collections} x="month" y="amount" label="Fee collections by month" money currency={inst.currency} /></Section>}
        {payroll && <Section title="Payroll (net), approved runs"><Trend data={payroll} x="month" y="net" label="Net payroll by month" money currency={inst.currency} /></Section>}
        {research && <Section title="Verified publications by year"><Bars data={research.publications} x="year" y="publications" label="Verified publications by year" /></Section>}
        {library && <Section title="Library circulation, last 6 months"><Bars data={library.circulation} x="month" y="loans" label="Library loans by month" /></Section>}
        {admissions && <Section title="Admissions funnel (last 12 months)"><Bars data={admissions} x="stage" y="count" label="Admission applications by stage" horizontal /></Section>}
      </div>
    </div>
  );
}
