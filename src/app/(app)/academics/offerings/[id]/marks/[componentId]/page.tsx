import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { MarksGrid } from "@/features/results/marks-grid";
import { SHEET_STATUS } from "@/lib/domain/labels";
import { requirePageAuth } from "@/server/auth/current";
import { markGrid } from "@/server/services/marks";

export const metadata: Metadata = { title: "Marks" };

export default async function MarksPage({ params }: { params: Promise<{ id: string; componentId: string }> }) {
  const { id, componentId } = await params;
  const ctx = await requirePageAuth(["marks.enter", "marks.verify", "marks.approve", "enrollment.manage"]);
  const g = await markGrid(ctx, componentId).catch(() => null);
  if (!g || g.component.offeringId !== id) notFound();
  const o = g.offering;
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        breadcrumbs={[{ label: "Classes", href: "/academics/offerings" }, { label: `${o.course.code}-${o.section}`, href: `/academics/offerings/${id}?tab=marks` }, { label: g.component.name }]}
        title={<span className="flex flex-wrap items-center gap-3">{g.component.name} <StatusBadge meta={SHEET_STATUS[g.status]} size="md" /></span>}
        description={`${o.course.title} · out of ${g.component.maxMarks}, counts for ${g.component.weight} of ${o.course.internalMarks} internal marks`}
      />
      {g.status === "RETURNED" && <p className="mb-4 rounded-lg border border-tone-warning/40 bg-tone-warning/5 px-4 py-3 text-sm">These marks were returned for correction — see the reason in your approval centre. Correct them and submit again.</p>}
      {(g.status === "SUBMITTED" || g.status === "VERIFIED") && <p className="mb-4 rounded-lg border px-4 py-3 text-sm">Submitted for verification. Marks are read-only while in approval.</p>}
      <MarksGrid
        componentId={componentId}
        max={g.component.maxMarks}
        editable={g.editable}
        revising={g.canRevise}
        rows={g.rows.map((r) => ({ studentId: r.student.id, studentNo: r.student.studentNo, name: `${r.student.firstName} ${r.student.lastName}`, marks: r.marks, status: r.status, revisions: r.revisions }))}
      />
    </div>
  );
}
