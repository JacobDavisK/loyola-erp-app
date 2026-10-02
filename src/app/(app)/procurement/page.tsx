import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { PromptButton } from "@/features/finance/controls";
import { ActionButton } from "@/features/academic-ops/controls";
import { approveVendorInvoiceAction, payVendorInvoiceAction, saveVendorAction } from "@/features/operations/actions";
import { vendorFields } from "@/features/operations/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { requestWhere } from "@/server/services/procurement";

export const metadata: Metadata = { title: "Purchasing" };

const money = (d: { toString(): string } | number) => formatMoney(toMinor(d));

export default async function ProcurementPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["procurement.request", "procurement.manage", "procurement.pay"]);
  const view = (await searchParams).view ?? "requests";
  const manage = can(ctx, "procurement.manage");
  const pay = can(ctx, "procurement.pay");
  const where = requestWhere(ctx);
  const [requests, orders, bills, vendors, pendingBills] = await Promise.all([
    view === "requests" ? db.purchaseRequest.findMany({ where, include: { department: { select: { code: true } } }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
    view === "orders" ? db.purchaseOrder.findMany({ where: manage || pay ? {} : { request: where }, include: { vendor: { select: { name: true } }, department: { select: { code: true } } }, orderBy: { orderDate: "desc" }, take: 200 }) : [],
    view === "bills" && (manage || pay) ? db.vendorInvoice.findMany({ include: { vendor: { select: { name: true } }, po: { select: { id: true, number: true } } }, orderBy: [{ status: "asc" }, { invoiceDate: "desc" }], take: 200 }) : [],
    view === "vendors" ? db.vendor.findMany({ orderBy: { name: "asc" } }) : [],
    db.vendorInvoice.aggregate({ where: { status: "APPROVED" }, _sum: { amount: true }, _count: true }),
  ]);
  const openRequests = await db.purchaseRequest.count({ where: { ...where, status: { in: ["SUBMITTED", "APPROVED"] } } });
  const openOrders = manage || pay ? await db.purchaseOrder.count({ where: { status: { in: ["ISSUED", "PART_RECEIVED"] } } }) : 0;
  const tabs = [
    { key: "requests", label: "Requests", href: "/procurement" },
    { key: "orders", label: "Purchase orders", href: "/procurement?view=orders" },
    ...(manage || pay ? [{ key: "bills", label: "Vendor bills", href: "/procurement?view=bills" }] : []),
    { key: "vendors", label: "Vendors", href: "/procurement?view=vendors" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchasing"
        description="Departments raise purchase requests against their budget; the head of department approves (and the Finance Officer too above ₹50,000). Purchase issues the order, the store receives the goods — stock goes into the store, equipment into the asset register — and accounts approve and pay the vendor's bill, which posts to the ledger."
        actions={<Button size="sm" asChild><Link href="/procurement/requests/new"><Plus /> New request</Link></Button>}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Requests in progress" value={openRequests} />
        {(manage || pay) && <StatCard label="Orders awaiting delivery" value={openOrders} />}
        {(manage || pay) && <StatCard label="Approved bills unpaid" value={pendingBills._count} hint={money(pendingBills._sum.amount ?? 0)} />}
      </div>
      <LinkTabs tabs={tabs} active={view} />
      {view === "requests" && (
        <Section title="Purchase requests" bodyClassName="p-0">
          <DataTable head={[{ label: "Request" }, { label: "Department" }, { label: "Raised" }, { label: "Value", className: "text-right" }, { label: "Status" }]} empty="No purchase requests.">
            {requests.map((r) => (
              <tr key={r.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/procurement/requests/${r.id}`}>{r.title}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.number}</div></Td>
                <Td className="text-xs">{r.department.code}</Td>
                <Td className="text-xs">{fmtDate(r.createdAt)}</Td>
                <Td className="text-right tabular">{money(r.total)}</Td>
                <Td className="text-xs">{r.status.toLowerCase()}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {view === "orders" && (
        <Section title="Purchase orders" bodyClassName="p-0">
          <DataTable head={[{ label: "Order" }, { label: "Vendor" }, { label: "Department" }, { label: "Expected" }, { label: "Value", className: "text-right" }, { label: "Status" }]} empty="No purchase orders.">
            {orders.map((o) => (
              <tr key={o.id}>
                <Td><Link className="font-mono font-medium hover:text-primary" href={`/procurement/orders/${o.id}`}>{o.number}</Link><div className="text-[11px] text-muted-foreground">{fmtDate(o.orderDate)}</div></Td>
                <Td>{o.vendor.name}</Td>
                <Td className="text-xs">{o.department.code}</Td>
                <Td className="text-xs">{fmtDate(o.expectedOn)}</Td>
                <Td className="text-right tabular">{money(o.total)}</Td>
                <Td className="text-xs">{o.status.toLowerCase().replace("_", " ")}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {view === "bills" && (
        <Section title="Vendor bills" description="A bill is matched to its purchase order and to what has been received. Approving it posts the purchase and the amount owed; paying it clears the amount owed from the bank." bodyClassName="p-0">
          <DataTable head={[{ label: "Bill" }, { label: "Vendor" }, { label: "Order" }, { label: "Amount", className: "text-right" }, { label: "Status" }, { label: "" }]} empty="No bills recorded.">
            {bills.map((b) => (
              <tr key={b.id}>
                <Td><span className="font-mono">{b.invoiceNo}</span><div className="text-[11px] text-muted-foreground">{fmtDate(b.invoiceDate)}</div></Td>
                <Td>{b.vendor.name}</Td>
                <Td><Link className="font-mono text-xs hover:text-primary" href={`/procurement/orders/${b.po.id}`}>{b.po.number}</Link></Td>
                <Td className="text-right tabular">{money(b.amount)}</Td>
                <Td className="text-xs">{b.status.toLowerCase()}{b.paymentRef ? ` · ${b.paymentRef}` : ""}</Td>
                <Td className="text-right">
                  {pay && b.status === "RECEIVED" && <ActionButton label="Approve" run={approveVendorInvoiceAction.bind(null, b.id)} confirmText="Approve this bill and post it to the ledger?" />}
                  {pay && b.status === "APPROVED" && <PromptButton label="Mark paid" question="Payment reference (NEFT / cheque number)?" action={payVendorInvoiceAction.bind(null, b.id)} />}
                </Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {view === "vendors" && (
        <Section title="Vendors" actions={manage ? <FormDialog title="Vendor" action={saveVendorAction} fields={vendorFields} columns={2} initial={{ active: true }} /> : undefined} bodyClassName="p-0">
          <DataTable head={[{ label: "Vendor" }, { label: "GSTIN" }, { label: "Contact" }, { label: "Supplies" }, { label: "" }]} empty="No vendors yet.">
            {vendors.map((v) => (
              <tr key={v.id} className={v.active ? undefined : "opacity-60"}>
                <Td className="font-medium">{v.name}</Td>
                <Td className="font-mono text-xs">{v.gstin ?? "—"}</Td>
                <Td className="text-xs">{[v.contactName, v.phone, v.email].filter(Boolean).join(" · ") || "—"}</Td>
                <Td className="text-xs">{v.categories.join(", ") || "—"}</Td>
                <Td className="text-right">{manage && <FormDialog title="Vendor" id={v.id} action={saveVendorAction} fields={vendorFields} columns={2} initial={{ name: v.name, gstin: v.gstin ?? "", contactName: v.contactName ?? "", phone: v.phone ?? "", email: v.email ?? "", categories: v.categories.join(", "), address: v.address ?? "", active: v.active }} />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
