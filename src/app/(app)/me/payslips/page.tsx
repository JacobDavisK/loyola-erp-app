import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "My payslips" };

export default async function MyPayslipsPage() {
  const ctx = await requirePageAuth();
  if (!ctx.subject.employeeId) redirect("/dashboard");
  const [slips, inst] = await Promise.all([
    // Payslips become visible once the payroll run is approved.
    db.payslip.findMany({ where: { employeeId: ctx.subject.employeeId, run: { status: { in: ["APPROVED", "PAID"] } } }, orderBy: { run: { period: "desc" } }, include: { run: { select: { period: true, status: true } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  return (
    <div className="space-y-6">
      <PageHeader title="My payslips" breadcrumbs={[{ label: "My work" }, { label: "Payslips" }]} />
      {slips.length === 0 ? <EmptyState icon={Banknote} title="No payslips yet" description="Payslips appear here once a month's payroll is approved." /> : (
        <Section title={`${slips.length} payslip(s)`} bodyClassName="p-0">
          <DataTable head={[{ label: "Month" }, { label: "Gross", className: "text-right" }, { label: "Deductions", className: "text-right" }, { label: "Net pay", className: "text-right" }, { label: "" }]}>
            {slips.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.run.period}</Td>
                <Td className="text-right tabular">{fmt(toMinor(p.gross))}</Td>
                <Td className="text-right tabular">{fmt(toMinor(p.deductions))}</Td>
                <Td className="text-right font-medium tabular">{fmt(toMinor(p.net))}</Td>
                <Td className="text-right"><Link className="text-sm text-primary hover:underline" href={`/me/payslips/${p.id}`}>View</Link></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
