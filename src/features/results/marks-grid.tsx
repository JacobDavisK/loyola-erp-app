"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveMarksAction, submitSheetAction } from "@/features/results/actions";
import { cn } from "@/lib/utils";

type Status = "PRESENT" | "ABSENT" | "MALPRACTICE" | "EXEMPT";
export interface GridRow {
  studentId: string;
  studentNo: string;
  name: string;
  marks: number | null;
  status: Status | null;
  revisions: number;
}

/**
 * Spreadsheet-style marks entry: type a mark and press Enter/↓ to move on; "A" marks absent.
 * Values are validated against the component maximum before saving. Approved sheets can be revised
 * only by the Controller's office, with a reason, and every change is kept.
 */
export function MarksGrid({ componentId, max, rows, editable, revising }: { componentId: string; max: number; rows: GridRow[]; editable: boolean; revising: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, { marks: string; status: Status }>>(() =>
    Object.fromEntries(rows.map((r) => [r.studentId, { marks: r.marks === null ? "" : String(r.marks), status: r.status ?? "PRESENT" }])),
  );
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const readOnly = !editable && !revising;
  const invalid = rows.filter((r) => {
    const v = values[r.studentId];
    if (v.status !== "PRESENT" || v.marks === "") return false;
    const n = Number(v.marks);
    return isNaN(n) || n < 0 || n > max;
  });
  const missing = rows.filter((r) => values[r.studentId].status === "PRESENT" && values[r.studentId].marks === "").length;
  const dirty = rows.some((r) => {
    const v = values[r.studentId];
    return (v.marks === "" ? null : Number(v.marks)) !== r.marks || v.status !== (r.status ?? "PRESENT");
  });
  const entered = rows.map((r) => values[r.studentId]).filter((v) => v.status === "PRESENT" && v.marks !== "").map((v) => Number(v.marks));
  const avg = entered.length ? (entered.reduce((a, b) => a + b, 0) / entered.length).toFixed(1) : "—";

  const save = (then?: () => Promise<void>) =>
    start(async () => {
      const entries = rows
        .map((r) => ({ studentId: r.studentId, marks: values[r.studentId].status === "PRESENT" && values[r.studentId].marks !== "" ? Number(values[r.studentId].marks) : null, status: values[r.studentId].status }))
        .filter((e) => e.marks !== null || e.status !== "PRESENT");
      const r = await saveMarksAction(componentId, { entries, reason: revising ? reason : undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(`${r.data.changed} mark(s) saved`);
      if (then) await then();
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground" aria-live="polite">{rows.length} students · {entered.length} marked · average {avg} / {max}{missing ? ` · ${missing} without a mark` : ""}{!readOnly && " · Enter/↓ next, ↑ previous, “a” absent"}</p>
      <ol className="surface-card divide-y">
        {rows.map((r, i) => {
          const v = values[r.studentId];
          const bad = invalid.includes(r);
          return (
            <li key={r.studentId} className="flex flex-wrap items-center gap-3 px-4 py-2">
              <span className="w-6 text-right text-xs text-muted-foreground tabular">{i + 1}</span>
              <span className="min-w-44 flex-1"><span className="font-medium">{r.name}</span><span className="block font-mono text-[11px] text-muted-foreground">{r.studentNo}{r.revisions ? ` · revised ${r.revisions}×` : ""}</span></span>
              <select aria-label={`Attendance for ${r.name}`} disabled={readOnly} className="h-8 rounded-lg border bg-card px-2 text-xs" value={v.status} onChange={(e) => setValues({ ...values, [r.studentId]: { marks: e.target.value === "PRESENT" ? v.marks : "", status: e.target.value as Status } })}>
                <option value="PRESENT">Present</option><option value="ABSENT">Absent</option><option value="EXEMPT">Exempt</option><option value="MALPRACTICE">Malpractice</option>
              </select>
              <Input
                data-row={i}
                aria-label={`Marks for ${r.name} out of ${max}`}
                aria-invalid={bad}
                inputMode="decimal"
                disabled={readOnly || v.status !== "PRESENT"}
                className={cn("h-8 w-24 text-right tabular", bad && "border-destructive")}
                value={v.marks}
                onChange={(e) => setValues({ ...values, [r.studentId]: { ...v, marks: e.target.value.replace(/[^0-9.]/g, "") } })}
                onKeyDown={(e) => {
                  const go = (d: number) => (document.querySelector(`input[data-row="${i + d}"]`) as HTMLInputElement | null)?.focus();
                  if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); go(1); }
                  if (e.key === "ArrowUp") { e.preventDefault(); go(-1); }
                  if (e.key.toLowerCase() === "a") { e.preventDefault(); setValues({ ...values, [r.studentId]: { marks: "", status: "ABSENT" } }); go(1); }
                }}
              />
            </li>
          );
        })}
      </ol>
      {!readOnly && (
        <div className="sticky bottom-3 flex flex-wrap items-end justify-end gap-2 rounded-xl bg-background/80 p-2 backdrop-blur">
          {revising && <div className="min-w-72 flex-1 space-y-1"><Label htmlFor="rev-reason">Reason for revising approved marks</Label><Input id="rev-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
          <Button variant="outline" disabled={!dirty || invalid.length > 0 || pending || (revising && reason.trim().length < 5)} onClick={() => save()}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
          {editable && (
            <Button disabled={invalid.length > 0 || missing > 0 || pending} onClick={() => {
              if (!confirm("Submit these marks for verification? You cannot edit them unless they are returned.")) return;
              const submit = async () => {
                const r = await submitSheetAction(componentId);
                if (!r.ok) toast.error(r.error);
                else toast.success("Submitted for verification");
              };
              if (dirty) save(submit);
              else start(async () => { await submit(); router.refresh(); });
            }}><Send /> Submit for verification</Button>
          )}
        </div>
      )}
    </div>
  );
}
