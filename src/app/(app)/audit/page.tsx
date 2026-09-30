import { Download, ShieldCheck, ShieldX } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, Td } from "@/components/app/list";
import { PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { describeDevice } from "@/server/request-context";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { verifyAuditChain } from "@/server/services/audit";

export const metadata: Metadata = { title: "Audit logs" };

const CATEGORIES: Record<string, { label: string; where: Prisma.AuditLogWhereInput }> = {
  all: { label: "All events", where: {} },
  security: { label: "Security", where: { OR: [{ action: { startsWith: "auth." } }, { action: { startsWith: "role." } }, { action: { startsWith: "user." } }] } },
  workflow: { label: "Workflow", where: { action: { startsWith: "paper." }, NOT: { action: { in: ["paper.preview", "paper.access"] } } } },
  exports: { label: "Downloads & exports", where: { OR: [{ action: { startsWith: "paper.export" } }, { action: "paper.package" }, { action: "file.download" }, { action: "report.export" }] } },
  access: { label: "Paper access", where: { action: { in: ["paper.preview", "paper.access"] } } },
  questions: { label: "Question bank", where: { action: { startsWith: "question." } } },
  admin: { label: "Administration", where: { OR: [{ action: { startsWith: "settings." } }, { action: { startsWith: "institution." } }, { action: { startsWith: "template." } }, { action: { startsWith: "watermark." } }, { action: { startsWith: "session." } }, { action: { startsWith: "course." } }] } },
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 50;
  const cat = CATEGORIES[sp.category ?? "all"] ?? CATEGORIES.all;
  const f: Prisma.AuditLogWhereInput[] = [cat.where];
  if (sp.q) f.push({ OR: [{ actorName: { contains: sp.q, mode: "insensitive" } }, { summary: { contains: sp.q, mode: "insensitive" } }, { action: { contains: sp.q, mode: "insensitive" } }, { resourceId: sp.q }, { ip: sp.q }] });
  if (sp.from) f.push({ createdAt: { gte: new Date(sp.from) } });
  if (sp.to) f.push({ createdAt: { lte: new Date(`${sp.to}T23:59:59`) } });
  const where = { AND: f };
  const [rows, total, chain] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    db.auditLog.count({ where }),
    sp.verify ? verifyAuditChain() : Promise.resolve(null),
  ]);
  const base = { category: sp.category, q: sp.q, from: sp.from, to: sp.to };
  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit logs"
        description="Append-only, hash-chained record of every significant action. Rows cannot be edited or deleted — not even by administrators (enforced by the database)."
        actions={
          <>
            <Button asChild variant="outline" size="sm"><a href={`/audit${qs(base, { verify: 1 })}`}><ShieldCheck /> Verify integrity</a></Button>
            <Button asChild size="sm"><a href={`/api/audit/export${qs(base, {})}`}><Download /> Export CSV</a></Button>
          </>
        }
      />
      {chain && (
        <div role="status" className={cn("flex items-center gap-3 rounded-xl border px-4 py-3 text-sm", chain.brokenAt ? "border-tone-danger/40 bg-tone-danger/5" : "border-tone-success/40 bg-tone-success/5")}>
          {chain.brokenAt ? <ShieldX className="size-5 text-tone-danger" /> : <ShieldCheck className="size-5 text-tone-success" />}
          {chain.brokenAt ? <span><b>Integrity failure</b> at entry #{chain.brokenAt}. The record has been altered outside the application — escalate to the Controller of Examinations.</span> : <span><b>Chain intact.</b> {chain.checked.toLocaleString("en-IN")} entries verified — every hash links to its predecessor.</span>}
        </div>
      )}
      <form className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted-foreground">Category
          <select name="category" defaultValue={sp.category ?? "all"} className="mt-1 block h-8 rounded-lg border bg-card px-2 text-[13px] text-foreground">
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-muted-foreground">From<input type="date" name="from" defaultValue={sp.from} className="mt-1 block h-8 rounded-lg border bg-card px-2 text-[13px] text-foreground" /></label>
        <label className="text-xs text-muted-foreground">To<input type="date" name="to" defaultValue={sp.to} className="mt-1 block h-8 rounded-lg border bg-card px-2 text-[13px] text-foreground" /></label>
        <label className="text-xs text-muted-foreground">Search<input name="q" defaultValue={sp.q} placeholder="User, action, IP, record id" className="mt-1 block h-8 w-64 rounded-lg border bg-card px-2 text-[13px] text-foreground" /></label>
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
      </form>
      <div className="surface-card overflow-hidden">
        <DataTable head={[{ label: "#" }, { label: "Date / time" }, { label: "User" }, { label: "Action" }, { label: "Resource" }, { label: "Detail" }, { label: "IP / device" }]}>
          {rows.map((r) => (
            <tr key={r.id.toString()} className="align-top">
              <Td className="font-mono text-[11px] text-muted-foreground">{r.id.toString()}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
              <Td className="text-sm">{r.actorName ?? <span className="text-muted-foreground">—</span>}</Td>
              <Td><code className={cn("rounded px-1.5 py-0.5 text-[11px]", r.action.includes("failed") || r.action.includes("locked") || r.action.includes("blocked") ? "bg-tone-danger/10 text-tone-danger" : "bg-muted")}>{r.action}</code></Td>
              <Td className="text-xs text-muted-foreground">{r.resourceType}</Td>
              <Td className="max-w-md text-xs">
                {r.summary}
                {(r.oldValue || r.newValue) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-muted-foreground">Old / new value</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted p-2 text-[10.5px] whitespace-pre-wrap">{JSON.stringify({ old: r.oldValue, new: r.newValue }, null, 2)}</pre>
                  </details>
                )}
              </Td>
              <Td className="text-[11px] whitespace-nowrap text-muted-foreground">{r.ip ?? "—"}<div>{r.userAgent === "seed" ? "seed" : describeDevice(r.userAgent)}</div></Td>
            </tr>
          ))}
        </DataTable>
        {rows.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No events match these filters.</p>}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/audit${qs(base, { page: p })}`} />
      </div>
    </div>
  );
}
