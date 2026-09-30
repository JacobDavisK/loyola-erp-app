import Link from "next/link";
import { Contact, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataGrid, type GridColumn } from "@/components/app/data-grid";
import { FormDialog } from "@/components/app/form-dialog";
import { SearchForm } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { createEmployeeAction } from "@/features/hr/actions";
import { employeeFields } from "@/features/hr/fields";
import { EMPLOYEE_STATUS, EMPLOYMENT_TYPE_LABEL } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { employeeWhere } from "@/server/services/hr";

export const metadata: Metadata = { title: "Employees" };

export default async function EmployeesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("hr.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const and: Prisma.EmployeeWhereInput[] = [employeeWhere(ctx)];
  if (sp.status && sp.status in EMPLOYEE_STATUS) and.push({ status: sp.status as keyof typeof EMPLOYEE_STATUS });
  else if (!sp.status) and.push({ status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] } });
  if (sp.dept) and.push({ departmentId: sp.dept });
  if (sp.category === "TEACHING" || sp.category === "NON_TEACHING") and.push({ category: sp.category });
  const q = sp.q?.trim().slice(0, 80);
  if (q) and.push({ AND: q.split(/\s+/).slice(0, 4).map((w) => ({ OR: [{ firstName: { contains: w, mode: "insensitive" as const } }, { lastName: { contains: w, mode: "insensitive" as const } }, { employeeNo: { contains: w, mode: "insensitive" as const } }, { designation: { contains: w, mode: "insensitive" as const } }] })) });
  const where = { AND: and };
  const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = sp.sort === "joined" ? [{ joinDate: "asc" }] : sp.sort === "no" ? [{ employeeNo: "asc" }] : [{ lastName: "asc" }, { firstName: "asc" }];
  const [rows, total, departments, positions, managers, users] = await Promise.all([
    db.employee.findMany({ where, orderBy, skip: (page - 1) * pageSize, take: pageSize, include: { department: { select: { code: true } }, reportingTo: { select: { firstName: true, lastName: true } } } }),
    db.employee.count({ where }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
    db.position.findMany({ orderBy: { code: "asc" } }),
    db.employee.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: [{ lastName: "asc" }], select: { id: true, firstName: true, lastName: true, employeeNo: true } }),
    db.user.findMany({ where: { userType: "STAFF", deletedAt: null, employeeProfile: null }, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
  ]);
  const columns: GridColumn[] = [
    { key: "no", label: "Employee no.", pinned: true, sort: "no" },
    { key: "name", label: "Name", pinned: true },
    { key: "designation", label: "Designation" },
    { key: "dept", label: "Department" },
    { key: "type", label: "Employment" },
    { key: "manager", label: "Reports to", hidden: true },
    { key: "joined", label: "Joined", sort: "joined" },
    { key: "status", label: "Status" },
  ];
  return (
    <div>
      <PageHeader
        title="Employees"
        breadcrumbs={[{ label: "People" }, { label: "Employees" }]}
        description={`${total} employee(s)`}
        actions={can(ctx, "hr.manage") && (
          <FormDialog title="Employee" columns={2} fields={employeeFields({ departments, positions, managers, users })} action={createEmployeeAction} initial={{ category: "TEACHING", employmentType: "PERMANENT" }} trigger={<Button size="sm"><Plus /> Add employee</Button>} />
        )}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Current staff</option>{Object.entries(EMPLOYEE_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}</select>
          <select name="dept" defaultValue={sp.dept ?? ""} aria-label="Department" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">All departments</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select name="category" defaultValue={sp.category ?? ""} aria-label="Category" className="h-8 rounded-lg border bg-card px-2 text-[13px]"><option value="">Teaching and non-teaching</option><option value="TEACHING">Teaching</option><option value="NON_TEACHING">Non-teaching</option></select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Name, number or designation" hidden={{ status: sp.status, dept: sp.dept, category: sp.category }} /></div>
      </div>
      <DataGrid
        gridKey="employees"
        columns={columns}
        total={total}
        page={page}
        pageSize={pageSize}
        savedViews={(await db.savedFilter.findMany({ where: { userId: ctx.user.id, scope: "employees" } })).map((v) => ({ id: v.id, name: v.name, query: v.query as Record<string, string> }))}
        empty={<EmptyState icon={Contact} title="No employees" description="No employee records match, or none are in your scope." />}
        rows={rows.map((e) => ({
          id: e.id,
          cells: {
            no: <Link href={`/hr/employees/${e.id}`} className="font-mono text-xs hover:text-primary">{e.employeeNo}</Link>,
            name: <Link href={`/hr/employees/${e.id}`} className="hover:text-primary">{e.firstName} {e.lastName}</Link>,
            designation: <span className="text-xs">{e.designation}</span>,
            dept: <span className="text-xs">{e.department?.code ?? "—"}</span>,
            type: <span className="text-xs">{EMPLOYMENT_TYPE_LABEL[e.employmentType]} · {e.category === "TEACHING" ? "teaching" : "non-teaching"}</span>,
            manager: <span className="text-xs">{e.reportingTo ? `${e.reportingTo.firstName} ${e.reportingTo.lastName}` : "—"}</span>,
            joined: <span className="text-xs">{fmtDate(e.joinDate)}</span>,
            status: <StatusBadge meta={EMPLOYEE_STATUS[e.status]} />,
          },
        }))}
      />
    </div>
  );
}
