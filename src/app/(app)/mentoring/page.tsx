import Link from "next/link";
import { NotebookPen } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { MEETING_FIELDS } from "@/features/success/fields";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { endMentorshipAction, recordMeetingAction } from "@/features/success/actions";
import { AssignMentorForm } from "@/features/success/controls";
import { RISK_LEVEL } from "@/features/success/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { Users } from "lucide-react";

export const metadata: Metadata = { title: "Mentoring" };


export default async function MentoringPage() {
  const ctx = await requirePageAuth();
  if (ctx.user.userType !== "STAFF") return <EmptyState icon={Users} title="Mentoring is for staff" description="Students see their mentor under Mentoring & support." />;
  const term = await currentTerm();
  const manageScope = scopeOf(ctx, "mentoring.manage");
  const manage = can(ctx, "mentoring.manage");
  const mentees = await db.mentorAssignment.findMany({
    where: { mentorId: ctx.user.id, endsOn: null },
    orderBy: { student: { studentNo: "asc" } },
    include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, program: { select: { code: true } }, currentSemester: true, risks: term ? { where: { termId: term.id }, select: { level: true, score: true } } : false, mentorMeetings: { orderBy: { heldOn: "desc" }, take: 1, select: { heldOn: true, followUpOn: true } } } } },
  });
  const [students, mentors] = manage
    ? await Promise.all([
        db.student.findMany({ where: { deletedAt: null, status: { in: ["ACTIVE", "ON_LEAVE"] }, ...(manageScope === null ? {} : { departmentId: { in: manageScope } }) }, orderBy: { studentNo: "asc" }, take: 500, select: { id: true, studentNo: true, firstName: true, lastName: true, program: { select: { code: true } }, mentors: { where: { endsOn: null }, select: { id: true, mentor: { select: { name: true } } } } } }),
        db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null, ...(manageScope === null ? {} : { departmentId: { in: manageScope } }), roles: { some: { role: { permissions: { some: { permission: { key: "attendance.take" } } } } } } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
      ])
    : [[], []];
  const now = new Date();
  return (
    <div className="space-y-6">
      <PageHeader title="Mentoring" description="Your mentees, their current early-warning level, and your meetings. Summaries and action items are shared with the student; private notes are not." />
      <Section title={`My mentees (${mentees.length})`} bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Semester" }, { label: "Risk" }, { label: "Last meeting" }, { label: "Follow up" }, { label: "" }]} empty="No mentees assigned to you.">
          {mentees.map((m) => {
            const last = m.student.mentorMeetings[0];
            const risk = m.student.risks?.[0];
            const due = last?.followUpOn && last.followUpOn <= now;
            return (
              <tr key={m.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/students/${m.student.id}?tab=support`}>{m.student.firstName} {m.student.lastName}</Link><div className="font-mono text-xs text-muted-foreground">{m.student.studentNo} · {m.student.program.code}</div></Td>
                <Td>{m.student.currentSemester}</Td>
                <Td>{risk ? <StatusBadge meta={RISK_LEVEL[risk.level]} /> : "—"}</Td>
                <Td className="text-xs">{last ? fmtDate(last.heldOn) : <span className="text-tone-warning">never</span>}</Td>
                <Td className={due ? "text-xs font-medium text-tone-danger" : "text-xs"}>{last?.followUpOn ? fmtDate(last.followUpOn) : "—"}</Td>
                <Td className="text-right"><FormDialog title="Meeting" columns={2} fields={MEETING_FIELDS} action={recordMeetingAction.bind(null, m.student.id)} submitLabel="Record" initial={{ mode: "IN_PERSON" }} trigger={<Button size="xs" variant="outline"><NotebookPen /> Record meeting</Button>} /></Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
      {manage && (
        <>
          <Section title="Assign mentors" description="Choose a teacher and tick the students. Assigning a new mentor ends the previous mentorship.">
            <AssignMentorForm mentors={mentors} students={students.map((s) => ({ id: s.id, label: `${s.studentNo} — ${s.firstName} ${s.lastName} (${s.program.code})`, mentor: s.mentors[0]?.mentor.name ?? null }))} />
          </Section>
          <Section title="Current mentorships" bodyClassName="p-0">
            <DataTable head={[{ label: "Student" }, { label: "Mentor" }, { label: "" }]} empty="No mentorships yet.">
              {students.filter((s) => s.mentors.length).map((s) => (
                <tr key={s.id}>
                  <Td>{s.firstName} {s.lastName} <span className="font-mono text-xs text-muted-foreground">{s.studentNo}</span></Td>
                  <Td>{s.mentors[0].mentor.name}</Td>
                  <Td className="text-right"><ActionButton size="xs" variant="ghost" label="End" confirmText="End this mentorship?" run={endMentorshipAction.bind(null, s.mentors[0].id)} /></Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        </>
      )}
    </div>
  );
}
