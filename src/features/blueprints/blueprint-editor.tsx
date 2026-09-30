"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Copy, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archiveBlueprintAction, duplicateBlueprintAction, saveBlueprintAction } from "@/features/blueprints/actions";
import type { BlueprintDimension, QuestionType } from "@/generated/prisma/enums";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

export interface EditorSection {
  label: string;
  title: string;
  instructions: string;
  questionCount: number;
  attemptCount: number;
  marksPerQuestion: number;
  questionTypes: QuestionType[];
  units: number[];
}
export interface EditorRule {
  dimension: BlueprintDimension;
  key: string;
  targetPercent: number;
  tolerance: number;
}
export interface EditorValue {
  name: string;
  description: string;
  courseId: string;
  isPattern: boolean;
  durationMinutes: number;
  sections: EditorSection[];
  rules: EditorRule[];
}

const num = "h-8 w-full rounded-md border bg-card px-2 text-sm tabular outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

function RuleGroup({ title, dim, keys, rules, setRules, labelFor, readOnly }: { title: string; dim: BlueprintDimension; keys: string[]; rules: EditorRule[]; setRules: (r: EditorRule[]) => void; labelFor: (k: string) => string; readOnly: boolean }) {
  const current = rules.filter((r) => r.dimension === dim);
  const sum = current.reduce((s, r) => s + (Number(r.targetPercent) || 0), 0);
  const get = (k: string) => current.find((r) => r.key === k);
  const update = (k: string, patch: Partial<EditorRule> | null) => {
    const others = rules.filter((r) => !(r.dimension === dim && r.key === k));
    if (patch === null) return setRules(others);
    const existing = get(k) ?? { dimension: dim, key: k, targetPercent: 0, tolerance: 8 };
    setRules([...others, { ...existing, ...patch }]);
  };
  return (
    <fieldset className="rounded-xl border p-4">
      <legend className="px-1 text-sm font-semibold">{title}</legend>
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Marks-weighted targets (leave blank to not constrain)</span>
        {current.length > 0 && (
          <span className={cn("flex items-center gap-1 font-semibold tabular", Math.abs(sum - 100) <= 0.5 ? "text-tone-success" : "text-tone-danger")}>
            {Math.abs(sum - 100) <= 0.5 ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />} {sum}%
          </span>
        )}
      </div>
      <table className="w-full text-sm">
        <thead className="text-xs text-muted-foreground">
          <tr><th scope="col" className="text-left font-medium">Level</th><th scope="col" className="w-24 text-right font-medium">Target %</th><th scope="col" className="w-24 text-right font-medium">± tolerance</th></tr>
        </thead>
        <tbody>
          {keys.map((k) => {
            const r = get(k);
            return (
              <tr key={k}>
                <td className="py-1">{labelFor(k)}</td>
                <td className="py-1 pl-2">
                  <input aria-label={`${labelFor(k)} target percent`} type="number" min={0} max={100} className={num} disabled={readOnly} value={r?.targetPercent ?? ""} onChange={(e) => (e.target.value === "" ? update(k, null) : update(k, { targetPercent: Number(e.target.value) }))} />
                </td>
                <td className="py-1 pl-2">
                  <input aria-label={`${labelFor(k)} tolerance`} type="number" min={0} max={50} className={num} disabled={readOnly || !r} value={r?.tolerance ?? ""} onChange={(e) => update(k, { tolerance: Number(e.target.value) })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </fieldset>
  );
}

export function BlueprintEditor({ id, initial, courses, readOnly, lockedReason }: { id: string | null; initial: EditorValue; courses: { id: string; label: string }[]; readOnly: boolean; lockedReason?: string }) {
  const router = useRouter();
  const [v, setV] = useState<EditorValue>(initial);
  const [pending, start] = useTransition();
  const total = useMemo(() => v.sections.reduce((s, x) => s + x.attemptCount * x.marksPerQuestion, 0), [v.sections]);
  const setSection = (i: number, patch: Partial<EditorSection>) => setV((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const maxUnit = Math.max(5, ...v.sections.flatMap((s) => s.units));

  const save = () =>
    start(async () => {
      const res = await saveBlueprintAction(id, {
        ...v,
        description: v.description || null,
        courseId: v.courseId || null,
        totalMarks: total,
        sections: v.sections.map((s) => ({ ...s, instructions: s.instructions || null })),
      });
      if (!res.ok) {
        const details = res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : "";
        toast.error(res.error, { description: details || undefined });
        return;
      }
      toast.success("Blueprint saved");
      if (!id) router.push(`/blueprints/${res.data.id}`);
      else router.refresh();
    });

  return (
    <div className="space-y-6">
      {lockedReason && <div className="rounded-xl border border-tone-warning/30 bg-tone-warning/5 px-4 py-3 text-sm">{lockedReason}</div>}
      <section className="surface-card grid gap-4 p-5 md:grid-cols-[1fr_200px_160px]">
        <div className="space-y-1.5">
          <Label htmlFor="bp-name">Name</Label>
          <Input id="bp-name" value={v.name} disabled={readOnly} onChange={(e) => setV({ ...v, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-course">Applies to</Label>
          <select id="bp-course" className="h-9 w-full rounded-lg border bg-card px-2 text-sm" disabled={readOnly} value={v.isPattern ? "__pattern" : v.courseId} onChange={(e) => setV({ ...v, isPattern: e.target.value === "__pattern", courseId: e.target.value === "__pattern" ? "" : e.target.value })}>
            <option value="__pattern">Reusable paper pattern</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bp-duration">Duration (minutes)</Label>
          <Input id="bp-duration" type="number" min={15} step={15} disabled={readOnly} value={v.durationMinutes} onChange={(e) => setV({ ...v, durationMinutes: Number(e.target.value) })} />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="bp-desc">Description</Label>
          <Textarea id="bp-desc" rows={2} disabled={readOnly} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Sections</h2>
            <p className="text-xs text-muted-foreground">
              {v.sections.map((s) => `${s.label}: ${s.attemptCount}${s.attemptCount !== s.questionCount ? `/${s.questionCount}` : ""} × ${s.marksPerQuestion}`).join(" · ")} = <b className="text-foreground tabular">{total} marks</b>
            </p>
          </div>
          {!readOnly && (
            <Button size="sm" variant="outline" onClick={() => setV({ ...v, sections: [...v.sections, { label: String.fromCharCode(65 + v.sections.length), title: "Answer ALL questions", instructions: "", questionCount: 5, attemptCount: 5, marksPerQuestion: 2, questionTypes: [], units: [] }] })}>
              <Plus /> Section
            </Button>
          )}
        </div>
        <div className="divide-y">
          {v.sections.map((s, i) => (
            <div key={i} className="grid gap-3 p-5 lg:grid-cols-[64px_1fr_repeat(3,96px)_auto]">
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`s${i}-label`}>Label</Label>
                <input id={`s${i}-label`} className={num} disabled={readOnly} value={s.label} maxLength={4} onChange={(e) => setSection(i, { label: e.target.value.toUpperCase() })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`s${i}-title`}>Heading</Label>
                <Input id={`s${i}-title`} className="h-8" disabled={readOnly} value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`s${i}-qc`}>Questions set</Label>
                <input id={`s${i}-qc`} type="number" min={1} className={num} disabled={readOnly} value={s.questionCount} onChange={(e) => setSection(i, { questionCount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`s${i}-ac`}>To answer</Label>
                <input id={`s${i}-ac`} type="number" min={1} className={num} disabled={readOnly} value={s.attemptCount} onChange={(e) => setSection(i, { attemptCount: Number(e.target.value) })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`s${i}-m`}>Marks each</Label>
                <input id={`s${i}-m`} type="number" min={1} className={num} disabled={readOnly} value={s.marksPerQuestion} onChange={(e) => setSection(i, { marksPerQuestion: Number(e.target.value) })} />
              </div>
              <div className="flex items-end">
                {!readOnly && v.sections.length > 1 && <Button size="icon-sm" variant="ghost" aria-label={`Remove section ${s.label}`} onClick={() => setV({ ...v, sections: v.sections.filter((_, j) => j !== i) })}><Trash2 /></Button>}
              </div>
              <div className="space-y-1 lg:col-span-6">
                <Label className="text-xs" htmlFor={`s${i}-ins`}>Instructions printed under the heading</Label>
                <Input id={`s${i}-ins`} className="h-8" disabled={readOnly} value={s.instructions} onChange={(e) => setSection(i, { instructions: e.target.value })} />
              </div>
              <fieldset className="lg:col-span-3">
                <legend className="mb-1 text-xs font-medium">Units required (none = any)</legend>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: maxUnit }).map((_, u) => (
                    <label key={u} className={cn("flex h-7 min-w-7 cursor-pointer items-center justify-center rounded-md border px-2 text-xs", s.units.includes(u + 1) && "border-primary bg-primary/10 text-primary")}>
                      <input type="checkbox" className="sr-only" disabled={readOnly} checked={s.units.includes(u + 1)} onChange={(e) => setSection(i, { units: e.target.checked ? [...s.units, u + 1].sort() : s.units.filter((x) => x !== u + 1) })} />
                      {u + 1}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="lg:col-span-3">
                <legend className="mb-1 text-xs font-medium">Allowed question types (none = any)</legend>
                <select
                  multiple
                  aria-label={`Allowed question types for section ${s.label}`}
                  className="h-16 w-full rounded-md border bg-card px-1 text-xs"
                  disabled={readOnly}
                  value={s.questionTypes}
                  onChange={(e) => setSection(i, { questionTypes: [...e.target.selectedOptions].map((o) => o.value as QuestionType) })}
                >
                  {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </fieldset>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <RuleGroup title="Difficulty distribution" dim="DIFFICULTY" keys={Object.keys(DIFFICULTY_LABEL)} rules={v.rules} setRules={(rules) => setV({ ...v, rules })} labelFor={(k) => DIFFICULTY_LABEL[k as keyof typeof DIFFICULTY_LABEL]} readOnly={readOnly} />
        <RuleGroup title="Bloom distribution" dim="BLOOM" keys={Object.keys(BLOOM_LABEL)} rules={v.rules} setRules={(rules) => setV({ ...v, rules })} labelFor={(k) => `${BLOOM_K[k as keyof typeof BLOOM_K]} ${BLOOM_LABEL[k as keyof typeof BLOOM_LABEL]}`} readOnly={readOnly} />
        <RuleGroup title="Unit weightage" dim="UNIT" keys={Array.from({ length: maxUnit }, (_, u) => String(u + 1))} rules={v.rules} setRules={(rules) => setV({ ...v, rules })} labelFor={(k) => `Unit ${k}`} readOnly={readOnly} />
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {id && (
          <Button variant="outline" onClick={() => start(async () => { const r = await duplicateBlueprintAction(id); if (r.ok) router.push(`/blueprints/${r.data.id}`); else toast.error(r.error); })}>
            <Copy /> Duplicate
          </Button>
        )}
        {id && !readOnly && (
          <Button variant="ghost" onClick={() => { if (confirm("Archive this blueprint?")) start(async () => { const r = await archiveBlueprintAction(id); if (r.ok) router.push("/blueprints"); else toast.error(r.error); }); }}>
            Archive
          </Button>
        )}
        {!readOnly && <Button onClick={save} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save blueprint</Button>}
      </div>
    </div>
  );
}
