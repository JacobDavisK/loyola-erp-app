import Link from "next/link";
import { notFound } from "next/navigation";
import { Send } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { submitRequestAction } from "@/features/operations/actions";
import { OrderForm, RequestForm } from "@/features/operations/controls";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fiscalYearOf } from "@/lib/domain/operations";
import { fmtDate } from "@/lib/format";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { requestWhere } from "@/server/services/procurement";

export const metadata: Metadata = { title: "Purchase request" };

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAuth(["procurement.request", "procurement.manage", "procurement.pay"]);
  const { id } = await params;
  const r = await db.purchaseRequest.findFirst({
    where: { AND: [{ id }, requestWhere(ctx)] },
    include: { department: true, lines: { include: { item: true } }, budgetLine: { include: { account: true, budget: true } }, orders: { include: { vendor: { select: { name: true } } } } },
  });
  if (!r) notFound();
  const requester = await db.user.findUnique({ where: { id: r.requestedById }, select: { name: true } });
  const mine = r.requestedById === ctx.user.id || isSuperAdmin(ctx);
  const editable = r.status === "DRAFT" && mine;
  const manage = can(ctx, "procurement.manage");
  const [vendors, items, budgetLines] = await Promise.all([
    manage && r.status === "APPROVED" ? db.vendor.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
    editable ? db.stockItem.findMany({ where: { active: true }, orderBy: { name: "asc" } }) : [],
    editable ? db.budgetLine.findMany({ where: { budget: { status: "APPROVED", fiscalYear: fiscalYearOf(new Date()), OR: [{ departmentId: null }, { departmentId: r.departmentId }] } }, include: { account: true, budget: true } }) : [],
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title={r.title}
        eyebrow={r.number}
        breadcrumbs={[{ label: "Purchasing", href: "/procurement" }, { label: r.number }]}
        actions={editable ? <ActionButton label={r.workflowId ? "Resubmit for approval" : "Send for approval"} variant="default" icon={<Send />} run={submitRequestAction.bind(null, r.id)} confirmText="Send this request for approval?" /> : undefined}
      />
      <Section title="Details">
        <KeyValue items={[
          ["Status", <span key="s">{r.status.toLowerCase()}{r.workflowId && <> · <Link className="text-primary hover:underline" href={`/inbox/requests/${r.workflowId}`}>approval trail</Link></>}</span>],
          ["Department", r.department.name],
          ["Raised by", `${requester?.name ?? "—"} on ${fmtDate(r.createdAt)}`],
          ["Budget line", r.budgetLine ? `${r.budgetLine.budget.fiscalYear} · ${r.budgetLine.account.name}` : "Not linked"],
          ["Estimated value", formatMoney(toMinor(r.total))],
          ["Justification", <span key="j" className="whitespace-pre-wrap">{r.justification}</span>],
        ]} />
      </Section>
      <Section title="Lines" bodyClassName="p-0">
        <DataTable head={[{ label: "Item" }, { label: "Kind" }, { label: "Quantity", className: "text-right" }, { label: "Est. unit price", className: "text-right" }, { label: "Amount", className: "text-right" }]}>
          {r.lines.map((l) => (
            <tr key={l.id}>
              <Td>{l.description}{l.item && <span className="ml-1 font-mono text-[11px] text-muted-foreground">{l.item.code}</span>}</Td>
              <Td className="text-xs">{l.kind.toLowerCase()}</Td>
              <Td className="text-right tabular">{l.quantity} {l.unit}</Td>
              <Td className="text-right tabular">{formatMoney(toMinor(l.estUnitPrice))}</Td>
              <Td className="text-right tabular">{formatMoney(Math.round(l.quantity * toMinor(l.estUnitPrice)))}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {editable && (
        <Section title="Edit draft">
          <RequestForm
            departments={[{ id: r.department.id, label: `${r.department.code} — ${r.department.name}` }]}
            items={items.map((i) => ({ id: i.id, label: `${i.name} (${i.code})`, unit: i.unit }))}
            budgetLines={budgetLines.map((l) => ({ id: l.id, label: `${l.budget.fiscalYear} · ${l.account.name}` }))}
            initial={{ id: r.id, departmentId: r.departmentId, title: r.title, justification: r.justification, budgetLineId: r.budgetLineId, lines: r.lines.map((l) => ({ kind: l.kind, description: l.description, itemId: l.itemId, quantity: l.quantity, unit: l.unit, estUnitPrice: Number(l.estUnitPrice) })) }}
          />
        </Section>
      )}
      {manage && r.status === "APPROVED" && (
        <Section title="Issue a purchase order" description="Enter the agreed prices from the chosen quotation.">
          <OrderForm requestId={r.id} vendors={vendors.map((v) => ({ id: v.id, label: v.name }))} lines={r.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unit: l.unit, estUnitPrice: Number(l.estUnitPrice) }))} />
        </Section>
      )}
      {r.orders.length > 0 && (
        <Section title="Orders">
          <ul className="space-y-1 text-sm">{r.orders.map((o) => <li key={o.id}><Link className="font-mono text-primary hover:underline" href={`/procurement/orders/${o.id}`}>{o.number}</Link> — {o.vendor.name}, {formatMoney(toMinor(o.total))}, {o.status.toLowerCase().replace("_", " ")}</li>)}</ul>
        </Section>
      )}
    </div>
  );
}
