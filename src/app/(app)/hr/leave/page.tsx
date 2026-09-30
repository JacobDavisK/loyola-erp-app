import Link from "next/link";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ActionButton } from "@/features/academic-ops/controls";
import { allocateLeaveAction } from "@/features/hr/actions";
import { CancelLeaveButton } from "@/features/hr/controls";
import { dateOnly } from "@/lib/domain/hr";
import { LEAVE_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { employeeWhere } from "@/server/services/hr";

export const metadata: Metadata = { title: "Leave" };

export default async function HrLeavePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["hr.view", "leave.manage"]);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 40;
  const scope = employeeWhere(ctx, can(ctx, "leave.manage") ? "leave.manage" : "hr.view");
  const today = dateOnly(new Date().toISOString().slice(0, 10));
  const and: Prisma.LeaveRequestWhereInput[] = [{ employee: scope }];
  if (sp.status && sp.status in LEAVE_STATUS) and.push({ status: sp.status as keyof typeof LEAVE_STATUS });
  if (sp.type) and.push({ leaveTypeId: sp.type });
  if (sp.when === "today") and.push({ status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } });
  const where = { AND: and };
  const year = today.getUTCFullYear();
  const [rows, total, types, onLeaveToday, pending, openedThisYear] = await Promise.all([
    db.leaveRequest.findMany({ where, orderBy: [{ fromDate: "desc" }], skip: (page - 1) * pageSize, take: pageSize, include: { leaveType: { select: { code: true, name: true } }, employee: { select: { id: true, employeeNo: true, firstName: true, lastName: true, department: { select: { code: true } } } } } }),
    db.leaveRequest.count({ where }),
    db.leaveType.findMany({ orderBy: { code: "asc" } }),
    db.leaveRequest.count({ where: { employee: scope, status: "APPROVED", fromDate: { lte: today }, toDate: { gte: today } } }),
    db.leaveRequest.count({ where: { employee: scope, status: "PENDING" } }),
    db.leaveBalance.count({ where: { year, employee: scope } }),
  ]);
  const base = { status: sp.status, type: sp.type, when: sp.when };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave"
        breadcrumbs={[{ label: "People" }, { label: "Leave" }]}
        description="Applications from staff in your scope. Approvals happen in the approval centre."
        actions={can(ctx, "leave.manage") && (
          <div className="flex gap-2">
            <ActionButton label={`Open ${year} balances`} run={allocateLeaveAction.bind(null, year)} confirmText={`Open ${year} leave balances for every active employee who does not have them? Quotas are pro-rated for joiners and carry forward is applied.`} />
            <ActionButton label={`Open ${year + 1} balances`} run={allocateLeaveAction.bind(null, year + 1)} confirmText={`Open ${year + 1} leave balances now?`} />
          </div>
        )}
      />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <StatCard label="On leave today" value={onLeaveToday} href="?when=today" />
        <StatCard label="Awaiting approval" value={pending} href="?status=PENDING" tone={pending ? "warning" : undefined} />
        <StatCard label={`Balances opened for ${year}`} value={openedThisYear} />
      </div>
      <form className="flex flex-wrap gap-2">
        <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Any status</option>{Object.entries(LEAVE_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} aria-label="Leave type" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All leave types</option>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
      </form>
      <Section title={`${total} application(s)`} bodyClassName="p-0">
        <DataTable head={[{ label: "Employee" }, { label: "Leave" }, { label: "Dates" }, { label: "Days", className: "text-right" }, { label: "Reason" }, { label: "Status" }, { label: "" }]} empty="No leave applications match.">
          {rows.map((r) => (
            <tr key={r.id}>
              <Td><Link className="hover:text-primary" href={`/hr/employees/${r.employee.id}?tab=leave`}>{r.employee.firstName} {r.employee.lastName}</Link><div className="font-mono text-[11px] text-muted-foreground">{r.employee.employeeNo} · {r.employee.department?.code ?? "—"}</div></Td>
              <Td className="text-xs">{r.leaveType.name}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(r.fromDate)}{r.toDate.getTime() !== r.fromDate.getTime() ? ` – ${fmtDate(r.toDate)}` : ""}{r.halfDay ? " (half)" : ""}</Td>
              <Td className="text-right tabular">{r.days}</Td>
              <Td className="max-w-72 text-xs"><span className="line-clamp-2" title={r.reason}>{r.reason}</span></Td>
              <Td><StatusBadge meta={LEAVE_STATUS[r.status]} /></Td>
              <Td className="text-right">{can(ctx, "leave.manage") && r.status === "APPROVED" && <CancelLeaveButton id={r.id} approved />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => qs(base, { page: p })} />
    </div>
  );
}
