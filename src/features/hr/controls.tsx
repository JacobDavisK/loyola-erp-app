"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  activateSalaryStructureAction, cancelLeaveAction, markPayrollPaidAction, markStaffAttendanceAction, saveHrSettingsAction, saveSalaryStructureAction, submitManagerReviewAction,
  submitSelfReviewAction,
} from "@/features/hr/actions";
import { STAFF_ATTENDANCE_LABEL } from "@/lib/domain/labels";
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
        toast.success(r.message ?? "Done");
        after?.(r);
        router.refresh();
      }),
  };
}

export function CancelLeaveButton({ id, approved }: { id: string; approved: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => {
      const reason = prompt(approved ? "Reason for cancelling this approved leave? The days will be restored to the balance." : "Reason for withdrawing this application?");
      if (reason) run(() => cancelLeaveAction(id, reason));
    }}>{pending && <Loader2 className="animate-spin" />} {approved ? "Cancel leave" : "Withdraw"}</Button>
  );
}

export function MarkPayrollPaidButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" disabled={pending} onClick={() => {
      const ref = prompt("Bank transfer reference (NEFT batch / UTR)?");
      if (ref) run(() => markPayrollPaidAction(id, ref));
    }}>{pending && <Loader2 className="animate-spin" />} Mark paid</Button>
  );
}

export function ActivateSalaryStructureButton({ id, hasPrevious }: { id: string; hasPrevious: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="xs" variant="outline" disabled={pending} onClick={() => {
      let eff: string | null = null;
      if (hasPrevious) {
        eff = prompt("Move employees on the previous version to this one from which date? (YYYY-MM-DD, leave empty to move nobody)") || null;
        if (eff && !/^\d{4}-\d{2}-\d{2}$/.test(eff)) { toast.error("Use the format YYYY-MM-DD"); return; }
      }
      run(() => activateSalaryStructureAction(id, eff));
    }}>{pending && <Loader2 className="animate-spin" />} Activate</Button>
  );
}

// ───────────────────────── Staff attendance ─────────────────────────

type AttStatus = keyof typeof STAFF_ATTENDANCE_LABEL;
const MARKABLE: AttStatus[] = ["PRESENT", "ABSENT", "HALF_DAY", "ON_DUTY", "HOLIDAY"];

