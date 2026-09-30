import type { Metadata } from "next";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { CoverageHeatmap, DistributionBars, GrowthChart, WorkloadChart } from "@/features/analytics/charts";
import { requirePageAuth } from "@/server/auth/current";
import { analytics } from "@/server/services/analytics";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  const ctx = await requirePageAuth("analytics.view");
  const a = await analytics(ctx);
  const k = a.kpis;
  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="How the examination cycle and the question bank are performing." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Paper completion" value={`${k.completionRate}%`} hint={`${k.completed} of ${k.totalExams} examinations approved or locked`} />
        <StatCard label="Avg. submission time" value={k.avgSubmitDays == null ? "—" : `${k.avgSubmitDays.toFixed(1)} d`} hint="Assignment to submission" />
        <StatCard label="Moderation turnaround" value={k.avgModDays == null ? "—" : `${k.avgModDays.toFixed(1)} d`} hint="Start to decision" />
        <StatCard label="Question reuse rate" value={`${k.reuseRate}%`} hint="Used questions appearing in 2+ sessions" />
        <StatCard label="Question bank" value={k.questions.toLocaleString("en-IN")} hint="Active and pending questions" />
        <StatCard label="Overdue assignments" value={k.overdue} tone={k.overdue ? "danger" : undefined} href="/setters?tab=deadlines" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Question bank growth" description="Total questions, last 12 months"><GrowthChart data={a.growth} /></Section>
        <Section title="Setter workload" description="Assignments by setter"><WorkloadChart data={a.workload} /></Section>
        <Section title="Difficulty distribution" description="Questions in the bank"><DistributionBars data={a.difficulty} name="Questions" /></Section>
        <Section title="Bloom distribution" description="Questions in the bank"><DistributionBars data={a.bloom} name="Questions" /></Section>
      </div>
      <Section title="Unit coverage" description="Questions available per unit — empty cells are gaps the bank cannot generate papers from">
        <CoverageHeatmap rows={a.coverage} />
      </Section>
    </div>
  );
}
