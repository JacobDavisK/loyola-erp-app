import { notFound } from "next/navigation";
import { ArrowRightLeft, ClipboardCheck, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { assetEventAction, disposeAssetAction, saveAssetAction, transferAssetAction } from "@/features/operations/actions";
import { assetEventFields, assetFields, assetTransferFields, disposeFields } from "@/features/operations/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { depreciation } from "@/lib/domain/operations";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { asDepreciable } from "@/server/services/assets";

export const metadata: Metadata = { title: "Asset" };

const EVENT: Record<string, string> = { ACQUIRED: "Acquired", UPDATED: "Details corrected", TRANSFER: "Moved", VERIFIED: "Verified", REPAIR: "Sent for repair", RETURNED_TO_USE: "Back in use", IDLE: "Idle", LOST: "Reported missing", DISPOSED: "Disposed of" };

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageAuth("asset.manage");
  const { id } = await params;
  const a = await db.asset.findUnique({ where: { id }, include: { department: true, events: { orderBy: { createdAt: "desc" } } } });
  if (!a) notFound();
  const departments = await db.department.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } });
  const deptOpts = departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }));
  const actors = new Map((await db.user.findMany({ where: { id: { in: [...new Set(a.events.map((e) => e.actorId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const dep = depreciation(asDepreciable(a), a.disposedAt ?? new Date());
  const live = a.status !== "DISPOSED";
  return (
    <div className="space-y-6">
      <PageHeader
        title={a.name}
        eyebrow={a.tag}
        breadcrumbs={[{ label: "Asset register", href: "/assets" }, { label: a.tag }]}
        actions={live ? (
          <div className="flex flex-wrap gap-2">
            <FormDialog title="Asset event" id={a.id} action={assetEventAction} fields={assetEventFields} submitLabel="Record" trigger={<Button size="sm" variant="outline"><ClipboardCheck /> Verify / status</Button>} />
            <FormDialog title="Asset move" id={a.id} action={transferAssetAction} fields={assetTransferFields(deptOpts)} initial={{ departmentId: a.departmentId, location: a.location ?? "" }} submitLabel="Move" trigger={<Button size="sm" variant="outline"><ArrowRightLeft /> Move</Button>} />
            <FormDialog title="Disposal" id={a.id} action={disposeAssetAction} fields={disposeFields} initial={{ date: new Date().toISOString().slice(0, 10), value: 0 }} submitLabel="Dispose of" trigger={<Button size="sm" variant="outline" className="text-destructive"><Trash2 /> Dispose</Button>} />
            <FormDialog title="Asset" id={a.id} action={saveAssetAction} fields={assetFields(deptOpts)} columns={2}
              initial={{ name: a.name, category: a.category, departmentId: a.departmentId, location: a.location ?? "", serialNo: a.serialNo ?? "", purchaseDate: a.purchaseDate.toISOString().slice(0, 10), cost: Number(a.cost), salvageValue: Number(a.salvageValue), usefulLifeYears: a.usefulLifeYears, method: a.method, wdvRate: a.wdvRate ?? "" }} />
          </div>
        ) : undefined}
      />
      <Section title="Details">
        <KeyValue items={[
          ["Status", a.status.toLowerCase().replace("_", " ")],
          ["Department", a.department.name],
          ["Location", a.location ?? "—"],
          ["Serial number", a.serialNo ?? "—"],
          ["Purchased", fmtDate(a.purchaseDate)],
          ["Cost", formatMoney(toMinor(a.cost))],
          ["Depreciation", a.method === "STRAIGHT_LINE" ? `Straight line over ${a.usefulLifeYears} years, salvage ${formatMoney(toMinor(a.salvageValue))}` : `Written-down value at ${a.wdvRate}% a year`],
          [live ? "Accumulated depreciation" : "Depreciation at disposal", formatMoney(Math.round(dep.accumulated * 100))],
          [live ? "Book value today" : "Book value at disposal", formatMoney(Math.round(dep.bookValue * 100))],
          ...(a.disposedAt ? [["Disposed", `${fmtDate(a.disposedAt)} for ${formatMoney(toMinor(a.disposalValue))}`] as [string, string]] : []),
        ]} />
      </Section>
      <Section title="History">
        <ol className="space-y-2 text-sm">
          {a.events.map((e) => (
            <li key={e.id} className="border-l-2 pl-3">
              <div className="font-medium">{EVENT[e.kind] ?? e.kind}</div>
              {e.note && <div className="text-muted-foreground">{e.note}</div>}
              <div className="text-[11px] text-muted-foreground">{fmtDateTime(e.createdAt)} · {actors.get(e.actorId) ?? "—"}</div>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  );
}
