import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { BlueprintEditor, type EditorValue } from "@/features/blueprints/blueprint-editor";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Blueprint" };

const EMPTY: EditorValue = {
  name: "",
  description: "",
  courseId: "",
  isPattern: true,
  durationMinutes: 180,
  sections: [
    { label: "A", title: "Answer ALL questions", instructions: "Answer ALL questions. Each question carries 2 marks.", questionCount: 10, attemptCount: 10, marksPerQuestion: 2, questionTypes: [], units: [1, 2, 3, 4, 5] },
    { label: "B", title: "Answer any FIVE questions", instructions: "Answer any FIVE questions. Each question carries 5 marks.", questionCount: 7, attemptCount: 5, marksPerQuestion: 5, questionTypes: [], units: [1, 2, 3, 4, 5] },
    { label: "C", title: "Answer any THREE questions", instructions: "Answer any THREE questions. Each question carries 10 marks.", questionCount: 5, attemptCount: 3, marksPerQuestion: 10, questionTypes: [], units: [1, 2, 3, 4, 5] },
  ],
  rules: [
    { dimension: "DIFFICULTY", key: "EASY", targetPercent: 30, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "MODERATE", targetPercent: 50, tolerance: 8 },
    { dimension: "DIFFICULTY", key: "HARD", targetPercent: 20, tolerance: 8 },
  ],
};

export default async function BlueprintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("blueprint.view");
  const manage = can(ctx, "blueprint.manage");
  const courses = await db.course.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true, title: true } });
  const courseOpts = courses.map((c) => ({ id: c.id, label: `${c.code} — ${c.title}` }));

  if (id === "new") {
    if (!manage) notFound();
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Blueprints", href: "/blueprints" }, { label: "New" }]} title="New blueprint" description="Starts from the standard 75-mark LOCF structure — adjust sections and distributions as required." />
        <BlueprintEditor id={null} initial={EMPTY} courses={courseOpts} readOnly={false} />
      </div>
    );
  }

  const bp = await db.blueprint.findFirst({ where: { id, deletedAt: null }, include: { sections: { orderBy: { order: "asc" } }, rules: true } });
  if (!bp) notFound();
  const inReview = await db.questionPaper.count({ where: { blueprintId: id, deletedAt: null, status: { notIn: ["DRAFT"] } } });
  const readOnly = !manage || inReview > 0;

  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Blueprints", href: "/blueprints" }, { label: bp.name }]} title={bp.name} description={`${bp.totalMarks} marks · governs every paper that references it`} />
      <BlueprintEditor
        id={bp.id}
        readOnly={readOnly}
        lockedReason={manage && inReview ? `This blueprint governs ${inReview} submitted or finalised paper(s), so it is read-only. Duplicate it to make changes.` : undefined}
        courses={courseOpts}
        initial={{
          name: bp.name,
          description: bp.description ?? "",
          courseId: bp.courseId ?? "",
          isPattern: bp.isPattern,
          durationMinutes: bp.durationMinutes,
          sections: bp.sections.map((s) => ({ label: s.label, title: s.title, instructions: s.instructions ?? "", questionCount: s.questionCount, attemptCount: s.attemptCount, marksPerQuestion: s.marksPerQuestion, questionTypes: s.questionTypes, units: s.units })),
          rules: bp.rules.map((r) => ({ dimension: r.dimension, key: r.key, targetPercent: r.targetPercent, tolerance: r.tolerance })),
        }}
      />
    </div>
  );
}
