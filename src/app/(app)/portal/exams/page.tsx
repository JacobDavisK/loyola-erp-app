import Link from "next/link";
import { Ticket } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { CondonationButton } from "@/features/results/portal-controls";
import { EXAM_REG_STATUS } from "@/lib/domain/labels";
import { fmtDate, fmtTime } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { portalSubject } from "@/server/services/portal";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Examinations" };

export default async function PortalExamsPage({ searchParams }: { searchParams: Promise<{ student?: string }> }) {
  const ctx = await requirePageAuth("self.portal");
  const t = await getT();
  const sp = await searchParams;
  const subject = await portalSubject(ctx, sp.student);
  if (!subject.canAcademic) return <div><PageHeader title={t("Examinations")} /><EmptyState icon={Ticket} title="Not shared with this account" /></div>;
  const inst = await getInstitution();
  const regs = await db.examRegistration.findMany({
    where: { studentId: subject.student.id, session: { status: { not: "ARCHIVED" } } },
    include: { session: { select: { id: true, name: true } }, examination: { include: { course: { select: { code: true, title: true } }, schedule: true } }, seat: { include: { room: { select: { code: true } } } } },
    orderBy: [{ session: { startDate: "desc" } }, { examination: { schedule: { startsAt: "asc" } } }],
  });
  const openCondonation = new Set((await db.workflowInstance.findMany({ where: { resourceType: "examRegistration", resourceId: { in: regs.map((r) => r.id) }, status: { in: ["IN_PROGRESS", "RETURNED"] } }, select: { resourceId: true } })).map((w) => w.resourceId));
  const sessions = [...new Map(regs.map((r) => [r.session.id, r.session])).values()];
  return (
    <div className="space-y-6">
      <PageHeader title={t("Examinations")} description={`${subject.student.firstName} ${subject.student.lastName} · eligibility, timetable, seat and hall ticket`} />
      {sessions.length === 0 && <EmptyState icon={Ticket} title="No examinations yet" description="When the examination cell confirms eligibility, your papers appear here." />}
      {sessions.map((s) => {
        const list = regs.filter((r) => r.session.id === s.id);
        const ticket = list.some((r) => r.status === "REGISTERED");
        return (
          <Section key={s.id} title={s.name} actions={ticket && <Link href={`/portal/exams/${s.id}${subject.isSelf ? "" : `?student=${subject.student.id}`}`} className="text-sm font-medium text-primary hover:underline">Hall ticket →</Link>} bodyClassName="p-0">
            <DataTable head={[{ label: "Paper" }, { label: "Date & time" }, { label: "Seat" }, { label: "Attendance", className: "text-right" }, { label: "Status" }, { label: "" }]}>
              {list.map((r) => (
                <tr key={r.id}>
                  <Td><span className="font-mono text-xs text-muted-foreground">{r.examination.course.code}</span> {r.examination.course.title}</Td>
                  <Td className="text-xs whitespace-nowrap">{r.examination.schedule ? `${fmtDate(r.examination.schedule.startsAt)}, ${fmtTime(r.examination.schedule.startsAt, inst.timezone)}` : "To be announced"}</Td>
                  <Td className="text-xs">{r.seat ? `${r.seat.room.code}, seat ${r.seat.seatNo}` : "—"}</Td>
                  <Td className="text-right tabular">{r.attendancePct ?? "—"}{r.attendancePct !== null && "%"}</Td>
                  <Td><StatusBadge meta={EXAM_REG_STATUS[r.status]} />{r.reasons.length > 0 && <div className="text-[11px] text-muted-foreground">{r.reasons.join("; ")}</div>}</Td>
                  <Td className="text-right">{subject.isSelf && r.status === "CONDONATION_PENDING" && (openCondonation.has(r.id) ? <span className="text-xs text-muted-foreground">Request in approval</span> : <CondonationButton registrationId={r.id} />)}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        );
      })}
    </div>
  );
}
