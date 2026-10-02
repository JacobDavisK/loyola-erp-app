import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { NadBatchActions } from "@/features/compliance/controls";
import { NAD_STATUS } from "@/features/compliance/labels";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { batchColumns, loadNadBatch } from "@/server/services/nad";

export const metadata: Metadata = { title: "Upload file" };

export default async function NadBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("apaar.manage");
  const data = await loadNadBatch(ctx, id).catch(() => null);
  if (!data) notFound();
  const { batch: b, rows, skipped } = data;
  const all = batchColumns(rows);
  const cols = all.slice(0, 14);
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "ABC & NAD", href: "/compliance/nad" }, { label: b.number }]}
        title={b.title}
        eyebrow={<span className="font-mono">{b.number}</span>}
        actions={<Button asChild size="sm"><a href={`/api/compliance/nad/${b.id}`}><Download /> Download CSV</a></Button>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Status">
          <div className="space-y-4">
            <KeyValue items={[
              ["Status", <StatusBadge key="s" meta={NAD_STATUS[b.status]} />],
              ["Rows", String(b.rowCount)],
              ["Prepared", fmtDateTime(b.createdAt)],
              ["Uploaded", fmtDateTime(b.submittedAt)],
              ["Portal response", fmtDateTime(b.respondedAt)],
              ["Reference", b.reference ?? "—"],
              ["Remarks", b.remarks ?? "—"],
            ]} />
            <NadBatchActions id={b.id} status={b.status} />
          </div>
        </Section>
        <Section title={`Held back (${skipped.length})`} description="Fix these and prepare a new file for them." bodyClassName="p-0">
          <DataTable head={[{ label: "Student" }, { label: "Reason" }]} empty="Every eligible student is in the file.">
            {skipped.map((s) => (
              <tr key={s.studentId}>
                <Td><Link className="hover:text-primary" href={`/students/${s.studentId}?tab=nep`}>{s.name}</Link> <span className="font-mono text-xs text-muted-foreground">{s.studentNo}</span></Td>
                <Td className="text-xs text-tone-warning">{s.reason}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      </div>
      <Section title="Preview" description={`First 50 rows and ${cols.length} of ${all.length} columns; the CSV has everything.`} bodyClassName="p-0">
        <div className="overflow-x-auto">
          <DataTable head={cols.map((c) => ({ label: c }))} empty="No rows.">
            {rows.slice(0, 50).map((r, i) => (
              <tr key={i}>{cols.map((c) => <Td key={c} className="whitespace-nowrap font-mono text-xs">{r[c] ?? ""}</Td>)}</tr>
            ))}
          </DataTable>
        </div>
      </Section>
    </div>
  );
}
