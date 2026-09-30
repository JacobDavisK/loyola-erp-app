import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { assignTicketAction, setPriorityAction, setTicketStatusAction } from "@/features/campus/actions";
import { RateTicket, TicketReply } from "@/features/campus/controls";
import { TICKET_STATUS } from "@/features/campus/labels";
import { canMoveTicket } from "@/lib/domain/campus";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { loadTicketFor } from "@/server/services/helpdesk";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Ticket" };

const MOVES = { IN_PROGRESS: "Start", WAITING: "Wait for requester", RESOLVED: "Resolve", CLOSED: "Close" } as const;

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  const r = await loadTicketFor(ctx, id).catch(() => null);
  if (!r) notFound();
  const { ticket: t, agent, own } = r;
  const cfg = await getSetting("helpdesk");
  const cat = cfg.categories.find((c) => c.key === t.category);
  const open = !["CLOSED"].includes(t.status);
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={t.number} title={t.subject} breadcrumbs={[{ label: "Helpdesk", href: "/helpdesk" }, { label: t.number }]} description={<span className="flex flex-wrap items-center gap-2"><StatusBadge meta={TICKET_STATUS[t.status]} /> {cat?.label ?? t.category} · {t.priority.toLowerCase()} priority · due {fmtDateTime(t.dueAt)}</span>}
        actions={agent && open && (
          <div className="flex flex-wrap gap-2">
            {!t.assignee && <ActionButton size="sm" label="Take it" run={assignTicketAction.bind(null, t.id, ctx.user.id)} />}
            {(Object.keys(MOVES) as (keyof typeof MOVES)[]).filter((s) => canMoveTicket(t.status, s)).map((s) => <ActionButton key={s} size="sm" label={MOVES[s]} variant={s === "RESOLVED" ? "default" : "outline"} run={setTicketStatusAction.bind(null, t.id, s)} />)}
            {t.priority !== "URGENT" && <ActionButton size="sm" variant="ghost" label="Mark urgent" run={setPriorityAction.bind(null, t.id, "URGENT")} />}
          </div>
        )} />
      <Section title="Details"><KeyValue items={[["Requester", `${t.requester.name}${agent ? ` · ${t.requester.email}` : ""}`], ["Assigned to", t.assignee?.name ?? "Not yet assigned"], ["Raised", fmtDateTime(t.createdAt)], ["First response", t.firstResponseAt ? fmtDateTime(t.firstResponseAt) : "—"], ["Resolved", t.resolvedAt ? fmtDateTime(t.resolvedAt) : "—"], ...(t.satisfaction ? [["Rating", `${t.satisfaction} / 5`] as [string, string]] : [])]} /></Section>
      <Section title="Conversation">
        <ol className="space-y-3">
          {t.messages.map((m) => (
            <li key={m.id} className={cn("rounded-lg border p-3", m.internal && "border-tone-warning/40 bg-tone-warning/5", m.authorId === t.requesterId ? "mr-8" : "ml-8 bg-muted/30")}>
              <div className="mb-1 flex justify-between gap-2 text-xs text-muted-foreground"><span className="font-medium text-foreground">{m.author.name}{m.internal ? " · internal note" : ""}</span><span>{fmtDateTime(m.createdAt)}</span></div>
              <p className="whitespace-pre-wrap text-sm">{m.body}</p>
            </li>
          ))}
        </ol>
      </Section>
      {open && <Section title="Reply"><TicketReply id={t.id} agent={agent} /></Section>}
      {own && open && (
        <div className="flex flex-wrap items-center gap-3">
          {t.status === "RESOLVED" && <RateTicket id={t.id} />}
          {!agent && <ActionButton size="sm" variant="ghost" label="Close ticket" run={setTicketStatusAction.bind(null, t.id, "CLOSED")} confirmText="Close this ticket?" />}
        </div>
      )}
      {agent && can(ctx, "helpdesk.manage") && !open && <p className="text-xs text-muted-foreground">Closed tickets are kept for reporting; messages cannot be edited.</p>}
    </div>
  );
}
