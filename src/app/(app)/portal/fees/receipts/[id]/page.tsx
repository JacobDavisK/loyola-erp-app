import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { Receipt } from "@/features/finance/receipt";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { invoiceWhere } from "@/server/services/finance";

export const metadata: Metadata = { title: "Receipt" };

export default async function PortalReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("self.portal");
  const p = await db.payment.findUnique({ where: { id }, select: { id: true, studentId: true } });
  // Same visibility as invoices: own record, or a ward with finance visibility.
  if (!p || !(await db.invoice.count({ where: { AND: [await invoiceWhere(ctx), { studentId: p.studentId }] } }))) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Receipt" breadcrumbs={[{ label: "Fees", href: "/portal/fees" }, { label: "Receipt" }]} actions={<PrintButton />} />
      <Receipt paymentId={p.id} />
    </div>
  );
}
