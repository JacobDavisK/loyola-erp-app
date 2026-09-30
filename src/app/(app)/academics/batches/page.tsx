import Link from "next/link";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { saveSetupAction } from "@/features/academic-ops/actions";
import { can, hasGlobal, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Batches" };

export default async function BatchesPage() {
  const ctx = await requirePageAuth("academic.view");
  const manage = hasGlobal(ctx, "academic.manage");
  const [batches, programs, regulations, curricula] = await Promise.all([
    db.batch.findMany({
      where: { deletedAt: null },
      orderBy: [{ admissionYear: "desc" }, { code: "asc" }],
      include: { program: { select: { code: true } }, regulation: { select: { code: true } }, curriculum: { select: { name: true, version: true } }, _count: { select: { students: { where: { deletedAt: null, status: "ACTIVE" } } } } },
    }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.regulation.findMany({ orderBy: { effectiveFromYear: "desc" } }),
    db.curriculum.findMany({ where: { status: { not: "RETIRED" } }, include: { program: { select: { code: true } } }, orderBy: [{ programId: "asc" }, { version: "desc" }] }),
  ]);
  const fields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true, placeholder: "BCA-2026" },
    { name: "name", label: "Name", type: "text", placeholder: "BCA 2026–29" },
    { name: "programId", label: "Programme", type: "select", options: programs.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) },
    { name: "regulationId", label: "Regulation", type: "select", options: regulations.map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` })) },
    { name: "admissionYear", label: "Admission year", type: "number" },
    { name: "graduationYear", label: "Expected graduation year", type: "number" },
    { name: "curriculumId", label: "Curriculum", type: "select", optional: true, options: curricula.map((c) => ({ value: c.id, label: `${c.program.code}: ${c.name} v${c.version}${c.status === "DRAFT" ? " (draft)" : ""}` })), hint: "Pins the degree requirements for this cohort.", wide: true },
  ];
  const year = new Date().getFullYear();
  return (
    <div>
      <PageHeader title="Batches" description="Cohorts admitted to a programme in a given year. Each batch pins the curriculum version its students must complete." />
      <Section title="All batches" actions={manage && <FormDialog title="Batch" fields={fields} columns={2} action={saveSetupAction.bind(null, "batch")} initial={{ admissionYear: year, graduationYear: year + 3 }} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Batch" }, { label: "Programme" }, { label: "Years" }, { label: "Regulation" }, { label: "Curriculum" }, { label: "Active students", className: "text-right" }, { label: "" }]}>
          {batches.map((b) => (
            <tr key={b.id}>
              <Td><div className="font-medium">{b.name}</div><div className="font-mono text-[11px] text-muted-foreground">{b.code}</div></Td>
              <Td className="text-xs">{b.program.code}</Td>
              <Td className="text-xs tabular">{b.admissionYear}–{b.graduationYear}</Td>
              <Td className="text-xs">{b.regulation.code}</Td>
              <Td className="text-xs">{b.curriculum ? `${b.curriculum.name} v${b.curriculum.version}` : <span className="text-muted-foreground">Programme default</span>}</Td>
              <Td className="text-right tabular">{can(ctx, "student.view") ? <Link href={`/students?batch=${b.id}`} className="hover:text-primary">{b._count.students}</Link> : b._count.students}</Td>
              <Td className="text-right">{manage && <FormDialog title="Batch" fields={fields} columns={2} action={saveSetupAction.bind(null, "batch")} id={b.id} initial={{ code: b.code, name: b.name, programId: b.programId, regulationId: b.regulationId, admissionYear: b.admissionYear, graduationYear: b.graduationYear, curriculumId: b.curriculumId }} />}</Td>
            </tr>
          ))}
        </DataTable>
        {batches.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No batches yet.</p>}
      </Section>
    </div>
  );
}
