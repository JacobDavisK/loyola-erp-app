import Link from "next/link";
import { Award, Plus } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { createRunAction } from "@/features/results/actions";
import { RUN_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Results" };

export default async function ResultsPage() {
  const ctx = await requirePageAuth(["result.process", "result.view"]);
  const scope = scopeOf(ctx, "result.view");
  const programFilter = scope === null || can(ctx, "result.process") ? {} : { program: { departmentId: { in: scope } } };
  const [runs, sessions, programs] = await Promise.all([
    db.resultRun.findMany({ where: programFilter, orderBy: { createdAt: "desc" }, include: { session: { select: { name: true, code: true } }, program: { select: { code: true, name: true } }, gradingScheme: { select: { code: true, version: true } }, _count: { select: { courseResults: { where: { isCurrent: true } } } } } }),
    db.examinationSession.findMany({ where: { termId: { not: null } }, orderBy: { startDate: "desc" } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
  ]);
  const fields: FormField[] = [
    { name: "sessionId", label: "Examination session", type: "select", options: sessions.map((s) => ({ value: s.id, label: s.name })) },
    { name: "programId", label: "Programme", type: "select", options: programs.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Results"
        description="Result processing by session and programme: compute from approved marks and final valuations, approve in three steps, publish."
        actions={
          <>
            {can(ctx, "revaluation.manage") && <Button asChild size="sm" variant="outline"><Link href="/results/revaluation">Revaluation desk</Link></Button>}
            {can(ctx, "grading.manage") && <Button asChild size="sm" variant="outline"><Link href="/results/grading">Grading schemes</Link></Button>}
            {can(ctx, "result.process") && sessions.length > 0 && <FormDialog title="Result run" fields={fields} action={createRunAction} trigger={<Button size="sm"><Plus /> New result run</Button>} />}
          </>
        }
      />
      <Section bodyClassName="p-0">
        {runs.length === 0 ? <div className="p-6"><EmptyState icon={Award} title="No result runs yet" /></div> : (
          <DataTable head={[{ label: "Session" }, { label: "Programme" }, { label: "Grading" }, { label: "Results", className: "text-right" }, { label: "Pass rate", className: "text-right" }, { label: "Status" }, { label: "Published" }]}>
            {runs.map((r) => {
              const stats = (r.stats ?? {}) as { passPercent?: number };
              return (
                <tr key={r.id} className="hover:bg-muted/40">
                  <Td><Link href={`/results/${r.id}`} className="font-medium hover:text-primary">{r.session.name}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.session.code}</div></Td>
                  <Td className="text-xs">{r.program ? `${r.program.code} — ${r.program.name}` : "All"}</Td>
                  <Td className="text-xs">{r.gradingScheme.code} v{r.gradingScheme.version}</Td>
                  <Td className="text-right tabular">{r._count.courseResults}</Td>
                  <Td className="text-right tabular">{stats.passPercent !== undefined ? `${stats.passPercent}%` : "—"}</Td>
                  <Td><StatusBadge meta={RUN_STATUS[r.status]} /></Td>
                  <Td className="text-xs whitespace-nowrap">{fmtDate(r.publishedAt)}</Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
