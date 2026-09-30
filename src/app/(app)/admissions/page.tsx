import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { makeOffersAction, saveAdmissionCycleAction, setSeatsAction } from "@/features/campus/actions";
import { APPLICANT_STATUS } from "@/features/campus/labels";
import { fmtDate, toZonedInput } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Admissions" };

export default async function AdmissionsPage({ searchParams }: { searchParams: Promise<{ cycle?: string; program?: string; status?: string }> }) {
  const ctx = await requirePageAuth(["admission.view", "admission.manage"]);
  const sp = await searchParams;
  const manage = can(ctx, "admission.manage");
  const [cycles, years, programs, batches, inst] = await Promise.all([
    db.admissionCycle.findMany({ orderBy: { opensAt: "desc" }, include: { academicYear: { select: { label: true } }, seats: { include: { program: { select: { code: true, name: true } }, batch: { select: { code: true } } } } } }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true, programId: true } }),
    getInstitution(),
  ]);
  const cycle = cycles.find((c) => c.id === sp.cycle) ?? cycles[0];
  const programId = sp.program ?? cycle?.seats[0]?.programId;
  const [apps, counts] = cycle && programId ? await Promise.all([
    db.admissionApplication.findMany({ where: { cycleId: cycle.id, programId, ...(sp.status && sp.status in APPLICANT_STATUS ? { status: sp.status as keyof typeof APPLICANT_STATUS } : {}) }, orderBy: [{ meritScore: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }], take: 300 }),
    db.admissionApplication.groupBy({ by: ["programId", "status"], where: { cycleId: cycle.id }, _count: true }),
  ]) : [[], []];
  const count = (pid: string, statuses: string[]) => counts.filter((c) => c.programId === pid && statuses.includes(c.status)).reduce((a, c) => a + c._count, 0);
  const cycleFields = [
    { name: "name", label: "Name", type: "text" as const, wide: true },
    { name: "academicYearId", label: "Academic year", type: "select" as const, options: years.map((y) => ({ value: y.id, label: y.label })) },
    { name: "opensAt", label: "Opens", type: "datetime-local" as const },
    { name: "closesAt", label: "Closes", type: "datetime-local" as const },
    { name: "isPublic", label: "Accept online applications at /apply", type: "checkbox" as const, wide: true },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Admissions" description="Seat matrix, online applications, verification with merit scores, merit-ordered offers that lapse if not accepted, and enrolment into the student register."
        actions={<div className="flex gap-2"><Button asChild size="sm" variant="outline"><a href="/apply" target="_blank" rel="noopener"><ExternalLink /> Public form</a></Button>{manage && <FormDialog title="Admission cycle" columns={2} fields={cycleFields} action={saveAdmissionCycleAction} initial={{ academicYearId: years.find((y) => y.isCurrent)?.id ?? null, isPublic: false }} trigger={<Button size="sm"><Plus /> Cycle</Button>} />}</div>} />
      {cycles.length > 1 && <nav className="flex flex-wrap gap-3 text-sm" aria-label="Cycles">{cycles.map((c) => <a key={c.id} href={`?cycle=${c.id}`} className={c.id === cycle?.id ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground"}>{c.name}</a>)}</nav>}
      {cycle && (
        <>
          <Section title={cycle.name} description={`${cycle.academicYear.label} · ${fmtDate(cycle.opensAt)} – ${fmtDate(cycle.closesAt)} · ${cycle.isPublic ? "online applications on" : "online applications off"}`}
            actions={manage && <div className="flex gap-2"><FormDialog title="Admission cycle" columns={2} id={cycle.id} fields={cycleFields} action={saveAdmissionCycleAction} initial={{ name: cycle.name, academicYearId: cycle.academicYearId, opensAt: toZonedInput(cycle.opensAt, inst.timezone), closesAt: toZonedInput(cycle.closesAt, inst.timezone), isPublic: cycle.isPublic }} />
              <FormDialog title="Seats" id={cycle.id} action={setSeatsAction} submitLabel="Save" trigger={<Button size="xs" variant="outline"><Plus /> Seats</Button>} initial={{ offerValidDays: 7 }}
                fields={[{ name: "programId", label: "Programme", type: "select", options: programs.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) }, { name: "batchId", label: "Admitted into batch", type: "select", options: batches.map((b) => ({ value: b.id, label: b.code })) }, { name: "seats", label: "Seats", type: "number", min: 0 }, { name: "offerValidDays", label: "Offer valid for (days)", type: "number", min: 1, max: 90 }]} /></div>}
            bodyClassName="p-0">
            <DataTable head={[{ label: "Programme" }, { label: "Batch" }, { label: "Seats", className: "text-right" }, { label: "Applied", className: "text-right" }, { label: "Verified", className: "text-right" }, { label: "Offered", className: "text-right" }, { label: "Accepted / enrolled", className: "text-right" }, { label: "" }]} empty="No seats set.">
              {cycle.seats.map((s) => (
                <tr key={s.id} className={s.programId === programId ? "bg-primary/5" : undefined}>
                  <Td><a className="hover:text-primary" href={`?cycle=${cycle.id}&program=${s.programId}`}>{s.program.code}</a> <span className="text-xs text-muted-foreground">{s.program.name}</span></Td>
                  <Td className="text-xs">{s.batch.code}</Td>
                  <Td className="text-right tabular">{s.seats}</Td>
                  <Td className="text-right tabular">{count(s.programId, ["SUBMITTED", "VERIFIED", "OFFERED", "ACCEPTED", "ENROLLED", "DECLINED", "REJECTED"])}</Td>
                  <Td className="text-right tabular">{count(s.programId, ["VERIFIED"])}</Td>
                  <Td className="text-right tabular">{count(s.programId, ["OFFERED"])}</Td>
                  <Td className="text-right tabular">{count(s.programId, ["ACCEPTED", "ENROLLED"])}</Td>
                  <Td className="text-right">{manage && <ActionButton size="xs" label="Offer round" run={makeOffersAction.bind(null, cycle.id, s.programId)} confirmText="Offer free seats to the top verified applicants (merit order)? Lapsed offers are released first. Applicants are e-mailed." />}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
          {programId && (
            <Section title="Applications (merit order)" actions={<form className="flex gap-2"><input type="hidden" name="cycle" value={cycle.id} /><input type="hidden" name="program" value={programId} /><select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All</option>{Object.entries(APPLICANT_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select><button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button></form>} bodyClassName="p-0">
              <DataTable head={[{ label: "#" }, { label: "Applicant" }, { label: "Qualifying %", className: "text-right" }, { label: "Entrance", className: "text-right" }, { label: "Merit", className: "text-right" }, { label: "Status" }]} empty="No applications.">
                {apps.map((a, i) => (
                  <tr key={a.id}>
                    <Td className="text-xs tabular">{a.meritScore !== null ? i + 1 : "—"}</Td>
                    <Td><Link className="font-medium hover:text-primary" href={`/admissions/applications/${a.id}`}>{a.firstName} {a.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{a.number} · {a.category ?? "—"}</div></Td>
                    <Td className="text-right tabular">{a.qualifyingPercent}</Td>
                    <Td className="text-right tabular">{a.entranceScore ?? "—"}</Td>
                    <Td className="text-right font-medium tabular">{a.meritScore ?? "—"}</Td>
                    <Td><StatusBadge meta={APPLICANT_STATUS[a.status]} />{a.status === "OFFERED" && a.offerExpiresAt && <div className="text-[11px] text-muted-foreground">until {fmtDate(a.offerExpiresAt)}</div>}</Td>
                  </tr>
                ))}
              </DataTable>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
