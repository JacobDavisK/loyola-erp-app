"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Controller, useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Braces, Code2, Copy, ImagePlus, Loader2, Plus, Sigma, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { RichContent } from "@/components/app/rich-content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assetUrlsAction, createQuestionAction, similarToAction, updateQuestionAction, uploadQuestionImageAction } from "@/features/question-bank/actions";
import { BloomLevel, Difficulty, QuestionType } from "@/generated/prisma/enums";
import { collectAssets } from "@/lib/content/parse";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

export interface CourseOption {
  id: string;
  code: string;
  title: string;
  units: { id: string; number: number; title: string; topics: { id: string; title: string }[] }[];
  outcomes: { id: string; code: string; description: string }[];
}

const schema = z.object({
  courseId: z.string().min(1, "Choose a course"),
  unitId: z.string().min(1, "Choose a unit"),
  topicId: z.string(),
  outcomeId: z.string(),
  type: z.enum(QuestionType),
  bloom: z.enum(BloomLevel),
  difficulty: z.enum(Difficulty),
  marks: z.number({ message: "Enter marks" }).int().min(1).max(100),
  estimatedMinutes: z.number({ message: "Enter minutes" }).int().min(1).max(240),
  body: z.string().trim().min(5, "Question text is too short"),
  choices: z.array(z.object({ text: z.string(), correct: z.boolean() })),
  pairs: z.array(z.object({ left: z.string(), right: z.string() })),
  answerKey: z.string(),
  keywords: z.string(),
  tags: z.string(),
  changeNote: z.string(),
});
type Values = z.infer<typeof schema>;

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive";

function Err({ msg }: { msg?: string }) {
  return msg ? <p className="text-xs text-destructive">{msg}</p> : null;
}

