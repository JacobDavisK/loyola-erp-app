import Link from "next/link";
import { notFound } from "next/navigation";
import { History, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { RichContent } from "@/components/app/rich-content";
import { Button } from "@/components/ui/button";
import { QuestionStatusButtons } from "@/features/question-bank/status-buttons";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_STATUS_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import type { QuestionOptionData } from "@/lib/domain/paper-types";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, requirePageAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { getQuestion } from "@/server/services/questions";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Question" };

export default async function QuestionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const { id } = await params;
  const { v } = await searchParams;
  const ctx = await requirePageAuth("question.view");
  let q;
  try {
    q = await getQuestion(ctx, id);
  } catch (e) {
    if (isAppError(e)) notFound();
    throw e;
  }
  const shown = q.versions.find((x) => String(x.version) === v) ?? q.versions[0];
  const canEdit = (q.authorId === ctx.user.id && can(ctx, "question.edit.own")) || can(ctx, "question.edit.any", q.course.departmentId);
  const canRetire = can(ctx, "question.retire", q.course.departmentId) || (q.authorId === ctx.user.id && q.usageCount === 0);
  const canReview = can(ctx, "question.review", q.course.departmentId);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Question bank", href: "/question-bank" }, { label: q.code }]}
        title={<span className="font-mono">{q.code}</span>}
        description={`${q.course.code} — ${q.course.title} · Unit ${q.unit.number}: ${q.unit.title}`}
        actions={
          <>
            <QuestionStatusButtons id={q.id} status={q.status} canRetire={canRetire} canReview={canReview} />
            {canEdit && q.status !== "RETIRED" && (
              <Button asChild size="sm">
                <Link href={`/question-bank/${q.id}/edit`}><Pencil /> Edit</Link>
              </Button>
            )}
          </>
        }
      />
      {q.status !== "ACTIVE" && (
        <div className={cn("rounded-xl border px-4 py-3 text-sm", q.status === "RETIRED" ? "border-tone-danger/30 bg-tone-danger/5" : "border-tone-warning/30 bg-tone-warning/5")}>
          {q.status === "RETIRED"
            ? "Retired — not available for new papers. Historical papers that used it keep their copy."
            : q.status === "PENDING_REVIEW"
              ? "Awaiting review by the department before it can be used in papers."
              : "Draft"}
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Section
            title={`Version ${shown.version}${shown.version === q.currentVersion ? " (current)" : ""}`}
            description={`${shown.createdBy.name} · ${fmtDateTime(shown.createdAt)}${shown.changeNote ? ` · ${shown.changeNote}` : ""}`}
          >
            <div className="rounded-lg bg-white p-5 text-black">
              <RichContent body={shown.body} options={shown.options as QuestionOptionData | null} assetUrl={(a) => signedAssetUrl(a)} className="font-paper text-[16px]" />
            </div>
            {shown.answerKey && (
              <details className="mt-4 rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Answer key (confidential)</summary>
                <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{shown.answerKey}</div>
              </details>
            )}
          </Section>

          <Section title="Usage history" description="Written when a paper is locked. Never deleted." bodyClassName="p-0">
            {q.usages.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Never used in a finalised paper.</p>
            ) : (
              <ul className="divide-y">
                {q.usages.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                    <History className="size-4 text-muted-foreground" />
                    <span className="flex-1">{u.examination.session.name}</span>
                    <Link href={`/papers/${u.paper.id}`} className="font-mono text-xs text-primary hover:underline">{u.paper.code}</Link>
                    <span className="text-xs text-muted-foreground">{fmtDate(u.usedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
        <div className="space-y-6">
          <Section title="Details">
            <KeyValue
              items={[
                ["Status", QUESTION_STATUS_LABEL[q.status]],
                ["Type", QUESTION_TYPE_LABEL[q.type]],
                ["Marks", q.marks],
                ["Difficulty", DIFFICULTY_LABEL[q.difficulty]],
                ["Bloom", `${BLOOM_K[q.bloom]} · ${BLOOM_LABEL[q.bloom]}`],
                ["Topic", q.topic?.title ?? "—"],
                ["Outcome", q.outcome?.code ?? "—"],
                ["Est. time", `${q.estimatedMinutes} min`],
                ["Author", q.author.name],
                ["Created", fmtDate(q.createdAt)],
                ["Modified", fmtDate(q.updatedAt)],
                ["Usage", `${q.usageCount}×${q.lastUsedSessionId ? ` · last ${q.lastUsedSessionId}` : ""}`],
              ]}
            />
            {(q.keywords.length > 0 || q.tags.length > 0) && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {q.tags.map((t) => <span key={t.tagId} className="rounded-full bg-muted px-2 py-0.5 text-xs">#{t.tag.name}</span>)}
                {q.keywords.map((k) => <span key={k} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{k}</span>)}
              </div>
            )}
          </Section>
          <Section title="Versions" bodyClassName="p-0">
            <ul className="divide-y">
              {q.versions.map((x) => (
                <li key={x.id}>
                  <Link
                    href={`/question-bank/${q.id}?v=${x.version}`}
                    aria-current={x.id === shown.id ? "true" : undefined}
                    className={cn("block px-5 py-2.5 text-sm hover:bg-muted/40", x.id === shown.id && "bg-accent")}
                  >
                    <div className="font-medium">
                      v{x.version}
                      {x.version === q.currentVersion && <span className="ml-2 text-xs text-muted-foreground">current</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {x.createdBy.name} · {fmtDate(x.createdAt)}
                      {x.changeNote ? ` · ${x.changeNote}` : ""}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
