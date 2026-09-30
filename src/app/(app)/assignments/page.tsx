import Link from "next/link";
import { BookOpenCheck, FileText, Inbox, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { Deadline } from "@/components/app/deadline";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { AssignmentResponse } from "@/features/papers/assignment-response";
import { OpenWorkspaceButton } from "@/features/papers/open-workspace-button";
import { ASSIGNMENT_STATUS, PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { myAssignments } from "@/server/services/dashboard";

export const metadata: Metadata = { title: "My assignments" };

export default async function AssignmentsPage() {
  const ctx = await requirePageAuth("assignment.respond");
  const list = await myAssignments(ctx);
  const blueprints = await db.blueprint.findMany({
    where: { id: { in: list.map((a) => a.blueprintId).filter((x): x is string => !!x) } },
    include: { sections: { orderBy: { order: "asc" } } },
  });
  const bpById = new Map(blueprints.map((b) => [b.id, b]));
  const open = list.filter((a) => !["DECLINED", "APPROVED"].includes(a.status));
  const closed = list.filter((a) => ["DECLINED", "APPROVED"].includes(a.status));

  return (
    <div className="space-y-6">
      <PageHeader title="My assignments" description="Question papers you have been appointed to set. Accept an assignment to open its paper workspace." />
      {list.length === 0 && <EmptyState icon={Inbox} title="No assignments" description="When the Examination Controller appoints you as a paper setter, the assignment appears here with its deadline and instructions." />}
      <div className="grid gap-4 lg:grid-cols-2">
        {open.map((a) => {
          const bp = a.blueprintId ? bpById.get(a.blueprintId) : null;
          const editable = a.paper && ["DRAFT", "REVISION_REQUIRED"].includes(a.paper.status) && a.setterId === ctx.user.id;
          return (
            <article key={a.id} className="surface-card flex flex-col">
              <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
                <div className="min-w-0">
                  <div className="font-mono text-xs text-muted-foreground">{a.examination.course.code} · Set {a.setLabel}</div>
                  <h2 className="mt-0.5 text-base font-semibold">{a.examination.course.title}</h2>
                  <div className="mt-1 text-xs text-muted-foreground">{a.examination.session.name} · {a.examination.course.program.code} · {a.examination.course.semester.name}</div>
                </div>
                <StatusBadge meta={a.paper && a.paper.status !== "DRAFT" ? PAPER_STATUS[a.paper.status] : ASSIGNMENT_STATUS[a.status]} />
              </div>
              <div className="flex-1 space-y-3 px-5 py-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                  <Deadline date={a.deadline} />
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" /> Appointed by {a.assignedBy.name}</span>
                  {a.backupSetterId === ctx.user.id && <span className="rounded bg-muted px-1.5 text-[11px]">You are the backup setter</span>}
                </div>
                {a.instructions && (
                  <div className="rounded-lg bg-muted/60 px-3 py-2.5 text-[13px]">
                    <div className="eyebrow mb-1">Paper-setting instructions</div>
                    {a.instructions}
                  </div>
                )}
                {bp && (
                  <div>
                    <div className="eyebrow mb-1.5">Paper pattern · {bp.totalMarks} marks</div>
                    <ul className="flex flex-wrap gap-2 text-xs">
                      {bp.sections.map((s) => (
                        <li key={s.id} className="rounded-md border px-2 py-1">
                          §{s.label}: {s.attemptCount === s.questionCount ? `${s.questionCount}` : `${s.attemptCount} of ${s.questionCount}`} × {s.marksPerQuestion} = {s.attemptCount * s.marksPerQuestion}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {a.paper && a.paper._count.comments > 0 && <div className="text-xs font-medium text-tone-warning">{a.paper._count.comments} open review comment(s) to address</div>}
              </div>
              <div className="flex flex-wrap justify-end gap-2 border-t px-5 py-3">
                {a.status === "ASSIGNED" && a.setterId === ctx.user.id ? (
                  <AssignmentResponse id={a.id} course={a.examination.course.code} />
                ) : a.paper ? (
                  <>
                    <Button asChild size="sm" variant="outline"><Link href={`/papers/${a.paper.id}`}><FileText /> Paper</Link></Button>
                    {editable && <Button asChild size="sm"><Link href={`/papers/${a.paper.id}/builder`}><BookOpenCheck /> {a.paper.status === "REVISION_REQUIRED" ? "Revise paper" : "Open builder"}</Link></Button>}
                  </>
                ) : a.setterId === ctx.user.id ? (
                  <OpenWorkspaceButton assignmentId={a.id} />
                ) : (
                  <span className="text-xs text-muted-foreground">Awaiting the primary setter</span>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {closed.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">Completed & declined</h2>
          <ul className="surface-card divide-y">
            {closed.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className="font-mono text-xs text-muted-foreground">{a.examination.course.code}</span>
                <span className="flex-1">{a.examination.course.title} · {a.examination.session.name}</span>
                <span className="text-xs text-muted-foreground">{fmtDate(a.updatedAt)}</span>
                <StatusBadge meta={ASSIGNMENT_STATUS[a.status]} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
