import Link from "next/link";
import { redirect } from "next/navigation";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardList, FileClock, FilePen, Inbox, ListChecks, Lock, ScanSearch,
  ShieldAlert, Stamp,
} from "lucide-react";
import type { Metadata } from "next";
import { Deadline } from "@/components/app/deadline";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { SegmentedProgress, WorkflowFunnel } from "@/components/app/pipeline";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { ASSIGNMENT_STATUS, PAPER_STATUS, SESSION_STATUS } from "@/lib/domain/labels";
import { deadlineText, fmtDate, fmtDateShort, fmtRelative, pct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import {
  activeSessions, myAssignments, pipelineCounts, recentActivity, reviewQueue, securityAlerts, setterWorkload, upcomingDeadlines,
} from "@/server/services/dashboard";

export const metadata: Metadata = { title: "Dashboard" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const ACTION_LABEL: Record<string, string> = {
  submit: "submitted", resubmit: "resubmitted", start_moderation: "started moderation of", moderation_request_changes: "requested changes on",
  moderation_approve: "approved moderation of", moderation_reject: "rejected", scrutiny_pass: "passed scrutiny for", scrutiny_return: "returned",
  approve: "approved", approval_return: "returned", approval_reject: "rejected", lock: "locked", release: "released", archive: "archived", reopen: "reopened",
};

export default async function DashboardPage() {
  const ctx = await requirePageAuth();
  if (ctx.user.userType !== "STAFF") redirect("/portal");
  const oversight = can(ctx, "exam.view") && (can(ctx, "assignment.manage") || can(ctx, "paper.view.scope") || can(ctx, "report.view"));
  const isSetter = can(ctx, "assignment.respond");
  const isModerator = can(ctx, "moderation.perform");
  const isScrutiny = can(ctx, "scrutiny.perform");
  const isApprover = can(ctx, "paper.approve");

  const [sessions, pipeline, deadlines, workload, activity, security, assignments, modQueue, scrQueue, apprQueue] = await Promise.all([
    oversight ? activeSessions(ctx) : [],
    oversight ? pipelineCounts(ctx) : [],
    oversight && can(ctx, "assignment.manage") ? upcomingDeadlines(ctx) : [],
    can(ctx, "assignment.manage") ? setterWorkload(ctx) : [],
    recentActivity(ctx, 8),
    can(ctx, "audit.view") ? securityAlerts() : null,
    isSetter ? myAssignments(ctx) : [],
    isModerator ? reviewQueue(ctx, "moderation") : [],
    isScrutiny ? reviewQueue(ctx, "scrutiny") : [],
    isApprover ? reviewQueue(ctx, "approval") : [],
  ]);
  const first = ctx.user.name.replace(/^(Dr\.|Prof\.)\s*/, "").split(" ")[0];
  const s0 = sessions[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date())}
        title={`${greeting()}, ${ctx.user.name.startsWith("Dr.") ? `Dr. ${ctx.user.name.split(" ").pop()}` : first}`}
        description={`${ctx.primaryRole.name}${ctx.user.departmentName ? ` · ${ctx.user.departmentName}` : ""}`}
      />

      {/* Review queues first: they are the user's work */}
      {(isModerator || isScrutiny || isApprover) && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          {isModerator && <QueueCard title="Moderation queue" icon={ScanSearch} href="/moderation" items={modQueue.map((p) => ({ id: p.id, code: p.examination.course.code, title: p.examination.course.title, status: p.status, href: `/moderation/${p.id}`, due: p.examination.session.moderationDeadline }))} />}
          {isScrutiny && <QueueCard title="Scrutiny queue" icon={ListChecks} href="/scrutiny" items={scrQueue.map((p) => ({ id: p.id, code: p.examination.course.code, title: p.examination.course.title, status: p.status, href: `/scrutiny/${p.id}`, due: p.examination.session.scrutinyDeadline }))} />}
          {isApprover && <QueueCard title="Awaiting your approval" icon={Stamp} href="/approvals" items={apprQueue.map((p) => ({ id: p.id, code: p.examination.course.code, title: p.examination.course.title, status: p.status, href: `/approvals/${p.id}`, due: p.examination.session.approvalDeadline }))} />}
        </div>
      )}

      {isSetter && (
        <Section title="My paper-setting assignments" description="Papers you have been appointed to set" actions={<Button asChild variant="ghost" size="sm"><Link href="/assignments">All assignments <ArrowRight /></Link></Button>} bodyClassName="p-0">
          {assignments.length === 0 ? (
            <div className="p-5"><EmptyState icon={Inbox} title="No assignments yet" description="When the Examination Controller appoints you as a setter, the assignment will appear here." /></div>
          ) : (
            <ul className="divide-y">
              {assignments.slice(0, 6).map((a) => (
                <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">{a.examination.course.code}</span>
                      <span className="font-medium">{a.examination.course.title}</span>
                      {a.backupSetterId === ctx.user.id && <span className="rounded bg-muted px-1.5 text-[11px] text-muted-foreground">Backup setter</span>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{a.examination.session.name}</span>
                      <span>{a.examination.course.program.code} · {a.examination.course.semester.name}</span>
                      {a.paper && a.paper._count.comments > 0 && <span className="font-medium text-tone-warning">{a.paper._count.comments} open review comment(s)</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge meta={a.paper && a.paper.status !== "DRAFT" ? PAPER_STATUS[a.paper.status] : ASSIGNMENT_STATUS[a.status]} />
                    {["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(a.status) && <Deadline date={a.deadline} compact />}
                    <Button asChild size="sm" variant={a.status === "ASSIGNED" ? "default" : "outline"}>
                      <Link href={a.paper ? (a.paper.status === "DRAFT" || a.paper.status === "REVISION_REQUIRED" ? `/papers/${a.paper.id}/builder` : `/papers/${a.paper.id}`) : "/assignments"}>
                        {a.status === "ASSIGNED" ? "Respond" : a.paper?.status === "DRAFT" || a.paper?.status === "REVISION_REQUIRED" ? "Continue" : "View"}
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {oversight && s0 && (
        <section className="surface-card overflow-hidden">
          <div className="grid lg:grid-cols-[1.4fr_1fr]">
            <div className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="eyebrow">Examination session</span>
                <StatusBadge meta={SESSION_STATUS[s0.status]} />
              </div>
              <Link href={`/examinations/sessions/${s0.id}`} className="mt-2 block text-xl font-semibold tracking-tight hover:text-primary">{s0.name}</Link>
              <p className="mt-1 text-sm text-muted-foreground">{fmtDate(s0.startDate)} – {fmtDate(s0.endDate)} · Academic year {s0.academicYear}</p>
              <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
                {[
                  ["Subjects", s0.subjects],
                  ["Papers completed", s0.completed],
                  ["Awaiting moderation", s0.submitted + s0.moderation],
                  ["Under scrutiny", s0.scrutiny],
                  ["Awaiting approval", s0.approval],
                ].map(([k, v]) => (
                  <div key={k as string}>
                    <div className="text-2xl font-semibold tracking-tight tabular">{v}</div>
                    <div className="text-xs text-muted-foreground">{k}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6">
                <SegmentedProgress
                  total={s0.subjects}
                  segments={[
                    { label: "Locked", value: s0.locked, className: "bg-tone-locked" },
                    { label: "Approved", value: s0.approved, className: "bg-tone-success" },
                    { label: "In review", value: s0.submitted + s0.moderation + s0.scrutiny + s0.approval, className: "bg-tone-progress" },
                    { label: "In preparation", value: s0.inPreparation, className: "bg-primary/40" },
                    { label: "Not started", value: Math.max(0, s0.subjects - s0.completed - s0.submitted - s0.moderation - s0.scrutiny - s0.approval - s0.inPreparation), className: "bg-muted-foreground/20" },
                  ]}
                />
              </div>
            </div>
            <div className="border-t bg-surface/60 p-6 lg:border-t-0 lg:border-l">
              <div className="eyebrow mb-4">Deadlines</div>
              <ol className="relative space-y-4 border-l pl-5">
                {s0.deadlines.map((d) => {
                  const dt = deadlineText(d.date);
                  return (
                    <li key={d.label} className="relative">
                      <span aria-hidden className={cn("absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-card", dt.tone === "danger" ? "bg-tone-danger" : dt.tone === "warning" ? "bg-tone-warning" : "bg-primary")} />
                      <div className="text-sm font-medium">{d.label}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(d.date)} · <span className={cn(dt.tone === "danger" && "font-semibold text-tone-danger", dt.tone === "warning" && "font-medium text-tone-warning")}>{dt.text}</span></div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </section>
      )}

      {oversight && s0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <StatCard label="In preparation" value={s0.inPreparation} icon={FilePen} href="/papers?view=drafts" />
          <StatCard label="Awaiting submission" value={s0.awaitingSubmission} icon={FileClock} href="/setters" tone={s0.awaitingSubmission ? "warning" : undefined} />
          <StatCard label="Awaiting moderation" value={s0.submitted + s0.moderation} icon={ScanSearch} href="/papers?view=moderation" />
          <StatCard label="Awaiting scrutiny" value={s0.scrutiny} icon={ListChecks} href="/papers?view=scrutiny" />
          <StatCard label="Awaiting approval" value={s0.approval} icon={Stamp} href="/papers?view=approval" />
          <StatCard label="Approved" value={s0.approved} icon={CheckCircle2} href="/papers?view=approved" tone="success" />
          <StatCard label="Locked" value={s0.locked} icon={Lock} href="/papers?view=locked" />
        </div>
      )}

      {oversight && (
        <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
          <Section title="Workflow funnel" description="Papers at each stage across active sessions">
            <WorkflowFunnel stages={pipeline} />
            <div className="mt-5 text-xs text-muted-foreground">
              Completion {pct(pipeline.filter((p) => ["approved", "locked"].includes(p.key)).reduce((s, p) => s + p.count, 0), s0?.subjects ?? 0)}% of subjects in {s0?.code ?? "the active session"}
            </div>
          </Section>
          {can(ctx, "assignment.manage") && (
            <Section title="Upcoming deadlines" description="Setter submissions due in the next 30 days" bodyClassName="p-0" actions={<Button asChild variant="ghost" size="sm"><Link href="/setters">Manage <ArrowRight /></Link></Button>}>
              {deadlines.length === 0 ? (
                <div className="p-5"><EmptyState icon={FileClock} title="No deadlines in the next 30 days" /></div>
              ) : (
                <ul className="divide-y">
                  {deadlines.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{d.course}</div>
                        <div className="text-xs text-muted-foreground">{d.setter}</div>
                      </div>
                      <StatusBadge meta={ASSIGNMENT_STATUS[d.status]} />
                      <Deadline date={d.deadline} compact className="w-32 justify-end" />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        {workload.length > 0 && (
          <Section title="Setter workload" bodyClassName="p-0" actions={<Button asChild variant="ghost" size="sm"><Link href="/setters?tab=workload">Details <ArrowRight /></Link></Button>}>
            <div className="relative overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">Setter</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Assigned</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Completed</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Pending</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {workload.slice(0, 7).map((w) => (
                  <tr key={w.id}>
                    <td className="px-5 py-2.5"><div className="font-medium">{w.name}</div><div className="text-xs text-muted-foreground">{w.dept}</div></td>
                    <td className="px-3 text-right tabular">{w.assigned}</td>
                    <td className="px-3 text-right tabular">{w.completed}</td>
                    <td className="px-3 text-right tabular">{w.pending}</td>
                    <td className={cn("px-5 text-right tabular", w.overdue && "font-semibold text-tone-danger")}>{w.overdue ? `${w.overdue} ⚠` : 0}</td>
                  </tr>
                ))}
              </tbody>
              </table>
            </div>
          </Section>
        )}
        <Section title="Recent activity" bodyClassName="p-0">
          {activity.length === 0 ? (
            <div className="p-5"><EmptyState icon={ClipboardList} title="No activity yet" description="Workflow events on papers you can access will appear here." /></div>
          ) : (
            <ul className="divide-y">
              {activity.map((a) => (
                <li key={a.id} className="flex gap-3 px-5 py-3">
                  <StatusBadge meta={PAPER_STATUS[a.to]} className="mt-0.5" />
                  <div className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{a.actor}</span> <span className="text-muted-foreground">{ACTION_LABEL[a.action] ?? a.action}</span>{" "}
                    <Link href={`/papers/${a.paperId}`} className="font-mono text-[13px] hover:text-primary">{a.paperCode}</Link>
                    {a.note && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">“{a.note}”</div>}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtRelative(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {security && (
        <Section title="Security alerts" description="Last 7 days" actions={<Button asChild variant="ghost" size="sm"><Link href="/audit?category=security">Audit log <ArrowRight /></Link></Button>}>
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-3"><AlertTriangle className="size-4 text-tone-warning" /><span className="text-sm"><b className="tabular">{security.failed}</b> failed sign-ins</span></div>
              <div className="flex items-center gap-3"><ShieldAlert className="size-4 text-tone-danger" /><span className="text-sm"><b className="tabular">{security.locked}</b> locked accounts</span></div>
            </div>
            <ul className="space-y-2 text-sm">
              {security.recent.length === 0 && <li className="text-muted-foreground">No security events.</li>}
              {security.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate"><span className="font-mono text-xs text-muted-foreground">{r.action}</span> · {r.summary ?? ""} {r.actor ? `· ${r.actor}` : ""}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.ip ?? ""} · {fmtRelative(r.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}

      {!oversight && !isSetter && !isModerator && !isScrutiny && !isApprover && (
        <EmptyState icon={ClipboardList} title="Nothing needs your attention" description="Use the navigation to browse the areas available to your role." />
      )}
    </div>
  );
}

function QueueCard({ title, icon: Icon, href, items }: { title: string; icon: typeof Stamp; href: string; items: { id: string; code: string; title: string; status: keyof typeof PAPER_STATUS; href: string; due: Date | null }[] }) {
  return (
    <section className="surface-card flex flex-col">
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-primary" /> {title}</h2>
        <span className="rounded-full bg-primary/10 px-2 text-xs font-semibold text-primary tabular">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nothing waiting for you.</p>
      ) : (
        <ul className="flex-1 divide-y">
          {items.slice(0, 5).map((i) => (
            <li key={i.id}>
              <Link href={i.href} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/50">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium"><span className="font-mono text-xs text-muted-foreground">{i.code}</span> {i.title}</div>
                  {i.due && <div className="mt-0.5 text-xs text-muted-foreground">Due {fmtDateShort(i.due)}</div>}
                </div>
                <StatusBadge meta={PAPER_STATUS[i.status]} />
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t p-2">
        <Button asChild variant="ghost" size="sm" className="w-full"><Link href={href}>Open <ArrowRight /></Link></Button>
      </div>
    </section>
  );
}
