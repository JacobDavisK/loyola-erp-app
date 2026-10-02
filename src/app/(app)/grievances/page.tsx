import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { raiseGrievanceAction } from "@/features/campuslife/actions";
import { UndertakingForm } from "@/features/campuslife/controls";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { grievanceWhere, undertakingCompliance } from "@/server/services/grievances";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Grievances" };

const CATEGORY: Record<string, string> = { ACADEMIC: "Academic", EXAMINATION: "Examination", FEES: "Fees", ADMINISTRATION: "Administration", FACILITIES: "Facilities", HARASSMENT: "Harassment", RAGGING: "Ragging", DISCRIMINATION: "Discrimination", OTHER: "Other" };
const LEVEL: Record<string, string> = { DEPARTMENT: "Department", INSTITUTION: "Institution committee", OMBUDSPERSON: "Ombudsperson" };

export default async function GrievancesPage() {
  const ctx = await requirePageAuth();
  const cfg = await getSetting("campus");
  const now = new Date();
  const rows = await db.grievance.findMany({ where: grievanceWhere(ctx), orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 300 });
  const handler = can(ctx, "grievance.handle") || can(ctx, "grievance.committee") || can(ctx, "grievance.ombudsperson");
  const open = rows.filter((g) => !["RESOLVED", "CLOSED"].includes(g.status));
  const student = ctx.subject.studentId;
  const year = student ? await db.academicYear.findFirst({ where: { isCurrent: true } }) : null;
  const undertaking = student && year ? await db.antiRaggingUndertaking.findUnique({ where: { studentId_academicYearId: { studentId: student, academicYearId: year.id } } }) : null;
  const compliance = can(ctx, "antiragging.manage") ? await undertakingCompliance(ctx) : null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Grievance redressal"
        description={`Raise a concern about academics, examinations, fees, facilities or treatment on campus. Each level must decide within ${cfg.grievanceDays} days, or the grievance moves up by itself; you can appeal a decision within ${cfg.appealDays} days, up to the Ombudsperson. Ragging and harassment complaints go straight to the institution committee and may be anonymous.`}
        actions={<FormDialog title="Grievance" action={raiseGrievanceAction} submitLabel="Submit" initial={{ category: "ACADEMIC", anonymous: false }} trigger={<Button size="sm"><Plus /> Raise a grievance</Button>}
          fields={[
            { name: "category", label: "About", type: "select", options: Object.entries(CATEGORY).map(([value, label]) => ({ value, label })) },
            { name: "subject", label: "Subject", type: "text" },
            { name: "description", label: "What happened (dates, places, people involved)", type: "textarea" },
            { name: "anonymous", label: "Keep my name from the committee (ragging and harassment only)", type: "checkbox" },
          ]} />}
      />
      {handler && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <StatCard label="Open" value={open.length} />
          <StatCard label="Past the time limit" value={open.filter((g) => g.dueAt < now).length} tone={open.some((g) => g.dueAt < now) ? "danger" : undefined} />
          <StatCard label="Ragging / harassment" value={open.filter((g) => ["RAGGING", "HARASSMENT"].includes(g.category)).length} />
        </div>
      )}
      <Section title={handler ? "Grievances" : "My grievances"} bodyClassName="p-0">
        <DataTable head={[{ label: "Grievance" }, { label: "About" }, { label: "With" }, { label: "Respond by" }, { label: "Status" }]} empty="No grievances.">
          {rows.map((g) => {
            const late = !["RESOLVED", "CLOSED"].includes(g.status) && g.dueAt < now;
            return (
              <tr key={g.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/grievances/${g.id}`}>{g.subject}</Link><div className="font-mono text-[11px] text-muted-foreground">{g.number}{g.anonymous ? " · anonymous" : ""}</div></Td>
                <Td className="text-xs">{CATEGORY[g.category]}</Td>
                <Td className="text-xs">{LEVEL[g.level]}</Td>
                <Td className={cn("text-xs", late && "font-medium text-tone-danger")}>{fmtDate(g.dueAt)}</Td>
                <Td className="text-xs">{g.status.toLowerCase().replace("_", " ")}</Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      {student && year && (
        <Section title={`Anti-ragging undertaking ${year.label}`} description="Every student files the online anti-ragging undertaking each year at antiragging.in and records the reference number here.">
          {undertaking ? <KeyValue items={[["Reference", undertaking.referenceNo], ["Recorded", fmtDate(undertaking.submittedAt)]]} /> : <UndertakingForm />}
        </Section>
      )}
      {compliance && (
        <Section title={`Anti-ragging undertakings ${compliance.year.label}: ${compliance.submitted} of ${compliance.total}`} description="Active students who have not recorded this year's undertaking." bodyClassName="p-0">
          <DataTable head={[{ label: "Student" }, { label: "Programme" }]} empty="Every active student has filed the undertaking.">
            {compliance.missing.slice(0, 100).map((s) => <tr key={s.id}><Td>{s.firstName} {s.lastName} <span className="font-mono text-xs text-muted-foreground">{s.studentNo}</span></Td><Td className="text-xs">{s.program.code}</Td></tr>)}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
