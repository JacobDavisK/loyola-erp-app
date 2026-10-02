import Link from "next/link";
import type { Metadata } from "next";
import { ActionButton } from "@/features/academic-ops/controls";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { deleteExitAwardAction, saveExitAwardAction } from "@/features/compliance/actions";
import { EXIT_STATUS } from "@/features/compliance/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { studentWhere } from "@/server/auth/access";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "NEP multiple entry & exit" };

const AWARD_FIELDS: FormField[] = [
  { name: "level", label: "Level", type: "number", min: 1, max: 10, hint: "1 = first exit point (e.g. after year 1)" },
  { name: "title", label: "Award", type: "text", placeholder: "UG Certificate in Computer Applications", wide: true },
  { name: "minCredits", label: "Minimum credits", type: "number", min: 0, step: 0.5 },
  { name: "minYears", label: "Minimum years of study", type: "number", min: 0, step: 0.5 },
  { name: "reentryYears", label: "Re-entry allowed within (years)", type: "number", min: 0, max: 15 },
];

export default async function NepPage() {
  const ctx = await requirePageAuth(["nep.manage", "student.status"]);
  const manage = can(ctx, "nep.manage");
  const [programs, requests] = await Promise.all([
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, include: { exitAwards: { orderBy: { level: "asc" }, include: { _count: { select: { requests: true } } } } } }),
    db.exitRequest.findMany({ where: { student: studentWhere(ctx) }, orderBy: { createdAt: "desc" }, take: 100, include: { award: true, student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Multiple entry & exit (NEP 2020)" description="Awards students may leave with at each exit point, and the requests to exit. Exits are approved by the HoD and the Registrar; the exit certificate is issued automatically and re-entry stays open for the award's window." />
      <Section title="Exit requests" bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Award" }, { label: "Credits" }, { label: "Requested" }, { label: "Status" }, { label: "Re-entry until" }]} empty="No exit requests.">
          {requests.map((r) => (
            <tr key={r.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/students/${r.student.id}?tab=nep`}>{r.student.firstName} {r.student.lastName}</Link> <span className="font-mono text-xs text-muted-foreground">{r.student.studentNo}</span></Td>
              <Td>{r.award.title}</Td>
              <Td>{r.creditsEarned}</Td>
              <Td className="text-xs">{fmtDate(r.createdAt)}</Td>
              <Td>{r.workflowId && r.status === "PENDING" ? <Link href={`/inbox/requests/${r.workflowId}`}><StatusBadge meta={EXIT_STATUS[r.status]} /></Link> : <StatusBadge meta={EXIT_STATUS[r.status]} />}</Td>
              <Td className="text-xs">{fmtDate(r.reentryUntil)}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <div className="grid gap-6 xl:grid-cols-2">
        {programs.map((p) => (
          <Section
            key={p.id}
            title={`${p.code} — ${p.name}`}
            description={`${p.durationYears}-year programme`}
            actions={manage ? <FormDialog title="Exit award" fields={AWARD_FIELDS} action={saveExitAwardAction.bind(null, p.id)} initial={{ level: p.exitAwards.length + 1, minYears: p.exitAwards.length + 1, reentryYears: 7 }} columns={2} /> : undefined}
            bodyClassName="p-0"
          >
            <DataTable head={[{ label: "Level" }, { label: "Award" }, { label: "Credits" }, { label: "Years" }, { label: "Re-entry" }, ...(manage ? [{ label: "" }] : [])]} empty="No exit awards configured.">
              {p.exitAwards.map((a) => (
                <tr key={a.id}>
                  <Td className="font-mono">{a.level}</Td>
                  <Td className="font-medium">{a.title}</Td>
                  <Td>{a.minCredits}</Td>
                  <Td>{a.minYears}</Td>
                  <Td className="text-xs">{a.reentryYears} yr</Td>
                  {manage && (
                    <Td className="whitespace-nowrap text-right">
                      <FormDialog title="Exit award" id={a.id} fields={AWARD_FIELDS} action={saveExitAwardAction.bind(null, p.id)} initial={{ level: a.level, title: a.title, minCredits: a.minCredits, minYears: a.minYears, reentryYears: a.reentryYears }} columns={2} />
                      {a._count.requests === 0 && <ActionButton size="xs" variant="ghost" label="Remove" confirmText={`Remove ${a.title}?`} run={deleteExitAwardAction.bind(null, a.id)} />}
                    </Td>
                  )}
                </tr>
              ))}
            </DataTable>
          </Section>
        ))}
      </div>
    </div>
  );
}
