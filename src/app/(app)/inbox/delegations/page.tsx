import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { DelegationForm, EndDelegationButton } from "@/features/workflow/forms";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Out of office" };

export default async function DelegationsPage() {
  const ctx = await requirePageAuth();
  const now = new Date();
  const [given, received] = await Promise.all([
    db.workflowDelegation.findMany({ where: { fromUserId: ctx.user.id }, orderBy: { startsAt: "desc" }, take: 20, include: { toUser: { select: { name: true } } } }),
    db.workflowDelegation.findMany({ where: { toUserId: ctx.user.id, revokedAt: null, endsAt: { gte: now } }, orderBy: { startsAt: "asc" }, include: { fromUser: { select: { name: true } } } }),
  ]);
  const state = (d: { revokedAt: Date | null; startsAt: Date; endsAt: Date }) => (d.revokedAt ? "Ended early" : d.endsAt < now ? "Finished" : d.startsAt > now ? "Scheduled" : "Active");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Out of office"
        description="While you are away, new approval tasks go to the colleague you choose. Tasks already in your queue stay with you — delegate them individually."
        breadcrumbs={[{ label: "Approval centre", href: "/inbox" }, { label: "Out of office" }]}
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="New delegation"><DelegationForm /></Section>
        <div className="space-y-6">
          <Section title="My delegations" bodyClassName="p-0">
            {given.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">You have not delegated your approvals.</p>
            ) : (
              <DataTable head={[{ label: "To" }, { label: "Period" }, { label: "Status" }, { label: "" }]}>
                {given.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.toUser.name}{d.reason && <div className="text-[11px] text-muted-foreground">{d.reason}</div>}</Td>
                    <Td className="text-xs whitespace-nowrap">{fmtDate(d.startsAt)} – {fmtDate(d.endsAt)}</Td>
                    <Td className="text-xs">{state(d)}</Td>
                    <Td className="text-right">{!d.revokedAt && d.endsAt >= now && <EndDelegationButton id={d.id} />}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Section>
          <Section title="Delegated to me" bodyClassName="p-0">
            {received.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">No colleague has delegated approvals to you.</p>
            ) : (
              <DataTable head={[{ label: "From" }, { label: "Period" }]}>
                {received.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.fromUser.name}</Td>
                    <Td className="text-xs whitespace-nowrap">{fmtDate(d.startsAt)} – {fmtDate(d.endsAt)}</Td>
                  </tr>
                ))}
              </DataTable>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
