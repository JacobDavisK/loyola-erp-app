"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveGradingSchemeAction } from "@/features/results/actions";

type Band = { grade: string; minPercent: number; gradePoint: number; pass: boolean };
export interface SchemeValue {
  code: string;
  name: string;
  bands: Band[];
  passPercent: number;
  minExternalPercent: number;
  minInternalPercent: number;
  absentGrade: string;
  failGrade: string;
  withheldGrade: string;
  graceMaxPerCourse: number;
  graceMaxTotal: number;
  gpaDecimals: number;
}

export function GradingEditor({ id, initial, trigger, status }: { id: string | null; initial: SchemeValue; trigger: React.ReactNode; status?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const num = (k: keyof SchemeValue, label: string, step = 1) => (
    <div className="space-y-1"><Label htmlFor={`g-${k}`}>{label}</Label><Input id={`g-${k}`} type="number" step={step} value={String(v[k])} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} /></div>
  );
  const txt = (k: keyof SchemeValue, label: string) => (
    <div className="space-y-1"><Label htmlFor={`g-${k}`}>{label}</Label><Input id={`g-${k}`} value={String(v[k])} disabled={k === "code" && !!id} onChange={(e) => setV({ ...v, [k]: k === "code" ? e.target.value.toUpperCase() : e.target.value })} /></div>
  );
  const bands = [...v.bands].sort((a, b) => b.minPercent - a.minPercent);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setV(initial); }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{id ? `Edit ${initial.code}` : "New grading scheme"}</DialogTitle>
          <DialogDescription>{status === "ACTIVE" || status === "RETIRED" ? "This version is in use. Saving creates the next version as a draft; results already computed keep the version they used." : "Grade bands, pass rules and grace limits. Results record the exact version used."}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-4">
          {txt("code", "Code")}
          <div className="sm:col-span-3">{txt("name", "Name")}</div>
          {num("passPercent", "Pass % (overall)")}
          {num("minExternalPercent", "Min % in end-semester")}
          {num("minInternalPercent", "Min % in internal")}
          {num("gpaDecimals", "GPA decimals")}
          {num("graceMaxPerCourse", "Grace per course (marks)", 0.5)}
          {num("graceMaxTotal", "Grace per student (marks)", 0.5)}
          {txt("absentGrade", "Absent grade")}
          {txt("failGrade", "Fail grade")}
          {txt("withheldGrade", "Withheld grade")}
        </div>
        <fieldset className="mt-2">
          <legend className="mb-2 text-sm font-medium">Grade bands</legend>
          <div className="space-y-1.5">
            {bands.map((b) => {
              const i = v.bands.indexOf(b);
              const set = (p: Partial<Band>) => setV({ ...v, bands: v.bands.map((x, j) => (j === i ? { ...x, ...p } : x)) });
              return (
                <div key={i} className="grid grid-cols-[80px_110px_110px_auto_auto] items-center gap-2 text-sm">
                  <Input aria-label="Grade" value={b.grade} onChange={(e) => set({ grade: e.target.value })} />
                  <Input aria-label="From %" type="number" value={b.minPercent} onChange={(e) => set({ minPercent: Number(e.target.value) })} />
                  <Input aria-label="Grade point" type="number" step={0.5} value={b.gradePoint} onChange={(e) => set({ gradePoint: Number(e.target.value) })} />
                  <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={b.pass} onChange={(e) => set({ pass: e.target.checked })} /> Pass</label>
                  <Button size="icon-sm" variant="ghost" aria-label={`Remove ${b.grade}`} onClick={() => setV({ ...v, bands: v.bands.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              );
            })}
            <div className="grid grid-cols-[80px_110px_110px] gap-2 text-[11px] text-muted-foreground"><span>Grade</span><span>From %</span><span>Grade point</span></div>
          </div>
          <Button size="xs" variant="outline" className="mt-2" onClick={() => setV({ ...v, bands: [...v.bands, { grade: "", minPercent: 0, gradePoint: 0, pass: true }] })}><Plus /> Band</Button>
        </fieldset>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveGradingSchemeAction(id, v);
            if (!r.ok) {
              toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
              return;
            }
            toast.success("Saved");
            setOpen(false);
            router.refresh();
          })}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