export function StaffAttendanceBoard({ date, rows }: { date: string; rows: { id: string; no: string; name: string; dept: string; status: AttStatus | null; locked: boolean }[] }) {
  const { pending, run } = useRun();
  const [v, setV] = useState<Record<string, AttStatus | null>>(() => Object.fromEntries(rows.map((r) => [r.id, r.status])));
  const editable = rows.filter((r) => !r.locked);
  const unmarked = editable.filter((r) => !v[r.id]).length;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">{unmarked ? `${unmarked} not marked` : "Everyone marked"}</span>
        <Button size="xs" variant="outline" className="ml-auto" onClick={() => setV({ ...v, ...Object.fromEntries(editable.filter((r) => !v[r.id]).map((r) => [r.id, "PRESENT" as const])) })}>Mark the rest present</Button>
        <Button size="xs" disabled={pending || editable.every((r) => !v[r.id])} onClick={() => run(() => markStaffAttendanceAction({ date, entries: editable.filter((r) => v[r.id]).map((r) => ({ employeeId: r.id, status: v[r.id]! })) }))}>
          {pending ? <Loader2 className="animate-spin" /> : <Save />} Save
        </Button>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
            <span className="w-24 font-mono text-xs text-muted-foreground">{r.no}</span>
            <span className="min-w-40 flex-1 text-sm">{r.name}<span className="ml-2 text-xs text-muted-foreground">{r.dept}</span></span>
            {r.locked ? (
              <span className="text-xs text-muted-foreground">{STAFF_ATTENDANCE_LABEL[r.status ?? "ON_LEAVE"].label} (approved leave)</span>
            ) : (
              <div role="radiogroup" aria-label={`Attendance for ${r.name}`} className="flex gap-1">
                {MARKABLE.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={v[r.id] === s} title={STAFF_ATTENDANCE_LABEL[s].label}
                    className={cn("h-7 min-w-9 rounded-md border px-1.5 text-xs font-medium", v[r.id] === s ? (s === "ABSENT" ? "border-destructive bg-destructive text-white" : "border-primary bg-primary text-primary-foreground") : "hover:bg-muted")}
                    onClick={() => setV({ ...v, [r.id]: s })}>{STAFF_ATTENDANCE_LABEL[s].short}</button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ───────────────────────── Salary structure editor ─────────────────────────

type Calc = "FIXED" | "PERCENT_OF_BASIC" | "PERCENT_OF_GROSS" | "INCOME_TAX";
interface SLine { componentId: string; calc: Calc; value: string; cap: string }
const CALC_LABEL: Record<Calc, string> = { FIXED: "Fixed amount", PERCENT_OF_BASIC: "% of basic", PERCENT_OF_GROSS: "% of gross", INCOME_TAX: "Income tax (slabs)" };

export function SalaryStructureEditor({ id, initial, components, readOnly }: { id: string | null; initial: { code: string; name: string; lines: SLine[] }; components: { id: string; label: string; kind: string }[]; readOnly: boolean }) {
  const router = useRouter();
  const { pending, run } = useRun();
  const [code, setCode] = useState(initial.code);
  const [name, setName] = useState(initial.name);
  const [lines, setLines] = useState<SLine[]>(initial.lines);
  const patch = (i: number, p: Partial<SLine>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
        <div className="space-y-1.5"><Label htmlFor="ss-code">Code</Label><Input id="ss-code" value={code} disabled={!!id || readOnly} onChange={(e) => setCode(e.target.value.toUpperCase())} /></div>
        <div className="space-y-1.5"><Label htmlFor="ss-name">Name</Label><Input id="ss-name" value={name} disabled={readOnly} onChange={(e) => setName(e.target.value)} /></div>
      </div>
      <p className="text-xs text-muted-foreground">Basic pay is set per employee. Components are applied in this order: earnings on basic, then earnings on gross, then deductions and employer contributions.</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Component</th><th className="font-medium">Computed as</th><th className="font-medium">Value</th><th className="font-medium">Monthly cap</th><th /></tr></thead>
        <tbody className="divide-y">
          {lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1.5 pr-2"><select aria-label="Component" className={field} disabled={readOnly} value={l.componentId} onChange={(e) => patch(i, { componentId: e.target.value })}>{components.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></td>
              <td className="pr-2"><select aria-label="Calculation" className={field} disabled={readOnly} value={l.calc} onChange={(e) => patch(i, { calc: e.target.value as Calc })}>{(Object.keys(CALC_LABEL) as Calc[]).map((c) => <option key={c} value={c}>{CALC_LABEL[c]}</option>)}</select></td>
              <td className="w-32 pr-2"><Input aria-label="Value" type="number" min={0} step="0.01" disabled={readOnly || l.calc === "INCOME_TAX"} value={l.value} onChange={(e) => patch(i, { value: e.target.value })} /></td>
              <td className="w-32 pr-2"><Input aria-label="Cap" type="number" min={0} step="0.01" disabled={readOnly || l.calc === "FIXED" || l.calc === "INCOME_TAX"} placeholder="none" value={l.cap} onChange={(e) => patch(i, { cap: e.target.value })} /></td>
              <td className="w-10">{!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove component" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button size="xs" variant="outline" onClick={() => setLines([...lines, { componentId: components[0]?.id ?? "", calc: "PERCENT_OF_BASIC", value: "0", cap: "" }])}><Plus /> Component</Button>
          <Button size="sm" className="ml-auto" disabled={pending} onClick={() => run(
            () => saveSalaryStructureAction(id, { code, name, lines: lines.map((l) => ({ componentId: l.componentId, calc: l.calc, value: Number(l.value || 0), cap: l.cap ? Number(l.cap) : null })) }),
            (r) => { const newId = (r.data as { id?: string } | undefined)?.id; if (newId && newId !== id) router.push(`/hr/setup/structures/${newId}`); },
          )}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id ? "Save" : "Create"}</Button>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── HR settings ─────────────────────────

interface HrSettings {
  employeePrefix: string; workWeek: number[]; payrollWorkingDays: number; absentIsLossOfPay: boolean; taxEnabled: boolean;
  tax: { standardDeduction: number; slabs: { upTo: number | null; rate: number }[]; rebateLimit: number; rebateMax: number; cessPercent: number };
}
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function HrSettingsForm({ initial, readOnly }: { initial: HrSettings; readOnly: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState(initial);
  const setTax = (p: Partial<HrSettings["tax"]>) => setV({ ...v, tax: { ...v.tax, ...p } });
  const setSlab = (i: number, p: Partial<{ upTo: number | null; rate: number }>) => setTax({ slabs: v.tax.slabs.map((s, j) => (j === i ? { ...s, ...p } : s)) });
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); run(() => saveHrSettingsAction(v)); }}>
      <fieldset disabled={readOnly} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5"><Label htmlFor="hs-prefix">Employee number prefix</Label><Input id="hs-prefix" value={v.employeePrefix} onChange={(e) => setV({ ...v, employeePrefix: e.target.value })} /><p className="text-xs text-muted-foreground">{"{YY}"} and {"{YYYY}"} insert the year.</p></div>
          <div className="space-y-1.5"><Label htmlFor="hs-wd">Payroll working days</Label><Input id="hs-wd" type="number" min={0} max={31} value={v.payrollWorkingDays} onChange={(e) => setV({ ...v, payrollWorkingDays: Number(e.target.value) })} /><p className="text-xs text-muted-foreground">0 = calendar days of the month.</p></div>
          <div className="flex flex-col justify-end gap-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.absentIsLossOfPay} onChange={(e) => setV({ ...v, absentIsLossOfPay: e.target.checked })} /> Absence without leave is loss of pay</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={v.taxEnabled} onChange={(e) => setV({ ...v, taxEnabled: e.target.checked })} /> Withhold income tax</label>
          </div>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Staff work week</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm">
                <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={v.workWeek.includes(i + 1)} onChange={(e) => setV({ ...v, workWeek: e.target.checked ? [...v.workWeek, i + 1].sort() : v.workWeek.filter((x) => x !== i + 1) })} /> {d}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Holidays come from the academic calendar (events of type Holiday).</p>
        </fieldset>
        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 text-sm font-medium">Income tax withholding</legend>
          <p className="text-xs text-muted-foreground">A configurable slab projection used to estimate monthly withholding. Keep these values in line with current law; this is not tax advice.</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5"><Label htmlFor="hs-sd">Standard deduction (a year)</Label><Input id="hs-sd" type="number" min={0} value={v.tax.standardDeduction} onChange={(e) => setTax({ standardDeduction: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="hs-rl">Rebate up to income</Label><Input id="hs-rl" type="number" min={0} value={v.tax.rebateLimit} onChange={(e) => setTax({ rebateLimit: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="hs-rm">Maximum rebate</Label><Input id="hs-rm" type="number" min={0} value={v.tax.rebateMax} onChange={(e) => setTax({ rebateMax: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="hs-cess">Cess %</Label><Input id="hs-cess" type="number" min={0} max={100} step="0.5" value={v.tax.cessPercent} onChange={(e) => setTax({ cessPercent: Number(e.target.value) })} /></div>
          </div>
          <table className="text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground"><th className="pr-3 font-medium">Taxable income up to</th><th className="pr-3 font-medium">Rate %</th><th /></tr></thead>
            <tbody>
              {v.tax.slabs.map((s, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3"><Input aria-label={`Slab ${i + 1} upper limit`} type="number" min={0} placeholder="no limit" value={s.upTo ?? ""} onChange={(e) => setSlab(i, { upTo: e.target.value ? Number(e.target.value) : null })} /></td>
                  <td className="py-1 pr-3"><Input aria-label={`Slab ${i + 1} rate`} type="number" min={0} max={100} step="0.5" value={s.rate} onChange={(e) => setSlab(i, { rate: Number(e.target.value) })} /></td>
                  <td><Button type="button" size="icon-sm" variant="ghost" aria-label="Remove slab" disabled={v.tax.slabs.length === 1} onClick={() => setTax({ slabs: v.tax.slabs.filter((_, j) => j !== i) })}><Trash2 /></Button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <Button type="button" size="xs" variant="outline" onClick={() => setTax({ slabs: [...v.tax.slabs, { upTo: null, rate: 0 }] })}><Plus /> Slab</Button>
        </fieldset>
      </fieldset>
      {!readOnly && <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save settings</Button></div>}
    </form>
  );
}

// ───────────────────────── Appraisal ─────────────────────────

export function AppraisalForm({ id, mode, criteria }: { id: string; mode: "self" | "manager"; criteria: { key: string; label: string; weight: number }[] }) {
  const { pending, run } = useRun();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comments, setComments] = useState("");
  const complete = criteria.every((c) => ratings[c.key]) && comments.trim().length >= 10;
  return (
    <div className="space-y-3">
      {criteria.map((c) => (
        <fieldset key={c.key} className="flex flex-wrap items-center gap-3">
          <legend className="sr-only">{c.label}</legend>
          <span className="min-w-56 flex-1 text-sm">{c.label} <span className="text-xs text-muted-foreground">({c.weight}%)</span></span>
          <div className="flex gap-1" role="radiogroup" aria-label={c.label}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={ratings[c.key] === n} className={cn("size-8 rounded-md border text-sm", ratings[c.key] === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")} onClick={() => setRatings({ ...ratings, [c.key]: n })}>{n}</button>
            ))}
          </div>
        </fieldset>
      ))}
      <div className="space-y-1.5"><Label htmlFor={`ap-${id}`}>{mode === "self" ? "Achievements, challenges and goals" : "Reviewer comments"}</Label><Textarea id={`ap-${id}`} rows={4} value={comments} onChange={(e) => setComments(e.target.value)} /></div>
      <div className="flex justify-end">
        <Button disabled={pending || !complete} onClick={() => run(() => (mode === "self" ? submitSelfReviewAction(id, { ratings, comments }) : submitManagerReviewAction(id, { ratings, comments })))}>{pending && <Loader2 className="animate-spin" />} Submit</Button>
      </div>
    </div>
  );
}
