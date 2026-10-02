import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Progress } from "@/components/ui/progress";
import { STANDING_LABEL } from "@/lib/domain/attendance";
import { cn } from "@/lib/utils";
import { Percent } from "lucide-react";
import { requirePageAuth } from "@/server/auth/current";
import { currentTerm } from "@/server/services/academic-setup";
import { studentAttendance } from "@/server/services/attendance";
import { portalSubject } from "@/server/services/portal";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Attendance" };

export default async function PortalAttendancePage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  const t = await getT();
  const sp = await searchParams;
  const subject = await portalSubject(ctx, sp.student);
  const term = await currentTerm();
  if (!subject.canAcademic || !term) return <div><PageHeader title={t("Attendance")} /><EmptyState icon={Percent} title={term ? "Not shared with this account" : "No current term"} /></div>;
  const att = await studentAttendance(ctx, subject.student.id, term.id);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader title={t("Attendance")} description={`${subject.student.firstName} ${subject.student.lastName} · ${term.name} · minimum ${att.policy.minimumPercent}% to sit the examination${att.policy.condonationPercent < att.policy.minimumPercent ? ` (condonation possible from ${att.policy.condonationPercent}%)` : ""}`} />
      <Section title="By course" bodyClassName="p-0">
        {att.classes.length === 0 ? <p className="px-5 py-4 text-sm text-muted-foreground">No classes registered this term.</p> : (
          <DataTable head={[{ label: "Course" }, { label: "Attended" }, { label: "%", className: "text-right" }, { label: "What it means" }]}>
            {att.classes.map((c) => (
              <tr key={c.offeringId}>
                <Td><span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title}</Td>
                <Td className="min-w-40"><div className="mb-1 text-xs tabular">{c.summary.attended} of {c.summary.counted} classes</div><Progress value={c.summary.percent ?? 0} aria-label={`${c.code} attendance`} /></Td>
                <Td className="text-right text-base font-semibold tabular">{c.summary.percent ?? "—"}</Td>
                <Td className={cn("text-sm", c.summary.standing === "SHORTAGE" && "text-tone-danger", (c.summary.standing === "CONDONABLE" || c.summary.standing === "AT_RISK") && "text-tone-warning")}>
                  {STANDING_LABEL[c.summary.standing]}
                  <div className="text-xs text-muted-foreground">
                    {c.summary.standing === "OK" || c.summary.standing === "AT_RISK" ? (c.summary.canMiss !== null ? `You can miss up to ${c.summary.canMiss} more class(es) and stay at ${att.policy.minimumPercent}%.` : "") : c.summary.mustAttend ? `Attend the next ${c.summary.mustAttend} class(es) without absence to reach ${att.policy.minimumPercent}%.` : ""}
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}
      </Section>
      <p className="text-xs text-muted-foreground">Approved medical leave and excused absences are not counted against you. If a mark looks wrong, speak to your course instructor within a few days of the class.</p>
    </div>
  );
}
