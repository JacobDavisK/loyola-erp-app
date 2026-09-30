"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCheck, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveAttendanceAction } from "@/features/academic-ops/actions";
import { ATTENDANCE_MARK_LABEL } from "@/lib/domain/labels";
import { cn } from "@/lib/utils";

type Mark = keyof typeof ATTENDANCE_MARK_LABEL;
const QUICK: Mark[] = ["PRESENT", "ABSENT", "LATE", "ON_DUTY", "MEDICAL", "EXCUSED"];
const KEYS: Record<string, Mark> = { p: "PRESENT", a: "ABSENT", l: "LATE", o: "ON_DUTY", m: "MEDICAL", e: "EXCUSED" };
const TONE: Record<Mark, string> = {
  PRESENT: "bg-tone-success text-white border-tone-success",
  ABSENT: "bg-tone-danger text-white border-tone-danger",
  LATE: "bg-tone-warning text-white border-tone-warning",
  ON_DUTY: "bg-tone-info text-white border-tone-info",
  MEDICAL: "bg-tone-progress text-white border-tone-progress",
  EXCUSED: "bg-tone-neutral text-white border-tone-neutral",
};

export interface SheetStudent {
  id: string;
  studentNo: string;
  name: string;
  mark: Mark | null;
}

/**
 * Attendance roll. Tap a mark, or focus a row and press P / A / L / O / M / E (then ↓ moves on).
 * Unmarked students must be marked before saving so nobody is silently skipped.
 */
export function AttendanceSheet({ meetingId, students, initialTopic, readOnly, correcting }: { meetingId: string; students: SheetStudent[]; initialTopic: string; readOnly: boolean; correcting: boolean }) {
  const router = useRouter();
  const [marks, setMarks] = useState<Record<string, Mark | null>>(() => Object.fromEntries(students.map((s) => [s.id, s.mark])));
  const [topic, setTopic] = useState(initialTopic);
  const [pending, start] = useTransition();
  const unmarked = students.filter((s) => !marks[s.id]).length;
  const counts = QUICK.map((m) => [m, Object.values(marks).filter((x) => x === m).length] as const).filter(([, n]) => n > 0);
  const setMark = (id: string, m: Mark) => setMarks((x) => ({ ...x, [id]: m }));

  return (
    <div className="space-y-4">
      <div className="surface-card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-60 flex-1 space-y-1.5"><Label htmlFor="topic">Topic covered</Label><Input id="topic" value={topic} disabled={readOnly} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Unit 2 — linked lists" /></div>
        {!readOnly && <Button variant="outline" onClick={() => setMarks(Object.fromEntries(students.map((s) => [s.id, marks[s.id] ?? "PRESENT"])))}><CheckCheck /> Mark rest present</Button>}
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {students.length} students · {counts.map(([m, n]) => `${n} ${ATTENDANCE_MARK_LABEL[m].label.toLowerCase()}`).join(" · ") || "none marked"}{unmarked ? ` · ${unmarked} not marked` : ""}
        {!readOnly && " · keys: P A L O M E"}
      </p>
      <ol className="surface-card divide-y">
        {students.map((s, idx) => (
          <li
            key={s.id}
            tabIndex={readOnly ? undefined : 0}
            aria-label={`${s.name}, ${marks[s.id] ? ATTENDANCE_MARK_LABEL[marks[s.id]!].label : "not marked"}`}
            onKeyDown={(e) => {
              if (readOnly) return;
              const m = KEYS[e.key.toLowerCase()];
              if (m) {
                e.preventDefault();
                setMark(s.id, m);
                (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
              }
            }}
            className="flex flex-wrap items-center gap-3 px-4 py-2.5 outline-none focus-visible:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <span className="w-6 text-right text-xs text-muted-foreground tabular">{idx + 1}</span>
            <span className="min-w-40 flex-1"><span className="font-medium">{s.name}</span><span className="block font-mono text-[11px] text-muted-foreground">{s.studentNo}</span></span>
            <div role="radiogroup" aria-label={`Attendance for ${s.name}`} className="flex flex-wrap gap-1">
              {QUICK.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={marks[s.id] === m}
                  disabled={readOnly}
                  title={ATTENDANCE_MARK_LABEL[m].label}
                  onClick={() => setMark(s.id, m)}
                  className={cn("h-8 min-w-9 rounded-md border px-2 text-xs font-semibold transition-colors disabled:opacity-60", marks[s.id] === m ? TONE[m] : "bg-card hover:bg-muted")}
                >
                  {ATTENDANCE_MARK_LABEL[m].short}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ol>
      {!readOnly && (
        <div className="sticky bottom-3 flex justify-end">
          <Button
            size="lg"
            disabled={pending || unmarked > 0}
            onClick={() =>
              start(async () => {
                const r = await saveAttendanceAction(meetingId, { topic: topic || null, marks: students.map((s) => ({ studentId: s.id, mark: marks[s.id]! })) });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(correcting ? `Correction saved (${r.data.changed} changed)` : "Attendance saved");
                router.refresh();
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : <Save />} {unmarked ? `${unmarked} still unmarked` : correcting ? "Save correction" : "Save attendance"}
          </Button>
        </div>
      )}
    </div>
  );
}
