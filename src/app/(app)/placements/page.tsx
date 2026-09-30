import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { saveCompanyAction, saveDriveAction } from "@/features/campus/actions";
import { driveFields } from "@/features/campus/fields";
import { formatMoney } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { placementStats } from "@/server/services/placements";

export const metadata: Metadata = { title: "Placements" };


export default async function PlacementsPage() {
  await requirePageAuth("placement.manage");
  const [companies, drives, stats, inst] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { drives: true } } } }),
    db.placementDrive.findMany({ orderBy: { applyBy: "desc" }, include: { company: { select: { name: true } }, applications: { select: { status: true } } } }),
    placementStats(),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (n: number | null) => (n === null ? "—" : formatMoney(Math.round(n * 100), inst.currency, inst.locale));
  return (
    <div className="space-y-6">
      <PageHeader title="Placements" description="Companies and recruitment drives. Eligibility (CGPA, programme, backlogs, batch, one-offer policy) is checked against academic records when students apply."
        actions={<div className="flex gap-2"><FormDialog title="Company" columns={2} action={saveCompanyAction} fields={[{ name: "name", label: "Name", type: "text" }, { name: "industry", label: "Industry", type: "text", optional: true }, { name: "website", label: "Website", type: "text", optional: true }, { name: "contactName", label: "Contact person", type: "text", optional: true }, { name: "contactEmail", label: "Contact e-mail", type: "email", optional: true }]} trigger={<Button size="sm" variant="outline"><Plus /> Company</Button>} /><FormDialog title="Drive" columns={2} fields={driveFields(companies)} action={saveDriveAction} initial={{ status: "DRAFT" }} trigger={<Button size="sm"><Plus /> Drive</Button>} /></div>} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        <StatCard label="Offers" value={stats.offers} />
        <StatCard label="Students placed" value={stats.placedStudents} />
        <StatCard label="Highest CTC" value={fmt(stats.highest)} />
        <StatCard label="Median CTC" value={fmt(stats.median)} />
      </div>
      <Section title="Drives" bodyClassName="p-0">
        <DataTable head={[{ label: "Drive" }, { label: "Role" }, { label: "CTC", className: "text-right" }, { label: "Apply by" }, { label: "Applied", className: "text-right" }, { label: "Selected", className: "text-right" }, { label: "Status" }]} empty="No drives.">
          {drives.map((d) => (
            <tr key={d.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/placements/drives/${d.id}`}>{d.company.name}</Link><div className="text-xs text-muted-foreground">{d.title}</div></Td>
              <Td className="text-xs">{d.role}</Td>
              <Td className="text-right tabular">{fmt(Number(d.ctc))}</Td>
              <Td className="text-xs">{fmtDate(d.applyBy)}</Td>
              <Td className="text-right tabular">{d.applications.filter((a) => a.status !== "WITHDRAWN").length}</Td>
              <Td className="text-right tabular">{d.applications.filter((a) => a.status === "SELECTED").length}</Td>
              <Td className="text-xs">{d.status.toLowerCase()}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Companies" bodyClassName="p-0">
        <DataTable head={[{ label: "Company" }, { label: "Industry" }, { label: "Drives", className: "text-right" }]}>
          {companies.map((c) => <tr key={c.id}><Td>{c.website ? <a className="hover:text-primary" href={c.website} target="_blank" rel="noopener noreferrer">{c.name}</a> : c.name}</Td><Td className="text-xs">{c.industry ?? "—"}</Td><Td className="text-right tabular">{c._count.drives}</Td></tr>)}
        </DataTable>
      </Section>
    </div>
  );
}
