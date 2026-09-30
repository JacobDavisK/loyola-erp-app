import { FileSpreadsheet, FileText, Sheet } from "lucide-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { buildReport, REPORT_KINDS, type ReportKind } from "@/server/services/reports";

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ kind?: string; session?: string }> }) {
  const ctx = await requirePageAuth(["report.view", "audit.view"]);
  const sp = await searchParams;
  const available = REPORT_KINDS.filter((k) => can(ctx, k.perm));
  const kind = (available.find((k) => k.key === sp.kind) ?? available[0])?.key as ReportKind | undefined;
  if (!kind) redirect("/forbidden");
  const [report, sessions] = await Promise.all([buildReport(ctx, kind, { sessionId: sp.session }), db.examinationSession.findMany({ orderBy: { startDate: "desc" }, select: { id: true, name: true } })]);
  const exportHref = (format: string) => `/api/reports/${kind}?format=${format}${sp.session ? `&session=${sp.session}` : ""}`;
  const sessionScoped = kind !== "question-bank" && kind !== "audit";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Operational examination reports. Every export is recorded in the audit log."
        actions={
          <>
            <Button asChild variant="outline" size="sm"><a href={exportHref("csv")}><Sheet /> CSV</a></Button>
            <Button asChild variant="outline" size="sm"><a href={exportHref("xlsx")}><FileSpreadsheet /> Excel</a></Button>
            <Button asChild size="sm"><a href={exportHref("pdf")}><FileText /> PDF</a></Button>
          </>
        }
      />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <LinkTabs active={kind} tabs={available.map((k) => ({ key: k.key, label: k.label, href: `/reports?kind=${k.key}${sp.session ? `&session=${sp.session}` : ""}` }))} />
        {sessionScoped && (
          <form className="flex min-w-0 gap-2">
            <input type="hidden" name="kind" value={kind} />
            <select name="session" defaultValue={sp.session ?? ""} aria-label="Session" className="h-8 min-w-0 flex-1 rounded-lg border bg-card px-2 text-[13px] lg:flex-none">
              <option value="">Current session</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="h-8 shrink-0 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button>
          </form>
        )}
      </div>
      <div>
        <h2 className="text-lg font-semibold">{report.title}</h2>
        <p className="text-sm text-muted-foreground">{report.subtitle}</p>
      </div>
      <div className={cn("grid gap-3", report.summary.length > 4 ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-6" : "grid-cols-2 md:grid-cols-4")}>
        {report.summary.map((s) => <StatCard key={s.label} label={s.label} value={s.value} />)}
      </div>
      {report.tables.map((t) => (
        <Section key={t.title} title={t.title} description={`${t.rows.length} row${t.rows.length === 1 ? "" : "s"}`} bodyClassName="p-0">
          {t.rows.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No records.</p>
          ) : (
            <DataTable head={t.columns.map((c) => ({ label: c.label, className: c.align === "right" ? "text-right" : undefined }))}>
              {t.rows.slice(0, 200).map((row, i) => (
                <tr key={i}>
                  {t.columns.map((c) => <Td key={c.key} className={cn(c.align === "right" && "text-right tabular")}>{String(row[c.key] ?? "")}</Td>)}
                </tr>
              ))}
            </DataTable>
          )}
          {t.rows.length > 200 && <p className="border-t px-5 py-2 text-xs text-muted-foreground">Showing 200 of {t.rows.length} rows. Export to see all.</p>}
        </Section>
      ))}
    </div>
  );
}
