import Link from "next/link";
import { ArrowUpRight, Check, CircleDot, Clock, Forward, Undo2, X } from "lucide-react";
import { KeyValue, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { TASK_STATUS, WORKFLOW_STATUS } from "@/lib/domain/labels";
import { describeCondition, type WorkflowStep } from "@/lib/domain/workflow-engine";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { loadInstanceFor } from "@/server/services/workflow";

type Loaded = Awaited<ReturnType<typeof loadInstanceFor>>;

const ACTION_TEXT: Record<string, string> = {
  start: "submitted the request",
  approve: "approved",
  reject: "rejected",
  return: "returned it for correction",
  delegate: "delegated",
  reassign: "reassigned",
  escalate: "SLA missed",
  skip: "step skipped",
  resubmit: "resubmitted",
  complete: "approval complete",
  cancelled: "withdrew the request",
  rejected: "request rejected",
  returned: "request returned",
};

const ICON: Record<string, typeof Check> = { approve: Check, complete: Check, reject: X, rejected: X, return: Undo2, returned: Undo2, delegate: Forward, reassign: Forward, escalate: Clock };

/** Renders request data as label/value pairs. Keys starting with "_" and ids are hidden. */
function dataItems(data: unknown): [string, React.ReactNode][] {
  if (!data || typeof data !== "object") return [];
  const out: [string, React.ReactNode][] = [];
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    if (k.startsWith("_") || /Id$|^id$|Scoped$/.test(k) || v === null || v === undefined || typeof v === "object") continue;
    const label = k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    const text = typeof v === "boolean" ? (v ? "Yes" : "No") : /^\d{4}-\d{2}-\d{2}T/.test(String(v)) ? fmtDateTime(String(v)) : String(v);
    out.push([label, text]);
  }
  return out;
}

export function RequestView({ loaded, children }: { loaded: Loaded; children?: React.ReactNode }) {
  const { instance: inst, steps, href, details } = loaded;
  const round = inst.round;
  const tasksFor = (i: number) => inst.tasks.filter((t) => t.stepIndex === i && t.round === round);
  const skipped = new Set(inst.actions.filter((a) => a.action === "skip").map((a) => a.stepIndex));
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-6">
        <Section
          title={inst.title}
          description={`${inst.definition.name} · version ${inst.definition.version}`}
          actions={<StatusBadge meta={WORKFLOW_STATUS[inst.status]} />}
        >
          {inst.summary && <p className="mb-4 text-sm">{inst.summary}</p>}
          <KeyValue
            items={[
              ["Requested by", `${inst.initiator.name}${inst.initiator.designation ? `, ${inst.initiator.designation}` : ""}`],
              ["Submitted", `${fmtDateTime(inst.createdAt)} (${fmtRelative(inst.createdAt)})`],
              ...(inst.completedAt ? [["Completed", fmtDateTime(inst.completedAt)] as [string, React.ReactNode]] : []),
              ...(details ?? dataItems(inst.data)),
            ]}
          />
          {href && (
            <Link href={href} className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              Open the record <ArrowUpRight className="size-3.5" />
            </Link>
          )}
          {children && <div className="mt-5 border-t pt-5">{children}</div>}
        </Section>
        <Section title="Approval path" description={round > 1 ? `Round ${round} (the request was resubmitted)` : undefined}>
          <ol className="space-y-4">
            {steps.map((s: WorkflowStep, i: number) => {
              const tasks = tasksFor(i);
              const current = inst.status === "IN_PROGRESS" && inst.currentStep === i;
              const wasSkipped = skipped.has(i) && !tasks.length;
              return (
                <li key={s.key} className="flex gap-3" aria-current={current ? "step" : undefined}>
                  <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 text-[11px] font-semibold", current ? "border-primary bg-primary/10 text-primary" : tasks.some((t) => t.status === "APPROVED") ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground")}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {s.name}
                      <span className="text-xs font-normal text-muted-foreground">{s.mode === "ALL" ? "all must approve" : "any one approver"}{s.slaHours ? ` · SLA ${s.slaHours} h` : ""}</span>
                    </div>
                    {s.condition && <div className="text-xs text-muted-foreground">Applies when {describeCondition(s.condition)}</div>}
                    {wasSkipped && <div className="text-xs text-muted-foreground">Skipped{tasks.length ? "" : " — not applicable or no independent approver"}</div>}
                    {tasks.length > 0 && (
                      <ul className="mt-1.5 space-y-1">
                        {tasks.map((t) => (
                          <li key={t.id} className="flex flex-wrap items-center gap-2 text-xs">
                            <StatusBadge meta={TASK_STATUS[t.status]} />
                            <span>{t.assignee.name}</span>
                            {t.delegatedFrom && <span className="text-muted-foreground">(for {t.delegatedFrom.name})</span>}
                            {t.status === "PENDING" && t.dueAt && <span className={cn("text-muted-foreground", t.dueAt < new Date() && "font-medium text-tone-danger")}>due {fmtRelative(t.dueAt)}</span>}
                            {t.decidedAt && t.status !== "CANCELLED" && t.status !== "SKIPPED" && <span className="text-muted-foreground">{fmtDateTime(t.decidedAt)}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Section>
      </div>
      <Section title="History" bodyClassName="p-0">
        <ol className="divide-y text-sm">
          {inst.actions.map((a) => {
            const Icon = ICON[a.action] ?? CircleDot;
            return (
              <li key={a.id} className="flex gap-3 px-5 py-3">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div><span className="font-medium">{a.actor?.name ?? "System"}</span> {ACTION_TEXT[a.action] ?? a.action}{a.stepIndex !== null && steps[a.stepIndex] ? <span className="text-muted-foreground"> · {steps[a.stepIndex].name}</span> : null}</div>
                  {a.comment && <p className="mt-0.5 text-muted-foreground">“{a.comment}”</p>}
                  <div className="mt-0.5 text-[11px] text-muted-foreground">{fmtDateTime(a.createdAt)}</div>
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
    </div>
  );
}
