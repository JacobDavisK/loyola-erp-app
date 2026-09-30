"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveCurriculumAction } from "@/features/academic-ops/actions";

type Course = { id: string; code: string; title: string; credits: number; courseType: string };
type Row = { courseId: string; semesterNumber: number; category: "MANDATORY" | "ELECTIVE"; groupCode: string | null };
type Group = { code: string; name: string; minCredits: number };
type Req = { kind: "CATEGORY_CREDITS"; label: string; courseTypes: string[]; minCredits: number } | { kind: "MIN_CGPA"; label: string; value: number };

export interface CurriculumValue {
  programId: string;
  regulationId: string;
  name: string;
  totalCredits: number;
  minCgpa: number | null;
  groups: Group[];
  courses: Row[];
  requirements: Req[];
}

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";
const COURSE_TYPES = ["CORE", "ELECTIVE", "ALLIED", "SKILL_ENHANCEMENT", "ABILITY_ENHANCEMENT", "PROJECT"];

export function CurriculumEditor({ id, initial, courses, readOnly, programs, regulations }: { id: string | null; initial: CurriculumValue; courses: Course[]; readOnly: boolean; programs: { id: string; label: string }[]; regulations: { id: string; label: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [adding, setAdding] = useState("");
  const [pending, start] = useTransition();
  const byId = useMemo(() => new Map(courses.map((c) => [c.id, c])), [courses]);
  const credits = v.courses.reduce((a, r) => a + (byId.get(r.courseId)?.credits ?? 0), 0);
  const mandatory = v.courses.filter((r) => r.category === "MANDATORY").reduce((a, r) => a + (byId.get(r.courseId)?.credits ?? 0), 0);
  const electiveMin = v.groups.reduce((a, g) => a + g.minCredits, 0);
  const semesters = [...new Set(v.courses.map((r) => r.semesterNumber))].sort((a, b) => a - b);
  const set = <K extends keyof CurriculumValue>(k: K, val: CurriculumValue[K]) => setV((x) => ({ ...x, [k]: val }));

  return (
    <div className="space-y-6">
      <section className="surface-card grid gap-4 p-5 md:grid-cols-4">
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="cu-name">Name</Label><Input id="cu-name" disabled={readOnly} value={v.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="space-y-1.5">
          <Label htmlFor="cu-prog">Programme</Label>
          <select id="cu-prog" className={field} disabled={readOnly || !!id} value={v.programId} onChange={(e) => set("programId", e.target.value)}>{programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cu-reg">Regulation</Label>
          <select id="cu-reg" className={field} disabled={readOnly || !!id} value={v.regulationId} onChange={(e) => set("regulationId", e.target.value)}>{regulations.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        </div>
        <div className="space-y-1.5"><Label htmlFor="cu-total">Credits to graduate</Label><Input id="cu-total" type="number" min={1} disabled={readOnly} value={v.totalCredits} onChange={(e) => set("totalCredits", Number(e.target.value))} /></div>
        <div className="space-y-1.5"><Label htmlFor="cu-cgpa">Minimum CGPA (optional)</Label><Input id="cu-cgpa" type="number" step="0.01" min={0} max={10} disabled={readOnly} value={v.minCgpa ?? ""} onChange={(e) => set("minCgpa", e.target.value ? Number(e.target.value) : null)} /></div>
        <div className="flex items-end text-xs text-muted-foreground md:col-span-2">
          {credits} credits listed · {mandatory} mandatory + at least {electiveMin} elective = {mandatory + electiveMin}{mandatory + electiveMin > v.totalCredits ? "" : ` (${v.totalCredits - mandatory - electiveMin} free-choice)`}
        </div>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Elective groups</h2>
          {!readOnly && <Button size="xs" variant="outline" onClick={() => set("groups", [...v.groups, { code: `E${v.groups.length + 1}`, name: "Discipline elective", minCredits: 4 }])}><Plus /> Group</Button>}
        </div>
        <ul className="divide-y">
          {v.groups.map((g, i) => (
            <li key={i} className="grid gap-2 px-5 py-2.5 md:grid-cols-[100px_1fr_140px_auto]">
              <Input aria-label="Group code" disabled={readOnly} value={g.code} onChange={(e) => set("groups", v.groups.map((x, j) => (j === i ? { ...x, code: e.target.value.toUpperCase() } : x)))} />
              <Input aria-label="Group name" disabled={readOnly} value={g.name} onChange={(e) => set("groups", v.groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input aria-label="Minimum credits" type="number" min={0} disabled={readOnly} value={g.minCredits} onChange={(e) => set("groups", v.groups.map((x, j) => (j === i ? { ...x, minCredits: Number(e.target.value) } : x)))} />
              {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove group" onClick={() => set("groups", v.groups.filter((_, j) => j !== i))}><Trash2 /></Button>}
            </li>
          ))}
          {v.groups.length === 0 && <li className="px-5 py-3 text-sm text-muted-foreground">No elective groups.</li>}
        </ul>
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Courses by semester</h2>
          {!readOnly && (
            <div className="ml-auto flex gap-2">
              <select aria-label="Course to add" className={`${field} h-8 max-w-80 text-[13px]`} value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Add a course…</option>
                {courses.filter((c) => !v.courses.some((r) => r.courseId === c.id)).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} ({c.credits} cr)</option>)}
              </select>
              <Button size="xs" variant="outline" disabled={!adding} onClick={() => { set("courses", [...v.courses, { courseId: adding, semesterNumber: semesters.at(-1) ?? 1, category: "MANDATORY", groupCode: null }]); setAdding(""); }}><Plus /> Add</Button>
            </div>
          )}
        </div>
        {(semesters.length ? semesters : [1]).map((sem) => (
          <div key={sem}>
            <div className="border-b bg-muted/40 px-5 py-1.5 text-xs font-semibold">Semester {sem} · {v.courses.filter((r) => r.semesterNumber === sem).reduce((a, r) => a + (byId.get(r.courseId)?.credits ?? 0), 0)} credits</div>
            <ul className="divide-y">
              {v.courses.map((r, i) => ({ r, i })).filter(({ r }) => r.semesterNumber === sem).map(({ r, i }) => {
                const c = byId.get(r.courseId);
                return (
                  <li key={r.courseId} className="grid items-center gap-2 px-5 py-2 text-sm md:grid-cols-[1fr_90px_140px_140px_auto]">
                    <span><span className="font-mono text-xs text-muted-foreground">{c?.code}</span> {c?.title} <span className="text-xs text-muted-foreground">· {c?.credits} cr</span></span>
                    <Input aria-label="Semester" type="number" min={1} max={16} disabled={readOnly} value={r.semesterNumber} onChange={(e) => set("courses", v.courses.map((x, j) => (j === i ? { ...x, semesterNumber: Number(e.target.value) } : x)))} />
                    <select aria-label="Category" className={field} disabled={readOnly} value={r.category} onChange={(e) => set("courses", v.courses.map((x, j) => (j === i ? { ...x, category: e.target.value as Row["category"], groupCode: e.target.value === "MANDATORY" ? null : x.groupCode } : x)))}>
                      <option value="MANDATORY">Mandatory</option>
                      <option value="ELECTIVE">Elective</option>
                    </select>
                    <select aria-label="Elective group" className={field} disabled={readOnly || r.category !== "ELECTIVE"} value={r.groupCode ?? ""} onChange={(e) => set("courses", v.courses.map((x, j) => (j === i ? { ...x, groupCode: e.target.value || null } : x)))}>
                      <option value="">No group</option>
                      {v.groups.map((g) => <option key={g.code} value={g.code}>{g.code}</option>)}
                    </select>
                    {!readOnly && <Button size="icon-sm" variant="ghost" aria-label={`Remove ${c?.code}`} onClick={() => set("courses", v.courses.filter((_, j) => j !== i))}><Trash2 /></Button>}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>

      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Other graduation requirements</h2>
          {!readOnly && <Button size="xs" variant="outline" onClick={() => set("requirements", [...v.requirements, { kind: "CATEGORY_CREDITS", label: "Project / internship", courseTypes: ["PROJECT"], minCredits: 4 }])}><Plus /> Requirement</Button>}
        </div>
        <ul className="divide-y">
          {v.requirements.map((r, i) => (
            <li key={i} className="grid items-center gap-2 px-5 py-2.5 md:grid-cols-[1fr_220px_120px_auto]">
              <Input aria-label="Requirement label" disabled={readOnly} value={r.label} onChange={(e) => set("requirements", v.requirements.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              {r.kind === "CATEGORY_CREDITS" ? (
                <select aria-label="Course type" className={field} disabled={readOnly} value={r.courseTypes[0]} onChange={(e) => set("requirements", v.requirements.map((x, j) => (j === i ? { ...r, courseTypes: [e.target.value] } : x)))}>
                  {COURSE_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()} courses</option>)}
                </select>
              ) : <span className="text-sm text-muted-foreground">Minimum CGPA</span>}
              <Input aria-label="Minimum" type="number" step={r.kind === "MIN_CGPA" ? 0.01 : 1} disabled={readOnly} value={r.kind === "MIN_CGPA" ? r.value : r.minCredits} onChange={(e) => set("requirements", v.requirements.map((x, j) => (j === i ? (r.kind === "MIN_CGPA" ? { ...r, value: Number(e.target.value) } : { ...r, minCredits: Number(e.target.value) }) : x)))} />
              {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove requirement" onClick={() => set("requirements", v.requirements.filter((_, j) => j !== i))}><Trash2 /></Button>}
            </li>
          ))}
          {v.requirements.length === 0 && <li className="px-5 py-3 text-sm text-muted-foreground">None beyond credits, mandatory courses and elective groups.</li>}
        </ul>
      </section>

      {!readOnly && (
        <div className="flex justify-end">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveCurriculumAction(id, v);
            if (!r.ok) {
              toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m.join(", ")}`).join(" · ") : undefined });
              return;
            }
            toast.success("Curriculum saved");
            if (!id) router.push(`/academics/curricula/${r.data.id}`);
            else router.refresh();
          })}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save draft</Button>
        </div>
      )}
    </div>
  );
}
