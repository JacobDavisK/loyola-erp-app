import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { raiseTicketAction } from "@/features/campus/actions";
import { TICKET_STATUS } from "@/features/campus/labels";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { helpdeskStats, isAgent, ticketWhere } from "@/server/services/helpdesk";
import { getSetting } from "@/server/services/settings";

export const metadata: Metadata = { title: "Helpdesk" };

export default async function HelpdeskPage({ searchParams }: { searchParams: Promise<{ view?: string; category?: string }> }) {
  const ctx = await requirePageAuth();
  const sp = await searchParams;
  const agent = isAgent(ctx);
  const view = agent ? sp.view ?? "queue" : "mine";
  const cfg = await getSetting("helpdesk");
  const and: Prisma.TicketWhereInput[] = [ticketWhere(ctx)];
  if (view === "mine") and.push({ requesterId: ctx.user.id });
  if (view === "queue") and.push({ status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } });
  if (view === "assigned") and.push({ assigneeId: ctx.user.id, status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } });
  if (view === "unassigned") and.push({ assigneeId: null, status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } });
  if (sp.category) and.push({ category: sp.category });
  const [tickets, stats] = await Promise.all([
    db.ticket.findMany({ where: { AND: and }, orderBy: view === "mine" ? { createdAt: "desc" } : [{ dueAt: "asc" }], take: 200, include: { requester: { select: { name: true } }, assignee: { select: { name: true } } } }),
    agent ? helpdeskStats() : null,
  ]);
  const label = Object.fromEntries(cfg.categories.map((c) => [c.key, c.label]));
  const now = new Date();
  return (
    <div className="space-y-6">
      <PageHeader title="Helpdesk" description={agent ? "Tickets by SLA due time. Overdue tickets are highlighted." : "Ask for help with IT, records, examinations, fees, hostel and facilities."}
        actions={<FormDialog title="Ticket" action={raiseTicketAction} submitLabel="Raise ticket" initial={{ category: cfg.categories[0].key, priority: "NORMAL" }} trigger={<Button size="sm"><Plus /> New ticket</Button>}
          fields={[{ name: "category", label: "Category", type: "select", options: cfg.categories.map((c) => ({ value: c.key, label: c.label })) }, { name: "priority", label: "Priority", type: "select", options: [{ value: "LOW", label: "Low" }, { value: "NORMAL", label: "Normal" }, { value: "HIGH", label: "High" }] }, { name: "subject", label: "Subject", type: "text" }, { name: "description", label: "Describe the problem", type: "textarea" }]} />} />
      {stats && (
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
          <StatCard label="Open" value={stats.open} href="?view=queue" />
          <StatCard label="Past SLA" value={stats.breached} tone={stats.breached ? "danger" : undefined} />
          <StatCard label="Resolved (30 days)" value={stats.resolved30} />
          <StatCard label="Resolved on time" value={stats.slaPercent === null ? "—" : `${stats.slaPercent}%`} />
          <StatCard label="Satisfaction" value={stats.satisfaction === null ? "—" : `${stats.satisfaction} / 5`} hint={`${stats.ratings} rating(s)`} />
        </div>
      )}
      {agent && (
        <nav className="flex flex-wrap gap-3 text-sm" aria-label="Views">
          {[["queue", "Open queue"], ["assigned", "Assigned to me"], ["unassigned", "Unassigned"], ["all", "All"], ["mine", "Raised by me"]].map(([k, l]) => <a key={k} href={`?view=${k}`} className={view === k ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground"}>{l}</a>)}
        </nav>
      )}
      <Section title={`${tickets.length} ticket(s)`} bodyClassName="p-0">
        <DataTable head={[{ label: "Ticket" }, { label: "Category" }, ...(agent ? [{ label: "Requester" }, { label: "Assignee" }] : []), { label: "Due" }, { label: "Status" }]} empty="No tickets.">
          {tickets.map((t) => {
            const late = ["OPEN", "IN_PROGRESS", "WAITING"].includes(t.status) && t.dueAt < now;
            return (
              <tr key={t.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/helpdesk/${t.id}`}>{t.subject}</Link><div className="font-mono text-[11px] text-muted-foreground">{t.number} · {t.priority.toLowerCase()} · {fmtRelative(t.createdAt)}</div></Td>
                <Td className="text-xs">{label[t.category] ?? t.category}</Td>
                {agent && <Td className="text-xs">{t.requester.name}</Td>}
                {agent && <Td className="text-xs">{t.assignee?.name ?? <span className="text-tone-warning">unassigned</span>}</Td>}
                <Td className={late ? "text-xs font-medium text-tone-danger" : "text-xs"}>{fmtDateTime(t.dueAt)}{late ? " · overdue" : ""}</Td>
                <Td><StatusBadge meta={TICKET_STATUS[t.status]} /></Td>
              </tr>
            );
          })}
        </DataTable>
      </Section>
    </div>
  );
}
