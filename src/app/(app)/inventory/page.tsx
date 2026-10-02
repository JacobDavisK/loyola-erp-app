import { ArrowLeftRight, ClipboardCheck, PackageMinus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { countStockAction, issueStockAction, saveItemAction, saveStoreAction, transferStockAction } from "@/features/operations/actions";
import { countFields, issueFields, itemFields, storeFields, transferFields } from "@/features/operations/fields";
import { formatMoney } from "@/lib/domain/money";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { stockLevels } from "@/server/services/inventory";

export const metadata: Metadata = { title: "Stores & inventory" };

const KIND: Record<string, string> = { RECEIPT: "Received", ISSUE: "Issued", TRANSFER_IN: "Transfer in", TRANSFER_OUT: "Transfer out", ADJUSTMENT: "Count adjustment" };

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth("inventory.manage");
  const view = (await searchParams).view ?? "stock";
  const [{ stores, rows }, items, departments, staff, moves] = await Promise.all([
    stockLevels(),
    db.stockItem.findMany({ orderBy: { code: "asc" } }),
    db.department.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true }, take: 500 }),
    view === "movements" ? db.stockMovement.findMany({ include: { item: { select: { code: true, name: true, unit: true } }, store: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 200 }) : [],
  ]);
  const itemOpts = items.filter((i) => i.active).map((i) => ({ id: i.id, label: `${i.name} (${i.code})` }));
  const storeOpts = stores.map((s) => ({ id: s.id, label: s.name }));
  const deptOpts = departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }));
  const deptCode = new Map(departments.map((d) => [d.id, d.code]));
  const value = rows.reduce((a, r) => a + r.stores.reduce((x, s) => x + Math.round(s.value * 100), 0), 0);
  const low = rows.filter((r) => r.low && r.item.reorderLevel > 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Stores & inventory"
        description="Stock on hand in each store, valued at weighted-average cost. Goods come in from purchase orders; issues to a department are charged to its consumables budget. A physical count posts any shortage or excess."
        actions={storeOpts.length && itemOpts.length ? (
          <div className="flex flex-wrap gap-2">
            <FormDialog title="Issue" action={issueStockAction} fields={issueFields(itemOpts, storeOpts, deptOpts)} submitLabel="Issue" trigger={<Button size="sm"><PackageMinus /> Issue</Button>} />
            <FormDialog title="Transfer" action={transferStockAction} fields={transferFields(itemOpts, storeOpts)} submitLabel="Transfer" trigger={<Button size="sm" variant="outline"><ArrowLeftRight /> Transfer</Button>} />
            <FormDialog title="Stock count" action={countStockAction} fields={countFields(itemOpts, storeOpts)} submitLabel="Record count" trigger={<Button size="sm" variant="outline"><ClipboardCheck /> Count</Button>} />
          </div>
        ) : undefined}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Stock value" value={formatMoney(value)} />
        <StatCard label="Items" value={items.filter((i) => i.active).length} />
        <StatCard label="At or below reorder level" value={low.length} tone={low.length ? "warning" : undefined} />
      </div>
      <LinkTabs active={view} tabs={[{ key: "stock", label: "Stock", href: "/inventory" }, { key: "movements", label: "Movements", href: "/inventory?view=movements" }, { key: "setup", label: "Items & stores", href: "/inventory?view=setup" }]} />
      {view === "stock" && (
        <Section title="Stock on hand" bodyClassName="p-0">
          <DataTable head={[{ label: "Item" }, ...stores.map((s) => ({ label: s.name, className: "text-right" })), { label: "Total", className: "text-right" }, { label: "Reorder at", className: "text-right" }]} empty="No items yet.">
            {rows.map((r) => (
              <tr key={r.item.id}>
                <Td>{r.item.name} <span className="font-mono text-[11px] text-muted-foreground">{r.item.code}</span><div className="text-[11px] text-muted-foreground">{r.item.category}</div></Td>
                {stores.map((s) => { const p = r.stores.find((x) => x.store.id === s.id); return <Td key={s.id} className="text-right tabular">{p ? p.quantity : "—"}</Td>; })}
                <Td className={cn("text-right tabular font-medium", r.low && r.item.reorderLevel > 0 && "text-tone-warning")}>{r.total} {r.item.unit}</Td>
                <Td className="text-right tabular text-xs text-muted-foreground">{r.item.reorderLevel || "—"}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {view === "movements" && (
        <Section title="Recent movements" bodyClassName="p-0">
          <DataTable head={[{ label: "When" }, { label: "Item" }, { label: "Store" }, { label: "Movement" }, { label: "Quantity", className: "text-right" }, { label: "Unit cost", className: "text-right" }]} empty="No movements yet.">
            {moves.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs">{fmtDateTime(m.createdAt)}</Td>
                <Td>{m.item.name}</Td>
                <Td className="text-xs">{m.store.name}</Td>
                <Td className="text-xs">{KIND[m.kind]}{m.departmentId ? ` → ${deptCode.get(m.departmentId)}` : ""}{m.note ? <span className="text-muted-foreground"> · {m.note}</span> : null}</Td>
                <Td className={cn("text-right tabular", m.quantity < 0 && "text-tone-danger")}>{m.quantity > 0 ? "+" : ""}{m.quantity} {m.item.unit}</Td>
                <Td className="text-right tabular">{formatMoney(Math.round(Number(m.unitCost) * 100))}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {view === "setup" && (
        <>
          <Section title="Stores" actions={<FormDialog title="Store" action={saveStoreAction} fields={storeFields(staff.map((s) => ({ id: s.id, label: s.name })))} />} bodyClassName="p-0">
            <DataTable head={[{ label: "Store" }, { label: "Location" }, { label: "" }]} empty="No stores yet.">
              {stores.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td className="text-xs">{s.location ?? "—"}</Td>
                  <Td className="text-right"><FormDialog title="Store" id={s.id} action={saveStoreAction} fields={storeFields(staff.map((x) => ({ id: x.id, label: x.name })))} initial={{ name: s.name, location: s.location ?? "", keeperId: s.keeperId ?? "" }} /></Td>
                </tr>
              ))}
            </DataTable>
          </Section>
          <Section title="Items" actions={<FormDialog title="Item" action={saveItemAction} fields={itemFields} columns={2} initial={{ active: true, reorderLevel: 0 }} />} bodyClassName="p-0">
            <DataTable head={[{ label: "Code" }, { label: "Item" }, { label: "Category" }, { label: "Unit" }, { label: "Reorder at", className: "text-right" }, { label: "" }]} empty="No items yet.">
              {items.map((i) => (
                <tr key={i.id} className={i.active ? undefined : "opacity-60"}>
                  <Td className="font-mono text-xs">{i.code}</Td>
                  <Td>{i.name}</Td>
                  <Td className="text-xs">{i.category}</Td>
                  <Td className="text-xs">{i.unit}</Td>
                  <Td className="text-right tabular">{i.reorderLevel}</Td>
                  <Td className="text-right"><FormDialog title="Item" id={i.id} action={saveItemAction} fields={itemFields} columns={2} initial={{ code: i.code, name: i.name, unit: i.unit, category: i.category, reorderLevel: i.reorderLevel, active: i.active }} /></Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        </>
      )}
    </div>
  );
}