export function QuestionForm({
  courses,
  initial,
  questionId,
  returnTo,
}: {
  courses: CourseOption[];
  initial?: Partial<Values>;
  questionId?: string;
  returnTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [assetUrls, setAssetUrls] = useState<Record<string, string>>({});
  const [similar, setSimilar] = useState<{ id: string; code: string; text: string; similarity: number; kind: string; usedIn: string[] }[]>([]);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      courseId: courses.length === 1 ? courses[0].id : "",
      unitId: "",
      topicId: "",
      outcomeId: "",
      type: "SHORT",
      bloom: "UNDERSTAND",
      difficulty: "MODERATE",
      marks: 5,
      estimatedMinutes: 9,
      body: "",
      choices: [],
      pairs: [],
      answerKey: "",
      keywords: "",
      tags: "",
      changeNote: "",
      ...initial,
    },
  });
  const choices = useFieldArray({ control: form.control, name: "choices" });
  const pairs = useFieldArray({ control: form.control, name: "pairs" });
  const [courseId, unitId, type, body] = form.watch(["courseId", "unitId", "type", "body"]);
  const course = courses.find((c) => c.id === courseId);
  const unit = course?.units.find((u) => u.id === unitId);
  const errs = form.formState.errors;

  // Resolve signed URLs for images referenced in the text (preview)
  const assetIds = useMemo(() => collectAssets(body ?? ""), [body]);
  useEffect(() => {
    const missing = assetIds.filter((id) => !assetUrls[id]);
    if (!missing.length) return;
    void assetUrlsAction(missing).then((r) => r.ok && setAssetUrls((m) => ({ ...m, ...r.data })));
  }, [assetIds, assetUrls]);

  // Live near-duplicate detection
  useEffect(() => {
    if (!courseId || (body ?? "").trim().length < 15) {
      setSimilar([]);
      return;
    }
    const t = setTimeout(async () => {
      const res = await similarToAction(courseId, body, questionId);
      if (res.ok) setSimilar(res.data);
    }, 600);
    return () => clearTimeout(t);
  }, [courseId, body, questionId]);

  useEffect(() => {
    if ((type === "MCQ" || type === "ASSERTION_REASON") && choices.fields.length === 0) {
      choices.replace([{ text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }, { text: "", correct: false }]);
    }
    if (type === "MATCH" && pairs.fields.length === 0) pairs.replace([{ left: "", right: "" }, { left: "", right: "" }, { left: "", right: "" }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  const insert = (snippet: string) => {
    const el = bodyRef.current;
    const cur = form.getValues("body") ?? "";
    const pos = el?.selectionStart ?? cur.length;
    const next = cur.slice(0, pos) + snippet + cur.slice(el?.selectionEnd ?? pos);
    form.setValue("body", next, { shouldDirty: true, shouldValidate: false });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + snippet.length, pos + snippet.length);
    });
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadQuestionImageAction(fd);
    setUploading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setAssetUrls((m) => ({ ...m, [res.data.id]: res.data.url }));
    insert(`\n![${res.data.name.replace(/\.[a-z]+$/i, "")}](asset:${res.data.id})\n`);
  };

  const onSubmit = form.handleSubmit((v) =>
    start(async () => {
      const payload = {
        courseId: v.courseId,
        unitId: v.unitId,
        topicId: v.topicId || null,
        outcomeId: v.outcomeId || null,
        type: v.type,
        bloom: v.bloom,
        difficulty: v.difficulty,
        marks: v.marks,
        estimatedMinutes: v.estimatedMinutes,
        body: v.body,
        options:
          v.type === "MCQ" || v.type === "ASSERTION_REASON"
            ? { choices: v.choices.filter((c) => c.text.trim()).map((c, i) => ({ label: String.fromCharCode(97 + i), text: c.text.trim(), correct: c.correct })) }
            : v.type === "MATCH"
              ? { pairs: v.pairs.filter((p) => p.left.trim() && p.right.trim()) }
              : null,
        answerKey: v.answerKey.trim() || null,
        keywords: v.keywords.split(",").map((s) => s.trim()).filter(Boolean),
        tags: v.tags.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean),
        changeNote: v.changeNote.trim() || undefined,
      };
      const res = questionId ? await updateQuestionAction(questionId, payload) : await createQuestionAction(payload);
      if (!res.ok) {
        if (res.fieldErrors) for (const [k, m] of Object.entries(res.fieldErrors)) form.setError((k === "options" ? "body" : k) as keyof Values, { message: m[0] });
        toast.error(res.error);
        return;
      }
      if (questionId) {
        toast.success("Saved as a new version. Papers already using the previous version are unaffected.");
        router.push(`/question-bank/${questionId}`);
      } else {
        const created = res.data as { id: string; code: string; status: string };
        toast.success(`${created.code} created${created.status === "PENDING_REVIEW" ? " — sent for review before it can be used" : ""}`);
        router.push(returnTo ?? `/question-bank/${created.id}`);
      }
      router.refresh();
    }),
  );

  return (
    <form onSubmit={onSubmit} className="grid gap-6 xl:grid-cols-[1fr_420px]" noValidate>
      <div className="space-y-5">
        <section className="surface-card space-y-4 p-5">
          <h2 className="text-sm font-semibold">Classification</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="courseId">Course</Label>
              <select id="courseId" className={field} {...form.register("courseId", { onChange: () => { form.setValue("unitId", ""); form.setValue("topicId", ""); form.setValue("outcomeId", ""); } })} disabled={!!questionId} aria-invalid={!!errs.courseId}>
                <option value="">Select course…</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
              </select>
              <Err msg={errs.courseId?.message} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="unitId">Unit</Label>
                <select id="unitId" className={field} {...form.register("unitId", { onChange: () => form.setValue("topicId", "") })} aria-invalid={!!errs.unitId}>
                  <option value="">Select…</option>
                  {course?.units.map((u) => <option key={u.id} value={u.id}>Unit {u.number} — {u.title}</option>)}
                </select>
                <Err msg={errs.unitId?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="topicId">Topic</Label>
                <select id="topicId" className={field} {...form.register("topicId")}>
                  <option value="">—</option>
                  {unit?.topics.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="type">Question type</Label>
              <select id="type" className={field} {...form.register("type")}>
                {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outcomeId">Learning outcome</Label>
              <select id="outcomeId" className={field} {...form.register("outcomeId")}>
                <option value="">—</option>
                {course?.outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.description.slice(0, 60)}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bloom">Bloom level</Label>
                <select id="bloom" className={field} {...form.register("bloom")}>
                  {Object.entries(BLOOM_LABEL).map(([k, l]) => <option key={k} value={k}>{BLOOM_K[k as keyof typeof BLOOM_K]} {l}</option>)}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="difficulty">Difficulty</Label>
                <select id="difficulty" className={field} {...form.register("difficulty")}>
                  {Object.entries(DIFFICULTY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="marks">Marks</Label>
                <Input id="marks" type="number" min={1} max={100} {...form.register("marks", { valueAsNumber: true })} aria-invalid={!!errs.marks} />
                <Err msg={errs.marks?.message} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="estimatedMinutes">Est. minutes</Label>
                <Input id="estimatedMinutes" type="number" min={1} max={240} {...form.register("estimatedMinutes", { valueAsNumber: true })} />
              </div>
            </div>
          </div>
        </section>

        <section className="surface-card space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="body" className="text-sm font-semibold">Question text</Label>
            <div className="flex flex-wrap gap-1" role="toolbar" aria-label="Insert">
              <Button type="button" size="xs" variant="ghost" onClick={() => insert("$x^2$")} title="Inline equation $…$"><Sigma /> Equation</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => insert("\n$$\n\\int_0^1 x\\,dx = \\tfrac{1}{2}\n$$\n")} title="Display equation"><Braces /> Block maths</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => insert("\n| Column A | Column B |\n|---|---|\n| value | value |\n")}><Table2 /> Table</Button>
              <Button type="button" size="xs" variant="ghost" onClick={() => insert("\n```\ncode here\n```\n")}><Code2 /> Code</Button>
              <Button type="button" size="xs" variant="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />} Image</Button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ""; }} />
            </div>
          </div>
          <Controller
            control={form.control}
            name="body"
            render={({ field: f }) => (
              <Textarea
                id="body"
                {...f}
                ref={(el) => { f.ref(el); bodyRef.current = el; }}
                rows={8}
                className="font-mono text-[13px] leading-relaxed"
                placeholder={"Write the question. Use $…$ for maths, **bold**, *italic*, lists with - , tables with | pipes |."}
                aria-invalid={!!errs.body}
                aria-describedby="body-help"
              />
            )}
          />
          <Err msg={errs.body?.message} />
          <p id="body-help" className="text-xs text-muted-foreground">Formatting: **bold**, *italic*, `code`, $inline maths$, $$display maths$$, - lists, 1. numbered, | tables |, H~2~O subscripts, x^2^ superscripts.</p>

          {(type === "MCQ" || type === "ASSERTION_REASON") && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-semibold">Answer choices — mark the correct one</legend>
              {choices.fields.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2">
                  <span className="w-5 text-sm text-muted-foreground">({String.fromCharCode(97 + i)})</span>
                  <Input {...form.register(`choices.${i}.text`)} aria-label={`Choice ${String.fromCharCode(97 + i)}`} />
                  <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" {...form.register(`choices.${i}.correct`)} className="size-4 accent-[var(--primary)]" /> Correct</label>
                  <Button type="button" size="icon-xs" variant="ghost" onClick={() => choices.remove(i)} aria-label="Remove choice"><Trash2 /></Button>
                </div>
              ))}
              {choices.fields.length < 8 && <Button type="button" size="xs" variant="outline" onClick={() => choices.append({ text: "", correct: false })}><Plus /> Choice</Button>}
            </fieldset>
          )}
          {type === "MATCH" && (
            <fieldset className="space-y-2 rounded-lg border p-3">
              <legend className="px-1 text-xs font-semibold">Pairs (shown shuffled to candidates is not automatic — order the right column as it should print)</legend>
              {pairs.fields.map((p, i) => (
                <div key={p.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <Input {...form.register(`pairs.${i}.left`)} placeholder={`${i + 1}. Left`} aria-label={`Left item ${i + 1}`} />
                  <Input {...form.register(`pairs.${i}.right`)} placeholder={`${String.fromCharCode(97 + i)}. Right`} aria-label={`Right item ${i + 1}`} />
                  <Button type="button" size="icon-xs" variant="ghost" onClick={() => pairs.remove(i)} aria-label="Remove pair"><Trash2 /></Button>
                </div>
              ))}
              <Button type="button" size="xs" variant="outline" onClick={() => pairs.append({ left: "", right: "" })}><Plus /> Pair</Button>
            </fieldset>
          )}
        </section>

        <section className="surface-card grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-1.5 md:col-span-2">
            <Label htmlFor="answerKey">Answer key / scheme of valuation (confidential, never printed)</Label>
            <Textarea id="answerKey" rows={3} {...form.register("answerKey")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="keywords">Keywords</Label>
            <Input id="keywords" placeholder="stack, postfix, evaluation" {...form.register("keywords")} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tags">Tags</Label>
            <Input id="tags" placeholder="numerical, previous-year" {...form.register("tags")} />
          </div>
          {questionId && (
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="changeNote">Change note for this version</Label>
              <Input id="changeNote" placeholder="e.g. Corrected data in part (b)" {...form.register("changeNote")} />
            </div>
          )}
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {questionId ? "Save new version" : "Create question"}</Button>
        </div>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-20 xl:h-fit">
        <section className="surface-card overflow-hidden">
          <div className="border-b px-4 py-2.5 text-[13px] font-semibold">Preview</div>
          <div className="min-h-32 bg-white p-5 text-black">
            {body?.trim() ? (
              <RichContent
                body={body}
                assetUrl={(id) => assetUrls[id] ?? ""}
                options={type === "MCQ" || type === "ASSERTION_REASON" ? { choices: form.watch("choices").filter((c) => c.text).map((c, i) => ({ label: String.fromCharCode(97 + i), text: c.text })) } : type === "MATCH" ? { pairs: form.watch("pairs").filter((p) => p.left || p.right) } : null}
                className="font-paper text-[15px]"
              />
            ) : (
              <p className="text-sm text-neutral-400">The question will appear here as it will print.</p>
            )}
          </div>
        </section>
        <section className={cn("surface-card p-4", similar.length && "border-tone-warning/40")}>
          <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Copy className="size-4 text-muted-foreground" /> Duplicate check</h3>
          {similar.length === 0 ? (
            <p className="text-xs text-muted-foreground">{(body ?? "").trim().length < 15 ? "Start typing to check for similar questions in this course." : "No similar questions found."}</p>
          ) : (
            <ul className="space-y-2">
              {similar.map((s) => (
                <li key={s.id} className="rounded-lg border border-tone-warning/30 bg-tone-warning/5 p-2.5 text-xs">
                  <div className="flex items-center justify-between font-semibold text-tone-warning">
                    <span>Potential duplicate</span>
                    <span className="tabular">Similarity {Math.round(s.similarity * 100)}%</span>
                  </div>
                  <a href={`/question-bank/${s.id}`} target="_blank" rel="noreferrer" className="mt-1 block text-foreground hover:underline"><span className="font-mono text-muted-foreground">{s.code}</span> {s.text.slice(0, 140)}</a>
                  {s.usedIn.length > 0 && <div className="mt-1 text-muted-foreground">Used in: {s.usedIn.join(", ")}</div>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </form>
  );
}
