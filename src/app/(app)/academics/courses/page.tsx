import Link from "next/link";
import { BookOpen, Plus } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, SearchForm, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { COURSE_TYPE_LABEL } from "@/lib/domain/labels";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Courses" };

export default async function CoursesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("academic.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;
  const filters: Prisma.CourseWhereInput[] = [{ deletedAt: null }];
  if (sp.dept) filters.push({ departmentId: sp.dept });
  if (sp.program) filters.push({ programId: sp.program });
  if (sp.q) filters.push({ OR: [{ code: { contains: sp.q, mode: "insensitive" } }, { title: { contains: sp.q, mode: "insensitive" } }] });
  const where = { AND: filters };
  const [rows, total, depts, programs] = await Promise.all([
    db.course.findMany({
      where,
      orderBy: [{ department: { code: "asc" } }, { code: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { department: { select: { code: true } }, program: { select: { code: true } }, semester: { select: { name: true } }, regulation: { select: { code: true } }, _count: { select: { units: true, questions: { where: { deletedAt: null, status: "ACTIVE" } } } } },
    }),
    db.course.count({ where }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);
  const base = { dept: sp.dept, program: sp.program, q: sp.q };
  return (
    <div>
      <PageHeader
        title="Courses"
        description="Course records with syllabus units, topics and learning outcomes — the backbone of the question bank and blueprints."
        actions={can(ctx, "academic.manage") ? <Button asChild size="sm"><Link href="/academics/courses/new"><Plus /> New course</Link></Button> : null}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <select name="dept" defaultValue={sp.dept ?? ""} aria-label="Department" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
          <select name="program" defaultValue={sp.program ?? ""} aria-label="Programme" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All programmes</option>
            {programs.map((p) => <option key={p.id} value={p.id}>{p.code}</option>)}
          </select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto"><SearchForm defaultValue={sp.q} placeholder="Code or title" hidden={{ dept: sp.dept, program: sp.program }} /></div>
      </div>
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={BookOpen} title="No courses found" /></div>
        ) : (
          <DataTable head={[{ label: "Course" }, { label: "Programme" }, { label: "Semester" }, { label: "Type" }, { label: "Credits", className: "text-right" }, { label: "Marks", className: "text-right" }, { label: "Units", className: "text-right" }, { label: "Questions", className: "text-right" }]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <Td><Link href={`/academics/courses/${c.id}`} className="font-medium hover:text-primary"><span className="font-mono text-xs text-muted-foreground">{c.code}</span> {c.title}</Link><div className="text-[11px] text-muted-foreground">{c.department.code} · {c.regulation.code}</div></Td>
                <Td className="text-xs">{c.program.code}</Td>
                <Td className="text-xs whitespace-nowrap">{c.semester.name}</Td>
                <Td className="text-xs">{COURSE_TYPE_LABEL[c.courseType]}{c.mode !== "THEORY" ? ` · ${c.mode === "PRACTICAL" ? "Practical" : "T+P"}` : ""}</Td>
                <Td className="text-right tabular">{c.credits}</Td>
                <Td className="text-right text-xs tabular">{c.internalMarks}+{c.externalMarks}</Td>
                <Td className="text-right tabular">{c._count.units}</Td>
                <Td className="text-right tabular">{can(ctx, "question.view") ? <Link href={`/question-bank?courseId=${c.id}`} className="hover:text-primary">{c._count.questions}</Link> : c._count.questions}</Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/academics/courses${qs(base, { page: p })}`} />
      </div>
    </div>
  );
}
