import { notFound } from "next/navigation";
import { Plus, Stamp } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { approveBudgetAction, setBudgetLineAction } from "@/features/operations/actions";
import { budgetLineFields } from "@/features/operations/fields";
import { formatMoney } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { budgetReport } from "@/server/services/budgets";

export const metadata: Metadata = { title: "Budget" };

export default async function BudgetPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAuth(["budget.manage", "budget.view"]);
  const { id } = await params;
  const exists = await db.budget.findUnique({ where: { id }, include: { department: true } });
  if (!exists) notFound();
  const { budget, lines } = await budgetReport(ctx, id);
  const manage = can(ctx, "budget.manage");
  const draft = budget.status === "DRAFT";
  const accounts = manage && draft ? await db.ledgerAccount.findMany({ where: { type: { in: ["EXPENSE", "ASSET"] }, isActive: true }, orderBy: { code: "asc" } }) : [];
  const approver = budget.approvedById ? await db.user.findUnique({ where: { id: budget.approvedById }, select: { name: true } }) : null;
  const sum = (k: "amount" | "actual" | "committed" | "available") => lines.reduce((a, l) => a + l[k], 0);
  const fields = budgetLineFields(accounts.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })));
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Budget ${budget.fiscalYear}`}
        eyebrow={exists.department?.name ?? "Institution-wide"}
        breadcrumbs={[{ label: "Budgets", href: "/budgets" }, { label: budget.fiscalYear }]}
        actions={manage && draft ? <ActionButton label="Approve budget" variant="default" icon={<Stamp />} run={approveBudgetAction.bind(null, id)} confirmText="Approve this budget? It can no longer be changed." /> : undefined}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Allocated" value={formatMoney(sum("amount"))} />
        <StatCard label="Spent" value={formatMoney(sum("actual"))} />
        <StatCard label="Committed" value={formatMoney(sum("committed"))} hint="Approved requests and orders not yet billed" />
        <StatCard label="Available" value={formatMoney(sum("available"))} tone={sum("available") < 0 ? "danger" : undefined} />
      </div>
      <Section title="Lines" actions={manage && draft && accounts.length ? <FormDialog title="Budget line" id={id} action={setBudgetLineAction} fields={fields} trigger={<Button size="xs" variant="outline"><Plus /> Line</Button>} /> : undefined} bodyClassName="p-0">
        <DataTable head={[{ label: "Account" }, { label: "Allocated", className: "text-right" }, { label: "Spent", className: "text-right" }, { label: "Committed", className: "text-right" }, { label: "Available", className: "text-right" }, { label: "Used", className: "text-right" }]} empty="No lines yet.">
          {lines.map((l) => (
            <tr key={l.line.id}>
              <Td><span className="font-mono text-xs text-muted-foreground">{l.line.account.code}</span> {l.line.account.name}{l.line.note && <div className="text-[11px] text-muted-foreground">{l.line.note}</div>}</Td>
              <Td className="text-right tabular">{formatMoney(l.amount)}</Td>
              <Td className="text-right tabular">{formatMoney(l.actual)}</Td>
              <Td className="text-right tabular">{formatMoney(l.committed)}</Td>
              <Td className={cn("text-right tabular", l.over && "font-medium text-tone-danger")}>{formatMoney(l.available)}</Td>
              <Td className="text-right">
                <div className="ml-auto h-1.5 w-20 overflow-hidden rounded bg-muted"><div className={cn("h-full", l.usedPercent > 100 ? "bg-tone-danger" : l.usedPercent > 85 ? "bg-tone-warning" : "bg-primary")} style={{ width: `${Math.min(100, l.usedPercent)}%` }} /></div>
                <span className="text-[11px] tabular text-muted-foreground">{l.usedPercent}%</span>
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="About">
        <KeyValue items={[["Status", budget.status.toLowerCase()], ["Approved", approver ? `${approver.name}, ${fmtDate(budget.approvedAt)}` : "—"], ["Notes", budget.notes ?? "—"]]} />
      </Section>
    </div>
  );
}
