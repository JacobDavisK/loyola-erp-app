"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Clock, Loader2, Plus, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  gradeSubmissionAction, saveAnswersAction, saveQuestionAction, startAttemptAction, submitAssignmentAction, submitAttemptAction, transferAction, uploadMaterialAction,
} from "@/features/lms/actions";
import { FeedbackDraftButton } from "@/features/insight/ai-controls";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";
type R = { ok: true; data?: unknown; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    pending,
    run: (fn: () => Promise<R>, after?: (r: R & { ok: true }) => void) =>
      start(async () => {
        const r = await fn();
        if (!r.ok) {
          toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined });
          return;
        }
        if (r.message) toast.success(r.message);
        after?.(r);
        router.refresh();
      }),
  };
}

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.gif,.docx,.xlsx,.pptx,.zip,.txt,.md,.csv,.py,.java,.c,.cpp,.js,.ts,.sql";

export function UploadMaterialDialog({ moduleId }: { moduleId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="outline"><Upload /> File</Button></DialogTrigger>
      <DialogContent>
        <form ref={ref} className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(ref.current!);
          f.set("isPublished", String((ref.current!.elements.namedItem("pub") as HTMLInputElement).checked));
          run(() => uploadMaterialAction(moduleId, f), () => setOpen(false));
        }}>
          <DialogHeader><DialogTitle>Upload course material</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="um-file">File (max 15 MB)</Label><Input id="um-file" name="file" type="file" accept={ACCEPT} required /></div>
          <div className="space-y-1.5"><Label htmlFor="um-title">Title</Label><Input id="um-title" name="title" placeholder="Defaults to the file name" /></div>
          <div className="space-y-1.5"><Label htmlFor="um-body">Description</Label><Textarea id="um-body" name="body" rows={2} /></div>
          <label className="flex items-center gap-2 text-sm"><input name="pub" type="checkbox" defaultChecked className="size-4 accent-[var(--primary)]" /> Visible to students</label>
          <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Upload</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SubmitAssignmentForm({ assignmentId, allowText, allowFiles, maxFiles }: { assignmentId: string; allowText: boolean; allowFiles: boolean; maxFiles: number }) {
  const { pending, run } = useRun();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      if (!confirm("Submit this attempt? You cannot change it afterwards.")) return;
      run(() => submitAssignmentAction(assignmentId, new FormData(ref.current!)), () => ref.current?.reset());
    }}>
      {allowText && <div className="space-y-1.5"><Label htmlFor="sa-text">Your answer</Label><Textarea id="sa-text" name="text" rows={8} /></div>}
      {allowFiles && <div className="space-y-1.5"><Label htmlFor="sa-files">Files (up to {maxFiles}, 10 MB each)</Label><Input id="sa-files" name="files" type="file" multiple accept={ACCEPT} /></div>}
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Submit</Button></div>
    </form>
  );
}

export function GradeForm({ submissionId, max, marks, feedback, penalty, assignmentTitle, aiAvailable = false }: { submissionId: string; max: number; marks: number | null; feedback: string | null; penalty: number; assignmentTitle?: string; aiAvailable?: boolean }) {
  const { pending, run } = useRun();
  const [m, setM] = useState(marks === null ? "" : String(marks));
  const [fb, setFb] = useState(feedback ?? "");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1"><Label htmlFor={`g-${submissionId}`} className="text-xs">Marks (of {max})</Label><Input id={`g-${submissionId}`} type="number" min={0} max={max} step="0.5" className="w-24" value={m} onChange={(e) => setM(e.target.value)} /></div>
        {penalty > 0 && m !== "" && <span className="pb-2 text-xs text-muted-foreground">after {penalty * 100}% late penalty: {Math.round(Number(m) * (1 - penalty) * 100) / 100}</span>}
      </div>
      <Textarea aria-label="Feedback" rows={2} placeholder="Feedback for the student" value={fb} onChange={(e) => setFb(e.target.value)} />
      {aiAvailable && assignmentTitle && <FeedbackDraftButton assignmentTitle={assignmentTitle} maxMarks={max} marks={m === "" ? null : Number(m)} notes={fb} onDraft={setFb} />}
      <div className="flex gap-2">
        <Button size="xs" disabled={pending || m === ""} onClick={() => run(() => gradeSubmissionAction(submissionId, { marks: Number(m), feedback: fb, status: "GRADED" }))}>{pending && <Loader2 className="animate-spin" />} Save grade</Button>
        <Button size="xs" variant="outline" disabled={pending || fb.trim().length < 3} title="Allows the student one more attempt" onClick={() => run(() => gradeSubmissionAction(submissionId, { marks: m === "" ? null : Number(m), feedback: fb, status: "RETURNED" }))}>Return for rework</Button>
      </div>
    </div>
  );
}

