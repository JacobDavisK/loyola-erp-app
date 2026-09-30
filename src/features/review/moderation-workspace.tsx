"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, MessageSquarePlus, Play, Replace } from "lucide-react";
import { toast } from "sonner";
import { RichContent } from "@/components/app/rich-content";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addCommentAction, transitionPaperAction } from "@/features/papers/actions";
import { QuestionMeta } from "@/features/papers/builder/question-meta";
import { CheckRow, Distribution } from "@/features/papers/builder/blueprint-panel";
import type { PaperStatus } from "@/generated/prisma/enums";
import type { BlueprintReport } from "@/lib/domain/blueprint";
import type { PaperSnapshot } from "@/lib/domain/paper-types";
import { cn } from "@/lib/utils";
import type { DuplicateFinding } from "@/server/services/papers";
import { ReplaceDialog } from "./replace-dialog";

const MANUAL_CHECKS = [
  { key: "relevance", label: "Question relevance", hint: "Every question is within the prescribed syllabus" },
  { key: "ambiguity", label: "No ambiguity", hint: "Wording admits a single interpretation" },
  { key: "grammar", label: "Language & grammar", hint: "Clear, correct English" },
  { key: "formatting", label: "Formatting", hint: "Numbering, symbols and tables are correct" },
  { key: "outcomes", label: "Learning outcomes", hint: "Questions map to stated course outcomes" },
  { key: "difficulty", label: "Difficulty appropriate", hint: "Suitable for the semester and programme" },
] as const;

