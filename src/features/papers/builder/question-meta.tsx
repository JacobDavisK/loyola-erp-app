import type { PaperItemData } from "@/lib/domain/paper-types";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";
import type { QuestionListRow } from "@/server/services/questions";

/** Shared by server and client components (no hooks, no "use client"). */
export function toItem(q: QuestionListRow): PaperItemData {
  const v = q.versions[0];
  return {
    itemId: `new-${q.id}`,
    questionId: q.id,
    questionCode: q.code,
    versionId: v.id,
    version: v.version,
    body: v.body,
    options: (v.options as PaperItemData["options"]) ?? null,
    marks: q.marks,
    type: q.type,
    difficulty: q.difficulty,
    bloom: q.bloom,
    unitNumber: q.unit.number,
    unitTitle: q.unit.title,
    outcomeCode: q.outcome?.code ?? null,
    topic: q.topic?.title ?? null,
  };
}

export const DIFF_DOT: Record<string, string> = { EASY: "bg-tone-success", MODERATE: "bg-tone-warning", HARD: "bg-tone-danger" };

export function QuestionMeta({ item, className }: { item: Pick<PaperItemData, "marks" | "difficulty" | "bloom" | "unitNumber" | "type" | "outcomeCode">; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground", className)}>
      <span className="font-semibold text-foreground tabular">{item.marks} m</span>
      <span className="flex items-center gap-1">
        <span aria-hidden className={cn("size-1.5 rounded-full", DIFF_DOT[item.difficulty])} />
        {DIFFICULTY_LABEL[item.difficulty]}
      </span>
      <span title={BLOOM_LABEL[item.bloom]}>
        {BLOOM_K[item.bloom]} {BLOOM_LABEL[item.bloom]}
      </span>
      <span>Unit {item.unitNumber}</span>
      {item.outcomeCode && <span>{item.outcomeCode}</span>}
      <span className="hidden xl:inline">{QUESTION_TYPE_LABEL[item.type]}</span>
    </div>
  );
}
