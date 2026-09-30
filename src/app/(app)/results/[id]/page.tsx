import Link from "next/link";
import { notFound } from "next/navigation";
import { Calculator, Send, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Pagination, qs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { computeRunAction, submitRunAction } from "@/features/results/actions";
import { WithholdButton } from "@/features/results/withhold-button";
import { COURSE_RESULT_STATUS, RUN_STATUS } from "@/lib/domain/labels";
import { fmtDateTime } from "@/lib/format";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Result run" };

type Stats = { students?: number; courses?: number; pass?: number; fail?: number; absent?: number; incomplete?: number; withheld?: number; graceUsed?: number; passPercent?: number; warnings?: string[] };

export default async function RunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageAuth(["result.process", "result.view"]);
  const run = await db.resultRun.findUnique({ where: { id }, include: { session: true, program: true, term: true, gradingScheme: true } });
  if (!run) notFound();
  const scope = scopeOf(ctx, "result.view");
  if (!can(ctx, "result.process") && scope !== null && !(run.program && scope.includes(run.program.departmentId))) notFound();
  const stats = (run.stats ?? {}) as Stats;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 50;
  const where = { runId: id, isCurrent: true, ...(sp.status ? { status: sp.status as never } : {}), ...(sp.course ? { courseId: sp.course } : {}) };
  const [rows, total, courses, instance] = await Promise.all([
    db.courseResult.findMany({ where, skip: (page - 1) * pageSize, take: pageSize, orderBy: [{ course: { code: "asc" } }, { student: { studentNo: "asc" } }], include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } }, course: { select: { code: true } } } }),
    db.courseResult.count({ where }),
    db.courseResult.findMany({ where: { runId: id }, distinct: ["courseId"], select: { courseId: true, course: { select: { code: true } } }, orderBy: { course: { code: "asc" } } }),
    db.workflowInstance.findFirst({ where: { resourceType: "resultRun", resourceId: id }, orderBy: { createdAt: "desc" } }),
  ]);
  const process = can(ctx, "result.process");
  const editable = run.status === "DRAFT" || run.status === "COMPUTED";
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Results", href: "/results" }, { label: `${run.session.code} · ${run.program?.code ?? "All"}` }]}
        title={<span className="flex flex-wrap items-center gap-3">{run.session.name} <StatusBadge meta={RUN_STATUS[run.status]} size="md" /></span>}
        description={`${run.program?.name ?? "All programmes"} · ${run.term.name} · grading ${run.gradingScheme.name} v${run.gradingScheme.version}${run.computedAt ? ` · computed ${fmtDateTime(run.computedAt)}` : ""}`}
        actions={
          process && editable ? (
            <>
              <ActionButton run={computeRunAction.bind(null, id)} label={run.status === "DRAFT" ? "Compute results" : "Recompute"} icon={<Calculator />} confirmText="Compute results from approved internal marks and final valuations? Draft results of this run are replaced." />
              {run.status === "COMPUTED" && <ActionButton variant="default" run={submitRunAction.bind(null, id)} label="Submit for approval" icon={<Send />} confirmText="Send these results to department verification, the Controller and the Registrar?" />}
            </>
          ) : instance ? <Link href={`/inbox/requests/${instance.id}`} className="text-sm font-medium text-primary hover:underline">Approval history →</Link> : null
        }
      />
      {stats.warnings && stats.warnings.length > 0 && (
        <div role="alert" className="rounded-xl border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium"><TriangleAlert className="size-4 text-tone-warning" /> Data not ready at computation</div>
          <ul className="list-disc pl-6 text-muted-foreground">{stats.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}
      {run.computedAt && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
          <StatCard label="Students" value={stats.students ?? 0} />
          <StatCard label="Course results" value={stats.courses ?? 0} />
          <StatCard label="Pass rate" value={`${stats.passPercent ?? 0}%`} tone="success" />
          <StatCard label="Failed" value={stats.fail ?? 0} tone={stats.fail ? "danger" : undefined} />
          <StatCard label="Absent" value={stats.absent ?? 0} />
          <StatCard label="Incomplete" value={stats.incomplete ?? 0} tone={stats.incomplete ? "warning" : undefined} hint={stats.incomplete ? "Blocks publication" : undefined} />
          <StatCard label="Grace marks used" value={stats.graceUsed ?? 0} />
        </div>
      )}
      <Section title="Course results" bodyClassName="p-0">
        <form className="flex flex-wrap gap-2 border-b px-5 py-3">
          <select name="course" defaultValue={sp.course ?? ""} aria-label="Course" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All courses</option>{courses.map((c) => <option key={c.courseId} value={c.courseId}>{c.course.code}</option>)}</select>
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Result" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any result</option>{Object.entries(COURSE_RESULT_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Filter</button>
        </form>
        {rows.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">{run.computedAt ? "No results match." : "Not computed yet."}</p> : (
          <DataTable head={[{ label: "Student" }, { label: "Course" }, { label: "Internal", className: "text-right" }, { label: "External", className: "text-right" }, { label: "Total", className: "text-right" }, { label: "Grade" }, { label: "Result" }, { label: "" }]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td><Link href={`/students/${r.student.id}?tab=results`} className="hover:text-primary">{r.student.firstName} {r.student.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
                <Td className="text-xs">{r.course.code}{r.attempt > 1 && <span className="text-muted-foreground"> · attempt {r.attempt}</span>}</Td>
                <Td className="text-right tabular">{r.internalMarks ?? "—"}</Td>
                <Td className="text-right tabular">{r.externalMarks ?? "—"}{r.graceMarks > 0 && <span className="text-tone-info" title="Grace marks"> +{r.graceMarks}</span>}</Td>
                <Td className="text-right tabular">{r.totalMarks ?? "—"} / {r.maxMarks}</Td>
                <Td className="font-semibold">{r.grade}{r.version > 1 && <span className="ml-1 text-[11px] font-normal text-muted-foreground">v{r.version}</span>}</Td>
                <Td><StatusBadge meta={COURSE_RESULT_STATUS[r.status]} />{r.withheldReason && <div className="text-[11px] text-muted-foreground">{r.withheldReason}</div>}</Td>
                <Td className="text-right">{can(ctx, "result.withhold") && (editable || run.status === "PUBLISHED") && <WithholdButton courseResultId={r.id} runId={id} withheld={r.status === "WITHHELD"} />}</Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/results/${id}${qs({ course: sp.course, status: sp.status }, { page: p })}`} />
      </Section>
    </div>
  );
}
