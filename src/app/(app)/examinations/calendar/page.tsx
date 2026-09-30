import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { CalendarView, type CalendarEvent } from "@/features/examinations/calendar-view";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { examinationWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Examination calendar" };

export default async function CalendarPage() {
  const ctx = await requirePageAuth("exam.view");
  const scope = examinationWhere(ctx);
  const [exams, sessions, assignments] = await Promise.all([
    db.examination.findMany({
      where: { AND: [scope, { schedule: { isNot: null } }] },
      include: {
        schedule: true,
        course: { include: { department: { select: { code: true } } } },
        session: { select: { code: true } },
        papers: { where: { deletedAt: null }, select: { status: true }, take: 1 },
      },
    }),
    db.examinationSession.findMany({ where: { status: { not: "ARCHIVED" }, examinations: { some: scope } } }),
    db.setterAssignment.findMany({
      where: { examination: scope, status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"] } },
      include: { examination: { include: { course: { select: { code: true } } } }, setter: { select: { name: true } } },
    }),
  ]);
  const now = new Date();
  const deadlineKinds = (s: (typeof sessions)[number]) =>
    [
      ["setting", "Paper submission", s.settingDeadline],
      ["moderation", "Moderation", s.moderationDeadline],
      ["scrutiny", "Scrutiny", s.scrutinyDeadline],
      ["approval", "Approval", s.approvalDeadline],
    ] as const;

  const events: CalendarEvent[] = [
    ...exams.map((e) => ({
      id: `exam-${e.id}`,
      date: e.schedule!.date.toISOString(),
      kind: "exam" as const,
      title: `${e.course.code} · ${e.schedule!.slot}`,
      subtitle: `${e.course.title} · ${e.course.department.code} · ${e.session.code} · ${e.papers[0] ? PAPER_STATUS[e.papers[0].status].label : "No paper"}`,
      href: `/examinations/${e.id}`,
      tone: "exam" as const,
    })),
    ...sessions.flatMap((s) =>
      deadlineKinds(s)
        .filter(([, , d]) => d)
        .map(([tone, label, d]) => ({
          id: `${s.id}-${tone}`,
          date: d!.toISOString(),
          kind: "deadline" as const,
          title: `${label} deadline`,
          subtitle: s.code,
          href: `/examinations/sessions/${s.id}`,
          tone,
        })),
    ),
    ...assignments.map((a) => ({
      id: `asg-${a.id}`,
      date: a.deadline.toISOString(),
      kind: "deadline" as const,
      title: `${a.examination.course.code} setter due`,
      subtitle: a.setter.name,
      href: `/examinations/${a.examinationId}`,
      tone: a.deadline < now ? ("overdue" as const) : ("setting" as const),
    })),
  ];

  return (
    <div>
      <PageHeader title="Examination calendar" description="Examination dates and every workflow deadline in your scope." />
      <CalendarView events={events} initialDate={now.toISOString()} />
    </div>
  );
}
