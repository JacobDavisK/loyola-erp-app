"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createSessionAction, updateSessionAction } from "@/features/examinations/actions";
import { EXAM_TYPE_LABEL } from "@/lib/domain/labels";

export interface SessionFormValues {
  name: string;
  code: string;
  academicYearId: string;
  termType: "ODD" | "EVEN";
  examType: keyof typeof EXAM_TYPE_LABEL;
  startDate: string;
  endDate: string;
  settingDeadline: string;
  moderationDeadline: string;
  scrutinyDeadline: string;
  approvalDeadline: string;
  programIds: string[];
  description: string;
}

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30";

export function SessionFormDialog({
  years,
  programs,
  initial,
  sessionId,
  defaultOpen,
  trigger,
}: {
  years: { id: string; label: string }[];
  programs: { id: string; code: string; name: string }[];
  initial?: Partial<SessionFormValues>;
  sessionId?: string;
  defaultOpen?: boolean;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!defaultOpen);
  const [v, setV] = useState<SessionFormValues>({
    name: "",
    code: "",
    academicYearId: years[0]?.id ?? "",
    termType: "ODD",
    examType: "REGULAR",
    startDate: "",
    endDate: "",
    settingDeadline: "",
    moderationDeadline: "",
    scrutinyDeadline: "",
    approvalDeadline: "",
    programIds: programs.map((p) => p.id),
    description: "",
    ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const set = <K extends keyof SessionFormValues>(k: K, val: SessionFormValues[K]) => setV((x) => ({ ...x, [k]: val }));

  const submit = () =>
    start(async () => {
      setErrors({});
      const payload = { ...v, settingDeadline: v.settingDeadline || null, moderationDeadline: v.moderationDeadline || null, scrutinyDeadline: v.scrutinyDeadline || null, approvalDeadline: v.approvalDeadline || null, description: v.description || null };
      const res = sessionId ? await updateSessionAction(sessionId, payload) : await createSessionAction(payload);
      if (!res.ok) {
        if (res.fieldErrors) setErrors(Object.fromEntries(Object.entries(res.fieldErrors).map(([k, m]) => [k, m[0]])));
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Saved");
      setOpen(false);
      if (!sessionId && res.data && typeof res.data === "object" && "id" in res.data) router.push(`/examinations/sessions/${(res.data as { id: string }).id}`);
      else router.refresh();
    });

  const date = (k: keyof SessionFormValues, label: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={k}>{label}</Label>
      <Input id={k} type="date" value={v[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} />
      {errors[k] && <p className="text-xs text-destructive">{errors[k]}</p>}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? <Button size="sm"><Plus /> New session</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{sessionId ? "Edit examination session" : "New examination session"}</DialogTitle>
            <DialogDescription>Sessions group the examinations of one academic term and carry the paper-setting deadlines.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="name">Session name</Label>
              <Input id="name" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="November 2026 End Semester Examinations" aria-invalid={!!errors.name} />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="code">Code</Label>
              <Input id="code" value={v.code} onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="NOV2026" disabled={!!sessionId} aria-invalid={!!errors.code} />
              {errors.code && <p className="text-xs text-destructive">{errors.code}</p>}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="academicYearId">Academic year</Label>
              <select id="academicYearId" className={field} value={v.academicYearId} onChange={(e) => set("academicYearId", e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="termType">Term</Label>
              <select id="termType" className={field} value={v.termType} onChange={(e) => set("termType", e.target.value as "ODD" | "EVEN")}>
                <option value="ODD">Odd semesters</option>
                <option value="EVEN">Even semesters</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="examType">Examination type</Label>
              <select id="examType" className={field} value={v.examType} onChange={(e) => set("examType", e.target.value as SessionFormValues["examType"])}>
                {Object.entries(EXAM_TYPE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {date("startDate", "Examinations start")}
            {date("endDate", "Examinations end")}
          </div>
          <fieldset className="grid gap-4 rounded-lg border p-3 sm:grid-cols-4">
            <legend className="px-1 text-xs font-semibold">Workflow deadlines</legend>
            {date("settingDeadline", "Paper submission")}
            {date("moderationDeadline", "Moderation")}
            {date("scrutinyDeadline", "Scrutiny")}
            {date("approvalDeadline", "Approval")}
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Applicable programmes</legend>
            <div className="flex flex-wrap gap-2">
              {programs.map((p) => (
                <label key={p.id} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-[var(--primary)]"
                    checked={v.programIds.includes(p.id)}
                    onChange={(e) => set("programIds", e.target.checked ? [...v.programIds, p.id] : v.programIds.filter((x) => x !== p.id))}
                  />
                  {p.code}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="space-y-1.5">
            <Label htmlFor="description">Notes</Label>
            <Textarea id="description" rows={2} value={v.description} onChange={(e) => set("description", e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {sessionId ? "Save changes" : "Create session"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
