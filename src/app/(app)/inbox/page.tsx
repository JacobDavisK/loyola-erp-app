import Link from "next/link";
import { AlertTriangle, CheckCircle2, Inbox, ListChecks, Plus, ScanSearch, Send, Stamp } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Pagination, qs, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { WORKFLOW_STATUS } from "@/lib/domain/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { paperWhere } from "@/server/auth/access";
import { can, isSuperAdmin, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Approval centre" };

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const ctx = await requirePageAuth();
  const sp = await searchParams;
  const view = sp.view === "requests" || sp.view === "done" ? sp.view : "pending";
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;
  const uid = ctx.user.id;
  const now = new Date();

  // The Super Admin sees every open task (except those on their own requests) and may act on any of them.
  const pendingWhere = isSuperAdmin(ctx)
    ? { status: "PENDING" as const, instance: { status: "IN_PROGRESS" as const, initiatorId: { not: uid }, OR: [{ subjectUserId: null }, { subjectUserId: { not: uid } }] } }
    : { assigneeId: uid, status: "PENDING" as const, instance: { status: "IN_PROGRESS" as const } };
  const doneWhere = { assigneeId: uid, status: { in: ["APPROVED", "REJECTED", "RETURNED"] as ("APPROVED" | "REJECTED" | "RETURNED")[] } };
  const [pendingCount, doneCount, requestCount, moderation, scrutiny, approvals, assignments] = await Promise.all([
    db.workflowTask.count({ where: pendingWhere }),
    db.workflowTask.count({ where: doneWhere }),
    db.workflowInstance.count({ where: { initiatorId: uid } }),
    can(ctx, "moderation.perform") ? db.questionPaper.count({ where: { deletedAt: null, examination: { moderatorId: uid }, status: { in: ["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"] } } }) : 0,
    can(ctx, "scrutiny.perform") ? db.questionPaper.count({ where: { deletedAt: null, examination: { scrutinizerId: uid }, status: "UNDER_SCRUTINY" } }) : 0,
    can(ctx, "paper.approve") ? db.questionPaper.count({ where: { AND: [paperWhere(ctx), { status: "AWAITING_APPROVAL" }] } }) : 0,
    can(ctx, "assignment.respond") ? db.setterAssignment.count({ where: { setterId: uid, status: { in: ["ASSIGNED", "RETURNED"] } } }) : 0,
  ]);
  const examQueues = [
    { label: "Papers to moderate", count: moderation, href: "/moderation", icon: ScanSearch, show: can(ctx, "moderation.perform") },
    { label: "Papers in scrutiny", count: scrutiny, href: "/scrutiny", icon: ListChecks, show: can(ctx, "scrutiny.perform") },
    { label: "Papers awaiting approval", count: approvals, href: "/approvals", icon: Stamp, show: can(ctx, "paper.approve") },
    { label: "Setter assignments", count: assignments, href: "/assignments", icon: Send, show: can(ctx, "assignment.respond") },
  ].filter((q) => q.show);

  const tasks =
    view === "requests"
      ? []
      : await db.workflowTask.findMany({
          where: view === "pending" ? pendingWhere : doneWhere,
          orderBy: view === "pending" ? [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }] : { decidedAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { instance: { select: { id: true, title: true, summary: true, module: true, status: true, initiator: { select: { name: true } }, definition: { select: { name: true } } } }, delegatedFrom: { select: { name: true } } },
        });
  const requests =
    view === "requests"
      ? await db.workflowInstance.findMany({
          where: { initiatorId: uid },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * pageSize,
          take: pageSize,
          include: { definition: { select: { name: true } }, tasks: { where: { status: "PENDING" }, select: { stepName: true, assignee: { select: { name: true } } } } },
        })
      : [];
  const total = view === "pending" ? pendingCount : view === "done" ? doneCount : requestCount;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Approval centre"
        description="Everything waiting for your decision across the university, and the requests you have raised."
        actions={
          <>
            <Button asChild size="sm" variant="outline"><Link href="/inbox/delegations">Out of office</Link></Button>
            <Button asChild size="sm"><Link href="/inbox/new/access"><Plus /> Request access</Link></Button>
          </>
        }
      />

      {examQueues.length > 0 && (
        <section aria-label="Examination queues" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          {examQueues.map((q) => (
            <Link key={q.href} href={q.href} className="surface-card flex items-center gap-3 p-4 hover:border-primary/30">
              <q.icon aria-hidden className="size-5 text-muted-foreground" />
              <span className="flex-1 text-sm">{q.label}</span>
              <span className={cn("text-xl font-semibold tabular", q.count > 0 && "text-primary")}>{q.count}</span>
            </Link>
          ))}
        </section>
      )}

      <LinkTabs
        active={view}
        tabs={[
          { key: "pending", label: "Waiting for me", count: pendingCount, href: "/inbox" },
          { key: "done", label: "Decided by me", count: doneCount, href: "/inbox?view=done" },
          { key: "requests", label: "My requests", count: requestCount, href: "/inbox?view=requests" },
        ]}
      />

      <div className="surface-card overflow-hidden">
        {view !== "requests" &&
          (tasks.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={view === "pending" ? CheckCircle2 : Inbox} title={view === "pending" ? "Nothing is waiting for you" : "No decisions yet"} description={view === "pending" ? "New approval requests assigned to you will appear here and in your notifications." : undefined} />
            </div>
          ) : (
            <DataTable head={[{ label: "Request" }, { label: "Step" }, { label: "From" }, { label: view === "pending" ? "Due" : "Decided" }]}>
              {tasks.map((t) => {
                const overdue = view === "pending" && t.dueAt && t.dueAt < now;
                return (
                  <tr key={t.id} className="hover:bg-muted/40">
                    <Td>
                      <Link href={`/inbox/${t.id}`} className="font-medium hover:text-primary">{t.instance.title}</Link>
                      <div className="text-[11px] text-muted-foreground">{t.instance.definition.name} · {t.instance.module}</div>
                    </Td>
                    <Td className="text-xs">{t.stepName}{t.delegatedFrom && <div className="text-muted-foreground">for {t.delegatedFrom.name}</div>}</Td>
                    <Td className="text-xs">{t.instance.initiator.name}</Td>
                    <Td className={cn("text-xs whitespace-nowrap", overdue && "font-medium text-tone-danger")}>
                      {view === "pending" ? (t.dueAt ? <>{overdue && <AlertTriangle aria-hidden className="mr-1 inline size-3.5" />}{overdue ? "Overdue " : ""}{fmtRelative(t.dueAt)}</> : "No SLA") : fmtDateTime(t.decidedAt)}
                    </Td>
                  </tr>
                );
              })}
            </DataTable>
          ))}
        {view === "requests" &&
          (requests.length === 0 ? (
            <div className="p-6"><EmptyState icon={Send} title="You have not raised any requests" description="Access requests, leave applications and other requests you submit will be tracked here." /></div>
          ) : (
            <DataTable head={[{ label: "Request" }, { label: "Status" }, { label: "Waiting on" }, { label: "Submitted" }]}>
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <Td>
                    <Link href={`/inbox/requests/${r.id}`} className="font-medium hover:text-primary">{r.title}</Link>
                    <div className="text-[11px] text-muted-foreground">{r.definition.name}</div>
                  </Td>
                  <Td><StatusBadge meta={WORKFLOW_STATUS[r.status]} /></Td>
                  <Td className="text-xs">{r.status === "IN_PROGRESS" ? r.tasks.map((t) => t.assignee.name).join(", ") || "—" : "—"}</Td>
                  <Td className="text-xs whitespace-nowrap">{fmtDateTime(r.createdAt)}</Td>
                </tr>
              ))}
            </DataTable>
          ))}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/inbox${qs({ view: view === "pending" ? undefined : view }, { page: p })}`} />
      </div>
    </div>
  );
}
