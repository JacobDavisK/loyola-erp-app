import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { generateNadBatchAction } from "@/features/compliance/actions";
import { NAD_STATUS } from "@/features/compliance/labels";
import { fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { apaarCoverage } from "@/server/services/nad";

export const metadata: Metadata = { title: "ABC & NAD-DigiLocker" };

export default async function NadPage() {
  await requirePageAuth("apaar.manage");
  const [coverage, batches, terms, pendingVerification] = await Promise.all([
    apaarCoverage(),
    db.nadBatch.findMany({ orderBy: { createdAt: "desc" }, take: 100, select: { id: true, number: true, title: true, kind: true, status: true, rowCount: true, skipped: true, reference: true, createdAt: true } }),
    db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 12, select: { id: true, name: true } }),
    db.student.findMany({ where: { deletedAt: null, apaarId: { not: null }, apaarVerifiedAt: null }, select: { id: true, studentNo: true, firstName: true, lastName: true, apaarId: true }, orderBy: { studentNo: "asc" }, take: 50 }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Academic Bank of Credits & NAD-DigiLocker"
        description="Students' APAAR IDs, and upload files for the ABC credit bank and the National Academic Depository, built from published results and issued degree certificates. Students without a verified APAAR ID are held back and listed."
        actions={
          <FormDialog
            title="Upload file"
            action={generateNadBatchAction}
            submitLabel="Prepare file"
            initial={{ kind: "ABC_CREDITS", termId: terms[0]?.id ?? "" }}
            trigger={<Button size="sm"><FileSpreadsheet /> Prepare upload file</Button>}
            fields={[
              { name: "kind", label: "File", type: "select", options: [{ value: "ABC_CREDITS", label: "ABC — credits earned in a term" }, { value: "NAD_MARKSHEET", label: "NAD — semester mark sheets" }, { value: "NAD_DEGREE", label: "NAD — new degree certificates" }] },
              { name: "termId", label: "Term (not needed for degree certificates)", type: "select", optional: true, options: terms.map((t) => ({ value: t.id, label: t.name })) },
            ]}
          />
        }
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Students" value={coverage.total} />
        <StatCard label="APAAR ID recorded" value={coverage.withId} hint={coverage.total ? `${Math.round((coverage.withId / coverage.total) * 100)}%` : undefined} />
        <StatCard label="Verified" value={coverage.verified} tone={coverage.verified < coverage.total ? "warning" : undefined} />
        <StatCard label="Awaiting verification" value={coverage.awaitingVerification} />
        <StatCard label="Missing" value={coverage.missing} tone={coverage.missing ? "danger" : undefined} />
      </div>
      <Section title="Upload files" bodyClassName="p-0">
        <DataTable head={[{ label: "File" }, { label: "Rows" }, { label: "Held back" }, { label: "Prepared" }, { label: "Status" }]} empty="No files prepared yet.">
          {batches.map((b) => (
            <tr key={b.id}>
              <Td>
                <Link className="font-medium hover:text-primary" href={`/compliance/nad/${b.id}`}>{b.title}</Link>
                <div className="font-mono text-[11px] text-muted-foreground">{b.number}{b.reference ? ` · ref ${b.reference}` : ""}</div>
              </Td>
              <Td>{b.rowCount}</Td>
              <Td className={(b.skipped as unknown[]).length ? "text-tone-warning" : undefined}>{(b.skipped as unknown[]).length}</Td>
              <Td className="text-xs">{fmtDateTime(b.createdAt)}</Td>
              <Td><StatusBadge meta={NAD_STATUS[b.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="APAAR IDs awaiting verification" description="Check each against the student's APAAR card or DigiLocker, then verify it on the student's ABC & NEP tab." bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "APAAR ID" }]} empty="Nothing to verify.">
          {pendingVerification.map((s) => (
            <tr key={s.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/students/${s.id}?tab=nep`}>{s.firstName} {s.lastName}</Link> <span className="font-mono text-xs text-muted-foreground">{s.studentNo}</span></Td>
              <Td className="font-mono">{s.apaarId}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
