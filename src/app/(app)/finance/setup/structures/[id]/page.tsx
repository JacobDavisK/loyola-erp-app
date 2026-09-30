import { notFound } from "next/navigation";
import { Stamp } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { activateStructureAction } from "@/features/finance/actions";
import { StructureEditor, type StructureValue } from "@/features/finance/structure-editor";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Fee structure" };

export default async function StructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("fee.manage");
  const isNew = id === "new";
  const s = isNew ? null : await db.feeStructure.findUnique({ where: { id }, include: { lines: true } });
  if (!isNew && !s) notFound();
  const [heads, years, programs, batches] = await Promise.all([
    db.feeHead.findMany({ where: { isActive: true }, orderBy: { code: "asc" } }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }] }),
  ]);
  const initial: StructureValue = s
    ? { code: s.code, name: s.name, academicYearId: s.academicYearId, programId: s.programId ?? "", batchId: s.batchId ?? "", lines: s.lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: String(l.amount), semester: l.semester ? String(l.semester) : "", termType: l.termType ?? "", dueDays: l.dueDays })) }
    : { code: "", name: "", academicYearId: years.find((y) => y.isCurrent)?.id ?? years[0]?.id ?? "", programId: "", batchId: "", lines: [] };
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Setup", href: "/finance/setup" }, { label: s ? `${s.code} v${s.version}` : "New" }]}
        title={s ? s.name : "New fee structure"}
        description={s ? (s.status === "DRAFT" ? "Draft — editable. Activate it to use it for invoicing." : "In use — saving creates the next version as a draft; invoices already raised keep their version.") : undefined}
        actions={s?.status === "DRAFT" ? <ActionButton run={activateStructureAction.bind(null, s.id)} label="Activate" icon={<Stamp />} confirmText="Activate this version? The previous active version of this structure is retired." /> : null}
      />
      <StructureEditor
        id={s?.id ?? null}
        initial={initial}
        readOnly={false}
        heads={heads.map((h) => ({ id: h.id, label: `${h.code} — ${h.name}` }))}
        years={years.map((y) => ({ id: y.id, label: y.label }))}
        programs={programs.map((p) => ({ id: p.id, label: p.code }))}
        batches={batches.map((b) => ({ id: b.id, label: b.code }))}
      />
    </div>
  );
}
