import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { adjustLeaveBalanceAction, applyLeaveAction, setEmployeeSalaryAction, setEmployeeStatusAction, setPayDetailsAction, updateEmployeeAction } from "@/features/hr/actions";
import { CancelLeaveButton } from "@/features/hr/controls";
import { employeeFields } from "@/features/hr/fields";
import { leaveFields } from "@/features/hr/leave-fields";
import { eachDay, isoDay, periodRange } from "@/lib/domain/hr";
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE_LABEL, LEAVE_STATUS, PAYROLL_STATUS, STAFF_ATTENDANCE_LABEL } from "@/lib/domain/labels";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { leaveSummary, loadEmployeeFor, maskedPayDetails } from "@/server/services/hr";

export const metadata: Metadata = { title: "Employee" };

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export default async function EmployeePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; month?: string; year?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = sp.tab ?? "overview";
  const ctx = await requirePageAuth(["hr.view", "payroll.view", "payroll.process"]);
  const base = await loadEmployeeFor(ctx, id).catch(() => null);
  const payrollStaff = can(ctx, "payroll.view") || can(ctx, "payroll.process");
  if (!base && !payrollStaff) notFound();
  const e = await db.employee.findUnique({
    where: { id },
    include: { department: true, position: true, reportingTo: { select: { id: true, firstName: true, lastName: true, designation: true } }, reports: { where: { deletedAt: null }, select: { id: true, firstName: true, lastName: true, designation: true } }, user: { select: { id: true, email: true, lastLoginAt: true } } },
  });
  if (!e || e.deletedAt) notFound();
  const canManage = can(ctx, "hr.manage", e.departmentId);
  const canLeave = can(ctx, "leave.manage", e.departmentId);
  const inst = await db.institution.findFirstOrThrow({ select: { currency: true, locale: true } });
  const fmt = (m: number) => formatMoney(m, inst.currency, inst.locale);

  const tabs = [
    { key: "overview", label: "Overview", href: `?tab=overview` },
    ...(base ? [{ key: "leave", label: "Leave", href: `?tab=leave` }, { key: "attendance", label: "Attendance", href: `?tab=attendance` }] : []),
    ...(payrollStaff ? [{ key: "pay", label: "Pay", href: `?tab=pay` }] : []),
  ];

  const editFields = canManage ? employeeFields({
    departments: await db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    positions: await db.position.findMany({ orderBy: { code: "asc" } }),
    managers: await db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE", id: { not: e.id } }, orderBy: { lastName: "asc" }, select: { id: true, firstName: true, lastName: true, employeeNo: true } }),
    users: await db.user.findMany({ where: { userType: "STAFF", deletedAt: null, OR: [{ employeeProfile: null }, { id: e.userId ?? "" }] }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  }) : [];
  const statusFields: FormField[] = [
    { name: "status", label: "Status", type: "select", options: Object.entries(EMPLOYEE_STATUS).map(([value, m]) => ({ value, label: m.label })) },
    { name: "exitDate", label: "Last working day (for exits)", type: "date", optional: true },
    { name: "reason", label: "Reason / order reference", type: "textarea" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={e.employeeNo}
        title={`${e.firstName} ${e.lastName}`}
        breadcrumbs={[{ label: "Employees", href: "/hr/employees" }, { label: `${e.firstName} ${e.lastName}` }]}
        description={<span className="flex flex-wrap items-center gap-2">{e.designation} · {e.department?.name ?? "No department"} <StatusBadge meta={EMPLOYEE_STATUS[e.status]} /></span>}
        actions={canManage && (
          <div className="flex gap-2">
            <FormDialog title="Employee" columns={2} id={e.id} fields={editFields} action={updateEmployeeAction} trigger={<Button size="sm" variant="outline"><Pencil /> Edit</Button>}
              initial={{ firstName: e.firstName, lastName: e.lastName, email: e.email, phone: e.phone, designation: e.designation, category: e.category, employmentType: e.employmentType, departmentId: e.departmentId, positionId: e.positionId, reportingToId: e.reportingToId, joinDate: ymd(e.joinDate), confirmationDate: ymd(e.confirmationDate), dateOfBirth: ymd(e.dateOfBirth), gender: e.gender, userId: e.userId, specialization: e.specialization }} />
            <FormDialog title="Employment status" id={e.id} fields={statusFields} action={setEmployeeStatusAction} initial={{ status: e.status, exitDate: ymd(e.exitDate) }} submitLabel="Change status" trigger={<Button size="sm" variant="outline">Change status</Button>} />
          </div>
        )}
      />
      <LinkTabs tabs={tabs} active={tab} />

      {tab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Section title="Employment">
            <KeyValue items={[
              ["Employee no.", <span key="n" className="font-mono">{e.employeeNo}</span>],
              ["Category", e.category === "TEACHING" ? "Teaching" : "Non-teaching"],
              ["Employment", EMPLOYMENT_TYPE_LABEL[e.employmentType]],
              ["Position", e.position ? `${e.position.code} — ${e.position.title}` : "—"],
              ["Joined", fmtDate(e.joinDate)],
              ["Confirmed", fmtDate(e.confirmationDate)],
              ...(e.exitDate ? [["Exit", `${fmtDate(e.exitDate)}${e.exitReason ? ` · ${e.exitReason}` : ""}`] as [string, string]] : []),
              ["Reports to", e.reportingTo ? <Link key="r" className="hover:text-primary" href={`/hr/employees/${e.reportingTo.id}`}>{e.reportingTo.firstName} {e.reportingTo.lastName}</Link> : "—"],
            ]} />
          </Section>
          <Section title="Contact & account">
            <KeyValue items={[
              ["E-mail", e.email],
              ["Phone", e.phone ?? "—"],
              ["Date of birth", fmtDate(e.dateOfBirth)],
              ["Sign-in account", e.user ? `${e.user.email}${e.user.lastLoginAt ? ` · last sign-in ${fmtDate(e.user.lastLoginAt)}` : ""}` : "Not linked"],
              ["Specialisation", e.specialization || "—"],
            ]} />
          </Section>
          {e.reports.length > 0 && (
            <Section title="Direct reports" description={`${e.reports.length}`}>
              <ul className="space-y-1.5 text-sm">{e.reports.map((r) => <li key={r.id}><Link className="hover:text-primary" href={`/hr/employees/${r.id}`}>{r.firstName} {r.lastName}</Link> <span className="text-xs text-muted-foreground">{r.designation}</span></li>)}</ul>
            </Section>
          )}
        </div>
      )}

      {tab === "leave" && base && <LeaveTab employeeId={e.id} year={Number(sp.year) || new Date().getUTCFullYear()} canLeave={canLeave} />}
      {tab === "attendance" && base && <AttendanceTab employeeId={e.id} month={sp.month} />}
      {tab === "pay" && payrollStaff && <PayTab e={e} canProcess={can(ctx, "payroll.process")} fmt={fmt} />}
    </div>
  );
}

async function LeaveTab({ employeeId, year, canLeave }: { employeeId: string; year: number; canLeave: boolean }) {
  const [{ balances, types }, requests] = await Promise.all([
    leaveSummary(employeeId, year),
    db.leaveRequest.findMany({ where: { employeeId }, orderBy: { fromDate: "desc" }, take: 50, include: { leaveType: { select: { code: true, name: true } } } }),
  ]);
  return (
    <div className="space-y-6">
      <Section
        title={`Leave balances ${year}`}
        actions={canLeave && <FormDialog title="Leave application" description="Applied on the employee's behalf; it goes through the same approval as a self-service application." fields={leaveFields(types)} id={employeeId} action={applyLeaveAction} submitLabel="Submit for approval" trigger={<Button size="xs" variant="outline"><CalendarPlus /> Apply on behalf</Button>} />}
        bodyClassName="p-0"
      >
        <DataTable head={[{ label: "Leave type" }, { label: "Entitled", className: "text-right" }, { label: "Carried forward", className: "text-right" }, { label: "Used", className: "text-right" }, { label: "Pending", className: "text-right" }, { label: "Available", className: "text-right" }, { label: "" }]} empty="No balances opened for this year. HR opens them from People → Leave.">
          {balances.map((b) => (
            <tr key={b.id}>
              <Td>{b.name} <span className="text-xs text-muted-foreground">{b.code}</span></Td>
              <Td className="text-right tabular">{b.entitled}</Td>
              <Td className="text-right tabular">{b.carriedForward}</Td>
              <Td className="text-right tabular">{b.used}</Td>
              <Td className="text-right tabular">{b.pending || "—"}</Td>
              <Td className="text-right font-medium tabular">{b.available}</Td>
              <Td className="text-right">{canLeave && <FormDialog title="Leave entitlement" id={b.id} action={adjustLeaveBalanceAction} fields={[{ name: "entitled", label: "Entitled days", type: "number", min: 0, step: 0.5 }, { name: "reason", label: "Reason", type: "textarea" }]} initial={{ entitled: b.entitled }} />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      <Section title="Applications" bodyClassName="p-0">
        <DataTable head={[{ label: "Leave" }, { label: "Dates" }, { label: "Days", className: "text-right" }, { label: "Reason" }, { label: "Status" }, { label: "" }]} empty="No leave applications.">
          {requests.map((r) => (
            <tr key={r.id}>
              <Td className="text-xs">{r.leaveType.name}</Td>
              <Td className="text-xs whitespace-nowrap">{fmtDate(r.fromDate)}{r.toDate.getTime() !== r.fromDate.getTime() ? ` – ${fmtDate(r.toDate)}` : ""}{r.halfDay ? " (half day)" : ""}</Td>
              <Td className="text-right tabular">{r.days}</Td>
              <Td className="max-w-80 text-xs"><span className="line-clamp-2" title={r.reason}>{r.reason}</span></Td>
              <Td><StatusBadge meta={LEAVE_STATUS[r.status]} /></Td>
              <Td className="text-right">{canLeave && r.status === "APPROVED" && <CancelLeaveButton id={r.id} approved />}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}

async function AttendanceTab({ employeeId, month }: { employeeId: string; month?: string }) {
  const period = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const { from, to } = periodRange(period);
  const rows = await db.staffAttendance.findMany({ where: { employeeId, date: { gte: from, lte: to } } });
  const byDay = new Map(rows.map((r) => [r.date.toISOString().slice(0, 10), r]));
  const counts = rows.reduce<Record<string, number>>((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
  const [y, m] = period.split("-").map(Number);
  const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
  const lead = isoDay(from) - 1;
  return (
    <Section title={new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })} actions={<div className="flex gap-2 text-sm"><Link className="hover:text-primary" href={`?tab=attendance&month=${prev}`}>← Previous</Link><Link className="hover:text-primary" href={`?tab=attendance&month=${next}`}>Next →</Link></div>}>
      <p className="mb-3 text-sm text-muted-foreground">{Object.entries(counts).map(([k, v]) => `${STAFF_ATTENDANCE_LABEL[k as keyof typeof STAFF_ATTENDANCE_LABEL].label}: ${v}`).join(" · ") || "Nothing marked this month."}</p>
      <div className="grid max-w-xl grid-cols-7 gap-1 text-center text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="py-1 font-medium text-muted-foreground">{d}</div>)}
        {Array.from({ length: lead }).map((_, i) => <div key={`l${i}`} />)}
        {eachDay(from, to).map((d) => {
          const r = byDay.get(d.toISOString().slice(0, 10));
          return (
            <div key={d.toISOString()} title={r ? `${STAFF_ATTENDANCE_LABEL[r.status].label}${r.remarks ? ` · ${r.remarks}` : ""}` : "Not marked"}
              className={cn("rounded-md border py-1.5", r?.status === "ABSENT" && "border-destructive/40 bg-destructive/10", r?.status === "ON_LEAVE" && "bg-tone-info/10", r?.status === "PRESENT" && "bg-tone-success/8")}>
              <div>{d.getUTCDate()}</div>
              <div className="font-medium">{r ? STAFF_ATTENDANCE_LABEL[r.status].short : "·"}</div>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

async function PayTab({ e, canProcess, fmt }: { e: { id: string; bankAccountEnc: string | null; bankIfsc: string | null; taxIdEnc: string | null }; canProcess: boolean; fmt: (m: number) => string }) {
  const [salaries, slips, structures] = await Promise.all([
    db.employeeSalary.findMany({ where: { employeeId: e.id }, orderBy: { effectiveFrom: "desc" }, include: { structure: { select: { code: true, version: true, name: true } } } }),
    db.payslip.findMany({ where: { employeeId: e.id }, orderBy: { run: { period: "desc" } }, include: { run: { select: { period: true, status: true } } } }),
    db.salaryStructure.findMany({ where: { status: "ACTIVE" }, orderBy: { code: "asc" } }),
  ]);
  const pay = maskedPayDetails(e);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Bank & tax" description="Stored encrypted; only the last four characters are shown." actions={canProcess && <FormDialog title="Pay details" id={e.id} action={setPayDetailsAction} fields={[{ name: "bankAccount", label: "Bank account number", type: "text", optional: true, hint: "Blank fields keep the current value." }, { name: "bankIfsc", label: "IFSC / routing code", type: "text", optional: true, upper: true }, { name: "taxId", label: "Tax identifier (PAN)", type: "text", optional: true, upper: true }]} initial={{ bankIfsc: e.bankIfsc }} />}>
          <KeyValue items={[["Account", <span key="a" className="font-mono">{pay.bankAccount}</span>], ["IFSC", pay.bankIfsc], ["Tax id", <span key="t" className="font-mono">{pay.taxId}</span>]]} />
        </Section>
        <Section title="Pay history" description="Append-only; a pay change is a new effective-dated row." actions={canProcess && structures.length > 0 && <FormDialog title="Pay change" id={e.id} action={setEmployeeSalaryAction} submitLabel="Record" fields={[{ name: "structureId", label: "Salary structure", type: "select", options: structures.map((s) => ({ value: s.id, label: `${s.code} v${s.version} — ${s.name}` })) }, { name: "basicMonthly", label: "Basic pay (monthly)", type: "number", min: 0, step: 0.01 }, { name: "effectiveFrom", label: "Effective from", type: "date" }]} trigger={<Button size="xs" variant="outline">Record pay change</Button>} />}>
          <ul className="space-y-1.5 text-sm">
            {salaries.length === 0 && <li className="text-muted-foreground">No pay set.</li>}
            {salaries.map((s) => <li key={s.id} className="flex justify-between gap-3"><span>{fmtDate(s.effectiveFrom)} · {s.structure.code} v{s.structure.version}</span><span className="tabular">{fmt(toMinor(s.basicMonthly))} basic</span></li>)}
          </ul>
        </Section>
      </div>
      <Section title="Payslips" bodyClassName="p-0">
        <DataTable head={[{ label: "Month" }, { label: "Gross", className: "text-right" }, { label: "Deductions", className: "text-right" }, { label: "Net", className: "text-right" }, { label: "Loss of pay", className: "text-right" }, { label: "Run" }]} empty="No payslips yet.">
          {slips.map((p) => (
            <tr key={p.id}>
              <Td><Link className="hover:text-primary" href={`/hr/payroll/payslips/${p.id}`}>{p.run.period}</Link></Td>
              <Td className="text-right tabular">{fmt(toMinor(p.gross))}</Td>
              <Td className="text-right tabular">{fmt(toMinor(p.deductions))}</Td>
              <Td className="text-right font-medium tabular">{fmt(toMinor(p.net))}</Td>
              <Td className="text-right tabular">{p.lopDays || "—"}</Td>
              <Td><StatusBadge meta={PAYROLL_STATUS[p.run.status]} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
