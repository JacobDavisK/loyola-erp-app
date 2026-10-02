import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { ComponentOutcomePicker } from "@/features/compliance/controls";
import { attainmentTone } from "@/features/compliance/labels";
import { cn } from "@/lib/utils";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { offeringAttainment } from "@/server/services/obe";

export const metadata: Metadata = { title: "Outcome attainment" };

const TONE_TEXT = { success: "text-tone-success", warning: "text-tone-warning", danger: "text-tone-danger", neutral: "text-muted-foreground" } as const;

export default async function ClassAttainmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const a = await offeringAttainment(ctx, id).catch(() => null);
  if (!a) notFound();
  const o = a.offering;
  const editable = o.instructors.some((i) => i.userId === ctx.user.id) || can(ctx, "obe.manage", o.course.departmentId) || isSuperAdmin(ctx);
  const code = (outcomeId: string) => a.outcomes.find((x) => x.id === outcomeId)?.code ?? "?";
  const target = a.policy.poTarget;
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Outcome-based education", href: `/obe?program=${o.course.programId}&tab=attainment` }, { label: `${o.course.code} ${o.section}` }]}
        title={`${o.course.code} — ${o.course.title}`}
        description={`${o.term.name} · Section ${o.section} · ${a.students} student(s). Attainment is computed from the marks in each mapped component.`}
      />
      {a.unmappedOutcomes.length > 0 && <p role="status" className="rounded-lg border border-tone-warning/40 bg-tone-warning/5 px-4 py-2 text-sm">Not measured by any assessment yet: <span className="font-mono">{a.unmappedOutcomes.join(", ")}</span>.</p>}
      <Section title="Which course outcomes each assessment measures" bodyClassName="p-0">
        <DataTable head={[{ label: "Assessment" }, { label: "Kind" }, { label: "Max" }, { label: "Marks entered" }, { label: "Course outcomes" }]} empty="This class has no assessment components yet.">
          {a.components.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium">{c.name}</Td>
              <Td className="text-xs">{c.kind === "EXTERNAL" ? "End-semester" : c.kind.charAt(0) + c.kind.slice(1).toLowerCase()}</Td>
              <Td>{c.maxMarks}</Td>
              <Td>{c.entered} / {a.students}</Td>
              <Td><ComponentOutcomePicker componentId={c.id} outcomes={a.outcomes.map((x) => ({ id: x.id, code: x.code }))} selected={c.outcomeIds} editable={editable} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Course outcome attainment" description={`A student attains an outcome at ${a.policy.targetPercent}% of its marks. Level 1/2/3 when ${a.policy.levelThresholds.join("% / ")}% of students attain it.`} bodyClassName="p-0">
        <DataTable head={[{ label: "Outcome" }, { label: "Internal" }, { label: "End-semester" }, { label: "Direct" }, { label: "Indirect (survey)" }, { label: "Final" }]} empty="No course outcomes.">
          {a.attainment.map((r) => (
            <tr key={r.outcomeId}>
              <Td className="font-mono font-medium">{code(r.outcomeId)}</Td>
              <Td className="text-xs">{r.internal ? `${r.internal.sharePercent}% → L${r.internal.level}` : "—"}</Td>
              <Td className="text-xs">{r.external ? `${r.external.sharePercent}% → L${r.external.level}` : "—"}</Td>
              <Td className="font-mono">{r.direct ?? "—"}</Td>
              <Td className="font-mono">{r.indirect ?? "—"}</Td>
              <Td className={cn("font-mono font-semibold", TONE_TEXT[attainmentTone(r.final, target)])}>{r.final ?? "—"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Method">
        <KeyValue items={[["Target score", `${a.policy.targetPercent}%`], ["Level thresholds", `${a.policy.levelThresholds.join("% / ")}% of students`], ["Internal : end-semester", `${a.policy.internalWeight} : ${100 - a.policy.internalWeight}`], ["Indirect weight", `${a.policy.indirectWeight}%`]]} />
      </Section>
    </div>
  );
}
