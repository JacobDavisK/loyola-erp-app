import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { Payslip } from "@/features/hr/payslip";
import { requirePageAuth } from "@/server/auth/current";
import { loadPayslipFor } from "@/server/services/payroll";

export const metadata: Metadata = { title: "Payslip" };

export default async function MyPayslipPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const p = await loadPayslipFor(ctx, id).catch(() => null);
  // Only one's own payslip here, even for payroll staff.
  if (!p || p.employeeId !== ctx.subject.employeeId) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={`Payslip ${p.run.period}`} breadcrumbs={[{ label: "Payslips", href: "/me/payslips" }, { label: p.run.period }]} actions={<PrintButton />} />
      <Payslip id={p.id} />
    </div>
  );
}
