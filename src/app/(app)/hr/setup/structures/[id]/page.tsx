import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { ActivateSalaryStructureButton, SalaryStructureEditor } from "@/features/hr/controls";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Salary structure" };

export default async function SalaryStructurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("payroll.process");
  const isNew = id === "new";
  const s = isNew ? null : await db.salaryStructure.findUnique({ where: { id }, include: { lines: { orderBy: { order: "asc" } } } });
  if (!isNew && !s) notFound();
  const [components, active] = await Promise.all([
    db.salaryComponent.findMany({ where: { isActive: true }, orderBy: [{ kind: "asc" }, { code: "asc" }] }),
    s ? db.salaryStructure.count({ where: { code: s.code, status: "ACTIVE", id: { not: s.id } } }) : 0,
  ]);
  const KIND = { EARNING: "earning", DEDUCTION: "deduction", EMPLOYER_CONTRIBUTION: "employer" } as const;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "HR setup", href: "/hr/setup?tab=payroll" }, { label: s ? `${s.code} v${s.version}` : "New" }]}
        title={s ? s.name : "New salary structure"}
        description={s ? (s.status === "DRAFT" ? "Draft — editable. Activate it to assign it to employees." : s.status === "ACTIVE" ? "In use — saving creates the next version as a draft; payslips already computed keep their amounts." : "Retired.") : undefined}
        actions={s?.status === "DRAFT" ? <ActivateSalaryStructureButton id={s.id} hasPrevious={active > 0} /> : null}
      />
      <Section title="Components">
        <SalaryStructureEditor
          id={s?.id ?? null}
          readOnly={s?.status === "RETIRED"}
          components={components.map((c) => ({ id: c.id, label: `${c.code} — ${c.name} (${KIND[c.kind]})`, kind: c.kind }))}
          initial={s ? { code: s.code, name: s.name, lines: s.lines.map((l) => ({ componentId: l.componentId, calc: l.calc, value: String(Number(l.value)), cap: l.cap ? String(Number(l.cap)) : "" })) } : { code: "", name: "", lines: [] }}
        />
      </Section>
    </div>
  );
}
