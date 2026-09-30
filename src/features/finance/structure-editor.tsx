"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveStructureAction } from "@/features/finance/actions";

type Opt = { id: string; label: string };
type Line = { feeHeadId: string; amount: string; semester: string; termType: string; dueDays: number };
export interface StructureValue {
  code: string;
  name: string;
  academicYearId: string;
  programId: string;
  batchId: string;
  lines: Line[];
}

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

export function StructureEditor({ id, initial, readOnly, heads, years, programs, batches }: { id: string | null; initial: StructureValue; readOnly: boolean; heads: Opt[]; years: Opt[]; programs: Opt[]; batches: Opt[] }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const setLine = (i: number, p: Partial<Line>) => setV({ ...v, lines: v.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  return (
    <div className="space-y-6">
      <section className="surface-card grid gap-4 p-5 md:grid-cols-3">
        <div className="space-y-1.5"><Label htmlFor="fs-code">Code</Label><Input id="fs-code" value={v.code} disabled={!!id || readOnly} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} /></div>
        <div className="space-y-1.5 md:col-span-2"><Label htmlFor="fs-name">Name</Label><Input id="fs-name" value={v.name} disabled={readOnly} onChange={(e) => setV({ ...v, name: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="fs-year">Academic year</Label><select id="fs-year" className={field} value={v.academicYearId} disabled={readOnly} onChange={(e) => setV({ ...v, academicYearId: e.target.value })}>{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="fs-prog">Programme</Label><select id="fs-prog" className={field} value={v.programId} disabled={readOnly} onChange={(e) => setV({ ...v, programId: e.target.value })}><option value="">Any programme</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></div>
        <div className="space-y-1.5"><Label htmlFor="fs-batch">Batch</Label><select id="fs-batch" className={field} value={v.batchId} disabled={readOnly} onChange={(e) => setV({ ...v, batchId: e.target.value })}><option value="">Any batch</option>{batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select></div>
      </section>
      <section className="surface-card overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-sm font-semibold">Fee lines</h2>
          {!readOnly && <Button size="xs" variant="outline" onClick={() => setV({ ...v, lines: [...v.lines, { feeHeadId: heads[0]?.id ?? "", amount: "", semester: "", termType: "", dueDays: 30 }] })}><Plus /> Line</Button>}
        </div>
        <div className="grid grid-cols-[1fr_130px_110px_130px_90px_auto] gap-2 px-5 pt-3 text-[11px] text-muted-foreground max-md:hidden"><span>Fee head</span><span>Amount</span><span>Semester</span><span>Term</span><span>Due (days)</span><span /></div>
        <ul className="space-y-2 p-5 pt-2">
          {v.lines.map((l, i) => (
            <li key={i} className="grid gap-2 md:grid-cols-[1fr_130px_110px_130px_90px_auto]">
              <select aria-label="Fee head" className={field} value={l.feeHeadId} disabled={readOnly} onChange={(e) => setLine(i, { feeHeadId: e.target.value })}>{heads.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}</select>
              <Input aria-label="Amount" inputMode="decimal" value={l.amount} disabled={readOnly} onChange={(e) => setLine(i, { amount: e.target.value.replace(/[^0-9.]/g, "") })} />
              <select aria-label="Semester" className={field} value={l.semester} disabled={readOnly} onChange={(e) => setLine(i, { semester: e.target.value })}><option value="">Every</option>{Array.from({ length: 10 }, (_, k) => <option key={k + 1} value={k + 1}>Semester {k + 1}</option>)}</select>
              <select aria-label="Term type" className={field} value={l.termType} disabled={readOnly} onChange={(e) => setLine(i, { termType: e.target.value })}><option value="">Both terms</option><option value="ODD">Odd term</option><option value="EVEN">Even term</option></select>
              <Input aria-label="Due in days" type="number" min={0} value={l.dueDays} disabled={readOnly} onChange={(e) => setLine(i, { dueDays: Number(e.target.value) })} />
              {!readOnly && <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
        <p className="px-5 pb-4 text-xs text-muted-foreground">A line applies to a student when its semester (if set) matches and its term (if set) matches the invoiced term.</p>
      </section>
      {!readOnly && (
        <div className="flex justify-end">
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await saveStructureAction(id, { ...v, programId: v.programId || null, batchId: v.batchId || null, lines: v.lines.map((l) => ({ feeHeadId: l.feeHeadId, amount: Number(l.amount), semester: l.semester ? Number(l.semester) : null, termType: l.termType || null, dueDays: l.dueDays })) });
            if (!r.ok) {
              toast.error(r.error, { description: r.fieldErrors ? Object.values(r.fieldErrors).flat().join(" · ") : undefined });
              return;
            }
            toast.success("Saved");
            router.push(`/finance/setup/structures/${r.data.id}`);
            router.refresh();
          })}>{pending ? <Loader2 className="animate-spin" /> : <Save />} {id && readOnly === false ? "Save" : "Save draft"}</Button>
        </div>
      )}
    </div>
  );
}
