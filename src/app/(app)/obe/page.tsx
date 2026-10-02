import Link from "next/link";
import { Target } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteProgramOutcomeAction, saveProgramOutcomeAction } from "@/features/compliance/actions";
import { attainmentTone } from "@/features/compliance/labels";
import { cn } from "@/lib/utils";
import { type AuthContext, can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { programAttainment } from "@/server/services/obe";

export const metadata: Metadata = { title: "Outcome-based education" };

const PO_FIELDS: FormField[] = [
  { name: "code", label: "Code", type: "text", upper: true, placeholder: "PO1 or PSO1" },
  { name: "title", label: "Short title", type: "text", placeholder: "Engineering knowledge" },
  { name: "description", label: "Statement", type: "textarea" },
];

const TONE_TEXT = { success: "text-tone-success", warning: "text-tone-warning", danger: "text-tone-danger", neutral: "text-muted-foreground" } as const;

export default async function ObePage({ searchParams }: { searchParams: Promise<{ program?: string; tab?: string }> }) {
  const ctx = await requirePageAuth(["obe.view", "obe.manage"]);
  const sp = await searchParams;
  const scope = scopeOf(ctx, "obe.view") ?? null;
  const manageScope = scopeOf(ctx, "obe.manage");
  const depts = scope === null || manageScope === null ? null : [...new Set([...(scope ?? []), ...(manageScope ?? [])])];
  const programs = await db.program.findMany({ where: { deletedAt: null, ...(depts ? { departmentId: { in: depts } } : {}) }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, departmentId: true } });
  if (!programs.length) return <EmptyState icon={Target} title="No programmes in your scope" description="Outcome-based education is set up per programme." />;
  const withOutcomes = new Set((await db.programOutcome.findMany({ where: { programId: { in: programs.map((p) => p.id) } }, distinct: ["programId"], select: { programId: true } })).map((x) => x.programId));
  const program = programs.find((p) => p.id === sp.program) ?? programs.find((p) => withOutcomes.has(p.id)) ?? programs[0];
  const tab = sp.tab ?? "outcomes";
  const manage = can(ctx, "obe.manage", program.departmentId);
  const base = `/obe?program=${program.id}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Outcome-based education"
        description="Programme outcomes, course outcomes and their correlation, and attainment computed from the marks teachers already enter. Map each assessment to the course outcomes it measures on the class's attainment page."
        actions={
          <form className="flex items-center gap-2" action="/obe">
            <label htmlFor="obe-p" className="text-xs text-muted-foreground">Programme</label>
            <select id="obe-p" name="program" defaultValue={program.id} className="h-9 rounded-lg border bg-card px-2.5 text-sm">{programs.map((p) => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}</select>
            <input type="hidden" name="tab" value={tab} />
            <button className="h-9 rounded-lg border px-3 text-sm">Show</button>
          </form>
        }
      />
      <LinkTabs tabs={[{ key: "outcomes", label: "Programme outcomes", href: `${base}&tab=outcomes` }, { key: "courses", label: "Courses & CO–PO", href: `${base}&tab=courses` }, { key: "attainment", label: "Attainment", href: `${base}&tab=attainment` }]} active={tab} />
      {tab === "outcomes" && <Outcomes programId={program.id} manage={manage} />}
      {tab === "courses" && <Courses programId={program.id} />}
      {tab === "attainment" && <Attainment ctx={ctx} programId={program.id} />}
    </div>
  );

}

async function Outcomes({ programId, manage }: { programId: string; manage: boolean }) {
  const pos = await db.programOutcome.findMany({ where: { programId }, orderBy: { order: "asc" }, include: { _count: { select: { mappings: true } } } });
  return (
    <Section title="Programme outcomes (POs) and programme-specific outcomes (PSOs)" actions={manage ? <FormDialog title="Outcome" fields={PO_FIELDS} action={saveProgramOutcomeAction.bind(null, programId)} /> : undefined} bodyClassName="p-0">
      <DataTable head={[{ label: "Code" }, { label: "Outcome" }, { label: "Mapped COs" }, ...(manage ? [{ label: "" }] : [])]} empty="No outcomes yet. NBA's twelve graduate attributes are a common starting point.">
        {pos.map((p) => (
          <tr key={p.id} className="align-top">
            <Td className="font-mono font-medium">{p.code}</Td>
            <Td><div className="font-medium">{p.title}</div><div className="text-xs text-muted-foreground">{p.description}</div></Td>
            <Td>{p._count.mappings}</Td>
            {manage && (
              <Td className="whitespace-nowrap text-right">
                <FormDialog title="Outcome" id={p.id} fields={PO_FIELDS} action={saveProgramOutcomeAction.bind(null, programId)} initial={{ code: p.code, title: p.title, description: p.description }} />
                <ActionButton size="xs" variant="ghost" label="Remove" confirmText={`Remove ${p.code} and its CO mappings?`} run={deleteProgramOutcomeAction.bind(null, p.id)} />
              </Td>
            )}
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

async function Courses({ programId }: { programId: string }) {
  const courses = await db.course.findMany({
    where: { programId, deletedAt: null },
    orderBy: [{ semester: { number: "asc" } }, { code: "asc" }],
    select: { id: true, code: true, title: true, semester: { select: { number: true } }, outcomes: { select: { id: true, _count: { select: { poMappings: true } } } } },
  });
  return (
    <Section title="Courses" description="Open a course to edit its course outcomes and its CO–PO matrix." bodyClassName="p-0">
      <DataTable head={[{ label: "Course" }, { label: "Semester" }, { label: "Course outcomes" }, { label: "Matrix" }]} empty="No courses.">
        {courses.map((c) => {
          const mapped = c.outcomes.filter((o) => o._count.poMappings > 0).length;
          return (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/obe/courses/${c.id}`}>{c.code}</Link> <span className="text-sm">{c.title}</span></Td>
              <Td>{c.semester.number}</Td>
              <Td>{c.outcomes.length}</Td>
              <Td className={cn("text-xs", c.outcomes.length && mapped === c.outcomes.length ? "text-tone-success" : "text-tone-warning")}>{c.outcomes.length ? `${mapped} of ${c.outcomes.length} COs mapped` : "No COs"}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Attainment({ ctx, programId }: { ctx: AuthContext; programId: string }) {
  const a = await programAttainment(ctx, programId);
  if (!a.pos.length) return <EmptyState icon={Target} title="No programme outcomes" description="Add the programme's POs first." />;
  return (
    <div className="space-y-6">
      <Section title="Programme outcome attainment" description={`On a 0–3 scale. Target ${a.policy.poTarget}. A student attains a course outcome at ${a.policy.targetPercent}% of its marks; levels 1/2/3 need ${a.policy.levelThresholds.join("% / ")}% of students; internal ${a.policy.internalWeight}% · end-semester ${100 - a.policy.internalWeight}%; indirect (course-exit survey) ${a.policy.indirectWeight}%.`}>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(120px,1fr))]">
          {a.overall.map((o) => {
            const po = a.pos.find((p) => p.id === o.programOutcomeId)!;
            return (
              <div key={o.programOutcomeId} className="rounded-lg border p-3" title={po.description}>
                <div className="font-mono text-xs text-muted-foreground">{po.code}</div>
                <div className={cn("text-2xl font-semibold tabular-nums", TONE_TEXT[attainmentTone(o.value, a.policy.poTarget)])}>{o.value ?? "—"}</div>
                <div className="truncate text-xs text-muted-foreground">{po.title}</div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section title="By class" description="Classes whose assessments are mapped to course outcomes." bodyClassName="p-0">
        <div className="overflow-x-auto">
          <DataTable head={[{ label: "Class" }, ...a.pos.map((p) => ({ label: p.code }))]} empty="No class has mapped assessments yet.">
            {a.courses.map((c) => (
              <tr key={c.offeringId}>
                <Td><Link className="font-medium hover:text-primary" href={`/obe/classes/${c.offeringId}`}>{c.course}</Link> <span className="text-xs text-muted-foreground">{c.term}</span></Td>
                {c.po.map((p) => <Td key={p.programOutcomeId} className={cn("font-mono tabular-nums", TONE_TEXT[attainmentTone(p.value, a.policy.poTarget)])}>{p.value ?? "–"}</Td>)}
              </tr>
            ))}
          </DataTable>
        </div>
      </Section>
    </div>
  );
}
