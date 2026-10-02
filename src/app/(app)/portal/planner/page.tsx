import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { autoPlanAction } from "@/features/success/actions";
import { PlanSelect } from "@/features/success/controls";
import { cn } from "@/lib/utils";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { plannerData, whatIf } from "@/server/services/planner";
import { Route } from "lucide-react";

export const metadata: Metadata = { title: "Degree planner" };

const STATUS_TEXT = { PASSED: "Passed", IN_PROGRESS: "Taking now", PLANNED: "Planned", TODO: "To plan" } as const;
const STATUS_CLASS = { PASSED: "text-tone-success", IN_PROGRESS: "text-tone-progress", PLANNED: "text-primary", TODO: "text-muted-foreground" } as const;

export default async function PlannerPage({ searchParams }: { searchParams: Promise<{ whatif?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  const sp = await searchParams;
  const data = await plannerData(ctx, studentId);
  if (!data) return <EmptyState icon={Route} title="No curriculum" description="Your programme's curriculum has not been published yet." />;
  const { check } = data;
  const lastSem = Math.max(8, ...data.courses.map((c) => c.semester)) + 2;
  const programs = await db.program.findMany({ where: { deletedAt: null, id: { not: data.student.programId }, curricula: { some: { status: "ACTIVE" } } }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } });
  const wi = sp.whatif ? await whatIf(ctx, studentId, sp.whatif).catch(() => null) : null;
  const semesters = [...new Set(data.courses.map((c) => c.semester))].sort((a, b) => a - b);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Degree planner"
        breadcrumbs={[{ label: "My studies" }, { label: "Degree planner" }]}
        description={`${data.curriculum.name} (v${data.curriculum.version}). Plan the courses you still need; the planner checks prerequisites and the ${data.maxCredits}-credit limit per semester.`}
        actions={data.editable ? <ActionButton label="Plan the rest for me" icon={<Sparkles />} run={autoPlanAction.bind(null, studentId)} /> : undefined}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Section title="Where you stand" className="lg:col-span-1">
          <KeyValue items={[
            ["Current semester", String(data.student.currentSemester)],
            ["Courses passed", String(data.courses.filter((c) => c.status === "PASSED").length)],
            ["Planned", String(data.courses.filter((c) => c.status === "PLANNED").length)],
            ["Still to plan", String(data.courses.filter((c) => c.status === "TODO" && c.category === "MANDATORY").length) + " mandatory"],
            ["Finish", check.finishesIn ? `Semester ${check.finishesIn}` : "Plan every mandatory course to see"],
          ]} />
        </Section>
        <Section title={check.issues.length ? `${check.issues.length} thing(s) to fix` : "Your plan checks out"} className="lg:col-span-2">
          {check.issues.length === 0 ? <p className="text-sm text-tone-success">No prerequisite, credit-load or missing-course problems.</p> : (
            <ul className="space-y-1 text-sm">{check.issues.map((i, k) => <li key={k} className={i.kind === "MISSING_MANDATORY" ? "text-tone-warning" : "text-tone-danger"}>• {i.message}</li>)}</ul>
          )}
        </Section>
      </div>
      {semesters.map((sem) => {
        const list = data.courses.filter((c) => c.semester === sem);
        return (
          <Section key={sem} title={`Curriculum semester ${sem}`} bodyClassName="p-0">
            <DataTable head={[{ label: "Course" }, { label: "Credits" }, { label: "Type" }, { label: "Status" }, { label: "Plan" }]}>
              {list.map((c) => (
                <tr key={c.courseId}>
                  <Td><span className="font-mono text-xs">{c.code}</span> {c.title}</Td>
                  <Td>{c.credits}</Td>
                  <Td className="text-xs">{c.category === "MANDATORY" ? "Mandatory" : `Elective${c.group ? ` (${c.group})` : ""}`}</Td>
                  <Td className={cn("text-xs font-medium", STATUS_CLASS[c.status])}>{STATUS_TEXT[c.status]}</Td>
                  <Td>{(c.status === "TODO" || c.status === "PLANNED") && data.editable ? <PlanSelect studentId={studentId} courseId={c.courseId} value={c.plannedFor} from={data.student.currentSemester + 1} to={lastSem} /> : null}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        );
      })}
      {[...check.bySemester.entries()].length > 0 && (
        <Section title="Your plan by semester" bodyClassName="p-0">
          <DataTable head={[{ label: "Semester" }, { label: "Courses" }, { label: "Credits" }]}>
            {[...check.bySemester.entries()].sort((a, b) => a[0] - b[0]).map(([sem, v]) => (
              <tr key={sem}>
                <Td>{sem}</Td>
                <Td className="text-sm">{v.courses.map((c) => c.code).join(", ")}</Td>
                <Td className={v.credits > data.maxCredits ? "font-medium text-tone-danger" : undefined}>{v.credits}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      <Section title="What if I changed programme?" description="See how your passed courses would count towards another programme's curriculum.">
        <form className="flex flex-wrap items-end gap-2" action="/portal/planner">
          <label htmlFor="wi" className="sr-only">Programme</label>
          <select id="wi" name="whatif" defaultValue={sp.whatif ?? ""} className="h-9 rounded-lg border bg-card px-2.5 text-sm"><option value="">Choose a programme</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
          <button className="h-9 rounded-lg border px-3 text-sm">Compare</button>
        </form>
        {wi && (
          <div className="mt-4">
            <KeyValue items={[
              ["Programme", `${wi.program.code} — ${wi.program.name}`],
              ["Your passed courses that count", String(wi.transferable)],
              ["Credits", `${wi.audit.earnedCredits} of ${wi.audit.requiredCredits} (${wi.audit.percent}%)`],
              ["Mandatory courses left", String(wi.audit.mandatory.remaining.length)],
            ]} />
          </div>
        )}
      </Section>
    </div>
  );
}
