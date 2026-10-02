import Link from "next/link";
import { LifeBuoy, NotebookPen } from "lucide-react";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { openCaseAction, recordMeetingAction } from "@/features/success/actions";
import { ActionItems } from "@/features/success/controls";
import { CASE_FIELDS, HELP_FIELDS, MEETING_FIELDS } from "@/features/success/fields";
import { CASE_SOURCE, CASE_STATUS, MEETING_MODE, RISK_LEVEL, type RiskFactorView } from "@/features/success/labels";
import { RiskFactors } from "@/features/success/risk-factors";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { type AuthContext, isSuperAdmin } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { isMentorOf, meetingsFor } from "@/server/services/mentoring";
import { caseWhere } from "@/server/services/success";

/** Mentor, meetings, early-warning factors and support cases for one student (staff record or the student's own portal). */
export async function SupportPanel({ ctx, studentId, self }: { ctx: AuthContext; studentId: string; self: boolean }) {
  const term = await currentTerm();
  const [mentor, meetings, risk, cases, mentorOfStudent] = await Promise.all([
    db.mentorAssignment.findFirst({ where: { studentId, endsOn: null }, include: { mentor: { select: { name: true, email: true, phone: true } } } }),
    meetingsFor(ctx, studentId),
    !self && term ? db.studentRisk.findUnique({ where: { studentId_termId: { studentId, termId: term.id } } }) : null,
    db.supportCase.findMany({ where: { AND: [{ studentId }, caseWhere(ctx)] }, orderBy: { createdAt: "desc" }, include: { assignee: { select: { name: true } } } }),
    isMentorOf(ctx, studentId),
  ]);
  const openCase = cases.find((c) => c.status === "OPEN" || c.status === "IN_PROGRESS");
  const canRecord = mentorOfStudent || isSuperAdmin(ctx);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Mentor">
          {mentor ? (
            <KeyValue items={[["Mentor", mentor.mentor.name], ["E-mail", mentor.mentor.email], ...(mentor.mentor.phone ? ([["Phone", mentor.mentor.phone]] as [string, string][]) : []), ["Since", fmtDate(mentor.startsOn)]]} />
          ) : (
            <p className="text-sm text-muted-foreground">{self ? "No mentor has been assigned to you yet." : "No mentor assigned."}</p>
          )}
        </Section>
        {self ? (
          <Section title="Need help?" description="Talk to your mentor and student support in confidence — about studies, attendance, fees or anything else.">
            {openCase ? (
              <p className="text-sm">Your request <Link className="text-primary hover:underline" href={`/success/cases/${openCase.id}`}>{openCase.number}</Link> is {openCase.status === "OPEN" ? "waiting for a response" : "being worked on"}.</p>
            ) : (
              <FormDialog title="Request for help" fields={HELP_FIELDS} action={openCaseAction.bind(null, studentId)} submitLabel="Ask for help" trigger={<Button size="sm"><LifeBuoy /> Ask for help</Button>} />
            )}
          </Section>
        ) : (
          <Section title={risk ? `Early warning: ${risk.score}` : "Early warning"} actions={risk ? <StatusBadge meta={RISK_LEVEL[risk.level]} /> : undefined}>
            {risk ? <RiskFactors factors={risk.factors as unknown as RiskFactorView[]} /> : <p className="text-sm text-muted-foreground">Not assessed for the current term yet.</p>}
            {risk && <p className="mt-3 text-xs text-muted-foreground">Computed {fmtDateTime(risk.computedAt)}</p>}
          </Section>
        )}
      </div>

      <Section
        title="Mentoring meetings"
        actions={canRecord ? <FormDialog title="Meeting" columns={2} fields={MEETING_FIELDS} action={recordMeetingAction.bind(null, studentId)} submitLabel="Record" initial={{ mode: "IN_PERSON" }} trigger={<Button size="xs" variant="outline"><NotebookPen /> Record meeting</Button>} /> : undefined}
      >
        {meetings.length === 0 ? <p className="text-sm text-muted-foreground">No meetings recorded.</p> : (
          <ol className="space-y-4">
            {meetings.map((m) => (
              <li key={m.id} className="border-l-2 pl-3">
                <p className="text-xs text-muted-foreground">{fmtDateTime(m.heldOn)} · {MEETING_MODE[m.mode]} · {m.mentor.name}{m.followUpOn ? ` · follow up ${fmtDate(m.followUpOn)}` : ""}</p>
                <p className="whitespace-pre-wrap text-sm">{m.summary}</p>
                <ActionItems meetingId={m.id} items={(m.actionItems as { text: string; done: boolean }[]) ?? []} editable={self || m.mentorId === ctx.user.id} />
                {m.privateNotes && <p className="mt-2 rounded bg-muted/50 px-2 py-1 text-xs"><span className="font-medium">Private notes:</span> {m.privateNotes}</p>}
              </li>
            ))}
          </ol>
        )}
      </Section>

      <Section
        title={self ? "My requests for help" : "Support cases"}
        actions={!self && !openCase ? <FormDialog title="Support case" fields={CASE_FIELDS} action={openCaseAction.bind(null, studentId)} submitLabel="Open case" initial={{ level: "MEDIUM" }} trigger={<Button size="xs" variant="outline"><LifeBuoy /> Open a case</Button>} /> : undefined}
        bodyClassName="p-0"
      >
        <DataTable head={[{ label: "Case" }, { label: "Source" }, { label: "Assigned to" }, { label: "Opened" }, { label: "Status" }]} empty="None.">
          {cases.map((c) => (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/success/cases/${c.id}`}>{c.summary}</Link><div className="font-mono text-[11px] text-muted-foreground">{c.number}</div></Td>
              <Td className="text-xs">{CASE_SOURCE[c.source]}</Td>
              <Td className="text-xs">{c.assignee?.name ?? "—"}</Td>
              <Td className="text-xs">{fmtDate(c.createdAt)}</Td>
              <Td><StatusBadge meta={CASE_STATUS[c.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
