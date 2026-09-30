import Link from "next/link";
import { FileBarChart, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteReportAction } from "@/features/insight/actions";
import { ReportBuilder } from "@/features/insight/report-builder";
import { definitionSchema } from "@/lib/domain/report";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { aiStatus } from "@/server/ai/gateway";
import { datasetsFor, fieldMeta } from "@/server/reports/engine";
import { loadReportFor, reportsFor } from "@/server/services/report-builder";

export const metadata: Metadata = { title: "Report builder" };

export default async function ReportBuilderPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await requirePageAuth();
  const { id } = await searchParams;
  const datasets = datasetsFor(ctx);
  if (!datasets.length) return <div><PageHeader title="Report builder" /><EmptyState icon={FileBarChart} title="No datasets available" description="Your roles do not include any reportable data." /></div>;
  const [saved, current, ai] = await Promise.all([reportsFor(ctx), id ? loadReportFor(ctx, id).catch(() => null) : null, aiStatus()]);
  const initial = current ? definitionSchema.parse(current.definition) : undefined;
  return (
    <div className="space-y-6">
      <PageHeader title="Report builder" breadcrumbs={[{ label: "Insight" }, { label: "Report builder" }]} description="Build tables and summaries from institutional data. Every report runs with your own access scope — a shared report never shows a colleague more than they could already see." />
      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <Section title="Saved reports" bodyClassName="p-0">
          <ul className="divide-y">
            <li><Link href="/reports/builder" className={cn("block px-4 py-2 text-sm hover:bg-muted/40", !current && "font-medium text-primary")}>+ New report</Link></li>
            {saved.map((r) => (
              <li key={r.id} className="flex items-center gap-1 pr-2">
                <Link href={`/reports/builder?id=${r.id}`} className={cn("block flex-1 px-4 py-2 text-sm hover:bg-muted/40", current?.id === r.id && "font-medium text-primary")}>
                  {r.name}<span className="block text-[11px] text-muted-foreground">{r.dataset}{r.shared ? ` · shared by ${r.owner.name}` : ""} · {fmtDate(r.updatedAt)}</span>
                </Link>
                {r.ownerId === ctx.user.id && <ActionButton size="xs" variant="ghost" label="" ariaLabel={`Delete ${r.name}`} icon={<Trash2 />} run={deleteReportAction.bind(null, r.id)} confirmText={`Delete "${r.name}"?`} />}
              </li>
            ))}
          </ul>
        </Section>
        <ReportBuilder
          key={current?.id ?? "new"}
          datasets={datasets.map((d) => ({ key: d.key, label: d.label, description: d.description, personal: d.personal, fields: fieldMeta(d) }))}
          initial={initial}
          savedId={current?.ownerId === ctx.user.id ? current.id : undefined}
          savedName={current?.name}
          aiAvailable={ai.configured && ai.enabled && ai.features.reportAssistant}
        />
      </div>
    </div>
  );
}
