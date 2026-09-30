"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  addSlotAction, dropRegistrationAction, registerBatchAction, removeSlotAction, searchStudentsAction, setInstructorsAction, staffRegisterAction,
} from "@/features/academic-ops/actions";
import { StaffPicker, type StaffOption } from "@/features/workflow/staff-picker";
import { DAY_NAMES } from "@/lib/domain/timetable";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

export function InstructorEditor({ offeringId, current }: { offeringId: string; current: (StaffOption & { isPrimary: boolean })[] }) {
  const router = useRouter();
  const [list, setList] = useState(current);
  const [pick, setPick] = useState<StaffOption | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(list.map((x) => [x.id, x.isPrimary])) !== JSON.stringify(current.map((x) => [x.id, x.isPrimary]));
  return (
    <div className="space-y-3">
      <ul className="space-y-1.5">
        {list.map((i) => (
          <li key={i.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">{i.name}<span className="block text-xs text-muted-foreground">{i.subtitle}</span></span>
            <label className="flex items-center gap-1 text-xs"><input type="radio" name="primary" className="accent-[var(--primary)]" checked={i.isPrimary} onChange={() => setList(list.map((x) => ({ ...x, isPrimary: x.id === i.id })))} /> Primary</label>
            <Button size="icon-xs" variant="ghost" aria-label={`Remove ${i.name}`} onClick={() => setList(list.filter((x) => x.id !== i.id))}><X /></Button>
          </li>
        ))}
        {list.length === 0 && <li className="text-sm text-muted-foreground">No instructor assigned.</li>}
      </ul>
      <div className="flex items-end gap-2">
        <div className="flex-1"><StaffPicker value={pick} onChange={setPick} label="Add instructor" /></div>
        <Button size="sm" variant="outline" disabled={!pick || list.some((x) => x.id === pick.id)} onClick={() => { setList([...list, { ...pick!, isPrimary: list.length === 0 }]); setPick(null); }}><Plus /> Add</Button>
      </div>
      {dirty && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const r = await setInstructorsAction(offeringId, { userIds: list.map((x) => x.id), primaryId: list.find((x) => x.isPrimary)?.id ?? null });
          if (!r.ok) toast.error(r.error);
          else { toast.success("Instructors saved"); router.refresh(); }
        })}>{pending && <Loader2 className="animate-spin" />} Save instructors</Button>
      )}
    </div>
  );
}

export function SlotForm({ offeringId, rooms }: { offeringId: string; rooms: { id: string; label: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState({ dayOfWeek: 1, startTime: "09:00", endTime: "10:00", roomId: "", kind: "LECTURE" });
  const [clash, setClash] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = (force: boolean) =>
    start(async () => {
      const r = await addSlotAction(offeringId, { ...v, roomId: v.roomId || null }, force);
      if (!r.ok) {
        if (!force && r.code === "WORKFLOW" && /allow clash/.test(r.error)) setClash(r.error);
        else toast.error(r.error);
        return;
      }
      setClash(null);
      toast.success("Slot added");
      router.refresh();
    });
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select aria-label="Day" className={field} value={v.dayOfWeek} onChange={(e) => setV({ ...v, dayOfWeek: Number(e.target.value) })}>
          {DAY_NAMES.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </select>
        <Input aria-label="Start time" type="time" value={v.startTime} onChange={(e) => setV({ ...v, startTime: e.target.value })} />
        <Input aria-label="End time" type="time" value={v.endTime} onChange={(e) => setV({ ...v, endTime: e.target.value })} />
        <select aria-label="Room" className={field} value={v.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })}>
          <option value="">No room</option>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
        <select aria-label="Session type" className={field} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          <option value="LECTURE">Lecture</option>
          <option value="TUTORIAL">Tutorial</option>
          <option value="LAB">Lab</option>
        </select>
      </div>
      {clash ? (
        <div className="rounded-lg border border-tone-warning/40 bg-tone-warning/5 p-3 text-sm">
          <p>{clash}</p>
          <div className="mt-2 flex gap-2"><Button size="xs" variant="outline" onClick={() => setClash(null)}>Change it</Button><Button size="xs" onClick={() => submit(true)} disabled={pending}>Allow clash</Button></div>
        </div>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => submit(false)}>{pending ? <Loader2 className="animate-spin" /> : <Plus />} Add to timetable</Button>
      )}
    </div>
  );
}

export function RemoveSlotButton({ slotId, offeringId }: { slotId: string; offeringId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="icon-xs" variant="ghost" aria-label="Remove slot" disabled={pending} onClick={() => start(async () => { const r = await removeSlotAction(slotId, offeringId); if (!r.ok) toast.error(r.error); else router.refresh(); })}>
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}

type RegResult = { studentId: string; ok: boolean; error?: string }[];

function summarise(r: RegResult) {
  const ok = r.filter((x) => x.ok).length;
  const failed = r.filter((x) => !x.ok);
  if (!failed.length) toast.success(`${ok} student(s) registered`);
  else toast.warning(`${ok} registered, ${failed.length} not`, { description: [...new Set(failed.map((f) => f.error))].slice(0, 3).join(" · ") });
}

export function RegisterStudents({ offeringId, batches }: { offeringId: string; batches: { id: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [student, setStudent] = useState<StaffOption | null>(null);
  const [batchId, setBatchId] = useState("");
  const [section, setSection] = useState("");
  const [override, setOverride] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const done = (r: { ok: true; data: RegResult } | { ok: false; error: string }) => {
    if (!r.ok) {
      toast.error(r.error);
      return;
    }
    summarise(r.data);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="xs" variant="outline"><UserPlus /> Register students</Button></DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Register students</DialogTitle>
          <DialogDescription>Eligibility is checked for every student: status, capacity, credit limit, prerequisites and timetable clashes.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-end gap-2">
            <div className="flex-1"><StaffPicker value={student} onChange={setStudent} label="One student" search={searchStudentsAction} placeholder="Name or student number" /></div>
            <Button size="sm" disabled={!student || pending} onClick={() => start(async () => { done(await staffRegisterAction(offeringId, { studentIds: [student!.id], override, reason: reason || undefined })); setStudent(null); })}>Add</Button>
          </div>
          <div className="grid grid-cols-[1fr_100px_auto] items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="rb-batch">Whole batch</Label>
              <select id="rb-batch" className={field} value={batchId} onChange={(e) => setBatchId(e.target.value)}>
                <option value="">Choose…</option>
                {batches.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="rb-sec">Section</Label><Input id="rb-sec" value={section} onChange={(e) => setSection(e.target.value.toUpperCase())} placeholder="All" /></div>
            <Button size="sm" disabled={!batchId || pending} onClick={() => start(async () => done(await registerBatchAction(offeringId, { batchId, section: section || null, override, reason: reason || undefined })))}>{pending ? <Loader2 className="animate-spin" /> : <Users />} Register</Button>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Override soft rules (capacity, credit limit, prerequisites, clashes, window)</label>
          {override && <div className="space-y-1.5"><Label htmlFor="rb-reason">Reason for override</Label><Input id="rb-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Close</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DropButton({ registrationId, label = "Drop" }: { registrationId: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        const reason = prompt("Reason for dropping this registration?");
        if (reason === null) return;
        start(async () => {
          const r = await dropRegistrationAction(registrationId, reason);
          if (!r.ok) toast.error(r.error);
          else { toast.success(r.data.status === "WITHDRAWN" ? "Marked as withdrawn (attendance exists)" : "Dropped"); router.refresh(); }
        });
      }}
    >
      {pending && <Loader2 className="animate-spin" />} {label}
    </Button>
  );
}
