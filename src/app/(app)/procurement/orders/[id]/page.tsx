import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { PromptButton } from "@/features/finance/controls";
import { approveVendorInvoiceAction, payVendorInvoiceAction, recordVendorInvoiceAction } from "@/features/operations/actions";
import { ReceiveForm } from "@/features/operations/controls";
import { billFields } from "@/features/operations/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { requestWhere } from "@/server/services/procurement";

export const metadata: Metadata = { title: "Purchase order" };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAuth(["procurement.request", "procurement.manage", "procurement.pay", "inventory.manage"]);
  const { id } = await params;
  const manage = can(ctx, "procurement.manage");
  const pay = can(ctx, "procurement.pay");
  const receive = manage || can(ctx, "inventory.manage");
  const po = await db.purchaseOrder.findFirst({
    where: { id, ...(manage || pay || receive ? {} : { request: requestWhere(ctx) }) },
    include: { vendor: true, department: true, request: { select: { id: true, number: true } }, lines: true, receipts: { include: { lines: true, store: { select: { name: true } } }, orderBy: { receivedAt: "asc" } }, invoices: { orderBy: { createdAt: "asc" } } },
  });
  if (!po) notFound();
  const stores = receive ? await db.store.findMany({ orderBy: { name: "asc" } }) : [];
  const open = ["ISSUED", "PART_RECEIVED"].includes(po.status);
  const lineName = new Map(po.lines.map((l) => [l.id, l.description]));
  return (
    <div className="space-y-6">
      <PageHeader title={`Purchase order ${po.number}`} eyebrow={po.vendor.name} breadcrumbs={[{ label: "Purchasing", href: "/procurement?view=orders" }, { label: po.number }]} />
      <Section title="Order">
        <KeyValue items={[
          ["Status", po.status.toLowerCase().replace("_", " ")],
          ["Vendor", `${po.vendor.name}${po.vendor.gstin ? ` (GSTIN ${po.vendor.gstin})` : ""}`],
          ["For", po.department.name],
          ["Request", po.request ? <Link key="r" className="font-mono text-primary hover:underline" href={`/procurement/requests/${po.request.id}`}>{po.request.number}</Link> : "—"],
          ["Ordered", fmtDate(po.orderDate)],
          ["Expected", fmtDate(po.expectedOn)],
          ["Value", `${formatMoney(toMinor(po.total))} incl. ${po.taxPercent}% GST`],
          ["Terms", po.terms ?? "—"],
        ]} />
      </Section>
      <Section title="Lines" bodyClassName="p-0">
        <DataTable head={[{ label: "Item" }, { label: "Ordered", className: "text-right" }, { label: "Received", className: "text-right" }, { label: "Unit price", className: "text-right" }]}>
          {po.lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.description} <span className="text-xs text-muted-foreground">({l.kind.toLowerCase()})</span></Td>
              <Td className="text-right tabular">{l.quantity} {l.unit}</Td>
              <Td className="text-right tabular">{l.receivedQty}</Td>
              <Td className="text-right tabular">{formatMoney(toMinor(l.unitPrice))}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {receive && open && (
        <Section title="Receive goods" description="Record what has arrived and passed inspection. Stock lines go into the chosen store at cost including GST; each piece of equipment gets an asset tag.">
          <ReceiveForm poId={po.id} stores={stores.map((s) => ({ id: s.id, label: s.name }))} lines={po.lines.filter((l) => l.receivedQty < l.quantity).map((l) => ({ id: l.id, kind: l.kind, description: l.description, outstanding: Math.round((l.quantity - l.receivedQty) * 1000) / 1000, unit: l.unit }))} />
        </Section>
      )}
      {po.receipts.length > 0 && (
        <Section title="Goods receipts">
          <ul className="space-y-2 text-sm">
            {po.receipts.map((g) => (
              <li key={g.id}><span className="font-mono">{g.number}</span> · {fmtDateTime(g.receivedAt)}{g.store ? ` · into ${g.store.name}` : ""} — {g.lines.map((l) => `${l.quantity} × ${lineName.get(l.poLineId)}`).join("; ")}{g.notes ? <span className="text-muted-foreground"> ({g.notes})</span> : null}</li>
            ))}
          </ul>
        </Section>
      )}
      <Section title="Vendor bills" actions={(manage || pay) && po.status !== "CANCELLED" ? <FormDialog title="Vendor bill" id={po.id} action={recordVendorInvoiceAction} fields={billFields} trigger={<Button size="xs" variant="outline"><Plus /> Record bill</Button>} /> : undefined} bodyClassName="p-0">
        <DataTable head={[{ label: "Bill" }, { label: "Date" }, { label: "Amount", className: "text-right" }, { label: "Status" }, { label: "" }]} empty="No bills yet.">
          {po.invoices.map((b) => (
            <tr key={b.id}>
              <Td className="font-mono">{b.invoiceNo}</Td>
              <Td className="text-xs">{fmtDate(b.invoiceDate)}</Td>
              <Td className="text-right tabular">{formatMoney(toMinor(b.amount))}</Td>
              <Td className="text-xs">{b.status.toLowerCase()}{b.paymentRef ? ` · ${b.paymentRef}` : ""}</Td>
              <Td className="text-right">
                {pay && b.status === "RECEIVED" && <ActionButton label="Approve" run={approveVendorInvoiceAction.bind(null, b.id)} confirmText="Approve this bill and post it to the ledger?" />}
                {pay && b.status === "APPROVED" && <PromptButton label="Mark paid" question="Payment reference (NEFT / cheque number)?" action={payVendorInvoiceAction.bind(null, b.id)} />}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
