import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Send, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { computePayrollRunAction, deletePayrollRunAction, submitPayrollRunAction } from "@/features/hr/actions";
import { MarkPayrollPaidButton } from "@/features/hr/controls";
import { PAYROLL_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { calendarWorkingDays } from "@/server/services/payroll";

export const metadata: Metadata = { title: "Payroll run" };

type Totals = { employees: number; gross: number; deductions: number; net: number; employerContributions: number; skipped?: string[] } | null;

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["payroll.process", "payroll.view"]);
  const run = await db.payrollRun.findUnique({
    where: { id },
    include: { payslips: { orderBy: { employee: { employeeNo: "asc" } }, include: { employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, designation: true, department: { select: { code: true } } } } } } },
  });
  if (!run) notFound();
  const [inst, workflow, calDays] = await Promise.all([
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
    db.workflowInstance.findFirst({ where: { resourceType: "payrollRun", resourceId: id }, orderBy: { createdAt: "desc" }, select: { id: true, status: true } }),
    calendarWorkingDays(run.period),
  ]);
  const fmtN = (n: number) => formatMoney(Math.round(n * 100), inst.currency, inst.locale);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const t = run.totals as Totals;
  const process = can(ctx, "payroll.process");
  const editable = run.status === "DRAFT" || run.status === "COMPUTED";
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll"
        title={run.period}
        breadcrumbs={[{ label: "Payroll", href: "/hr/payroll" }, { label: run.period }]}
        description={<span className="flex flex-wrap items-center gap-2"><StatusBadge meta={PAYROLL_STATUS[run.status]} /> {run.workingDays} payroll days ({calDays} working days on the staff calendar){run.computedAt ? ` · computed ${fmtDateTime(run.computedAt)}` : ""}{workflow ? <Link className="text-primary hover:underline" href={`/inbox/requests/${workflow.id}`}>approval record</Link> : null}</span>}
        actions={
          <div className="flex flex-wrap gap-2">
            {process && editable && <ActionButton label={run.status === "DRAFT" ? "Compute" : "Recompute"} icon={<Calculator />} run={computePayrollRunAction.bind(null, id)} />}
            {process && run.status === "COMPUTED" && <ActionButton label="Submit for approval" variant="default" icon={<Send />} run={submitPayrollRunAction.bind(null, id)} confirmText="Send this payroll to Finance and the Registrar for approval? It cannot be recomputed while in approval." />}
            {process && editable && <ActionButton label="Delete" icon={<Trash2 />} run={deletePayrollRunAction.bind(null, id)} confirmText="Delete this payroll run and its payslips?" />}
            {run.status === "APPROVED" && can(ctx, "payroll.disburse") && <MarkPayrollPaidButton id={id} />}
          </div>
        }
      />
      {t && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
          <StatCard label="Employees" value={t.employees} />
          <StatCard label="Gross" value={fmtN(t.gross)} />
          <StatCard label="Deductions" value={fmtN(t.deductions)} />
          <StatCard label="Net pay" value={fmtN(t.net)} />
          <StatCard label="Employer contributions" value={fmtN(t.employerContributions)} />
        </div>
      )}
      {t?.skipped?.length ? (
        <Section title="Not included">
          <p className="text-sm text-muted-foreground">{t.skipped.join(", ")}. Record their pay under the employee&apos;s Pay tab and recompute.</p>
        </Section>
      ) : null}
      {run.paidAt && <p className="text-sm">Paid {fmtDateTime(run.paidAt)} · reference <span className="font-mono">{run.paymentRef}</span></p>}
      <Section title="Payslips" bodyClassName="p-0">
        <DataTable head={[{ label: "Employee" }, { label: "Dept" }, { label: "Basic", className: "text-right" }, { label: "Gross", className: "text-right" }, { label: "Deductions", className: "text-right" }, { label: "Net", className: "text-right" }, { label: "LOP days", className: "text-right" }]} empty={editable ? "Compute the run to generate payslips." : "No payslips."}>
          {run.payslips.map((p) => (
            <tr key={p.id}>
              <Td><Link className="hover:text-primary" href={`/hr/payroll/payslips/${p.id}`}>{p.employee.firstName} {p.employee.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{p.employee.employeeNo}</div></Td>
              <Td className="text-xs">{p.employee.department?.code ?? "—"}</Td>
              <Td className="text-right tabular">{fmt(toMinor(p.basic))}</Td>
              <Td className="text-right tabular">{fmt(toMinor(p.gross))}</Td>
              <Td className="text-right tabular">{fmt(toMinor(p.deductions))}</Td>
              <Td className="text-right font-medium tabular">{fmt(toMinor(p.net))}</Td>
              <Td className="text-right tabular">{p.lopDays || "—"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
