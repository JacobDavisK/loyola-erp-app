import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { RESPONSE_STATUS } from "@/features/quality/fields";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Accreditation report" };

/** Printable compilation of every metric response, in framework order — the working draft of a self-study report. */
export default async function CycleReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("iqac.view");
  const cycle = await db.accreditationCycle.findUnique({ where: { id }, include: { framework: { include: { metrics: { orderBy: [{ order: "asc" }, { code: "asc" }] } } }, academicYear: true } });
  if (!cycle) notFound();
  const [inst, responses] = await Promise.all([
    db.institution.findFirstOrThrow(),
    db.metricResponse.findMany({ where: { cycleId: id }, include: { assignee: { select: { name: true } }, evidence: { select: { label: true, url: true, file: { select: { originalName: true } } } } } }),
  ]);
  const byMetric = new Map(responses.map((r) => [r.metricId, r]));
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Compiled report" breadcrumbs={[{ label: cycle.name, href: `/iqac/cycles/${id}` }, { label: "Report" }]} actions={<PrintButton />} />
      <article className="surface-card space-y-5 p-8 print:border-0 print:shadow-none">
        <header className="border-b pb-4">
          <div className="text-lg font-semibold">{inst.name}</div>
          <div className="text-sm">{cycle.framework.name} — {cycle.name}</div>
          <div className="text-xs text-muted-foreground">Academic year {cycle.academicYear.label}{cycle.yearsCovered > 1 ? `, ${cycle.yearsCovered} years of data` : ""} · generated {fmtDate(new Date())} · only approved responses are final</div>
        </header>
        {cycle.framework.metrics.map((m) => {
          const r = byMetric.get(m.id);
          const top = !m.code.includes(".");
          if (top) return <h2 key={m.id} className="border-b pt-3 text-base font-semibold">Criterion {m.code}: {m.title}</h2>;
          if (!r) return <h3 key={m.id} className="pt-1 text-sm font-medium">{m.code} {m.title}</h3>;
          return (
            <section key={m.id} className="break-inside-avoid space-y-1 text-sm">
              <h3 className="font-medium">{m.code} {m.title} <span className="text-xs font-normal text-muted-foreground">[{RESPONSE_STATUS[r.status].label}{r.assignee ? ` · ${r.assignee.name}` : ""}]</span></h3>
              {m.kind === "QUANTITATIVE" && <p><b>{r.value ?? "—"}</b> {m.unit}</p>}
              {r.narrative && <p className="whitespace-pre-wrap">{r.narrative}</p>}
              {r.evidence.length > 0 && <p className="text-xs text-muted-foreground">Evidence: {r.evidence.map((e) => e.label + (e.file ? ` (${e.file.originalName})` : e.url ? ` (${e.url})` : "")).join("; ")}</p>}
            </section>
          );
        })}
      </article>
    </div>
  );
}
