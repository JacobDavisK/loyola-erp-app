import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import type { Metadata } from "next";
import { Deadline } from "@/components/app/deadline";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ExamSettingsForm } from "@/features/examinations/exam-settings-form";
import { AppointSetterDialog } from "@/features/setters/appoint-dialog";
import { RecommendSetterDialog } from "@/features/setters/recommend-dialog";
import { ASSIGNMENT_STATUS, COURSE_TYPE_LABEL, PAPER_STATUS, SESSION_STATUS, formatDuration } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { examinationWhere } from "@/server/auth/access";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { peopleWith } from "@/server/services/people";
import { currentVersionLabel } from "@/server/services/papers";

export const metadata: Metadata = { title: "Examination" };

export default async function ExaminationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("exam.view");
  const e = await db.examination.findFirst({
    where: { AND: [examinationWhere(ctx), { id }] },
    include: {
      course: { include: { department: true, program: true, semester: true, regulation: true } },
      session: true,
      schedule: true,
      blueprint: { select: { id: true, name: true } },
      template: { select: { name: true } },
      moderator: { select: { name: true } },
      scrutinizer: { select: { name: true } },
      assignments: { orderBy: { setLabel: "asc" }, include: { setter: { select: { name: true } }, backupSetter: { select: { name: true } }, paper: { select: { id: true, status: true, versionMajor: true, versionMinor: true, deletedAt: true } } } },
      recommendations: { include: { setter: { select: { name: true } }, recommender: { select: { name: true } } } },
    },
  });
  if (!e) notFound();
  const dept = e.course.departmentId;
  const manage = can(ctx, "exam.manage", dept);
  const canAssign = can(ctx, "assignment.manage", dept);
  const canRecommend = can(ctx, "assignment.recommend", dept);
  const seePapers = can(ctx, "paper.view.scope", dept);
  const [moderators, scrutinizers, setters, blueprints, templates] = await Promise.all([
    manage ? peopleWith("moderation.perform") : [],
    manage ? peopleWith("scrutiny.perform") : [],
    canAssign || canRecommend ? peopleWith("paper.edit.own") : [],
    manage ? db.blueprint.findMany({ where: { deletedAt: null, OR: [{ courseId: e.courseId }, { isPattern: true }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
    manage ? db.template.findMany({ where: { kind: "PAPER" }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [],
  ]);
  const active = e.assignments.filter((a) => !["CANCELLED", "DECLINED"].includes(a.status));
  const toTime = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Sessions", href: "/examinations/sessions" }, { label: e.session.code, href: `/examinations/sessions/${e.sessionId}` }, { label: e.course.code }]}
        title={`${e.course.code} — ${e.course.title}`}
        description={`${e.session.name} · ${e.course.program.name} · ${e.course.semester.name} · ${e.course.regulation.code}`}
        actions={
          <>
            {e.isLocked && <span className="flex items-center gap-1.5 rounded-full bg-tone-locked/10 px-2.5 py-1 text-xs font-semibold text-tone-locked"><Lock className="size-3.5" /> Locked</span>}
            <StatusBadge meta={SESSION_STATUS[e.session.status]} size="md" />
            {canRecommend && !canAssign && <RecommendSetterDialog examinationId={e.id} setters={setters} />}
            {canAssign && !e.isLocked && (
              <AppointSetterDialog
                exams={[{ id: e.id, label: `${e.course.code} — ${e.course.title}`, dept: e.course.department.code, usedSets: active.map((a) => a.setLabel), moderatorId: e.moderatorId, recommendedIds: e.recommendations.map((r) => r.setterId) }]}
                setters={setters}
                defaultExamId={e.id}
                defaultDeadline={e.session.settingDeadline?.toISOString().slice(0, 10)}
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section title="Paper setters" description="Each set is an independent paper; the approving authority decides which set is locked for printing." bodyClassName="p-0">
            {e.assignments.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No setter appointed yet.</p>
            ) : (
              <ul className="divide-y">
                {e.assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                    <span className="grid size-8 place-items-center rounded-lg bg-muted text-sm font-semibold">{a.setLabel}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{a.setter.name}{a.backupSetter && <span className="text-xs font-normal text-muted-foreground"> · backup {a.backupSetter.name}</span>}</div>
                      <div className="mt-0.5 flex items-center gap-3">
                        <StatusBadge meta={ASSIGNMENT_STATUS[a.status]} />
                        {["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(a.status) && <Deadline date={a.deadline} compact />}
                        {a.declineReason && <span className="text-xs text-muted-foreground">“{a.declineReason}”</span>}
                      </div>
                    </div>
                    {a.paper && !a.paper.deletedAt && (
                      <div className="flex items-center gap-2">
                        <StatusBadge meta={PAPER_STATUS[a.paper.status]} />
                        <span className="text-xs text-muted-foreground tabular">v{currentVersionLabel(a.paper)}</span>
                        {seePapers && <Button asChild size="sm" variant="outline"><Link href={`/papers/${a.paper.id}`}>Paper</Link></Button>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Settings" description={e.isLocked ? "This examination is locked." : manage ? "Reviewers, pattern, template and timetable." : "Read-only for your role."}>
            <ExamSettingsForm
              examId={e.id}
              disabled={!manage || e.isLocked}
              moderators={moderators.map((m) => ({ id: m.id, label: `${m.name}${m.dept ? ` (${m.dept})` : ""}` }))}
              scrutinizers={scrutinizers.map((m) => ({ id: m.id, label: `${m.name}${m.dept ? ` (${m.dept})` : ""}` }))}
              blueprints={blueprints.map((b) => ({ id: b.id, label: b.name }))}
              templates={templates.map((t) => ({ id: t.id, label: t.name }))}
              initial={{
                moderatorId: e.moderatorId ?? "",
                scrutinizerId: e.scrutinizerId ?? "",
                blueprintId: e.blueprintId ?? "",
                templateId: e.templateId ?? "",
                maxMarks: e.maxMarks,
                durationMinutes: e.durationMinutes,
                notes: e.notes ?? "",
                date: e.schedule ? e.schedule.date.toISOString().slice(0, 10) : "",
                slot: e.schedule?.slot ?? "FN",
                startTime: e.schedule ? toTime(e.schedule.startsAt) : "10:00",
                venue: e.schedule?.venue ?? "",
              }}
            />
          </Section>
        </div>

        <div className="space-y-6">
          <Section title="Course">
            <KeyValue
              items={[
                ["Department", e.course.department.name],
                ["Type", COURSE_TYPE_LABEL[e.course.courseType]],
                ["Credits", e.course.credits],
                ["Max marks", `${e.maxMarks} (external)`],
                ["Duration", formatDuration(e.durationMinutes)],
                ["Blueprint", e.blueprint ? <Link key="b" href={`/blueprints/${e.blueprint.id}`} className="text-primary hover:underline">{e.blueprint.name}</Link> : "—"],
                ["Template", e.template?.name ?? "Default"],
                ["Moderator", e.moderator?.name ?? "—"],
                ["Scrutiny", e.scrutinizer?.name ?? "—"],
                ["Exam date", e.schedule ? `${fmtDate(e.schedule.date)} · ${e.schedule.slot}` : "Not scheduled"],
              ]}
            />
            <Button asChild variant="ghost" size="sm" className="mt-3"><Link href={`/academics/courses/${e.courseId}`}>Course record</Link></Button>
          </Section>
          {e.recommendations.length > 0 && (
            <Section title="HOD recommendations" bodyClassName="p-0">
              <ul className="divide-y">
                {e.recommendations.map((r) => (
                  <li key={r.id} className="px-5 py-3 text-sm">
                    <div className="font-medium">★ {r.setter.name}</div>
                    <div className="text-xs text-muted-foreground">by {r.recommender.name} · {fmtDate(r.createdAt)}</div>
                    {r.note && <div className="mt-1 text-xs">“{r.note}”</div>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}
