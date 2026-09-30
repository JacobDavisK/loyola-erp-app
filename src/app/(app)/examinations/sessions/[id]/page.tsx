import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardList, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { Deadline } from "@/components/app/deadline";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { AddExaminationsDialog, SessionStatusControls } from "@/features/examinations/session-controls";
import { SessionFormDialog } from "@/features/examinations/session-form";
import { ASSIGNMENT_STATUS, EXAM_TYPE_LABEL, PAPER_STATUS, SESSION_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { examinationWhere } from "@/server/auth/access";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Examination session" };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth(["exam.view", "session.manage"]);
  const s = await db.examinationSession.findUnique({ where: { id }, include: { academicYear: true, programs: true } });
  if (!s) notFound();
  const exams = await db.examination.findMany({
    where: { AND: [examinationWhere(ctx), { sessionId: id }] },
    orderBy: [{ course: { department: { code: "asc" } } }, { course: { code: "asc" } }],
    include: {
      course: { include: { department: { select: { code: true } }, program: { select: { code: true } }, semester: { select: { name: true } } } },
      schedule: true,
      moderator: { select: { name: true } },
      assignments: { where: { status: { notIn: ["CANCELLED"] } }, orderBy: { setLabel: "asc" }, include: { setter: { select: { name: true } } } },
      papers: { where: { deletedAt: null }, select: { id: true, status: true, setLabel: true } },
    },
  });
  const manage = can(ctx, "session.manage");
  const examManage = can(ctx, "exam.manage");
  const [years, programs, candidateCourses] = await Promise.all([
    manage ? db.academicYear.findMany({ orderBy: { startDate: "desc" }, select: { id: true, label: true } }) : [],
    manage ? db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }) : [],
    examManage
      ? db.course.findMany({
          where: { deletedAt: null, programId: { in: s.programs.map((p) => p.id) }, semester: { termType: s.termType }, examinations: { none: { sessionId: id } } },
          orderBy: { code: "asc" },
          include: { program: { select: { code: true } }, semester: { select: { name: true } } },
        })
      : [],
  ]);
  const lockedSession = ["LOCKED", "PUBLISHED", "ARCHIVED"].includes(s.status);
  const withPaper = exams.filter((e) => e.papers.length > 0).length;
  const lockedPapers = exams.filter((e) => e.papers.some((p) => ["LOCKED", "RELEASED", "ARCHIVED"].includes(p.status))).length;
  const unassigned = exams.filter((e) => e.assignments.length === 0 && e.course.mode !== "PRACTICAL").length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Sessions", href: "/examinations/sessions" }, { label: s.code }]}
        title={<span className="flex flex-wrap items-center gap-3">{s.name}<StatusBadge meta={SESSION_STATUS[s.status]} size="md" /></span>}
        description={`${EXAM_TYPE_LABEL[s.examType]} · ${s.termType === "ODD" ? "Odd" : "Even"} semesters · ${s.academicYear.label} · ${fmtDate(s.startDate)} – ${fmtDate(s.endDate)}`}
        actions={
          manage ? (
            <>
              <SessionStatusControls id={s.id} status={s.status} />
              {!lockedSession && (
                <SessionFormDialog
                  sessionId={s.id}
                  years={years}
                  programs={programs}
                  trigger={<Button size="sm" variant="outline"><Pencil /> Edit</Button>}
                  initial={{
                    name: s.name, code: s.code, academicYearId: s.academicYearId, termType: s.termType, examType: s.examType,
                    startDate: iso(s.startDate), endDate: iso(s.endDate), settingDeadline: iso(s.settingDeadline), moderationDeadline: iso(s.moderationDeadline),
                    scrutinyDeadline: iso(s.scrutinyDeadline), approvalDeadline: iso(s.approvalDeadline), programIds: s.programs.map((p) => p.id), description: s.description ?? "",
                  }}
                />
              )}
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Examinations" value={exams.length} />
        <StatCard label="Papers in progress" value={withPaper} />
        <StatCard label="Without a setter" value={unassigned} tone={unassigned ? "warning" : undefined} href="/setters" />
        <StatCard label="Locked papers" value={`${lockedPapers}/${exams.length}`} tone={lockedPapers === exams.length && exams.length ? "success" : undefined} />
      </div>

      <Section title="Deadlines">
        <div className="grid gap-4 sm:grid-cols-4">
          {([["Paper submission", s.settingDeadline], ["Moderation", s.moderationDeadline], ["Scrutiny", s.scrutinyDeadline], ["Approval", s.approvalDeadline]] as const).map(([l, d]) => (
            <div key={l}>
              <div className="text-xs text-muted-foreground">{l}</div>
              {d ? <Deadline date={d} className="mt-1" /> : <div className="mt-1 text-sm text-muted-foreground">Not set</div>}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Examinations"
        description={`${s.programs.map((p) => p.code).join(", ")}`}
        actions={examManage && !lockedSession ? <AddExaminationsDialog sessionId={s.id} courses={candidateCourses.map((c) => ({ id: c.id, code: c.code, title: c.title, program: c.program.code, semester: c.semester.name }))} /> : null}
        bodyClassName="p-0"
      >
        {exams.length === 0 ? (
          <div className="p-6"><EmptyState icon={ClipboardList} title="No examinations yet" description="Add the courses to be examined in this session." /></div>
        ) : (
          <DataTable head={[{ label: "Course" }, { label: "Dept" }, { label: "Exam date" }, { label: "Setter" }, { label: "Moderator" }, { label: "Paper" }, { label: "" }]}>
            {exams.map((e) => {
              const a = e.assignments[0];
              const p = e.papers[0];
              return (
                <tr key={e.id} className="hover:bg-muted/40">
                  <Td><div className="font-mono text-xs">{e.course.code}</div><div className="max-w-[260px] truncate">{e.course.title}</div><div className="text-[11px] text-muted-foreground">{e.course.program.code} · {e.course.semester.name}</div></Td>
                  <Td className="text-xs">{e.course.department.code}</Td>
                  <Td className="whitespace-nowrap text-xs">{e.schedule ? `${fmtDate(e.schedule.date)} · ${e.schedule.slot}` : <span className="text-muted-foreground">Not scheduled</span>}</Td>
                  <Td>{a ? <div><div className="text-sm">{a.setter.name}</div><StatusBadge meta={ASSIGNMENT_STATUS[a.status]} /></div> : <span className="text-xs text-tone-warning">Not appointed</span>}</Td>
                  <Td className="text-sm">{e.moderator?.name ?? <span className="text-xs text-muted-foreground">—</span>}</Td>
                  <Td>{p ? <StatusBadge meta={PAPER_STATUS[p.status]} /> : <span className="text-xs text-muted-foreground">—</span>}</Td>
                  <Td className="text-right"><Button asChild size="sm" variant="ghost"><Link href={`/examinations/${e.id}`}>Open</Link></Button></Td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Section>
    </div>
  );
}
