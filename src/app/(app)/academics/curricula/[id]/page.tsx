import { notFound } from "next/navigation";
import { CopyPlus, Power, Stamp } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { newCurriculumVersionAction, setCurriculumStatusAction } from "@/features/academic-ops/actions";
import { ActionButton } from "@/features/academic-ops/controls";
import { CurriculumEditor, type CurriculumValue } from "@/features/academic-ops/curriculum-editor";
import { extraRequirementsSchema } from "@/lib/domain/degree-audit";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Curriculum" };

export default async function CurriculumPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ program?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requirePageAuth(["academic.view", "curriculum.manage"]);
  const isNew = id === "new";
  const c = isNew ? null : await db.curriculum.findUnique({ where: { id }, include: { courses: { include: { group: true } }, groups: true, program: { select: { code: true, departmentId: true } } } });
  if (!isNew && !c) notFound();
  const [programs, regulations] = await Promise.all([
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.regulation.findMany({ orderBy: { effectiveFromYear: "desc" } }),
  ]);
  const programId = c?.programId ?? sp.program ?? programs[0]?.id ?? "";
  const program = programs.find((p) => p.id === programId);
  const manage = !!program && can(ctx, "curriculum.manage", program.departmentId);
  if (isNew && !manage) notFound();
  // Courses of the programme first, then everything else (cross-programme electives).
  const courses = await db.course.findMany({ where: { deletedAt: null }, orderBy: [{ code: "asc" }], select: { id: true, code: true, title: true, credits: true, courseType: true, programId: true } });
  courses.sort((a, b) => Number(b.programId === programId) - Number(a.programId === programId));
  const initial: CurriculumValue = c
    ? {
        programId: c.programId, regulationId: c.regulationId, name: c.name, totalCredits: c.totalCredits, minCgpa: c.minCgpa,
        groups: c.groups.map((g) => ({ code: g.code, name: g.name, minCredits: g.minCredits })),
        courses: c.courses.map((x) => ({ courseId: x.courseId, semesterNumber: x.semesterNumber, category: x.category, groupCode: x.group?.code ?? null })).sort((a, b) => a.semesterNumber - b.semesterNumber),
        requirements: extraRequirementsSchema.catch([]).parse(c.requirements ?? []) as CurriculumValue["requirements"],
      }
    : { programId, regulationId: regulations[0]?.id ?? "", name: `${program?.name ?? "Programme"} curriculum`, totalCredits: 120, minCgpa: null, groups: [], courses: [], requirements: [] };
  const readOnly = !manage || (!!c && c.status !== "DRAFT");
  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Curricula", href: "/academics/curricula" }, { label: c ? `${c.name} v${c.version}` : "New" }]}
        title={c ? `${c.name}` : "New curriculum"}
        description={c ? `Version ${c.version} · ${c.status === "DRAFT" ? "Draft — editable" : c.status === "ACTIVE" ? "Active — frozen; create a new version to change it" : "Retired"}` : "Define the courses, elective groups and graduation requirements of a programme."}
        actions={
          c && manage ? (
            <>
              {c.status === "DRAFT" && <ActionButton run={setCurriculumStatusAction.bind(null, c.id, "ACTIVE")} label="Activate" icon={<Stamp />} confirmText="Activate this version? It becomes read-only." />}
              {c.status === "ACTIVE" && <ActionButton run={setCurriculumStatusAction.bind(null, c.id, "RETIRED")} label="Retire" icon={<Power />} confirmText="Retire this version? Batches already using it keep it." />}
              {c.status !== "DRAFT" && <ActionButton run={newCurriculumVersionAction.bind(null, c.id)} label="New version" icon={<CopyPlus />} />}
            </>
          ) : null
        }
      />
      <CurriculumEditor
        id={c?.id ?? null}
        initial={initial}
        readOnly={readOnly}
        courses={courses.map(({ programId: _p, ...x }) => x)}
        programs={programs.map((p) => ({ id: p.id, label: p.code }))}
        regulations={regulations.map((r) => ({ id: r.id, label: r.code }))}
      />
    </div>
  );
}
