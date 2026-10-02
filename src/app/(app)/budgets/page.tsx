import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { saveBudgetAction } from "@/features/operations/actions";
import { budgetFields } from "@/features/operations/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fiscalYearOf } from "@/lib/domain/operations";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const ctx = await requirePageAuth(["budget.manage", "budget.view"]);
  const manage = can(ctx, "budget.manage");
  const scope = manage ? null : scopeOf(ctx, "budget.view");
  const [budgets, departments] = await Promise.all([
    db.budget.findMany({ where: scope === null ? {} : { departmentId: { in: scope } }, include: { department: { select: { code: true, name: true } }, lines: { select: { amount: true } } }, orderBy: [{ fiscalYear: "desc" }, { createdAt: "asc" }] }),
    manage ? db.department.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }) : [],
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Budgets"
        description={`Annual allocations per department and ledger account for the financial year (April to March; the current year is ${fiscalYearOf(new Date())}). Spending is read from the ledger as bills are approved and stores are issued; purchase requests are checked against what remains. A budget is approved by an officer other than the one who prepared it.`}
        actions={manage ? <FormDialog title="Budget" action={saveBudgetAction} fields={budgetFields(departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` })))} initial={{ fiscalYear: fiscalYearOf(new Date()) }} trigger={<Button size="sm"><Plus /> New budget</Button>} /> : undefined}
      />
      <Section title="Budgets" bodyClassName="p-0">
        <DataTable head={[{ label: "Year" }, { label: "Department" }, { label: "Lines", className: "text-right" }, { label: "Allocated", className: "text-right" }, { label: "Status" }]} empty="No budgets yet.">
          {budgets.map((b) => (
            <tr key={b.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/budgets/${b.id}`}>{b.fiscalYear}</Link></Td>
              <Td>{b.department ? `${b.department.code} — ${b.department.name}` : "Institution-wide"}</Td>
              <Td className="text-right tabular">{b.lines.length}</Td>
              <Td className="text-right tabular">{formatMoney(b.lines.reduce((a, l) => a + toMinor(l.amount), 0))}</Td>
              <Td className="text-xs">{b.status.toLowerCase()}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
