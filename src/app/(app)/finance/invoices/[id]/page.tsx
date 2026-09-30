import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { PrintButton } from "@/components/app/print-button";
import { StatusBadge } from "@/components/app/status-badge";
import { CancelInvoiceButton, ConcessionDialog, PayOnlineButton, RecordPaymentDialog } from "@/features/finance/controls";
import { INVOICE_STATUS, PAYMENT_METHOD_LABEL, PAYMENT_STATUS } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { onlinePaymentsEnabled } from "@/server/payments/gateway";
import { invoiceWhere } from "@/server/services/finance";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["finance.view", "self.portal"]);
  const inv = await db.invoice.findFirst({
    where: { AND: [{ id }, await invoiceWhere(ctx)] },
    include: {
      student: { select: { id: true, studentNo: true, firstName: true, lastName: true, departmentId: true, program: { select: { name: true } }, batch: { select: { code: true } } } },
      lines: { include: { feeHead: { select: { id: true, name: true } } } },
      allocations: { include: { payment: true } },
      concessions: { orderBy: { createdAt: "desc" } },
      term: { select: { name: true } },
    },
  });
  if (!inv) notFound();
  const inst = await db.institution.findFirstOrThrow();
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);
  const balance = toMinor(inv.total) - toMinor(inv.amountPaid);
  const open = !inv.cancelledAt && balance > 0;
  const staff = ctx.user.userType === "STAFF";
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        breadcrumbs={staff ? [{ label: "Finance", href: "/finance" }, { label: "Invoices", href: "/finance/invoices" }, { label: inv.number }] : [{ label: "Fees", href: "/portal/fees" }, { label: inv.number }]}
        title={<span className="flex flex-wrap items-center gap-3">Invoice {inv.number} <StatusBadge meta={INVOICE_STATUS[inv.status]} size="md" /></span>}
        description={`${inv.student.firstName} ${inv.student.lastName} (${inv.student.studentNo}) · ${inv.student.program.name}${inv.term ? ` · ${inv.term.name}` : ""}`}
        actions={
          <div className="flex flex-wrap gap-2 print:hidden">
            {open && staff && can(ctx, "payment.record") && <RecordPaymentDialog studentId={inv.studentId} invoiceId={inv.id} balance={balance} currency={inst.currency} />}
            {open && !staff && <PayOnlineButton invoiceId={inv.id} enabled={onlinePaymentsEnabled()} />}
            {open && can(ctx, "concession.request", inv.student.departmentId) && <ConcessionDialog invoiceId={inv.id} balance={balance} heads={inv.lines.map((l) => l.feeHead)} />}
            {!inv.cancelledAt && toMinor(inv.amountPaid) === 0 && can(ctx, "invoice.manage") && <CancelInvoiceButton id={inv.id} />}
            <PrintButton />
          </div>
        }
      />
      {open && !staff && !onlinePaymentsEnabled() && <p className="rounded-lg border px-4 py-3 text-sm print:hidden">Online payment is not available. Please pay at the accounts office quoting invoice <b>{inv.number}</b>.</p>}
      <Section>
        <div className="mb-5 flex flex-wrap justify-between gap-4 text-sm">
          <div><div className="font-semibold">{inst.name}</div><div className="text-muted-foreground">{inst.address}</div></div>
          <KeyValue items={[["Issued", fmtDate(inv.issueDate)], ["Due", fmtDate(inv.dueDate)], ["Batch", inv.student.batch.code]]} />
        </div>
        <DataTable head={[{ label: "Description" }, { label: "Amount", className: "text-right" }, { label: "Concession", className: "text-right" }, { label: "Net", className: "text-right" }]}>
          {inv.lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.description}</Td>
              <Td className="text-right tabular">{fmt(toMinor(l.amount))}</Td>
              <Td className="text-right tabular">{toMinor(l.concession) ? `− ${fmt(toMinor(l.concession))}` : "—"}</Td>
              <Td className="text-right tabular">{fmt(toMinor(l.amount) - toMinor(l.concession))}</Td>
            </tr>
          ))}
          <tr className="font-semibold"><Td>Total</Td><Td /><Td className="text-right tabular">{toMinor(inv.concession) ? `− ${fmt(toMinor(inv.concession))}` : ""}</Td><Td className="text-right tabular">{fmt(toMinor(inv.total))}</Td></tr>
          <tr><Td>Paid</Td><Td /><Td /><Td className="text-right tabular">{fmt(toMinor(inv.amountPaid))}</Td></tr>
          <tr className="text-base font-semibold"><Td>Balance due</Td><Td /><Td /><Td className="text-right tabular">{fmt(balance)}</Td></tr>
        </DataTable>
        {inv.cancelledAt && <p className="mt-3 text-sm text-destructive">Cancelled on {fmtDate(inv.cancelledAt)} — {inv.cancelReason}</p>}
      </Section>
      {inv.allocations.length > 0 && (
        <Section title="Payments applied" bodyClassName="p-0">
          <DataTable head={[{ label: "Receipt" }, { label: "Method" }, { label: "Applied", className: "text-right" }, { label: "Status" }, { label: "Date" }]}>
            {inv.allocations.map((a) => (
              <tr key={a.id}>
                <Td><Link href={staff ? `/finance/payments/${a.paymentId}` : `/portal/fees/receipts/${a.paymentId}`} className="font-mono text-xs hover:text-primary">{a.payment.receiptNo}</Link></Td>
                <Td className="text-xs">{PAYMENT_METHOD_LABEL[a.payment.method]}{a.payment.reference ? ` · ${a.payment.reference}` : ""}</Td>
                <Td className="text-right tabular">{fmt(toMinor(a.amount))}</Td>
                <Td><StatusBadge meta={PAYMENT_STATUS[a.payment.status]} /></Td>
                <Td className="text-xs">{fmtDateTime(a.payment.receivedAt)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {staff && inv.concessions.length > 0 && (
        <Section title="Concessions" bodyClassName="p-0">
          <DataTable head={[{ label: "Type" }, { label: "Amount", className: "text-right" }, { label: "Reason" }, { label: "Status" }]}>
            {inv.concessions.map((c) => <tr key={c.id}><Td className="text-xs">{c.kind.toLowerCase()}</Td><Td className="text-right tabular">{fmt(toMinor(c.amount))}</Td><Td className="text-xs">{c.reason}</Td><Td className="text-xs">{c.status.toLowerCase()}</Td></tr>)}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