// ───────────────────────── Quiz question editor ─────────────────────────

type QType = "SINGLE" | "MULTIPLE" | "TRUE_FALSE" | "SHORT" | "NUMERIC";
export interface QuestionValue { id?: string; type: QType; prompt: string; options: { id: string; text: string }[]; answer: Record<string, unknown>; marks: number; explanation: string; order: number; outcomeId?: string | null }
const TYPE_LABEL: Record<QType, string> = { SINGLE: "Single choice", MULTIPLE: "Multiple choice", TRUE_FALSE: "True / false", SHORT: "Short answer", NUMERIC: "Numeric" };
const defaultAnswer = (t: QType): Record<string, unknown> => (t === "SINGLE" || t === "MULTIPLE" ? { correct: [] } : t === "TRUE_FALSE" ? { correct: true } : t === "SHORT" ? { accepted: [""], caseSensitive: false } : { value: 0, tolerance: 0 });

export function QuestionEditor({ quizId, initial, trigger, outcomes = [] }: { quizId: string; initial?: QuestionValue; trigger: React.ReactNode; outcomes?: { id: string; code: string; description: string }[] }) {
  const { pending, run } = useRun();
  const blank: QuestionValue = { type: "SINGLE", prompt: "", options: [{ id: "a", text: "" }, { id: "b", text: "" }], answer: { correct: [] }, marks: 1, explanation: "", order: 0 };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<QuestionValue>(initial ?? blank);
  const correct = (v.answer.correct as string[] | undefined) ?? [];
  const setType = (type: QType) => setV({ ...v, type, answer: defaultAnswer(type), options: type === "SINGLE" || type === "MULTIPLE" ? (v.options.length ? v.options : blank.options) : v.options });
  const nextId = () => "abcdefghij".split("").find((c) => !v.options.some((o) => o.id === c)) ?? String(v.options.length);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setV(initial ?? blank); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{initial ? "Edit question" : "New question"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="qe-type">Type</Label><select id="qe-type" className={field} value={v.type} onChange={(e) => setType(e.target.value as QType)}>{(Object.keys(TYPE_LABEL) as QType[]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select></div>
            <div className="space-y-1.5"><Label htmlFor="qe-marks">Marks</Label><Input id="qe-marks" type="number" min={0.5} step="0.5" value={v.marks} onChange={(e) => setV({ ...v, marks: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="qe-order">Order</Label><Input id="qe-order" type="number" min={0} value={v.order} onChange={(e) => setV({ ...v, order: Number(e.target.value) })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="qe-prompt">Question</Label><Textarea id="qe-prompt" rows={3} value={v.prompt} onChange={(e) => setV({ ...v, prompt: e.target.value })} /></div>
          {(v.type === "SINGLE" || v.type === "MULTIPLE") && (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Options — tick the correct {v.type === "SINGLE" ? "one" : "ones"}</legend>
              {v.options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <input aria-label={`Option ${o.id} is correct`} type={v.type === "SINGLE" ? "radio" : "checkbox"} name="qe-correct" className="size-4 accent-[var(--primary)]" checked={correct.includes(o.id)}
                    onChange={(e) => setV({ ...v, answer: { ...v.answer, correct: v.type === "SINGLE" ? [o.id] : e.target.checked ? [...correct, o.id] : correct.filter((c) => c !== o.id) } })} />
                  <Input aria-label={`Option ${o.id}`} value={o.text} onChange={(e) => setV({ ...v, options: v.options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove option" disabled={v.options.length <= 2} onClick={() => setV({ ...v, options: v.options.filter((_, j) => j !== i), answer: { ...v.answer, correct: correct.filter((c) => c !== o.id) } })}><Trash2 /></Button>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" size="xs" variant="outline" disabled={v.options.length >= 10} onClick={() => setV({ ...v, options: [...v.options, { id: nextId(), text: "" }] })}><Plus /> Option</Button>
                {v.type === "MULTIPLE" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!v.answer.partial} onChange={(e) => setV({ ...v, answer: { ...v.answer, partial: e.target.checked } })} /> Partial credit</label>}
              </div>
            </fieldset>
          )}
          {v.type === "TRUE_FALSE" && (
            <div className="flex gap-4 text-sm" role="radiogroup" aria-label="Correct answer">
              {[true, false].map((b) => <label key={String(b)} className="flex items-center gap-2"><input type="radio" name="qe-tf" className="size-4 accent-[var(--primary)]" checked={v.answer.correct === b} onChange={() => setV({ ...v, answer: { correct: b } })} /> {b ? "True" : "False"}</label>)}
            </div>
          )}
          {v.type === "SHORT" && (
            <div className="space-y-1.5">
              <Label htmlFor="qe-acc">Accepted answers (one per line; spacing is ignored)</Label>
              <Textarea id="qe-acc" rows={3} value={((v.answer.accepted as string[]) ?? []).join("\n")} onChange={(e) => setV({ ...v, answer: { ...v.answer, accepted: e.target.value.split("\n") } })} />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!v.answer.caseSensitive} onChange={(e) => setV({ ...v, answer: { ...v.answer, caseSensitive: e.target.checked } })} /> Case-sensitive</label>
            </div>
          )}
          {v.type === "NUMERIC" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="qe-val">Correct value</Label><Input id="qe-val" type="number" step="any" value={String(v.answer.value ?? "")} onChange={(e) => setV({ ...v, answer: { ...v.answer, value: Number(e.target.value) } })} /></div>
              <div className="space-y-1.5"><Label htmlFor="qe-tol">Tolerance (±)</Label><Input id="qe-tol" type="number" min={0} step="any" value={String(v.answer.tolerance ?? 0)} onChange={(e) => setV({ ...v, answer: { ...v.answer, tolerance: Number(e.target.value) } })} /></div>
            </div>
          )}
          {outcomes.length > 0 && (
            <div className="space-y-1.5"><Label htmlFor="qe-co">Course outcome assessed (optional)</Label><select id="qe-co" className={field} value={v.outcomeId ?? ""} onChange={(e) => setV({ ...v, outcomeId: e.target.value || null })}><option value="">—</option>{outcomes.map((o) => <option key={o.id} value={o.id}>{o.code} — {o.description.slice(0, 80)}</option>)}</select></div>
          )}
          <div className="space-y-1.5"><Label htmlFor="qe-exp">Explanation shown in review (optional)</Label><Textarea id="qe-exp" rows={2} value={v.explanation} onChange={(e) => setV({ ...v, explanation: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={() => {
            const answer = v.type === "SHORT" ? { ...v.answer, accepted: ((v.answer.accepted as string[]) ?? []).map((s) => s.trim()).filter(Boolean) } : v.answer;
            run(() => saveQuestionAction(quizId, initial?.id ?? null, { type: v.type, prompt: v.prompt, options: v.type === "SINGLE" || v.type === "MULTIPLE" ? v.options : null, answer, marks: v.marks, explanation: v.explanation || null, order: v.order, outcomeId: v.outcomeId ?? null }), () => setOpen(false));
          }}>{pending && <Loader2 className="animate-spin" />} Save question</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ───────────────────────── Quiz taking ─────────────────────────

export function StartQuizButton({ quizId, label }: { quizId: string; label: string }) {
  const router = useRouter();
  const { pending, run } = useRun();
  return <Button disabled={pending} onClick={() => run(() => startAttemptAction(quizId), () => router.refresh())}>{pending && <Loader2 className="animate-spin" />} {label}</Button>;
}

export interface TakerQuestion { id: string; type: QType; prompt: string; options: { id: string; text: string }[] | null; marks: number }

/** Answers autosave a moment after each change; the attempt submits itself when time runs out. */
export function QuizTaker({ attemptId, questions, saved, deadline }: { attemptId: string; questions: TakerQuestion[]; saved: Record<string, unknown>; deadline: string }) {
  const router = useRouter();
  const [answers, setAnswers] = useState<Record<string, unknown>>(saved);
  const [left, setLeft] = useState(() => new Date(deadline).getTime() - Date.now());
  const [status, setStatus] = useState<"saved" | "saving" | "error">("saved");
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(0);
  const [sent, setSent] = useState(false);

  // Autosave: the whole answer set is sent 800 ms after the last change.
  useEffect(() => {
    if (!changed) return;
    const t = setTimeout(async () => {
      setStatus("saving");
      const r = await saveAnswersAction(attemptId, answers);
      setStatus(r.ok ? "saved" : "error");
      if (!r.ok) { toast.error(r.error); router.refresh(); }
    }, 800);
    return () => clearTimeout(t);
  }, [changed, answers, attemptId, router]);

  const submit = useCallback(async (auto: boolean) => {
    if (sent) return;
    if (!auto && !confirm("Submit your answers? You cannot change them afterwards.")) return;
    setSent(true);
    setSubmitting(true);
    const r = await submitAttemptAction(attemptId, answers);
    if (!r.ok) toast.error(r.error);
    else toast.success(auto ? "Time is up — your answers were submitted." : "Quiz submitted");
    router.refresh();
  }, [answers, attemptId, router, sent]);

  // The countdown ticks every second and submits automatically at zero.
  useEffect(() => {
    const t = setInterval(() => {
      const ms = new Date(deadline).getTime() - Date.now();
      setLeft(ms);
      if (ms <= 0) void submit(true);
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, submit]);

  const set = (id: string, value: unknown) => {
    setAnswers((cur) => ({ ...cur, [id]: value }));
    setChanged((n) => n + 1);
  };
  const mm = Math.max(0, Math.floor(left / 60000));
  const ss = Math.max(0, Math.floor((left % 60000) / 1000));
  const answered = questions.filter((q) => answers[q.id] !== undefined && answers[q.id] !== "" && !(Array.isArray(answers[q.id]) && (answers[q.id] as unknown[]).length === 0)).length;
  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-xl border bg-card/95 px-4 py-2.5 text-sm backdrop-blur">
        <span className={cn("flex items-center gap-1.5 font-medium tabular", left < 120_000 && "text-tone-danger")} role="timer" aria-live="off"><Clock className="size-4" /> {mm}:{String(ss).padStart(2, "0")} left</span>
        <span className="text-muted-foreground">{answered} of {questions.length} answered</span>
        <span className="text-xs text-muted-foreground" aria-live="polite">{status === "saving" ? "Saving…" : status === "error" ? "Not saved" : "All answers saved"}</span>
        <Button size="sm" className="ml-auto" disabled={submitting} onClick={() => void submit(false)}>{submitting && <Loader2 className="animate-spin" />} Submit</Button>
      </div>
      <ol className="space-y-4">
        {questions.map((q, i) => (
          <li key={q.id} className="surface-card p-5">
            <fieldset>
              <legend className="mb-3 flex w-full justify-between gap-3"><span className="whitespace-pre-wrap font-medium">{i + 1}. {q.prompt}</span><span className="shrink-0 text-xs text-muted-foreground">{q.marks} mark{q.marks === 1 ? "" : "s"}</span></legend>
              {q.type === "SINGLE" && q.options?.map((o) => (
                <label key={o.id} className="flex items-center gap-2 py-1 text-sm"><input type="radio" name={q.id} className="size-4 accent-[var(--primary)]" checked={answers[q.id] === o.id} onChange={() => set(q.id, o.id)} /> {o.text}</label>
              ))}
              {q.type === "MULTIPLE" && q.options?.map((o) => {
                const cur = (answers[q.id] as string[] | undefined) ?? [];
                return <label key={o.id} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={cur.includes(o.id)} onChange={(e) => set(q.id, e.target.checked ? [...cur, o.id] : cur.filter((x) => x !== o.id))} /> {o.text}</label>;
              })}
              {q.type === "TRUE_FALSE" && [true, false].map((b) => (
                <label key={String(b)} className="mr-6 inline-flex items-center gap-2 text-sm"><input type="radio" name={q.id} className="size-4 accent-[var(--primary)]" checked={answers[q.id] === b} onChange={() => set(q.id, b)} /> {b ? "True" : "False"}</label>
              ))}
              {q.type === "SHORT" && <Input aria-label="Your answer" value={String(answers[q.id] ?? "")} onChange={(e) => set(q.id, e.target.value)} maxLength={2000} />}
              {q.type === "NUMERIC" && <Input aria-label="Your answer" inputMode="decimal" className="max-w-48" value={String(answers[q.id] ?? "")} onChange={(e) => set(q.id, e.target.value)} />}
            </fieldset>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ───────────────────────── Gradebook transfer ─────────────────────────

export function TransferForm({ offeringId, columns, components }: { offeringId: string; columns: { key: string; title: string; max: number }[]; components: { id: string; name: string; maxMarks: number }[] }) {
  const { pending, run } = useRun();
  const [col, setCol] = useState(columns[0]?.key ?? "");
  const [comp, setComp] = useState(components[0]?.id ?? "");
  if (!columns.length || !components.length) return <p className="text-sm text-muted-foreground">{components.length ? "Publish an assignment or quiz first." : "Add internal-assessment components to this class (class page → Marks) to transfer scores."}</p>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor="tr-col" className="text-xs">Scores from</Label><select id="tr-col" className={field} value={col} onChange={(e) => setCol(e.target.value)}>{columns.map((c) => <option key={c.key} value={c.key}>{c.title} (out of {c.max})</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor="tr-comp" className="text-xs">Into component</Label><select id="tr-comp" className={field} value={comp} onChange={(e) => setComp(e.target.value)}>{components.map((c) => <option key={c.id} value={c.id}>{c.name} (out of {c.maxMarks})</option>)}</select></div>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => {
        if (!confirm("Copy these scores into the internal marks sheet (scaled to its maximum)? Existing marks for those students are overwritten while the sheet is a draft.")) return;
        run(() => transferAction(offeringId, { column: col, componentId: comp }), (r) => {
          const d = r.data as { transferred: number; blank: number };
          toast.success(`${d.transferred} score(s) copied; ${d.blank} student(s) without a score left blank`);
        });
      }}>{pending && <Loader2 className="animate-spin" />} Transfer to internal marks</Button>
    </div>
  );
}
