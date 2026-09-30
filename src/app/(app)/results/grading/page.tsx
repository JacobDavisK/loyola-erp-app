import { Plus, Stamp } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { activateGradingSchemeAction } from "@/features/results/actions";
import { GradingEditor, type SchemeValue } from "@/features/results/grading-editor";
import { bandsSchema } from "@/lib/domain/grading";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Grading schemes" };

const STATUS = { DRAFT: "Draft", ACTIVE: "Active", RETIRED: "Retired" } as const;

export default async function GradingPage() {
  await requirePageAuth("grading.manage");
  const [schemes, regulations] = await Promise.all([
    db.gradingScheme.findMany({ orderBy: [{ code: "asc" }, { version: "desc" }], include: { _count: { select: { runs: true, regulations: true } } } }),
    db.regulation.findMany({ include: { gradingScheme: { select: { code: true, version: true } } }, orderBy: { effectiveFromYear: "desc" } }),
  ]);
  const blank: SchemeValue = {
    code: "", name: "", passPercent: 40, minExternalPercent: 40, minInternalPercent: 0, absentGrade: "AB", failGrade: "RA", withheldGrade: "WH", graceMaxPerCourse: 0, graceMaxTotal: 0, gpaDecimals: 2,
    bands: [{ grade: "O", minPercent: 90, gradePoint: 10, pass: true }, { grade: "P", minPercent: 40, gradePoint: 4, pass: true }, { grade: "RA", minPercent: 0, gradePoint: 0, pass: false }],
  };
  return (
    <div className="space-y-6">
      <PageHeader title="Grading schemes" description="Versioned grade bands and pass rules. Regulations point to a scheme; every result records the version it was graded with." breadcrumbs={[{ label: "Results", href: "/results" }, { label: "Grading schemes" }]} actions={<GradingEditor id={null} initial={blank} trigger={<Button size="sm"><Plus /> New scheme</Button>} />} />
      <Section bodyClassName="p-0">
        <DataTable head={[{ label: "Scheme" }, { label: "Bands" }, { label: "Pass rule" }, { label: "Grace" }, { label: "Used by" }, { label: "Status" }, { label: "" }]}>
          {schemes.map((g) => {
            const bands = bandsSchema.catch([]).parse(g.bands);
            const value: SchemeValue = { code: g.code, name: g.name, bands, passPercent: g.passPercent, minExternalPercent: g.minExternalPercent, minInternalPercent: g.minInternalPercent, absentGrade: g.absentGrade, failGrade: g.failGrade, withheldGrade: g.withheldGrade, graceMaxPerCourse: g.graceMaxPerCourse, graceMaxTotal: g.graceMaxTotal, gpaDecimals: g.gpaDecimals };
            return (
              <tr key={g.id}>
                <Td><div className="font-medium">{g.name}</div><div className="font-mono text-[11px] text-muted-foreground">{g.code} v{g.version} · {fmtDate(g.createdAt)}</div></Td>
                <Td className="text-xs">{[...bands].sort((a, b) => b.minPercent - a.minPercent).map((b) => `${b.grade} ≥${b.minPercent}`).join(" · ")}</Td>
                <Td className="text-xs">{g.passPercent}% overall{g.minExternalPercent ? `, ${g.minExternalPercent}% end-sem` : ""}</Td>
                <Td className="text-xs">{g.graceMaxPerCourse ? `${g.graceMaxPerCourse}/course, ${g.graceMaxTotal}/student` : "None"}</Td>
                <Td className="text-xs">{g._count.regulations} regulation(s), {g._count.runs} run(s)</Td>
                <Td className="text-xs">{STATUS[g.status]}</Td>
                <Td className="text-right whitespace-nowrap">
                  {g.status === "DRAFT" && <ActionButton size="xs" run={activateGradingSchemeAction.bind(null, g.id)} label="Activate" icon={<Stamp />} confirmText="Activate this version? The previous active version of this scheme is retired and regulations move to this one. Results already computed keep their version." />}
                  <GradingEditor id={g.id} initial={value} status={g.status} trigger={<Button size="xs" variant="ghost">{g.status === "DRAFT" ? "Edit" : "New version"}</Button>} />
                </Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      <Section title="Regulations" bodyClassName="p-0">
        <DataTable head={[{ label: "Regulation" }, { label: "Grading scheme" }]}>
          {regulations.map((r) => <tr key={r.id}><Td>{r.code} — {r.name}</Td><Td className="text-xs">{r.gradingScheme ? `${r.gradingScheme.code} v${r.gradingScheme.version}` : "Not set (the first active scheme is used)"}</Td></tr>)}
        </DataTable>
      </Section>
    </div>
  );
}
