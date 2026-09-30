import Link from "next/link";
import { redirect } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { applyLeaveAction } from "@/features/hr/actions";
import { CancelLeaveButton } from "@/features/hr/controls";
import { leaveFields } from "@/features/hr/leave-fields";
import { dateOnly } from "@/lib/domain/hr";
import { LEAVE_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { leaveSummary } from "@/server/services/hr";

export const metadata: Metadata = { title: "My leave" };

export default async function MyLeavePage() {
  const ctx = await requirePageAuth();
  const employeeId = ctx.subject.employeeId;
  if (!employeeId) redirect("/dashboard");
  const year = new Date().getUTCFullYear();
  const today = dateOnly(new Date().toISOString().slice(0, 10));
  const [emp, { balances, types }, requests] = await Promise.all([
    db.employee.findUniqueOrThrow({ where: { id: employeeId }, select: { category: true, reportingTo: { select: { firstName: true, lastName: true } } } }),
    leaveSummary(employeeId, year),
    db.leaveRequest.findMany({ where: { employeeId }, orderBy: { fromDate: "desc" }, take: 40, include: { leaveType: { select: { name: true } } } }),
  ]);
  const applicable = types.filter((t) => !t.appliesTo || t.appliesTo === emp.category);
  const instances = await db.workflowInstance.findMany({ where: { resourceType: "leaveRequest", resourceId: { in: requests.map((r) => r.id) } }, select: { id: true, resourceId: true } });
  const wf = new Map(instances.map((i) => [i.resourceId, i.id]));
  return (
    <div className="space-y-6">
      <PageHeader
        title="My leave"
        breadcrumbs={[{ label: "My work" }, { label: "Leave" }]}
        description={emp.reportingTo ? `Applications go to ${emp.reportingTo.firstName} ${emp.reportingTo.lastName} first.` : "Applications go to your head of department first."}
        actions={<FormDialog title="Leave application" fields={leaveFields(applicable)} action={applyLeaveAction} submitLabel="Submit for approval" trigger={<Button size="sm"><CalendarPlus /> Apply for leave</Button>} />}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(170px,1fr))]">
        {balances.length === 0 && <p className="text-sm text-muted-foreground">No leave balances are open for {year} yet.</p>}
        {balances.map((b) => <StatCard key={b.id} label={b.name} value={b.available} hint={`${b.used} used${b.pending ? ` · ${b.pending} pending` : ""} of ${b.entitled + b.carriedForward}`} />)}
      </div>
      <Section title="My applications" bodyClassName="p-0">
        <DataTable head={[{ label: "Leave" }, { label: "Dates" }, { label: "Days", className: "text-right" }, { label: "Reason" }, { label: "Status" }, { label: "" }]} empty="You have not applied for leave.">
          {requests.map((r) => (
            <tr key={r.id}>
              <Td className="text-xs">{r.leaveType.name}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(r.fromDate)}{r.toDate.getTime() !== r.fromDate.getTime() ? ` – ${fmtDate(r.toDate)}` : ""}{r.halfDay ? " (half day)" : ""}</Td>
              <Td className="text-right tabular">{r.days}</Td>
              <Td className="max-w-72 text-xs"><span className="line-clamp-2">{r.reason}</span></Td>
              <Td>{wf.get(r.id) ? <Link href={`/inbox/requests/${wf.get(r.id)}`}><StatusBadge meta={LEAVE_STATUS[r.status]} /></Link> : <StatusBadge meta={LEAVE_STATUS[r.status]} />}</Td>
              <Td className="text-right">
                {(r.status === "PENDING" || r.status === "RETURNED") && <CancelLeaveButton id={r.id} approved={false} />}
                {r.status === "APPROVED" && r.fromDate > today && <CancelLeaveButton id={r.id} approved />}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
