import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { DecisionPanel, ReassignButton } from "@/features/workflow/decision-panel";
import { RequestView } from "@/features/workflow/request-view";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { canActOnTask, loadInstanceFor } from "@/server/services/workflow";

export const metadata: Metadata = { title: "Approval" };

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = await params;
  const ctx = await requirePageAuth();
  const task = await db.workflowTask.findUnique({ where: { id: taskId }, select: { id: true, instanceId: true, assigneeId: true, status: true, stepIndex: true, instance: { select: { status: true, departmentId: true, initiatorId: true, subjectUserId: true } }, assignee: { select: { name: true } } } });
  if (!task) notFound();
  const loaded = await loadInstanceFor(ctx, task.instanceId).catch(() => null);
  if (!loaded) notFound();
  const standIn = task.assigneeId !== ctx.user.id;
  const mine = canActOnTask(ctx, task) && task.status === "PENDING" && task.instance.status === "IN_PROGRESS";
  const step = loaded.steps[task.stepIndex];
  const monitor = can(ctx, "workflow.monitor", task.instance.departmentId ?? undefined) && task.status === "PENDING" && task.instance.status === "IN_PROGRESS";
  return (
    <div>
      <PageHeader title="Approval request" breadcrumbs={[{ label: "Approval centre", href: "/inbox" }, { label: loaded.instance.title }]} />
      <RequestView loaded={loaded}>
        {mine ? (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Your decision — {step?.name}{standIn ? ` (as Super Admin, in place of ${task.assignee.name})` : ""}</h3>
            <DecisionPanel taskId={task.id} allowReturn={step?.allowReturn ?? true} allowDelegate={step?.allowDelegate ?? true} />
          </div>
        ) : monitor ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">This task is assigned to someone else. <ReassignButton taskId={task.id} /></div>
        ) : (
          <p className="text-sm text-muted-foreground">No action is required from you on this request.</p>
        )}
      </RequestView>
    </div>
  );
}
