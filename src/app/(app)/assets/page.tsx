import Link from "next/link";
import { BookCheck, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { postDepreciationAction, saveAssetAction } from "@/features/operations/actions";
import { assetFields } from "@/features/operations/fields";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { depreciation, fiscalYearOf } from "@/lib/domain/operations";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { asDepreciable, depreciationSchedule } from "@/server/services/assets";

export const metadata: Metadata = { title: "Asset register" };

const STATUS: Record<string, string> = { IN_USE: "In use", IN_REPAIR: "In repair", IDLE: "Idle", DISPOSED: "Disposed", LOST: "Missing" };

function previousYears(n: number) {
  const cur = Number(fiscalYearOf(new Date()).slice(0, 4));
  return Array.from({ length: n }, (_, i) => { const y = cur - i; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; });
}

export default async function AssetsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth("asset.manage");
  const sp = await searchParams;
  const view = sp.view ?? "register";
  const fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : fiscalYearOf(new Date());
  const [assets, departments] = await Promise.all([
    db.asset.findMany({ where: sp.dept ? { departmentId: sp.dept } : {}, include: { department: { select: { code: true } } }, orderBy: { tag: "asc" }, take: 1000 }),
    db.department.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
  ]);
  const schedule = view === "depreciation" ? await depreciationSchedule(fy) : null;
  const now = new Date();
  const live = assets.filter((a) => a.status !== "DISPOSED");
  const cost = live.reduce((a, x) => a + toMinor(x.cost), 0);
  const book = live.reduce((a, x) => a + Math.round(depreciation(asDepreciable(x), now).bookValue * 100), 0);
  const deptOpts = departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Asset register"
        description="Every piece of equipment and furniture with a tag, its department, location and history. Book values are depreciated by straight line or written-down value; the year's depreciation is posted to the ledger once, per department."
        actions={<FormDialog title="Asset" action={saveAssetAction} fields={assetFields(deptOpts)} columns={2} initial={{ method: "STRAIGHT_LINE", salvageValue: 0, usefulLifeYears: 5, purchaseDate: now.toISOString().slice(0, 10) }} trigger={<Button size="sm"><Plus /> Add asset</Button>} />}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Assets in the register" value={live.length} />
        <StatCard label="Cost" value={formatMoney(cost)} />
        <StatCard label="Book value today" value={formatMoney(book)} />
        <StatCard label="In repair or missing" value={live.filter((a) => a.status === "IN_REPAIR" || a.status === "LOST").length} />
      </div>
      <LinkTabs active={view} tabs={[{ key: "register", label: "Register", href: "/assets" }, { key: "depreciation", label: "Depreciation", href: "/assets?view=depreciation" }]} />
      {view === "register" && (
        <Section title="Register" description={<span className="flex flex-wrap gap-2">{[{ id: "", code: "All" }, ...departments].map((d) => <Link key={d.id} href={d.id ? `/assets?dept=${d.id}` : "/assets"} className={`rounded px-1.5 text-xs ${(sp.dept ?? "") === d.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{d.code}</Link>)}</span>} bodyClassName="p-0">
          <DataTable head={[{ label: "Tag" }, { label: "Asset" }, { label: "Department" }, { label: "Purchased" }, { label: "Cost", className: "text-right" }, { label: "Book value", className: "text-right" }, { label: "Status" }]} empty="No assets.">
            {assets.map((a) => (
              <tr key={a.id} className={a.status === "DISPOSED" ? "opacity-60" : undefined}>
                <Td><Link className="font-mono text-xs font-medium hover:text-primary" href={`/assets/${a.id}`}>{a.tag}</Link></Td>
                <Td>{a.name}<div className="text-[11px] text-muted-foreground">{a.category}{a.location ? ` · ${a.location}` : ""}</div></Td>
                <Td className="text-xs">{a.department.code}</Td>
                <Td className="text-xs">{fmtDate(a.purchaseDate)}</Td>
                <Td className="text-right tabular">{formatMoney(toMinor(a.cost))}</Td>
                <Td className="text-right tabular">{a.status === "DISPOSED" ? "—" : formatMoney(Math.round(depreciation(asDepreciable(a), now).bookValue * 100))}</Td>
                <Td className="text-xs">{STATUS[a.status]}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {schedule && (
        <Section
          title={`Depreciation ${fy}`}
          description={<span className="flex flex-wrap gap-2">{previousYears(4).map((y) => <Link key={y} href={`/assets?view=depreciation&fy=${y}`} className={`rounded px-1.5 text-xs ${y === fy ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{y}</Link>)}</span>}
          actions={schedule.posted ? <span className="text-xs text-muted-foreground">Posted in {schedule.posted.number}</span> : <ActionButton label="Post to ledger" variant="default" icon={<BookCheck />} run={postDepreciationAction.bind(null, fy)} confirmText={`Post depreciation for ${fy}? It can be posted only once.`} />}
          bodyClassName="p-0"
        >
          <DataTable head={[{ label: "Department" }, { label: "Charge for the year", className: "text-right" }]} empty="Nothing to depreciate.">
            {schedule.byDept.map((d) => <tr key={d.departmentId}><Td>{d.code}</Td><Td className="text-right tabular">{formatMoney(Math.round(d.charge * 100))}</Td></tr>)}
            {schedule.byDept.length > 0 && <tr className="font-medium"><Td>Total</Td><Td className="text-right tabular">{formatMoney(schedule.byDept.reduce((a, d) => a + Math.round(d.charge * 100), 0))}</Td></tr>}
          </DataTable>
          <DataTable head={[{ label: "Tag" }, { label: "Asset" }, { label: "Method" }, { label: "Charge", className: "text-right" }, { label: "Closing book value", className: "text-right" }]}>
            {schedule.rows.map((r) => (
              <tr key={r.asset.id}>
                <Td className="font-mono text-xs">{r.asset.tag}</Td>
                <Td>{r.asset.name}</Td>
                <Td className="text-xs">{r.asset.method === "STRAIGHT_LINE" ? `SLM, ${r.asset.usefulLifeYears} y` : `WDV ${r.asset.wdvRate}%`}</Td>
                <Td className="text-right tabular">{formatMoney(Math.round(r.charge * 100))}</Td>
                <Td className="text-right tabular">{formatMoney(Math.round(r.closing * 100))}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
