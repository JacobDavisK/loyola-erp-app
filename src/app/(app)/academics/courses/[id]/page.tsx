import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { CourseForm, type CourseFormValue } from "@/features/academics/course-form";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Course" };

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("academic.view");
  const manage = can(ctx, "academic.manage");
  const [departments, programs, semesters, regulations] = await Promise.all([
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.semester.findMany({ orderBy: { number: "asc" } }),
    db.regulation.findMany({ orderBy: { effectiveFromYear: "desc" } }),
  ]);
  const opts = {
    departments: departments.map((d) => ({ id: d.id, label: `${d.code} — ${d.name}` })),
    programs: programs.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}`, departmentId: p.departmentId })),
    semesters: semesters.map((s) => ({ id: s.id, label: s.name })),
    regulations: regulations.map((r) => ({ id: r.id, label: `${r.code} — ${r.name}` })),
  };

  if (id === "new") {
    if (!manage) notFound();
    const blank: CourseFormValue = {
      code: "", title: "", credits: 4, departmentId: "", programId: "", semesterId: "", regulationId: regulations[0]?.id ?? "",
      courseType: "CORE", mode: "THEORY", maxMarks: 100, internalMarks: 25, externalMarks: 75, durationMinutes: 180, syllabus: "",
      units: [1, 2, 3, 4, 5].map((n) => ({ number: n, title: "", hours: 12, topics: [] })),
      outcomes: [1, 2, 3, 4, 5].map((n) => ({ code: `CO${n}`, description: "", bloom: "" as const })),
    };
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Courses", href: "/academics/courses" }, { label: "New" }]} title="New course" />
        <CourseForm id={null} initial={blank} readOnly={false} {...opts} />
      </div>
    );
  }

  const c = await db.course.findFirst({
    where: { id, deletedAt: null },
    include: { units: { orderBy: { number: "asc" }, include: { topics: { orderBy: { order: "asc" } } } }, outcomes: { orderBy: { code: "asc" } } },
  });
  if (!c) notFound();
  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Courses", href: "/academics/courses" }, { label: c.code }]} title={`${c.code} — ${c.title}`} description={manage ? "Units and outcomes already used by questions are updated in place, never deleted." : "Read-only for your role."} />
      <CourseForm
        id={c.id}
        readOnly={!manage}
        {...opts}
        initial={{
          code: c.code, title: c.title, credits: c.credits, departmentId: c.departmentId, programId: c.programId, semesterId: c.semesterId, regulationId: c.regulationId,
          courseType: c.courseType, mode: c.mode, maxMarks: c.maxMarks, internalMarks: c.internalMarks, externalMarks: c.externalMarks, durationMinutes: c.durationMinutes, syllabus: c.syllabus ?? "",
          units: c.units.map((u) => ({ id: u.id, number: u.number, title: u.title, hours: u.hours, topics: u.topics.map((t) => t.title) })),
          outcomes: c.outcomes.map((o) => ({ id: o.id, code: o.code, description: o.description, bloom: o.bloom ?? "" })),
        }}
      />
    </div>
  );
}