export function ModerationWorkspace({
  paperId,
  courseId,
  status,
  canModerate,
  current,
  submitted,
  submittedLabel,
  report,
  duplicates,
  commentsByItem,
}: {
  paperId: string;
  courseId: string;
  status: PaperStatus;
  canModerate: boolean;
  current: PaperSnapshot;
  submitted: PaperSnapshot | null;
  submittedLabel: string | null;
  report: BlueprintReport | null;
  duplicates: DuplicateFinding[];
  commentsByItem: Record<string, { author: string; body: string; kind: string }[]>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [summary, setSummary] = useState("");
  const [replaceTarget, setReplaceTarget] = useState<{ itemId: string; code: string; marks: number; unitNumber: number } | null>(null);
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentKind, setCommentKind] = useState("ISSUE");
  const inReview = status === "UNDER_MODERATION";
  const editable = canModerate && inReview;

  const items = current.sections.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));
  const currentIds = new Set(items.map((i) => i.questionId));
  const dupByQ = useMemo(() => {
    const m = new Map<string, DuplicateFinding[]>();
    for (const d of duplicates) m.set(d.itemQuestionId, [...(m.get(d.itemQuestionId) ?? []), d]);
    return m;
  }, [duplicates]);
  const unitsCovered = new Set(items.map((i) => i.unitNumber));
  const allChecked = MANUAL_CHECKS.every((c) => checklist[c.key]);

  const decide = (action: "moderation_approve" | "moderation_request_changes" | "moderation_reject") =>
    start(async () => {
      const list = Object.fromEntries(MANUAL_CHECKS.map((c) => [c.key, { ok: !!checklist[c.key] }]));
      const res = await transitionPaperAction(paperId, action, summary.trim() || undefined, list);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(action === "moderation_approve" ? "Moderation approved — sent for scrutiny" : action === "moderation_reject" ? "Paper rejected" : "Returned to setter for modification");
      router.push("/moderation");
    });

  let n = 0;
  return (
    <div className="grid min-h-0 gap-5 xl:grid-cols-[260px_1fr_320px]">
      {/* LEFT: original (as-submitted) paper */}
      <aside className="surface-card hidden h-fit max-h-[calc(100vh-9rem)] overflow-y-auto xl:sticky xl:top-20 xl:block" aria-label="Original paper">
        <div className="border-b px-4 py-3">
          <div className="text-[13px] font-semibold">Original paper</div>
          <div className="text-xs text-muted-foreground">{submittedLabel ? `As submitted · v${submittedLabel}` : "No submitted version"}</div>
        </div>
        <ol className="divide-y text-[12.5px]">
          {(submitted?.sections ?? []).flatMap((s) =>
            s.items.map((i, idx) => {
              const replaced = !currentIds.has(i.questionId);
              return (
                <li key={i.itemId} className={cn("px-4 py-2", replaced && "bg-tone-danger/5")}>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>§{s.label} · {idx + 1} · {i.questionCode}</span>
                    {replaced && <span className="font-semibold text-tone-danger">Replaced</span>}
                  </div>
                  <div className={cn("line-clamp-2", replaced && "line-through opacity-70")}>{i.body.replace(/[$*`|]/g, "")}</div>
                </li>
              );
            }),
          )}
        </ol>
      </aside>

      {/* CENTER: question-by-question review */}
      <div className="min-w-0 space-y-4">
        {!inReview && canModerate && (status === "SUBMITTED" || status === "RESUBMITTED") && (
          <div className="surface-card flex flex-wrap items-center gap-3 p-4">
            <div className="flex-1 text-sm">
              <div className="font-semibold">Ready for moderation</div>
              <div className="text-muted-foreground">Start the review to record comments, replace questions and reach a decision.</div>
            </div>
            <Button
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await transitionPaperAction(paperId, "start_moderation");
                  if (!res.ok) {
                    toast.error(res.error);
                    return;
                  }
                  router.refresh();
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : <Play />} Start moderation
            </Button>
          </div>
        )}
        {current.sections.map((s) => (
          <section key={s.id} className="surface-card overflow-hidden" aria-label={`Section ${s.label}`}>
            <div className="border-b bg-surface/50 px-5 py-2.5 text-sm">
              <b>Section {s.label}</b> <span className="text-muted-foreground">· {s.title}</span>
            </div>
            <ol className="divide-y">
              {s.items.map((it) => {
                n++;
                const dups = dupByQ.get(it.questionId) ?? [];
                const notes = commentsByItem[it.itemId] ?? [];
                return (
                  <li key={it.itemId} className="px-5 py-4">
                    <div className="flex gap-3">
                      <span className="w-8 shrink-0 text-sm font-semibold tabular">Q{n}.</span>
                      <div className="min-w-0 flex-1">
                        <RichContent body={it.body} options={it.options} className="font-paper text-[15px]" />
                        <div className="mt-2 flex flex-wrap items-center gap-3">
                          <QuestionMeta item={it} />
                          <span className="font-mono text-[10.5px] text-muted-foreground/70">{it.questionCode} v{it.version}</span>
                          {it.topic && <span className="text-[11px] text-muted-foreground">Topic: {it.topic}</span>}
                        </div>
                        {dups.slice(0, 2).map((d) => (
                          <div key={d.otherQuestionId + d.scope} className="mt-3 rounded-lg border border-tone-warning/30 bg-tone-warning/5 p-3 text-xs">
                            <div className="flex flex-wrap items-center gap-2 font-semibold text-tone-warning">
                              <Copy className="size-3.5" />
                              {d.scope === "in-paper" ? "Similar to another question in this paper" : d.kind === "previously-used" ? "Previously used question" : "Potential duplicate of a previously used question"}
                              <span className="rounded bg-tone-warning/15 px-1.5 tabular">Similarity {Math.round(d.similarity * 100)}%</span>
                            </div>
                            {d.otherQuestionId !== it.questionId && (
                              <div className="mt-1.5 text-foreground/80"><span className="font-mono text-muted-foreground">{d.otherCode}</span> — {d.otherText.slice(0, 180)}</div>
                            )}
                            {d.usedIn.length > 0 && <div className="mt-1 text-muted-foreground">Used in: {d.usedIn.join(", ")}</div>}
                          </div>
                        ))}
                        {notes.map((c, i) => (
                          <div key={i} className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs"><b>{c.author}</b> · {c.kind.toLowerCase().replace("_", " ")}: {c.body}</div>
                        ))}
                        {commentFor === it.itemId && (
                          <form
                            className="mt-3 space-y-2"
                            onSubmit={(e) => {
                              e.preventDefault();
                              start(async () => {
                                const res = await addCommentAction(paperId, { itemId: it.itemId, kind: commentKind, body: commentText });
                                if (!res.ok) {
                                  toast.error(res.error);
                                  return;
                                }
                                setCommentFor(null);
                                setCommentText("");
                                router.refresh();
                              });
                            }}
                          >
                            <Textarea autoFocus rows={2} value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder={`Remark on Q${n}…`} aria-label={`Remark on question ${n}`} />
                            <div className="flex gap-2">
                              <select value={commentKind} onChange={(e) => setCommentKind(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs" aria-label="Remark type">
                                <option value="ISSUE">Issue</option>
                                <option value="COMMENT">Comment</option>
                                <option value="SUGGEST_REPLACEMENT">Suggest replacement</option>
                              </select>
                              <Button size="sm" type="submit" disabled={pending || commentText.trim().length < 2}>Add remark</Button>
                              <Button size="sm" type="button" variant="ghost" onClick={() => setCommentFor(null)}>Cancel</Button>
                            </div>
                          </form>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-sm font-semibold tabular">[{it.marks}]</span>
                        {editable && (
                          <>
                            <Button size="xs" variant="ghost" onClick={() => { setCommentFor(it.itemId); setCommentText(""); }}><MessageSquarePlus /> Remark</Button>
                            <Button size="xs" variant="ghost" onClick={() => setReplaceTarget({ itemId: it.itemId, code: it.questionCode, marks: it.marks, unitNumber: it.unitNumber })}><Replace /> Replace</Button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {/* RIGHT: validation & decision */}
      <aside className="space-y-4 xl:sticky xl:top-20 xl:h-fit" aria-label="Validation">
        <section className="surface-card p-4">
          <h2 className="mb-2 text-[13px] font-semibold">Automatic checks</h2>
          <ul>
            {report?.checks.map((c) => <CheckRow key={c.key} status={c.status} label={c.label} detail={c.detail} />)}
            <CheckRow status={unitsCovered.size >= 5 ? "pass" : "warn"} label="Syllabus coverage" detail={`Units covered: ${[...unitsCovered].sort().join(", ")}`} />
            <CheckRow status={duplicates.length ? "warn" : "pass"} label="Duplication" detail={duplicates.length ? `${duplicates.length} potential duplicate(s) or reused question(s)` : "No duplicates or reuse detected"} />
          </ul>
          {report && (
            <div className="mt-4 space-y-4 border-t pt-4">
              <Distribution title="Difficulty" dim="DIFFICULTY" rows={report.distributions.DIFFICULTY} />
              <Distribution title="Bloom's taxonomy" dim="BLOOM" rows={report.distributions.BLOOM} />
            </div>
          )}
        </section>

        {canModerate && (
          <section className="surface-card p-4">
            <h2 className="mb-1 text-[13px] font-semibold">Moderator&apos;s checklist</h2>
            <p className="mb-3 text-xs text-muted-foreground">Recorded with your decision.</p>
            <ul className="space-y-2.5">
              {MANUAL_CHECKS.map((c) => (
                <li key={c.key}>
                  <label className="flex items-start gap-2.5 text-sm">
                    <Checkbox className="mt-0.5" disabled={!inReview} checked={!!checklist[c.key]} onCheckedChange={(v) => setChecklist((x) => ({ ...x, [c.key]: v === true }))} />
                    <span>
                      {c.label}
                      <span className="block text-xs text-muted-foreground">{c.hint}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1.5">
              <Label htmlFor="mod-summary">Moderation remarks</Label>
              <Textarea id="mod-summary" rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} disabled={!inReview} placeholder="Overall assessment. Required when requesting changes or rejecting." />
            </div>
            <div className="mt-4 grid gap-2">
              <Button disabled={!inReview || pending || !allChecked} onClick={() => decide("moderation_approve")}>
                {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve & send to scrutiny
              </Button>
              {!allChecked && inReview && <p className="text-xs text-muted-foreground">Complete the checklist to approve.</p>}
              <Button variant="outline" disabled={!inReview || pending || !summary.trim()} onClick={() => decide("moderation_request_changes")}>
                <AlertTriangle /> Request modification
              </Button>
              <Button variant="destructive" disabled={!inReview || pending || !summary.trim()} onClick={() => { if (confirm("Reject this paper? The Controller and setter will be notified.")) decide("moderation_reject"); }}>
                Reject paper
              </Button>
            </div>
          </section>
        )}
      </aside>

      <ReplaceDialog
        key={replaceTarget?.itemId ?? "closed"}
        open={!!replaceTarget}
        onOpenChange={(o) => !o && setReplaceTarget(null)}
        paperId={paperId}
        courseId={courseId}
        target={replaceTarget}
        excludeIds={[...currentIds]}
        onDone={() => router.refresh()}
      />
    </div>
  );
}
