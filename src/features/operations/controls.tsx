"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  createOrderAction, decideBookingAction, decideOutpassAction, preRegisterVisitorAction, receiveGoodsAction, saveRequestAction,
} from "@/features/operations/actions";

type Opt = { id: string; label: string };
const sel = "h-9 rounded-lg border bg-card px-2 text-sm";

// ───────────────────────── Purchase request ─────────────────────────

type Line = { kind: "STOCK" | "ASSET" | "SERVICE"; description: string; itemId: string; quantity: string; unit: string; estUnitPrice: string };
type RequestInit = { id: string; departmentId: string; title: string; justification: string; budgetLineId: string | null; lines: { kind: Line["kind"]; description: string; itemId: string | null; quantity: number; unit: string; estUnitPrice: number }[] };

/** Create or edit a purchase request with its lines; the estimated total is shown as you type. */
export function RequestForm({ departments, items, budgetLines, initial }: { departments: Opt[]; items: (Opt & { unit: string })[]; budgetLines: Opt[]; initial?: RequestInit }) {
  const router = useRouter();
  const blank = (): Line => ({ kind: "STOCK", description: "", itemId: "", quantity: "1", unit: "nos", estUnitPrice: "" });
  const [dept, setDept] = useState(initial?.departmentId ?? departments[0]?.id ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [why, setWhy] = useState(initial?.justification ?? "");
  const [budgetLineId, setBudgetLineId] = useState(initial?.budgetLineId ?? "");
  const [lines, setLines] = useState<Line[]>(initial?.lines.map((l) => ({ kind: l.kind, description: l.description, itemId: l.itemId ?? "", quantity: String(l.quantity), unit: l.unit, estUnitPrice: String(l.estUnitPrice) })) ?? [blank()]);
  const [pending, start] = useTransition();
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const total = lines.reduce((a, l) => a + Number(l.quantity || 0) * Number(l.estUnitPrice || 0), 0);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="pr-dept">Department</Label><select id="pr-dept" className={`${sel} w-full`} value={dept} onChange={(e) => setDept(e.target.value)}>{departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="pr-budget">Budget line</Label><select id="pr-budget" className={`${sel} w-full`} value={budgetLineId} onChange={(e) => setBudgetLineId(e.target.value)}><option value="">— not linked —</option>{budgetLines.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="pr-title">What is needed</Label><Input id="pr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 30 desktop computers for the networks lab" /></div>
        <div className="space-y-1 sm:col-span-2"><Label htmlFor="pr-why">Justification</Label><Textarea id="pr-why" rows={3} value={why} onChange={(e) => setWhy(e.target.value)} /></div>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[110px_1fr_90px_80px_110px_auto]">
            <select aria-label="Kind" className={sel} value={l.kind} onChange={(e) => set(i, { kind: e.target.value as Line["kind"], itemId: "" })}><option value="STOCK">Stock item</option><option value="ASSET">Equipment</option><option value="SERVICE">Service</option></select>
            {l.kind === "STOCK" ? (
              <select aria-label="Item" className={sel} value={l.itemId} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); set(i, { itemId: e.target.value, description: it?.label ?? "", unit: it?.unit ?? l.unit }); }}>
                <option value="">Choose an item…</option>{items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
              </select>
            ) : <Input aria-label="Description" placeholder="Description and specification" value={l.description} onChange={(e) => set(i, { description: e.target.value })} />}
            <Input aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value.replace(/[^0-9.]/g, "") })} />
            <Input aria-label="Unit" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} />
            <Input aria-label="Estimated unit price" inputMode="decimal" placeholder="Unit price" value={l.estUnitPrice} onChange={(e) => set(i, { estUnitPrice: e.target.value.replace(/[^0-9.]/g, "") })} />
            <Button size="icon-sm" variant="ghost" aria-label="Remove line" disabled={lines.length <= 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="xs" variant="outline" onClick={() => setLines([...lines, blank()])}><Plus /> Line</Button>
        <span className="text-xs tabular text-muted-foreground">Estimated total ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
        <Button size="sm" className="ml-auto" disabled={pending} onClick={() => start(async () => {
          const r = await saveRequestAction(initial?.id ?? null, {
            departmentId: dept, title, justification: why, budgetLineId: budgetLineId || null,
            lines: lines.map((l) => ({ kind: l.kind, description: l.description, itemId: l.kind === "STOCK" ? l.itemId || null : null, quantity: Number(l.quantity || 0), unit: l.unit, estUnitPrice: Number(l.estUnitPrice || 0) })),
          });
          if (!r.ok) { toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined }); return; }
          toast.success(r.message ?? "Saved");
          const id = (r.data as { id: string }).id;
          router.push(`/procurement/requests/${id}`);
          router.refresh();
        })}>{pending && <Loader2 className="animate-spin" />} Save draft</Button>
      </div>
    </div>
  );
}

// ───────────────────────── Purchase order ─────────────────────────

