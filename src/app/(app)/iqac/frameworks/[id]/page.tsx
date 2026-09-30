import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { ImportMetricsForm } from "@/features/quality/controls";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { SOURCES } from "@/server/services/iqac-sources";

export const metadata: Metadata = { title: "Framework" };

export default async function FrameworkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("iqac.view");
  const f = await db.accreditationFramework.findUnique({ where: { id }, include: { metrics: { orderBy: [{ order: "asc" }, { code: "asc" }] } } });
  if (!f) notFound();
  const depth = (code: string) => code.split(".").length - 1;
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={f.code} title={f.name} breadcrumbs={[{ label: "IQAC", href: "/iqac" }, { label: f.code }]} description={f.description ?? undefined} />
      <Section title="Metrics" bodyClassName="p-0">
        <DataTable head={[{ label: "Code" }, { label: "Metric" }, { label: "Type" }, { label: "Weight", className: "text-right" }, { label: "Platform data" }]} empty="No metrics yet.">
          {f.metrics.map((m) => (
            <tr key={m.id} className={depth(m.code) === 0 ? "bg-muted/30" : undefined}>
              <Td className="font-mono text-xs">{m.code}</Td>
              <Td className={depth(m.code) === 0 ? "font-medium" : "text-sm"}><span style={{ paddingLeft: `${depth(m.code) * 12}px` }}>{m.title}</span></Td>
              <Td className="text-xs">{m.kind === "QUANTITATIVE" ? "Quantitative" : "Narrative"}</Td>
              <Td className="text-right tabular">{m.weight || "—"}</Td>
              <Td className="text-xs">{m.source ? SOURCES[m.source]?.label ?? m.source : "—"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {can(ctx, "iqac.manage") && (
        <Section title="Add or update metrics" description={`Platform data sources: ${Object.keys(SOURCES).join(", ")}`}>
          <ImportMetricsForm frameworkId={f.id} />
        </Section>
      )}
    </div>
  );
}
