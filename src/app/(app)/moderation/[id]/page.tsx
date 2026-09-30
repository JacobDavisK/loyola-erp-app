import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ModerationWorkspace } from "@/features/review/moderation-workspace";
import { PAPER_STATUS } from "@/lib/domain/labels";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { paperDetail } from "@/server/services/paper-view";
import { paperDuplicates } from "@/server/services/papers";

export const metadata: Metadata = { title: "Moderation" };

export default async function ModerationWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("moderation.perform");
  let d;
  try {
    d = await paperDetail(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  if (!d.caps.moderate) notFound();
  const [duplicates, latest] = await Promise.all([
    paperDuplicates(ctx, id),
    db.questionPaperVersion.findFirst({ where: { paperId: id }, orderBy: [{ major: "desc" }, { minor: "desc" }] }),
  ]);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "paper.access", resourceType: "paper", resourceId: id, summary: `${d.paper.code} opened in moderation workspace` });

  const commentsByItem: Record<string, { author: string; body: string; kind: string }[]> = {};
  for (const c of d.paper.comments) {
    if (!c.itemId || c.resolved) continue;
    (commentsByItem[c.itemId] ??= []).push({ author: c.author.name, body: c.body, kind: c.kind });
  }
  const exam = d.paper.examination;

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Moderation", href: "/moderation" }, { label: d.paper.code }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {exam.course.code} — {exam.course.title}
            <StatusBadge meta={PAPER_STATUS[d.paper.status]} size="md" />
          </span>
        }
        description={`${exam.session.name} · ${exam.course.program.name} · ${exam.course.semester.name} · Version ${d.versionLabel} · Round ${d.paper.moderations[0]?.round ?? 1}`}
      />
      <ModerationWorkspace
        paperId={id}
        courseId={exam.courseId}
        status={d.paper.status}
        canModerate={d.caps.moderate}
        current={d.snapshot}
        submitted={(latest?.snapshot as unknown as PaperSnapshot) ?? null}
        submittedLabel={latest?.label ?? null}
        report={d.report}
        duplicates={duplicates}
        commentsByItem={commentsByItem}
      />
    </div>
  );
}
