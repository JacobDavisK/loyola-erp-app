import Link from "next/link";
import { GraduationCap, Plus, Upload } from "lucide-react";
import type { Metadata } from "next";
import { DataGrid, type GridColumn } from "@/components/app/data-grid";
import { SearchForm } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { STUDENT_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { STUDENT_SORTS, studentFilterWhere, type StudentFilters } from "@/server/services/students";

export const metadata: Metadata = { title: "Students" };

const select = "h-8 rounded-lg border bg-card px-2 text-[13px]";

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("student.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(sp.size) || 25));
  const filters: StudentFilters = { q: sp.q, programId: sp.program, batchId: sp.batch, departmentId: sp.dept, status: sp.status, semester: sp.sem, section: sp.section };
  const where = studentFilterWhere(ctx, filters);
  const sortKey = (sp.sort && sp.sort in STUDENT_SORTS ? sp.sort : "studentNo") as keyof typeof STUDENT_SORTS;
  const scope = scopeOf(ctx, "student.view");
  const deptFilter = scope === null ? {} : { departmentId: { in: scope } };
  const [rows, total, programs, batches, views] = await Promise.all([
    db.student.findMany({
      where,
      orderBy: [...STUDENT_SORTS[sortKey]],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { program: { select: { code: true } }, batch: { select: { code: true } }, department: { select: { code: true } }, _count: { select: { guardians: true } } },
    }),
    db.student.count({ where }),
    db.program.findMany({ where: { deletedAt: null, ...deptFilter }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    db.batch.findMany({ where: { deletedAt: null, ...(sp.program ? { programId: sp.program } : {}), program: deptFilter }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true } }),
    db.savedFilter.findMany({ where: { userId: ctx.user.id, scope: "students" }, orderBy: { createdAt: "asc" } }),
  ]);

  const columns: GridColumn[] = [
    { key: "no", label: "Student no.", sort: "studentNo", pinned: true, className: "whitespace-nowrap" },
    { key: "name", label: "Name", sort: "name", pinned: true },
    { key: "program", label: "Programme" },
    { key: "batch", label: "Batch" },
    { key: "sem", label: "Sem", sort: "semester", className: "text-right" },
    { key: "section", label: "Section" },
    { key: "status", label: "Status" },
    { key: "email", label: "E-mail", hidden: true },
    { key: "phone", label: "Phone", hidden: true },
    { key: "admission", label: "Admission no.", hidden: true },
    { key: "admitted", label: "Admitted", sort: "admitted", hidden: true },
    { key: "dept", label: "Dept", hidden: true },
  ];
  const exportQs = new URLSearchParams(Object.entries({ q: sp.q, program: sp.program, batch: sp.batch, dept: sp.dept, status: sp.status, sem: sp.sem, section: sp.section }).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <div>
      <PageHeader
        title="Students"
        description="Student records in your scope. Filters, sort and paging run on the server, so the list stays fast for any number of students."
        actions={
          can(ctx, "student.create") ? (
            <>
              <Button asChild size="sm" variant="outline"><Link href="/students/import"><Upload /> Import</Link></Button>
              <Button asChild size="sm"><Link href="/students/new"><Plus /> New student</Link></Button>
            </>
          ) : null
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          {sp.sort && <input type="hidden" name="sort" value={sp.sort} />}
          <select name="program" defaultValue={sp.program ?? ""} aria-label="Programme" className={select}>
            <option value="">All programmes</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <select name="batch" defaultValue={sp.batch ?? ""} aria-label="Batch" className={select}>
            <option value="">All batches</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.code}</option>)}
          </select>
          <select name="sem" defaultValue={sp.sem ?? ""} aria-label="Semester" className={select}>
            <option value="">Any semester</option>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Semester {n}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className={select}>
            <option value="">Any status</option>
            {Object.entries(STUDENT_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
          {(sp.program || sp.batch || sp.sem || sp.status || sp.q) && <Link href="/students" className="flex h-8 items-center px-2 text-[13px] text-muted-foreground hover:text-foreground">Reset</Link>}
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Name, number or e-mail" hidden={{ program: sp.program, batch: sp.batch, sem: sp.sem, status: sp.status, sort: sp.sort }} /></div>
      </div>
      <DataGrid
        gridKey="students"
        columns={columns}
        total={total}
        page={page}
        pageSize={pageSize}
        savedViews={views.map((v) => ({ id: v.id, name: v.name, query: v.query as Record<string, string> }))}
        exportHref={can(ctx, "student.export") ? `/api/students/export${exportQs ? `?${exportQs}` : ""}` : undefined}
        empty={<EmptyState icon={GraduationCap} title="No students found" description={total === 0 && !sp.q ? "Create students one by one or import a CSV file." : "Try a different search or filter."} />}
        rows={rows.map((s) => ({
          id: s.id,
          cells: {
            no: <Link href={`/students/${s.id}`} className="font-mono text-xs hover:text-primary">{s.studentNo}</Link>,
            name: <Link href={`/students/${s.id}`} className="font-medium hover:text-primary">{s.firstName} {s.lastName}</Link>,
            program: <span className="text-xs">{s.program.code}</span>,
            batch: <span className="text-xs">{s.batch.code}</span>,
            sem: <span className="tabular">{s.currentSemester}</span>,
            section: <span className="text-xs">{s.section ?? "—"}</span>,
            status: <StatusBadge meta={STUDENT_STATUS[s.status]} />,
            email: <span className="text-xs">{s.email}</span>,
            phone: <span className="text-xs">{s.phone ?? "—"}</span>,
            admission: <span className="font-mono text-xs">{s.admissionNo}</span>,
            admitted: <span className="text-xs whitespace-nowrap">{fmtDate(s.admittedOn)}</span>,
            dept: <span className="text-xs">{s.department.code}</span>,
          },
        }))}
      />
    </div>
  );
}
