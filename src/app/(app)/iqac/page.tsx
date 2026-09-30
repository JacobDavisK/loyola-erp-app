import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { createCycleAction, saveFrameworkAction } from "@/features/quality/actions";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { progressFor } from "@/server/services/iqac";

export const metadata: Metadata = { title: "IQAC & accreditation" };

export default async function IqacPage() {
  const ctx = await requirePageAuth("iqac.view");
  const manage = can(ctx, "iqac.manage");
  const [cycles, frameworks, years] = await Promise.all([
    db.accreditationCycle.findMany({ orderBy: { createdAt: "desc" }, include: { framework: { select: { code: true } }, academicYear: { select: { label: true } } } }),
    db.accreditationFramework.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { metrics: true, cycles: true } } } }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
  ]);
  const progress = await Promise.all(cycles.map((c) => progressFor(c.id)));
  return (
    <div className="space-y-6">
      <PageHeader title="IQAC & accreditation" breadcrumbs={[{ label: "Research & quality" }, { label: "IQAC" }]} description="Accreditation data is collected metric by metric from the people who own it, drawn from platform records where possible, backed by evidence and reviewed by IQAC." />
      <Section
        title="Cycles"
        actions={manage && frameworks.length > 0 && (
          <FormDialog title="Accreditation cycle" action={createCycleAction} submitLabel="Open cycle" trigger={<Button size="xs"><Plus /> Cycle</Button>} initial={{ yearsCovered: 5, academicYearId: years.find((y) => y.isCurrent)?.id ?? years[0]?.id }}
            fields={[
              { name: "frameworkId", label: "Framework", type: "select", options: frameworks.map((f) => ({ value: f.id, label: `${f.code} — ${f.name}` })) },
              { name: "academicYearId", label: "Academic year", type: "select", options: years.map((y) => ({ value: y.id, label: y.label })) },
              { name: "name", label: "Name", type: "text" },
              { name: "yearsCovered", label: "Years of data covered", type: "number", min: 1, max: 10, hint: "e.g. 5 for a NAAC SSR" },
              { name: "dueDate", label: "Due date", type: "date", optional: true },
            ]} />
        )}
        bodyClassName="p-0"
      >
        <DataTable head={[{ label: "Cycle" }, { label: "Framework" }, { label: "Year" }, { label: "Due" }, { label: "Progress" }, { label: "Status" }]} empty="No cycles yet.">
          {cycles.map((c, i) => (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/iqac/cycles/${c.id}`}>{c.name}</Link></Td>
              <Td className="text-xs">{c.framework.code}</Td>
              <Td className="text-xs">{c.academicYear.label}{c.yearsCovered > 1 ? ` (${c.yearsCovered} yrs)` : ""}</Td>
              <Td className="text-xs">{fmtDate(c.dueDate)}</Td>
              <Td className="w-56"><div className="flex items-center gap-2"><Progress value={progress[i].percent} aria-label="Weighted progress" /><span className="w-12 text-xs tabular">{progress[i].percent}%</span></div><div className="text-[11px] text-muted-foreground">{progress[i].approved}/{progress[i].total} approved · {progress[i].submitted} to review</div></Td>
              <Td className="text-xs">{c.isClosed ? "Closed" : "Open"}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Frameworks" actions={manage && <FormDialog title="Framework" action={saveFrameworkAction} fields={[{ name: "code", label: "Code", type: "text", upper: true }, { name: "name", label: "Name", type: "text" }, { name: "description", label: "Description", type: "textarea", optional: true }]} trigger={<Button size="xs" variant="outline"><Plus /> Framework</Button>} />} bodyClassName="p-0">
        <DataTable head={[{ label: "Framework" }, { label: "Metrics", className: "text-right" }, { label: "Cycles", className: "text-right" }]} empty="No frameworks.">
          {frameworks.map((f) => (
            <tr key={f.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/iqac/frameworks/${f.id}`}>{f.code}</Link> <span className="text-sm">{f.name}</span></Td>
              <Td className="text-right tabular">{f._count.metrics}</Td>
              <Td className="text-right tabular">{f._count.cycles}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
