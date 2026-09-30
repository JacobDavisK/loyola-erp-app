"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createAssignmentAction } from "@/features/papers/actions";

export interface PersonOption {
  id: string;
  name: string;
  dept: string | null;
  load?: number;
  recommended?: boolean;
}

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export function AppointSetterDialog({
  exams,
  setters,
  defaultExamId,
  defaultDeadline,
  defaultOpen,
  trigger,
}: {
  exams: { id: string; label: string; dept: string; usedSets: string[]; moderatorId: string | null; recommendedIds: string[] }[];
  setters: PersonOption[];
  defaultExamId?: string;
  defaultDeadline?: string;
  defaultOpen?: boolean;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);
  const [examId, setExamId] = useState(defaultExamId ?? exams[0]?.id ?? "");
  const exam = exams.find((e) => e.id === examId);
  const nextSet = useMemo(() => ["A", "B", "C", "D"].find((l) => !exam?.usedSets.includes(l)) ?? "E", [exam]);
  const [setLabel, setSetLabel] = useState(nextSet);
  const [setterId, setSetterId] = useState("");
  const [backupId, setBackupId] = useState("");
  const [deadline, setDeadline] = useState(defaultDeadline ?? "");
  const [instructions, setInstructions] = useState("Set the paper strictly as per the blueprint. Cover all units and avoid questions used in the last two sessions.");
  const [pending, start] = useTransition();

  const ordered = useMemo(() => {
    const rec = new Set(exam?.recommendedIds ?? []);
    return [...setters]
      .filter((s) => s.id !== exam?.moderatorId)
      .sort((a, b) => Number(rec.has(b.id)) - Number(rec.has(a.id)) || Number(b.dept === exam?.dept) - Number(a.dept === exam?.dept) || (a.load ?? 0) - (b.load ?? 0));
  }, [setters, exam]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm"><UserPlus /> Appoint setter</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createAssignmentAction({ examinationId: examId, setterId, backupSetterId: backupId || null, setLabel, deadline, instructions: instructions.trim() || null });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(res.message ?? "Setter appointed");
              setOpen(false);
              setSetterId("");
              setBackupId("");
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Appoint paper setter</DialogTitle>
            <DialogDescription>The setter is notified and must accept before the paper workspace opens. Workload and HOD recommendations are shown to help you choose.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-[1fr_90px]">
            <div className="space-y-1.5">
              <Label htmlFor="examId">Examination</Label>
              <select id="examId" className={field} value={examId} onChange={(e) => { setExamId(e.target.value); const ex = exams.find((x) => x.id === e.target.value); setSetLabel(["A", "B", "C", "D"].find((l) => !ex?.usedSets.includes(l)) ?? "E"); }} required>
                {exams.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="setLabel">Set</Label>
              <Input id="setLabel" value={setLabel} maxLength={3} onChange={(e) => setSetLabel(e.target.value.toUpperCase())} required />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="setterId">Setter</Label>
              <select id="setterId" className={field} value={setterId} onChange={(e) => setSetterId(e.target.value)} required>
                <option value="">Choose…</option>
                {ordered.map((s) => (
                  <option key={s.id} value={s.id}>
                    {exam?.recommendedIds.includes(s.id) ? "★ " : ""}{s.name}{s.dept ? ` (${s.dept})` : ""} · {s.load ?? 0} active
                  </option>
                ))}
              </select>
              {exam && exam.recommendedIds.length > 0 && <p className="text-[11px] text-muted-foreground">★ recommended by the Head of Department</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="backupId">Backup setter (optional)</Label>
              <select id="backupId" className={field} value={backupId} onChange={(e) => setBackupId(e.target.value)}>
                <option value="">None</option>
                {ordered.filter((s) => s.id !== setterId).map((s) => <option key={s.id} value={s.id}>{s.name}{s.dept ? ` (${s.dept})` : ""}</option>)}
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deadline">Submission deadline</Label>
            <Input id="deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} required min={new Date().toISOString().slice(0, 10)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="instructions">Instructions to the setter</Label>
            <Textarea id="instructions" rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending || !setterId || !deadline || !examId}>{pending && <Loader2 className="animate-spin" />} Appoint & notify</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
