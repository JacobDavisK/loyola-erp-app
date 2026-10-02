import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { RequestForm } from "@/features/operations/controls";
import { fiscalYearOf } from "@/lib/domain/operations";
import { can, isSuperAdmin, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "New purchase request" };

export default async function NewRequestPage() {
  const ctx = await requirePageAuth(["procurement.request", "procurement.manage"]);
  const scope = isSuperAdmin(ctx) || can(ctx, "procurement.manage") ? null : scopeOf(ctx, "procurement.request");
  const departments = await db.department.findMany({ where: scope === null ? {} : { id: { in: scope } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const [items, lines] = await Promise.all([
    db.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    db.budgetLine.findMany({ where: { budget: { status: "APPROVED", fiscalYear: fiscalYearOf(new Date()), OR: [{ departmentId: null }, { departmentId: { in: departments.map((d) => d.id) } }] } }, include: { account: true, budget: { include: { department: { select: { code: true } } } } } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="New purchase request" breadcrumbs={[{ label: "Purchasing", href: "/procurement" }, { label: "New request" }]} description="Save the request as a draft, then send it for approval. Link it to a budget line so the amount is checked against what is left." />
      <Section title="Request">
        <RequestForm
          departments={departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }))}
          items={items.map((i) => ({ id: i.id, label: `${i.name} (${i.code})`, unit: i.unit }))}
          budgetLines={lines.map((l) => ({ id: l.id, label: `${l.budget.fiscalYear} ${l.budget.department?.code ?? "Institution"} · ${l.account.name}` }))}
        />
      </Section>
    </div>
  );
}
