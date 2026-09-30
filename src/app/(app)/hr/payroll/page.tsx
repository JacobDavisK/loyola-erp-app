import Link from "next/link";
import { Briefcase, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { createPayrollRunAction } from "@/features/hr/actions";
import { PAYROLL_STATUS } from "@/lib/domain/labels";
import { formatMoney } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Payroll" };

type Totals = { employees: number; gross: number; deductions: number; net: number; employerContributions: number; skipped?: string[] } | null;

export default async function PayrollPage() {
  const ctx = await requirePageAuth(["payroll.process", "payroll.view"]);
  const [runs, inst] = await Promise.all([
    db.payrollRun.findMany({ orderBy: { period: "desc" }, take: 36 }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (n: number) => formatMoney(Math.round(n * 100), inst.currency, inst.locale);
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        breadcrumbs={[{ label: "People" }, { label: "Payroll" }]}
        description="Monthly runs: compute (repeatable), submit for approval by Finance and the Registrar, then Accounts records the bank transfer. Approval posts the salary accrual to the ledger."
        actions={can(ctx, "payroll.process") && (
          <FormDialog title="Payroll run" fields={[{ name: "period", label: "Month", type: "text", placeholder: "YYYY-MM", hint: "Working days default to the HR setting (calendar days when 0)." }]} initial={{ period: thisMonth }} action={createPayrollRunAction} submitLabel="Create" trigger={<Button size="sm"><Plus /> New payroll run</Button>} />
        )}
      />
      {runs.length === 0 ? <EmptyState icon={Briefcase} title="No payroll runs yet" description="Set up salary components and structures under HR setup, record each employee's pay, then create a run." /> : (
        <Section title="Runs" bodyClassName="p-0">
          <DataTable head={[{ label: "Month" }, { label: "Employees", className: "text-right" }, { label: "Gross", className: "text-right" }, { label: "Deductions", className: "text-right" }, { label: "Net pay", className: "text-right" }, { label: "Status" }, { label: "Paid" }]}>
            {runs.map((r) => {
              const t = r.totals as Totals;
              return (
                <tr key={r.id}>
                  <Td><Link href={`/hr/payroll/${r.id}`} className="font-medium hover:text-primary">{r.period}</Link></Td>
                  <Td className="text-right tabular">{t?.employees ?? "—"}</Td>
                  <Td className="text-right tabular">{t ? fmt(t.gross) : "—"}</Td>
                  <Td className="text-right tabular">{t ? fmt(t.deductions) : "—"}</Td>
                  <Td className="text-right font-medium tabular">{t ? fmt(t.net) : "—"}</Td>
                  <Td><StatusBadge meta={PAYROLL_STATUS[r.status]} /></Td>
                  <Td className="text-xs">{r.paidAt ? `${fmtDate(r.paidAt)} · ${r.paymentRef}` : "—"}</Td>
                </tr>
              );
            })}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
