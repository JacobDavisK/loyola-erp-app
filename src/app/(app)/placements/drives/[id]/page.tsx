import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { saveDriveAction } from "@/features/campus/actions";
import { PlacementStatusButtons } from "@/features/campus/controls";
import { driveFields } from "@/features/campus/fields";
import { PLACEMENT_STATUS } from "@/features/campus/labels";
import { driveEligibilitySchema } from "@/lib/domain/campus";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime, toZonedInput } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Placement drive" };

export default async function DrivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("placement.manage");
  const d = await db.placementDrive.findUnique({ where: { id }, include: { company: true, applications: { orderBy: { createdAt: "asc" }, include: { student: { select: { studentNo: true, firstName: true, lastName: true, program: { select: { code: true } } } } } } } });
  if (!d) notFound();
  const [companies, inst] = await Promise.all([db.company.findMany({ orderBy: { name: "asc" } }), getInstitution()]);
  const e = driveEligibilitySchema.catch({}).parse(d.eligibility);
  const fmt = (x: { toString(): string } | null) => (x === null ? "—" : formatMoney(toMinor(x), inst.currency, inst.locale));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow={d.company.name} title={d.title} breadcrumbs={[{ label: "Placements", href: "/placements" }, { label: d.company.name }]} description={`${d.role} · ${fmt(d.ctc)} · ${d.status.toLowerCase()}`}
        actions={<FormDialog title="Drive" columns={2} id={d.id} fields={driveFields(companies)} action={saveDriveAction} trigger={<Button size="sm" variant="outline">Edit</Button>}
          initial={{ companyId: d.companyId, status: d.status, title: d.title, role: d.role, ctc: Number(d.ctc), location: d.location, applyBy: toZonedInput(d.applyBy, inst.timezone), driveDate: toZonedInput(d.driveDate, inst.timezone), minCgpa: e.minCgpa ?? null, maxActiveBacklogs: e.maxActiveBacklogs ?? null, programCodes: e.programCodes?.join(", ") ?? "", batchYears: e.batchYears?.join(", ") ?? "", description: d.description }} />} />
      <Section title="Drive">
        <p className="mb-3 whitespace-pre-wrap text-sm">{d.description}</p>
        <KeyValue items={[["Apply by", fmtDateTime(d.applyBy)], ["Drive date", d.driveDate ? fmtDateTime(d.driveDate) : "—"], ["Location", d.location ?? "—"], ["Eligibility", [e.minCgpa !== undefined && `CGPA ≥ ${e.minCgpa}`, e.maxActiveBacklogs !== undefined && `≤ ${e.maxActiveBacklogs} backlog(s)`, e.programCodes?.length && e.programCodes.join("/"), e.batchYears?.length && `batch ${e.batchYears.join("/")}`].filter(Boolean).join(" · ") || "Open to all"]]} />
      </Section>
      <Section title={`Applicants (${d.applications.length})`} bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Programme" }, { label: "CGPA at applying", className: "text-right" }, { label: "Status" }, { label: "Offer", className: "text-right" }, { label: "" }]} empty="No applications yet.">
          {d.applications.map((a) => {
            const snap = a.snapshot as { cgpa?: number | null };
            return (
              <tr key={a.id}>
                <Td>{a.student.firstName} {a.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{a.student.studentNo}</div></Td>
                <Td className="text-xs">{a.student.program.code}</Td>
                <Td className="text-right tabular">{snap.cgpa ?? "—"}</Td>
                <Td><StatusBadge meta={PLACEMENT_STATUS[a.status]} /></Td>
                <Td className="text-right tabular">{fmt(a.offerCtc)}</Td>
                <Td className="text-right">{a.status !== "WITHDRAWN" && a.status !== "SELECTED" && <PlacementStatusButtons id={a.id} ctc={Number(d.ctc)} />}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
    </div>
  );
}