export function OrderForm({ requestId, vendors, lines }: { requestId: string; vendors: Opt[]; lines: { id: string; description: string; quantity: number; unit: string; estUnitPrice: number }[] }) {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(vendors[0]?.id ?? "");
  const [tax, setTax] = useState("18");
  const [expectedOn, setExpectedOn] = useState("");
  const [terms, setTerms] = useState("Delivery to the central store; payment within 30 days of acceptance.");
  const [prices, setPrices] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.estUnitPrice)])));
  const [pending, start] = useTransition();
  const sub = lines.reduce((a, l) => a + l.quantity * Number(prices[l.id] || 0), 0);
  const total = sub * (1 + Number(tax || 0) / 100);
  if (!vendors.length) return <p className="text-sm text-muted-foreground">Add a vendor first.</p>;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="po-v">Vendor</Label><select id="po-v" className={`${sel} w-full`} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>{vendors.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="po-tax">GST %</Label><Input id="po-tax" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
        <div className="space-y-1"><Label htmlFor="po-exp">Expected delivery</Label><Input id="po-exp" type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} /></div>
      </div>
      {lines.map((l) => (
        <div key={l.id} className="grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
          <span>{l.description} <span className="text-xs text-muted-foreground">× {l.quantity} {l.unit}</span></span>
          <Input aria-label={`Agreed unit price for ${l.description}`} inputMode="decimal" value={prices[l.id]} onChange={(e) => setPrices({ ...prices, [l.id]: e.target.value.replace(/[^0-9.]/g, "") })} />
        </div>
      ))}
      <div className="space-y-1"><Label htmlFor="po-terms">Terms</Label><Textarea id="po-terms" rows={2} value={terms} onChange={(e) => setTerms(e.target.value)} /></div>
      <div className="flex items-center gap-3">
        <span className="text-xs tabular text-muted-foreground">Order value ₹{total.toLocaleString("en-IN", { maximumFractionDigits: 2 })} incl. GST</span>
        <Button size="sm" className="ml-auto" disabled={pending} onClick={() => start(async () => {
          const r = await createOrderAction(requestId, { vendorId, taxPercent: Number(tax || 0), expectedOn: expectedOn || null, terms, prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, Number(v || 0)])) });
          if (!r.ok) { toast.error(r.error); return; }
          toast.success(`Issued ${(r.data as { number: string }).number}`);
          router.push(`/procurement/orders/${(r.data as { id: string }).id}`);
          router.refresh();
        })}>{pending && <Loader2 className="animate-spin" />} Issue purchase order</Button>
      </div>
    </div>
  );
}

// ───────────────────────── Goods receipt ─────────────────────────

export function ReceiveForm({ poId, stores, lines }: { poId: string; stores: Opt[]; lines: { id: string; kind: string; description: string; outstanding: number; unit: string }[] }) {
  const { pending, run } = useRun();
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [qty, setQty] = useState<Record<string, string>>(Object.fromEntries(lines.map((l) => [l.id, String(l.outstanding)])));
  const [category, setCategory] = useState("Computers & IT");
  const [life, setLife] = useState("5");
  const [notes, setNotes] = useState("");
  const hasStock = lines.some((l) => l.kind === "STOCK");
  const hasAsset = lines.some((l) => l.kind === "ASSET");
  return (
    <div className="space-y-3">
      {hasStock && <div className="space-y-1"><Label htmlFor="grn-store">Into store</Label><select id="grn-store" className={`${sel} w-full`} value={storeId} onChange={(e) => setStoreId(e.target.value)}>{stores.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>}
      {lines.map((l) => (
        <div key={l.id} className="grid grid-cols-[1fr_110px] items-center gap-2 text-sm">
          <span>{l.description} <span className="text-xs text-muted-foreground">({l.kind.toLowerCase()}, {l.outstanding} {l.unit} outstanding)</span></span>
          <Input aria-label={`Quantity received of ${l.description}`} inputMode="decimal" value={qty[l.id]} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value.replace(/[^0-9.]/g, "") })} />
        </div>
      ))}
      {hasAsset && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="grn-cat">Asset category</Label><Input id="grn-cat" value={category} onChange={(e) => setCategory(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="grn-life">Useful life (years)</Label><Input id="grn-life" inputMode="decimal" value={life} onChange={(e) => setLife(e.target.value.replace(/[^0-9.]/g, ""))} /></div>
        </div>
      )}
      <div className="space-y-1"><Label htmlFor="grn-notes">Inspection notes</Label><Input id="grn-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Checked against the specification; seals intact" /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => receiveGoodsAction(poId, { storeId: storeId || null, quantities: Object.fromEntries(Object.entries(qty).map(([k, v]) => [k, Number(v || 0)])), notes: notes || null, assetCategory: category, usefulLifeYears: Number(life || 5) }))}>
        {pending && <Loader2 className="animate-spin" />} Record receipt
      </Button>
    </div>
  );
}

// ───────────────────────── Approve / refuse ─────────────────────────

function Decide({ approve, refuse }: { approve: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>; refuse: (note: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }> }) {
  const { pending, run } = useRun();
  return (
    <span className="inline-flex gap-1">
      <Button size="xs" disabled={pending} onClick={() => run(approve)}><Check /> Approve</Button>
      <Button size="xs" variant="outline" disabled={pending} onClick={() => { const n = prompt("Reason for refusing?"); if (n) run(() => refuse(n)); }}><X /> Refuse</Button>
    </span>
  );
}

export const DecideBooking = ({ id }: { id: string }) => <Decide approve={() => decideBookingAction(id, true)} refuse={(n) => decideBookingAction(id, false, n)} />;
export const DecideOutpass = ({ id }: { id: string }) => <Decide approve={() => decideOutpassAction(id, true)} refuse={(n) => decideOutpassAction(id, false, n)} />;

// ───────────────────────── Visitors ─────────────────────────

export function PreRegisterVisitor({ fields }: { fields: FormField[] }) {
  return (
    <FormDialog title="Expected visitor" action={preRegisterVisitorAction} submitLabel="Create pass" trigger={<Button size="sm"><Plus /> Expect a visitor</Button>}
      fields={fields} onSaved={(d) => toast.success(`Pass code ${(d as { passCode: string }).passCode}`, { description: "Share this with your visitor; the gate checks them in with it.", duration: 20_000 })} />
  );
}
