import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { enrolApplicantAction, verifyApplicationAction } from "@/features/campus/actions";
import { APPLICANT_STATUS } from "@/features/campus/labels";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["admission.view", "admission.manage"]);
  const a = await db.admissionApplication.findUnique({ where: { id }, include: { program: true, cycle: true, student: { select: { id: true, studentNo: true } } } });
  if (!a) notFound();
  const manage = can(ctx, "admission.manage");
  const w = await getSetting("admissions");
  const history = await db.auditLog.findMany({ where: { resourceType: "admissionApplication", resourceId: id }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, actorName: true, summary: true, createdAt: true } });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={a.number} title={`${a.firstName} ${a.lastName}`} breadcrumbs={[{ label: "Admissions", href: `/admissions?cycle=${a.cycleId}&program=${a.programId}` }, { label: a.number }]} description={<span className="flex items-center gap-2"><StatusBadge meta={APPLICANT_STATUS[a.status]} /> {a.program.name} · {a.cycle.name}</span>}
        actions={manage && (
          <div className="flex gap-2">
            {(a.status === "SUBMITTED" || a.status === "VERIFIED") && (
              <FormDialog title="Verification" id={a.id} action={verifyApplicationAction} submitLabel="Record" initial={{ decision: "verify", entranceScore: a.entranceScore }} trigger={<Button size="sm">{a.status === "SUBMITTED" ? "Verify" : "Re-verify"}</Button>}
                description={`Check the original documents. Merit = ${w.weightQualifying}% qualifying + ${w.weightEntrance}% entrance.`}
                fields={[{ name: "decision", label: "Decision", type: "select", options: [{ value: "verify", label: "Documents verified — eligible" }, { value: "reject", label: "Not eligible — reject" }] }, { name: "entranceScore", label: "Entrance score (out of 100)", type: "number", optional: true, min: 0, max: 100, step: 0.01 }, { name: "remarks", label: "Remarks (required when rejecting)", type: "textarea", optional: true }]} />
            )}
            {a.status === "ACCEPTED" && can(ctx, "student.create") && <ActionButton size="sm" variant="default" label="Enrol as student" run={enrolApplicantAction.bind(null, a.id)} confirmText="Create the student record in the batch set for this programme?" />}
            {a.student && <Button asChild size="sm" variant="outline"><Link href={`/students/${a.student.id}`}>Student {a.student.studentNo}</Link></Button>}
          </div>
        )} />
      <Section title="Applicant">
        <KeyValue items={[["E-mail", a.email], ["Phone", a.phone], ["Date of birth", fmtDate(a.dateOfBirth)], ["Gender", a.gender?.toLowerCase() ?? "—"], ["Category", a.category ?? "—"], ["Qualifying examination", `${a.qualifyingExam} — ${a.qualifyingPercent}%`], ["Entrance score", a.entranceScore === null ? "—" : String(a.entranceScore)], ["Merit score", a.meritScore === null ? "—" : String(a.meritScore)], ["Offer valid until", a.offerExpiresAt ? fmtDateTime(a.offerExpiresAt) : "—"], ["Remarks", a.remarks ?? "—"], ["Submitted", fmtDateTime(a.createdAt)]]} />
      </Section>
      <Section title="History">
        <ul className="space-y-1 text-sm">{history.map((h) => <li key={h.id}><span className="text-xs text-muted-foreground">{fmtDateTime(h.createdAt)}</span> · {h.actorName ?? "System"} · {h.action.replace("admission.", "")}{h.summary ? ` — ${h.summary}` : ""}</li>)}</ul>
      </Section>
    </div>
  );
}
