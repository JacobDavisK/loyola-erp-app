import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { Payslip } from "@/features/hr/payslip";
import { requirePageAuth } from "@/server/auth/current";
import { loadPayslipFor } from "@/server/services/payroll";

export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["payroll.view", "payroll.process"]);
  const p = await loadPayslipFor(ctx, id).catch(() => null);
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Payslip ${p.run.period}`} breadcrumbs={[{ label: "Payroll", href: "/hr/payroll" }, { label: p.run.period, href: `/hr/payroll/${p.runId}` }, { label: `${p.employee.firstName} ${p.employee.lastName}` }]} actions={<PrintButton />} />
      <Payslip id={p.id} />
    </div>
  );
}
