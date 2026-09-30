import Link from "next/link";
import { ListChecks } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { RESPONSE_STATUS } from "@/features/quality/fields";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Accreditation tasks" };

export default async function MyIqacPage() {
  const ctx = await requirePageAuth();
  const rows = await db.metricResponse.findMany({
    where: { assigneeId: ctx.user.id, cycle: { isClosed: false } },
    include: { metric: true, cycle: { select: { name: true, dueDate: true, framework: { select: { code: true } } } } },
    orderBy: [{ cycle: { dueDate: "asc" } }, { metric: { order: "asc" } }],
  });
  const open = rows.filter((r) => r.status !== "APPROVED");
  return (
    <div className="space-y-6">
      <PageHeader title="Accreditation tasks" breadcrumbs={[{ label: "My work" }, { label: "Accreditation" }]} description="Metrics IQAC has asked you to provide. Enter or compute the value, write the narrative, attach evidence and submit." />
      {rows.length === 0 ? <EmptyState icon={ListChecks} title="Nothing assigned to you" description="IQAC assigns accreditation metrics to data owners; they will appear here." /> : (
        <Section title={`${open.length} open of ${rows.length}`} bodyClassName="p-0">
          <DataTable head={[{ label: "Metric" }, { label: "Cycle" }, { label: "Due" }, { label: "Status" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="max-w-xl"><Link className="hover:text-primary" href={`/iqac/responses/${r.id}`}><span className="font-mono text-xs text-muted-foreground">{r.metric.code}</span> {r.metric.title}</Link></Td>
                <Td className="text-xs">{r.cycle.framework.code} · {r.cycle.name}</Td>
                <Td className="text-xs">{fmtDate(r.cycle.dueDate)}</Td>
                <Td><StatusBadge meta={RESPONSE_STATUS[r.status]} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
