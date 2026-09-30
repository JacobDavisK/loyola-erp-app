import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { StaffAttendanceBoard } from "@/features/hr/controls";
import { dateOnly, isWorkingDay } from "@/lib/domain/hr";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { employeeWhere } from "@/server/services/hr";
import { workCalendar } from "@/server/services/hr-core";

export const metadata: Metadata = { title: "Staff attendance" };

export default async function StaffAttendancePage({ searchParams }: { searchParams: Promise<{ date?: string; dept?: string }> }) {
  const ctx = await requirePageAuth("attendance.staff");
  const sp = await searchParams;
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= todayStr ? sp.date : todayStr;
  const date = dateOnly(dateStr);
  const [employees, marks, departments, cal] = await Promise.all([
    db.employee.findMany({
      where: { AND: [employeeWhere(ctx, "attendance.staff"), { status: { in: ["ACTIVE", "ON_LEAVE"] }, joinDate: { lte: date } }, sp.dept ? { departmentId: sp.dept } : {}] },
      orderBy: [{ department: { code: "asc" } }, { lastName: "asc" }],
      select: { id: true, employeeNo: true, firstName: true, lastName: true, department: { select: { code: true } } },
    }),
    db.staffAttendance.findMany({ where: { date } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    workCalendar(date, date),
  ]);
  const byEmp = new Map(marks.map((m) => [m.employeeId, m]));
  const working = isWorkingDay(date, cal);
  return (
    <div className="space-y-6">
      <PageHeader title="Staff attendance" breadcrumbs={[{ label: "People" }, { label: "Staff attendance" }]} description="Daily attendance for staff in your scope. Days of approved leave are marked automatically and cannot be overwritten here." />
      <form className="flex flex-wrap items-center gap-2">
        <input type="date" name="date" max={todayStr} defaultValue={dateStr} aria-label="Date" className="h-8 rounded-lg border bg-card px-2 text-[13px]" />
        <select name="dept" defaultValue={sp.dept ?? ""} aria-label="Department" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All departments in scope</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button>
      </form>
      <Section title={fmtDate(date)} description={working ? `${employees.length} employee(s)` : "Not a working day under the staff calendar (weekend or holiday)."} bodyClassName="p-0">
        <StaffAttendanceBoard key={`${dateStr}:${sp.dept ?? ""}`} date={dateStr} rows={employees.map((e) => {
          const m = byEmp.get(e.id);
          return { id: e.id, no: e.employeeNo, name: `${e.firstName} ${e.lastName}`, dept: e.department?.code ?? "", status: m?.status ?? null, locked: m?.source === "LEAVE" };
        })} />
      </Section>
    </div>
  );
}
