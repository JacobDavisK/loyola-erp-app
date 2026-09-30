import Link from "next/link";
import { School } from "lucide-react";
import type { Metadata } from "next";
import { DataGrid, type GridColumn } from "@/components/app/data-grid";
import { SearchForm } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { saveOfferingAction } from "@/features/academic-ops/actions";
import { OFFERING_STATUS } from "@/lib/domain/labels";
import type { Prisma } from "@/generated/prisma/client";
import { offeringWhere } from "@/server/auth/access";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";

export const metadata: Metadata = { title: "Classes" };

export default async function OfferingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth(["academic.view", "enrollment.manage"]);
  const sp = await searchParams;
  const term = sp.term ? await db.academicTerm.findUnique({ where: { id: sp.term } }) : await currentTerm();
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const and: Prisma.CourseOfferingWhereInput[] = [offeringWhere(ctx)];
  if (term) and.push({ termId: term.id });
  if (sp.dept) and.push({ course: { departmentId: sp.dept } });
  if (sp.status && sp.status in OFFERING_STATUS) and.push({ status: sp.status as keyof typeof OFFERING_STATUS });
  if (sp.q) and.push({ OR: [{ course: { code: { contains: sp.q, mode: "insensitive" } } }, { course: { title: { contains: sp.q, mode: "insensitive" } } }] });
  const where = { AND: and };
  const manageScope = scopeOf(ctx, "enrollment.manage");
  const courseScope = manageScope === null ? {} : { departmentId: { in: manageScope } };
  const sort = sp.sort === "-code" ? [{ course: { code: "desc" as const } }, { section: "asc" as const }] : sp.sort === "reg" ? [{ registrations: { _count: "asc" as const } }] : sp.sort === "-reg" ? [{ registrations: { _count: "desc" as const } }] : [{ course: { code: "asc" as const } }, { section: "asc" as const }];
  const [rows, total, terms, depts, courses, batches] = await Promise.all([
    db.courseOffering.findMany({
      where, orderBy: sort, skip: (page - 1) * pageSize, take: pageSize,
      include: { course: { select: { code: true, title: true, credits: true, department: { select: { code: true } } } }, batch: { select: { code: true } }, instructors: { include: { user: { select: { name: true } } }, orderBy: { isPrimary: "desc" } }, _count: { select: { registrations: { where: { status: "REGISTERED" } }, slots: true, meetings: true } } },
    }),
    db.courseOffering.count({ where }),
    db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 12 }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    can(ctx, "enrollment.manage") ? db.course.findMany({ where: { deletedAt: null, ...courseScope }, orderBy: { code: "asc" }, select: { id: true, code: true, title: true } }) : [],
    can(ctx, "enrollment.manage") ? db.batch.findMany({ where: { deletedAt: null }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }], select: { id: true, code: true } }) : [],
  ]);
  const fields: FormField[] = [
    { name: "courseId", label: "Course", type: "select", options: courses.map((c) => ({ value: c.id, label: `${c.code} — ${c.title}` })), wide: true },
    { name: "termId", label: "Term", type: "select", options: terms.map((t) => ({ value: t.id, label: t.name })) },
    { name: "section", label: "Section", type: "text", upper: true },
    { name: "batchId", label: "Reserved for batch", type: "select", optional: true, options: batches.map((b) => ({ value: b.id, label: b.code })), hint: "Leave empty for an open class (e.g. an elective)" },
    { name: "capacity", label: "Capacity", type: "number", min: 1 },
    { name: "status", label: "Status", type: "select", options: Object.entries(OFFERING_STATUS).map(([value, m]) => ({ value, label: m.label })) },
    { name: "notes", label: "Notes", type: "textarea", optional: true },
  ];
  const columns: GridColumn[] = [
    { key: "course", label: "Class", sort: "code", pinned: true },
    { key: "batch", label: "Batch" },
    { key: "instructors", label: "Instructors" },
    { key: "reg", label: "Registered", sort: "reg", className: "text-right" },
    { key: "timetable", label: "Timetable", className: "text-right" },
    { key: "status", label: "Status" },
    { key: "dept", label: "Dept", hidden: true },
    { key: "credits", label: "Credits", hidden: true, className: "text-right" },
  ];
  return (
    <div>
      <PageHeader
        title="Classes"
        description={term ? `Course offerings in ${term.name}: sections, instructors, timetable and registrations.` : "No current term is set. Create one under Terms & calendar."}
        actions={can(ctx, "enrollment.manage") && courses.length > 0 && terms.length > 0 ? <FormDialog title="Class" fields={fields} columns={2} action={saveOfferingAction} initial={{ termId: term?.id ?? terms[0].id, section: "A", capacity: 60, status: "PLANNED" }} trigger={<Button size="sm">New class</Button>} /> : null}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          <select name="term" defaultValue={term?.id ?? ""} aria-label="Term" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select name="dept" defaultValue={sp.dept ?? ""} aria-label="Department" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
          <select name="status" defaultValue={sp.status ?? ""} aria-label="Status" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">Any status</option>
            {Object.entries(OFFERING_STATUS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Course code or title" hidden={{ term: sp.term, dept: sp.dept, status: sp.status }} /></div>
      </div>
      <DataGrid
        gridKey="offerings"
        columns={columns}
        total={total}
        page={page}
        pageSize={pageSize}
        empty={<EmptyState icon={School} title="No classes" description="Create a class for each course and section taught this term." />}
        rows={rows.map((o) => ({
          id: o.id,
          cells: {
            course: <Link href={`/academics/offerings/${o.id}`} className="hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{o.course.code}-{o.section}</span> <span className="font-medium">{o.course.title}</span></Link>,
            batch: <span className="text-xs">{o.batch?.code ?? "Open"}</span>,
            instructors: <span className="text-xs">{o.instructors.map((i) => i.user.name).join(", ") || <span className="text-tone-warning">Unassigned</span>}</span>,
            reg: <span className="tabular">{o._count.registrations} / {o.capacity}</span>,
            timetable: <span className="text-xs tabular">{o._count.slots} slot(s) · {o._count.meetings} sessions</span>,
            status: <StatusBadge meta={OFFERING_STATUS[o.status]} />,
            dept: <span className="text-xs">{o.course.department.code}</span>,
            credits: <span className="tabular">{o.course.credits}</span>,
          },
        }))}
      />
    </div>
  );
}
