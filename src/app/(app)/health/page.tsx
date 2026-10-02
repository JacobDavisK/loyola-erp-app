import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { recordVisitAction } from "@/features/operations/actions";
import { clinicFields } from "@/features/operations/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { clinicSummary } from "@/server/services/clinic";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Health centre" };

export default async function HealthPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requirePageAuth("health.manage");
  const q = ((await searchParams).q ?? "").trim().toUpperCase();
  const { timezone } = await getInstitution();
  const [summary, visits] = await Promise.all([
    clinicSummary(30),
    db.clinicVisit.findMany({
      where: q ? { OR: [{ student: { studentNo: q } }, { employee: { employeeNo: q } }] } : {},
      include: { student: { select: { studentNo: true, firstName: true, lastName: true } }, employee: { select: { employeeNo: true, firstName: true, lastName: true } } },
      orderBy: { visitedAt: "desc" }, take: 100,
    }),
  ]);
  const max = Math.max(1, ...summary.byDay.map((d) => d.count));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Health centre"
        description="Record visits by students and staff. The record is confidential to the health centre and the patient. When rest is advised, the student's mentor is told the number of days — never the diagnosis."
        actions={<FormDialog title="Clinic visit" action={recordVisitAction} fields={clinicFields} columns={2} initial={{ patient: "STUDENT", restDays: 0, certificate: false }} submitLabel="Record visit" trigger={<Button size="sm"><Plus /> Record a visit</Button>} />}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
        <StatCard label="Visits, last 30 days" value={summary.total} />
        <StatCard label="Of which students" value={summary.students} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Visits per day" description="A sudden rise may signal an outbreak (fever, food poisoning).">
          {summary.byDay.length ? (
            <div className="flex h-24 items-end gap-0.5" role="img" aria-label="Visits per day over the last 30 days">
              {summary.byDay.map((d) => <div key={d.date} title={`${d.date}: ${d.count}`} className="flex-1 rounded-t bg-primary/70" style={{ height: `${(d.count / max) * 100}%` }} />)}
            </div>
          ) : <p className="text-sm text-muted-foreground">No visits.</p>}
        </Section>
        <Section title="Commonest complaints">
          <ul className="space-y-1 text-sm">{summary.top.map((t) => <li key={t.label} className="flex justify-between"><span className="capitalize">{t.label}</span><span className="tabular text-muted-foreground">{t.count}</span></li>)}</ul>
        </Section>
      </div>
      <Section title={q ? `Visits by ${q}` : "Recent visits"} actions={<form action="/health" className="flex gap-1"><input name="q" defaultValue={q} placeholder="Student / employee no." aria-label="Patient number" className="h-8 w-44 rounded-lg border bg-card px-2 text-sm" /><Button size="xs" variant="outline" type="submit">Find</Button></form>} bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Patient" }, { label: "Complaint" }, { label: "Diagnosis" }, { label: "Rest" }]} empty="No visits.">
          {visits.map((v) => {
            const p = v.student ? { no: v.student.studentNo, name: `${v.student.firstName} ${v.student.lastName}` } : { no: v.employee!.employeeNo, name: `${v.employee!.firstName} ${v.employee!.lastName}` };
            return (
              <tr key={v.id}>
                <Td className="text-xs"><Link className="hover:text-primary" href={`/health/${v.id}`}>{fmtDateTimeZoned(v.visitedAt, timezone)}</Link></Td>
                <Td>{p.name}<div className="font-mono text-[11px] text-muted-foreground">{p.no}{v.employee ? " · staff" : ""}</div></Td>
                <Td className="text-xs">{v.complaint}</Td>
                <Td className="text-xs">{v.diagnosis ?? "—"}</Td>
                <Td className="text-xs">{v.restDays ? `${v.restDays} d` : "—"}{v.certificate ? " · cert." : ""}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
    </div>
  );
}
