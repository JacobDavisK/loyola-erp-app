import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePageAuth, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { blueprintSpec, paperForUser, snapshotOf } from "@/server/services/papers";
import { PaperBuilder } from "@/features/papers/builder/paper-builder";

export const metadata: Metadata = { title: "Paper builder" };

export default async function BuilderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth();
  let access;
  try {
    access = await paperForUser(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const { paper, caps } = access;
  if (!caps.editContent) redirect(`/papers/${id}`);

  const [snapshot, bp, exam, comments] = await Promise.all([
    snapshotOf(id),
    blueprintSpec(paper.blueprintId),
    db.examination.findUniqueOrThrow({
      where: { id: paper.examinationId },
      include: { course: { include: { units: { orderBy: { number: "asc" }, include: { topics: { orderBy: { order: "asc" } } } }, outcomes: true } } },
    }),
    db.moderationComment.findMany({
      where: { paperId: id, resolved: false },
      orderBy: { createdAt: "desc" },
      include: { author: { select: { name: true } } },
    }),
  ]);

  return (
    <PaperBuilder
      paper={{
        id: paper.id,
        code: paper.code,
        status: paper.status,
        revision: paper.revision,
        instructions: paper.instructions,
        courseId: exam.courseId,
      }}
      snapshot={snapshot}
      blueprint={bp}
      units={exam.course.units.map((u) => ({ number: u.number, title: u.title, topics: u.topics.map((t) => ({ id: t.id, title: t.title })) }))}
      outcomes={exam.course.outcomes.map((o) => ({ id: o.id, code: o.code, description: o.description }))}
      canGenerate={can(ctx, "paper.generate")}
      canCreateQuestion={can(ctx, "question.create")}
      comments={comments.map((c) => ({ id: c.id, itemId: c.itemId, kind: c.kind, body: c.body, author: c.author.name, at: c.createdAt.toISOString() }))}
    />
  );
}
