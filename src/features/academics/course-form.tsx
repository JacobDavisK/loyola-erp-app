"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { archiveCourseAction, saveCourseAction } from "@/features/academics/actions";
import { BLOOM_K, BLOOM_LABEL, COURSE_TYPE_LABEL } from "@/lib/domain/labels";

export interface CourseFormValue {
  code: string;
  title: string;
  credits: number;
  departmentId: string;
  programId: string;
  semesterId: string;
  regulationId: string;
  courseType: keyof typeof COURSE_TYPE_LABEL;
  mode: "THEORY" | "PRACTICAL" | "THEORY_PRACTICAL";
  maxMarks: number;
  internalMarks: number;
  externalMarks: number;
  durationMinutes: number;
  syllabus: string;
  units: { id?: string; number: number; title: string; hours: number | null; topics: string[] }[];
  outcomes: { id?: string; code: string; description: string; bloom: keyof typeof BLOOM_LABEL | "" }[];
}

type Opt = { id: string; label: string };
const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

export function CourseForm({
  id,
  initial,
  departments,
  programs,
  semesters,
  regulations,
  readOnly,
}: {
  id: string | null;
  initial: CourseFormValue;
  departments: Opt[];
  programs: (Opt & { departmentId: string })[];
  semesters: Opt[];
  regulations: Opt[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof CourseFormValue>(k: K, val: CourseFormValue[K]) => setV((x) => ({ ...x, [k]: val }));
  const sel = (k: "departmentId" | "programId" | "semesterId" | "regulationId", label: string, opts: Opt[]) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <select id={k} className={field} disabled={readOnly} value={v[k]} onChange={(e) => set(k, e.target.value)} required>
        <option value="">Select…</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
  const numberField = (k: "credits" | "maxMarks" | "internalMarks" | "externalMarks" | "durationMinutes", label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type="number" min={0} disabled={readOnly} value={v[k]} onChange={(e) => set(k, Number(e.target.value))} />
    </div>
  );

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await saveCourseAction(id, { ...v, syllabus: v.syllabus || null, outcomes: v.outcomes.map((o) => ({ ...o, bloom: o.bloom || null })) });
          if (!res.ok) {
            toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
            return;
          }
          toast.success("Course saved");
          if (!id) router.push(`/academics/courses/${res.data.id}`);
          else router.refresh();
        });
      }}
    >
      <section className="surface-card grid gap-4 p-5 md:grid-cols-4">
        <div className="space-y-1.5">
          <Label htmlFor="code">Course code</Label>
          <Input id="code" disabled={readOnly} value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} required />
        </div>
        <div className="space-y-1.5 md:col-span-3">
          <Label htmlFor="title">Title</Label>
          <Input id="title" disabled={readOnly} value={v.title} onChange={(e) => set("title", e.target.value)} required />
        </div>
        {sel("departmentId", "Department", departments)}
        {sel("programId", "Programme", programs.filter((p) => !v.departmentId || p.departmentId === v.departmentId))}
        {sel("semesterId", "Semester", semesters)}
        {sel("regulationId", "Regulation", regulations)}
        <div className="space-y-1.5">
          <Label htmlFor="courseType">Course type</Label>
          <select id="courseType" className={field} disabled={readOnly} value={v.courseType} onChange={(e) => set("courseType", e.target.value as CourseFormValue["courseType"])}>
            {Object.entries(COURSE_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mode">Theory / practical</Label>
          <select id="mode" className={field} disabled={readOnly} value={v.mode} onChange={(e) => set("mode", e.target.value as CourseFormValue["mode"])}>
            <option value="THEORY">Theory</option>
            <option value="PRACTICAL">Practical</option>
            <option value="THEORY_PRACTICAL">Theory + practical</option>
          </select>
        </div>
        {numberField("credits", "Credits")}
        {numberField("durationMinutes", "Exam duration (min)")}
        {numberField("maxMarks", "Maximum marks")}
        {numberField("internalMarks", "Internal marks")}
        {numberField("externalMarks", "External marks")}
        <div className="flex items-end text-xs text-muted-foreground">{v.internalMarks + v.externalMarks === v.maxMarks ? "Marks split balances." : <span className="text-destructive">Internal + external must equal {v.maxMarks}.</span>}</div>
        <div className="space-y-1.5 md:col-span-4">
          <Label htmlFor="syllabus">Syllabus</Label>
          <Textarea id="syllabus" rows={4} disabled={readOnly} value={v.syllabus} onChange={(e) => set("syllabus", e.target.value)} />
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Units & topics</h2>
          {!readOnly && <Button type="button" size="sm" variant="outline" onClick={() => set("units", [...v.units, { number: v.units.length + 1, title: "", hours: 12, topics: [] }])}><Plus /> Unit</Button>}
        </div>
        <ol className="divide-y">
          {v.units.map((u, i) => (
            <li key={u.id ?? `new-${i}`} className="grid gap-3 p-5 md:grid-cols-[70px_1fr_90px_auto]">
              <div className="space-y-1"><Label className="text-xs" htmlFor={`u${i}n`}>Unit</Label><Input id={`u${i}n`} type="number" min={1} disabled={readOnly} value={u.number} onChange={(e) => set("units", v.units.map((x, j) => (j === i ? { ...x, number: Number(e.target.value) } : x)))} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`u${i}t`}>Title</Label><Input id={`u${i}t`} disabled={readOnly} value={u.title} onChange={(e) => set("units", v.units.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} /></div>
              <div className="space-y-1"><Label className="text-xs" htmlFor={`u${i}h`}>Hours</Label><Input id={`u${i}h`} type="number" min={0} disabled={readOnly} value={u.hours ?? ""} onChange={(e) => set("units", v.units.map((x, j) => (j === i ? { ...x, hours: e.target.value ? Number(e.target.value) : null } : x)))} /></div>
              <div className="flex items-end">{!readOnly && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove unit ${u.number}`} onClick={() => set("units", v.units.filter((_, j) => j !== i))}><Trash2 /></Button>}</div>
              <div className="space-y-1 md:col-span-4">
                <Label className="text-xs" htmlFor={`u${i}topics`}>Topics (one per line)</Label>
                <Textarea id={`u${i}topics`} rows={2} disabled={readOnly} value={u.topics.join("\n")} onChange={(e) => set("units", v.units.map((x, j) => (j === i ? { ...x, topics: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean) } : x)))} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Course outcomes</h2>
          {!readOnly && <Button type="button" size="sm" variant="outline" onClick={() => set("outcomes", [...v.outcomes, { code: `CO${v.outcomes.length + 1}`, description: "", bloom: "" }])}><Plus /> Outcome</Button>}
        </div>
        <ul className="divide-y">
          {v.outcomes.map((o, i) => (
            <li key={o.id ?? `new-${i}`} className="grid gap-3 px-5 py-3 md:grid-cols-[90px_1fr_170px_auto]">
              <Input aria-label="Outcome code" disabled={readOnly} value={o.code} onChange={(e) => set("outcomes", v.outcomes.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} />
              <Input aria-label="Outcome description" disabled={readOnly} value={o.description} onChange={(e) => set("outcomes", v.outcomes.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
              <select aria-label="Bloom level" className={field} disabled={readOnly} value={o.bloom} onChange={(e) => set("outcomes", v.outcomes.map((x, j) => (j === i ? { ...x, bloom: e.target.value as CourseFormValue["outcomes"][number]["bloom"] } : x)))}>
                <option value="">Bloom level…</option>
                {Object.entries(BLOOM_LABEL).map(([k, l]) => <option key={k} value={k}>{BLOOM_K[k as keyof typeof BLOOM_K]} {l}</option>)}
              </select>
              {!readOnly && <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${o.code}`} onClick={() => set("outcomes", v.outcomes.filter((_, j) => j !== i))}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      </section>

      {!readOnly && (
        <div className="flex justify-end gap-2">
          {id && <Button type="button" variant="ghost" onClick={() => { if (confirm("Archive this course? It stays in historical records.")) start(async () => { const r = await archiveCourseAction(id); if (r.ok) router.push("/academics/courses"); else toast.error(r.error); }); }}>Archive course</Button>}
          <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save course</Button>
        </div>
      )}
    </form>
  );
}
