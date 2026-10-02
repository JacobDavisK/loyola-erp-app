import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteCourseOutcomeAction, saveCourseOutcomeAction } from "@/features/compliance/actions";
import { CoPoMatrix } from "@/features/compliance/controls";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Course outcomes" };

const BLOOM = ["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"];
const CO_FIELDS: FormField[] = [
  { name: "code", label: "Code", type: "text", upper: true, placeholder: "CO1" },
  { name: "bloom", label: "Bloom's level", type: "select", optional: true, options: BLOOM.map((b) => ({ value: b, label: b.charAt(0) + b.slice(1).toLowerCase() })) },
  { name: "description", label: "Statement", type: "textarea", placeholder: "Apply … to …" },
];

export default async function CourseObePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["obe.view", "obe.manage"]);
  const course = await db.course.findUnique({ where: { id }, include: { program: true, outcomes: { orderBy: { code: "asc" }, include: { poMappings: true, _count: { select: { questions: true } } } } } });
  if (!course || (!can(ctx, "obe.view", course.departmentId) && !can(ctx, "obe.manage", course.departmentId))) notFound();
  const manage = can(ctx, "obe.manage", course.departmentId);
  const pos = await db.programOutcome.findMany({ where: { programId: course.programId }, orderBy: { order: "asc" } });
  const cells = Object.fromEntries(course.outcomes.flatMap((o) => o.poMappings.map((m) => [`${o.id}:${m.programOutcomeId}`, m.strength])));
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Outcome-based education", href: `/obe?program=${course.programId}&tab=courses` }, { label: course.code }]} title={`${course.code} — ${course.title}`} description={`${course.program.name}. Course outcomes and their correlation with the programme outcomes.`} />
      <Section title="Course outcomes" actions={manage ? <FormDialog title="Course outcome" fields={CO_FIELDS} action={saveCourseOutcomeAction.bind(null, course.id)} initial={{ code: `CO${course.outcomes.length + 1}` }} /> : undefined} bodyClassName="p-0">
        <DataTable head={[{ label: "Code" }, { label: "Statement" }, { label: "Bloom" }, { label: "Questions" }, ...(manage ? [{ label: "" }] : [])]} empty="No course outcomes yet.">
          {course.outcomes.map((o) => (
            <tr key={o.id} className="align-top">
              <Td className="font-mono font-medium">{o.code}</Td>
              <Td className="text-sm">{o.description}</Td>
              <Td className="text-xs">{o.bloom ? o.bloom.charAt(0) + o.bloom.slice(1).toLowerCase() : "—"}</Td>
              <Td>{o._count.questions}</Td>
              {manage && (
                <Td className="whitespace-nowrap text-right">
                  <FormDialog title="Course outcome" id={o.id} fields={CO_FIELDS} action={saveCourseOutcomeAction.bind(null, course.id)} initial={{ code: o.code, description: o.description, bloom: o.bloom }} />
                  {o._count.questions === 0 && <ActionButton size="xs" variant="ghost" label="Remove" confirmText={`Remove ${o.code}?`} run={deleteCourseOutcomeAction.bind(null, o.id)} />}
                </Td>
              )}
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="CO–PO matrix">
        {pos.length && course.outcomes.length ? (
          <CoPoMatrix courseId={course.id} cos={course.outcomes.map((o) => ({ id: o.id, code: o.code, description: o.description }))} pos={pos.map((p) => ({ id: p.id, code: p.code, title: p.title }))} cells={cells} editable={manage} />
        ) : (
          <p className="text-sm text-muted-foreground">{pos.length ? "Add course outcomes first." : "The programme has no programme outcomes yet."}</p>
        )}
      </Section>
    </div>
  );
}
