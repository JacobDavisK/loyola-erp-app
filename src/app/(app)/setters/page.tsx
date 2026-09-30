import Link from "next/link";
import { UsersRound } from "lucide-react";
import type { Metadata } from "next";
import type { AssignmentStatus } from "@/generated/prisma/enums";
import { Deadline } from "@/components/app/deadline";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { AppointSetterDialog } from "@/features/setters/appoint-dialog";
import { AssignmentRowActions } from "@/features/setters/assignment-row-actions";
import { ASSIGNMENT_STATUS, PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { examinationWhere } from "@/server/auth/access";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { peopleWith } from "@/server/services/people";
import { setterWorkload } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Paper setters" };

const TABS = [
  { key: "assignments", label: "Assignments" },
  { key: "workload", label: "Workload" },
  { key: "deadlines", label: "Deadlines" },
  { key: "unassigned", label: "Needs a setter" },
  { key: "recommendations", label: "Recommendations" },
] as const;

const OPEN: AssignmentStatus[] = ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"];

export default async function SettersPage({ searchParams }: { searchParams: Promise<{ tab?: string; assign?: string; status?: string }> }) {
  const ctx = await requirePageAuth(["assignment.manage", "assignment.recommend"]);
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "assignments";
  const scope = examinationWhere(ctx);
  const canAssign = can(ctx, "assignment.manage");
  const now = new Date();

  const [assignments, workload, unassigned, recs, setters] = await Promise.all([
    db.setterAssignment.findMany({
      where: { examination: scope, ...(sp.status ? { status: sp.status as AssignmentStatus } : {}) },
      orderBy: [{ deadline: "asc" }],
      include: {
        setter: { select: { name: true, department: { select: { code: true } } } },
        backupSetter: { select: { name: true } },
        examination: { include: { course: { select: { code: true, title: true } }, session: { select: { code: true } } } },
        paper: { select: { id: true, status: true, deletedAt: true } },
      },
    }),
    setterWorkload(ctx),
    db.examination.findMany({
      where: { AND: [scope, { isLocked: false, course: { mode: { not: "PRACTICAL" } }, assignments: { none: { status: { notIn: ["CANCELLED", "DECLINED"] } } } }] },
      orderBy: { course: { code: "asc" } },
      include: { course: { include: { department: { select: { code: true } } } }, session: { select: { code: true, settingDeadline: true } }, recommendations: { select: { setterId: true } } },
    }),
    db.setterRecommendation.findMany({ where: { examination: scope }, orderBy: { createdAt: "desc" }, include: { setter: { select: { name: true } }, recommender: { select: { name: true } }, examination: { include: { course: { select: { code: true, title: true } } } } } }),
    canAssign ? peopleWith("paper.edit.own") : Promise.resolve([]),
  ]);

  const open = assignments.filter((a) => OPEN.includes(a.status));
  const overdue = open.filter((a) => a.deadline < now);
  const appointable = await (canAssign
    ? db.examination.findMany({
        where: { AND: [scope, { isLocked: false, session: { status: { notIn: ["LOCKED", "PUBLISHED", "ARCHIVED"] } } }] },
        orderBy: { course: { code: "asc" } },
        include: { course: { include: { department: { select: { code: true } } } }, session: { select: { code: true } }, assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, select: { setLabel: true } }, recommendations: { select: { setterId: true } } },
      })
    : Promise.resolve([]));

  const examOptions = appointable.map((e) => ({
    id: e.id,
    label: `${e.course.code} — ${e.course.title} (${e.session.code})`,
    dept: e.course.department.code,
    usedSets: e.assignments.map((a) => a.setLabel),
    moderatorId: e.moderatorId,
    recommendedIds: e.recommendations.map((r) => r.setterId),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Paper setters"
        description="Appoint setters and backups, track acceptance, workload and submission deadlines."
        actions={canAssign ? <AppointSetterDialog exams={examOptions} setters={setters} defaultOpen={sp.assign === "1"} /> : null}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open assignments" value={open.length} />
        <StatCard label="Awaiting acceptance" value={open.filter((a) => a.status === "ASSIGNED").length} />
        <StatCard label="Overdue" value={overdue.length} tone={overdue.length ? "danger" : undefined} href="/setters?tab=deadlines" />
        <StatCard label="Examinations without setter" value={unassigned.length} tone={unassigned.length ? "warning" : undefined} href="/setters?tab=unassigned" />
      </div>
      <LinkTabs active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, href: `/setters?tab=${t.key}` }))} />

      <div className="surface-card overflow-hidden">
        {tab === "assignments" &&
          (assignments.length === 0 ? (
            <div className="p-6"><EmptyState icon={UsersRound} title="No assignments yet" description="Appoint a setter for an examination to start the paper-setting workflow." /></div>
          ) : (
            <DataTable head={[{ label: "Examination" }, { label: "Set" }, { label: "Setter" }, { label: "Status" }, { label: "Deadline" }, { label: "Paper" }, { label: "" }]}>
              {assignments.map((a) => (
                <tr key={a.id} className="hover:bg-muted/40">
                  <Td><Link href={`/examinations/${a.examinationId}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{a.examination.course.code}</span> {a.examination.course.title}</Link><div className="text-[11px] text-muted-foreground">{a.examination.session.code}</div></Td>
                  <Td className="font-semibold">{a.setLabel}</Td>
                  <Td><div className="text-sm">{a.setter.name} <span className="text-xs text-muted-foreground">{a.setter.department?.code}</span></div>{a.backupSetter && <div className="text-[11px] text-muted-foreground">Backup: {a.backupSetter.name}</div>}</Td>
                  <Td><StatusBadge meta={ASSIGNMENT_STATUS[a.status]} /></Td>
                  <Td>{OPEN.includes(a.status) ? <Deadline date={a.deadline} compact /> : <span className="text-xs text-muted-foreground">{fmtDate(a.deadline)}</span>}</Td>
                  <Td>{a.paper && !a.paper.deletedAt ? <StatusBadge meta={PAPER_STATUS[a.paper.status]} /> : <span className="text-xs text-muted-foreground">—</span>}</Td>
                  <Td className="text-right">{canAssign && !["CANCELLED", "APPROVED", "DECLINED"].includes(a.status) && <AssignmentRowActions id={a.id} deadline={a.deadline.toISOString()} canCancel={!a.paper || a.paper.status === "DRAFT"} />}</Td>
                </tr>
              ))}
            </DataTable>
          ))}

        {tab === "workload" && (
          <DataTable head={[{ label: "Setter" }, { label: "Department" }, { label: "Assigned", className: "text-right" }, { label: "Completed", className: "text-right" }, { label: "Pending", className: "text-right" }, { label: "Overdue", className: "text-right" }, { label: "Load" }]}>
            {workload.map((w) => (
              <tr key={w.id}>
                <Td className="font-medium">{w.name}</Td>
                <Td className="text-xs">{w.dept}</Td>
                <Td className="text-right tabular">{w.assigned}</Td>
                <Td className="text-right tabular">{w.completed}</Td>
                <Td className="text-right tabular">{w.pending}</Td>
                <Td className={cn("text-right tabular", w.overdue && "font-semibold text-tone-danger")}>{w.overdue}</Td>
                <Td>
                  <div className="h-1.5 w-28 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${w.completed} of ${w.assigned} completed`}>
                    <div className="h-full bg-primary" style={{ width: `${(w.completed / Math.max(1, w.assigned)) * 100}%` }} />
                  </div>
                </Td>
              </tr>
            ))}
          </DataTable>
        )}

        {tab === "deadlines" &&
          (open.length === 0 ? (
            <div className="p-6"><EmptyState icon={UsersRound} title="No open deadlines" /></div>
          ) : (
            <ul className="divide-y">
              {open.map((a) => (
                <li key={a.id} className={cn("flex flex-wrap items-center gap-3 px-5 py-3", a.deadline < now && "bg-tone-danger/5")}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{a.examination.course.code} — {a.examination.course.title}</div>
                    <div className="text-xs text-muted-foreground">{a.setter.name} · Set {a.setLabel}</div>
                  </div>
                  <StatusBadge meta={ASSIGNMENT_STATUS[a.status]} />
                  <Deadline date={a.deadline} className="w-56 justify-end" />
                </li>
              ))}
            </ul>
          ))}

        {tab === "unassigned" &&
          (unassigned.length === 0 ? (
            <div className="p-6"><EmptyState icon={UsersRound} title="Every examination has a setter" /></div>
          ) : (
            <ul className="divide-y">
              {unassigned.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/examinations/${e.id}`} className="text-sm font-medium hover:text-primary">{e.course.code} — {e.course.title}</Link>
                    <div className="text-xs text-muted-foreground">{e.course.department.code} · {e.session.code}{e.recommendations.length ? ` · ${e.recommendations.length} HOD recommendation(s)` : ""}</div>
                  </div>
                  {canAssign && (
                    <AppointSetterDialog
                      exams={examOptions.filter((x) => x.id === e.id)}
                      setters={setters}
                      defaultExamId={e.id}
                      defaultDeadline={e.session.settingDeadline?.toISOString().slice(0, 10)}
                    />
                  )}
                </li>
              ))}
            </ul>
          ))}

        {tab === "recommendations" &&
          (recs.length === 0 ? (
            <div className="p-6"><EmptyState icon={UsersRound} title="No recommendations" description="Heads of Department can recommend setters from an examination page." /></div>
          ) : (
            <ul className="divide-y">
              {recs.map((r) => (
                <li key={r.id} className="px-5 py-3 text-sm">
                  <div className="font-medium">★ {r.setter.name} for {r.examination.course.code} — {r.examination.course.title}</div>
                  <div className="text-xs text-muted-foreground">Recommended by {r.recommender.name} · {fmtDate(r.createdAt)}</div>
                  {r.note && <div className="mt-1 text-xs">“{r.note}”</div>}
                </li>
              ))}
            </ul>
          ))}
      </div>
    </div>
  );
}
