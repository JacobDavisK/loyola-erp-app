"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateExaminationAction } from "@/features/examinations/actions";

type Opt = { id: string; label: string };
const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:opacity-60";

export function ExamSettingsForm({
  examId,
  disabled,
  moderators,
  scrutinizers,
  blueprints,
  templates,
  initial,
}: {
  examId: string;
  disabled: boolean;
  moderators: Opt[];
  scrutinizers: Opt[];
  blueprints: Opt[];
  templates: Opt[];
  initial: {
    moderatorId: string;
    scrutinizerId: string;
    blueprintId: string;
    templateId: string;
    maxMarks: number;
    durationMinutes: number;
    notes: string;
    date: string;
    slot: "FN" | "AN";
    startTime: string;
    venue: string;
  };
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const sel = (k: "moderatorId" | "scrutinizerId" | "blueprintId" | "templateId", label: string, opts: Opt[], none: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <select id={k} className={field} value={v[k]} disabled={disabled} onChange={(e) => set(k, e.target.value)}>
        <option value="">{none}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateExaminationAction(examId, {
            moderatorId: v.moderatorId || null,
            scrutinizerId: v.scrutinizerId || null,
            blueprintId: v.blueprintId || null,
            templateId: v.templateId || null,
            maxMarks: Number(v.maxMarks),
            durationMinutes: Number(v.durationMinutes),
            notes: v.notes || null,
            schedule: v.date ? { date: v.date, slot: v.slot, startTime: v.startTime, venue: v.venue || null } : null,
          });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("Examination updated");
          router.refresh();
        });
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        {sel("moderatorId", "Moderator", moderators, "Not appointed")}
        {sel("scrutinizerId", "Scrutiny officer", scrutinizers, "Not appointed")}
        {sel("blueprintId", "Blueprint / paper pattern", blueprints, "No blueprint")}
        {sel("templateId", "Paper template", templates, "Default template")}
      </div>
      <div className="grid gap-4 md:grid-cols-5">
        <div className="space-y-1.5">
          <Label htmlFor="maxMarks">Max marks</Label>
          <Input id="maxMarks" type="number" min={1} value={v.maxMarks} disabled={disabled} onChange={(e) => set("maxMarks", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="duration">Duration (min)</Label>
          <Input id="duration" type="number" min={15} step={15} value={v.durationMinutes} disabled={disabled} onChange={(e) => set("durationMinutes", Number(e.target.value))} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="date">Exam date</Label>
          <Input id="date" type="date" value={v.date} disabled={disabled} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="slot">Slot</Label>
          <select id="slot" className={field} value={v.slot} disabled={disabled} onChange={(e) => { const slot = e.target.value as "FN" | "AN"; set("slot", slot); set("startTime", slot === "FN" ? "10:00" : "14:00"); }}>
            <option value="FN">Forenoon (FN)</option>
            <option value="AN">Afternoon (AN)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="startTime">Starts</Label>
          <Input id="startTime" type="time" value={v.startTime} disabled={disabled} onChange={(e) => set("startTime", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="venue">Venue</Label>
          <Input id="venue" value={v.venue} disabled={disabled} onChange={(e) => set("venue", e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="notes">Confidential notes</Label>
          <Textarea id="notes" rows={1} value={v.notes} disabled={disabled} onChange={(e) => set("notes", e.target.value)} />
        </div>
      </div>
      {!disabled && (
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
        </div>
      )}
    </form>
  );
}
