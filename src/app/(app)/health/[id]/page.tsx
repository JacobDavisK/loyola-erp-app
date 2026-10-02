import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { getVisit } from "@/server/services/clinic";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Clinic visit" };

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePageAuth();
  const v = await getVisit(ctx, (await params).id);
  const { timezone } = await getInstitution();
  const who = v.student ? `${v.student.firstName} ${v.student.lastName} (${v.student.studentNo})` : `${v.employee!.firstName} ${v.employee!.lastName} (${v.employee!.employeeNo})`;
  const vitals = (v.vitals ?? {}) as { temperature?: number; pulse?: number; bp?: string };
  const own = ctx.subject.studentId === v.studentId && !!v.studentId;
  return (
    <div className="space-y-6">
      <PageHeader title="Clinic visit" eyebrow={fmtDateTimeZoned(v.visitedAt, timezone)} breadcrumbs={own ? [{ label: "Health record", href: "/portal/health" }, { label: "Visit" }] : [{ label: "Health centre", href: "/health" }, { label: "Visit" }]} />
      <Section title={who}>
        <KeyValue items={[
          ["Complaint", v.complaint],
          ["Vitals", [vitals.temperature && `${vitals.temperature} °C`, vitals.pulse && `pulse ${vitals.pulse}`, vitals.bp && `BP ${vitals.bp}`].filter(Boolean).join(", ") || "—"],
          ["Diagnosis", v.diagnosis ?? "—"],
          ["Treatment", v.treatment ?? "—"],
          ["Prescription", <span key="p" className="whitespace-pre-wrap">{v.prescription ?? "—"}</span>],
          ["Referred to", v.referral ?? "—"],
          ["Rest advised", v.restDays ? `${v.restDays} day(s)` : "None"],
          ["Medical certificate", v.certificate ? "Issued — attach this visit to a leave or attendance-condonation request" : "No"],
        ]} />
      </Section>
    </div>
  );
}
