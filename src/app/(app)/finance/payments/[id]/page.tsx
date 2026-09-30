import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { MarkRefundPaidButton, RefundButton, ReversePaymentButton } from "@/features/finance/controls";
import { Receipt } from "@/features/finance/receipt";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Receipt" };

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("finance.view");
  const scope = scopeOf(ctx, "finance.view");
  const p = await db.payment.findFirst({ where: { id, ...(scope === null ? {} : { student: { departmentId: { in: scope } } }) }, include: { allocations: true, refunds: { orderBy: { createdAt: "desc" } } } });
  if (!p) notFound();
  const unapplied = toMinor(p.amount) - p.allocations.reduce((a, x) => a + toMinor(x.amount), 0) - p.refunds.filter((r) => r.status !== "REJECTED").reduce((a, r) => a + toMinor(r.amount), 0);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Payments", href: "/finance/payments" }, { label: p.receiptNo ?? "Payment" }]}
        title="Receipt"
        actions={
          <div className="flex gap-2 print:hidden">
            {p.status === "SUCCEEDED" && can(ctx, "payment.reverse") && <><RefundButton paymentId={p.id} max={unapplied} /><ReversePaymentButton id={p.id} /></>}
            <PrintButton />
          </div>
        }
      />
      <Receipt paymentId={p.id} />
      {p.refunds.length > 0 && (
        <Section title="Refunds" className="print:hidden" bodyClassName="p-0">
          <DataTable head={[{ label: "Amount", className: "text-right" }, { label: "Reason" }, { label: "Status" }, { label: "Requested" }, { label: "" }]}>
            {p.refunds.map((r) => (
              <tr key={r.id}>
                <Td className="text-right tabular">{formatMoney(toMinor(r.amount), p.currency)}</Td>
                <Td className="text-xs">{r.reason}</Td>
                <Td className="text-xs">{r.status.toLowerCase()}{r.reference ? ` · ${r.reference}` : ""}</Td>
                <Td className="text-xs">{fmtDateTime(r.createdAt)}</Td>
                <Td className="text-right">{r.status === "APPROVED" && can(ctx, "payment.reverse") && <MarkRefundPaidButton id={r.id} />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
