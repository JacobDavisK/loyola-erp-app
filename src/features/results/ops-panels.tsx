"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  allocateSittingAction, assignInvigilatorAction, assignValuersAction, cancelExamRegistrationAction, removeDutyAction, setEligibilityAction, setScriptAttendanceAction,
} from "@/features/results/actions";
import { StaffPicker, type StaffOption } from "@/features/workflow/staff-picker";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";
type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, success?: (r: Result & { ok: true }) => string | undefined) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(success?.(r) ?? r.message ?? "Done");
        router.refresh();
      }
    });
  return { pending, run };
}

export function EligibilityControls({ registrationId, eligible }: { registrationId: string; eligible: boolean }) {
  const { pending, run } = useRun();
  return (
    <div className="flex justify-end gap-1">
      <Button size="xs" variant="ghost" disabled={pending} onClick={() => {
        const reason = prompt(eligible ? "Reason for declaring NOT eligible?" : "Reason for declaring eligible (e.g. condonation approved offline, fee waived)?");
        if (reason) run(() => setEligibilityAction(registrationId, { eligible: !eligible, reason }));
      }}>{eligible ? "Mark not eligible" : "Declare eligible"}</Button>
      <Button size="xs" variant="ghost" className="text-destructive" disabled={pending} onClick={() => {
        const reason = prompt("Reason for cancelling this examination registration?");
        if (reason) run(() => cancelExamRegistrationAction(registrationId, reason));
      }}>Cancel</Button>
    </div>
  );
}

export function AllocateForm({ sessionId, date, slot, rooms }: { sessionId: string; date: string; slot: "FN" | "AN"; rooms: { id: string; label: string; seats: number }[] }) {
  const { pending, run } = useRun();
  const [picked, setPicked] = useState<string[]>([]);
  const seats = rooms.filter((r) => picked.includes(r.id)).reduce((a, r) => a + r.seats, 0);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {rooms.map((r) => (
          <label key={r.id} className="flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs">
            <input type="checkbox" className="accent-[var(--primary)]" checked={picked.includes(r.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.id] : p.filter((x) => x !== r.id)))} />
            {r.label} <span className="text-muted-foreground">({r.seats})</span>
          </label>
        ))}
      </div>
      <Button size="xs" disabled={!picked.length || pending} onClick={() => run(() => allocateSittingAction(sessionId, { date, slot, roomIds: picked }), (r) => {
        const d = r.data as { seated: number; rooms: number };
        return `${d.seated} candidates seated in ${d.rooms} room(s)`;
      })}>{pending && <Loader2 className="animate-spin" />} Allocate seats ({seats} available)</Button>
    </div>
  );
}

export function DutyForm({ sessionId, sittings, rooms }: { sessionId: string; sittings: { date: string; slot: "FN" | "AN"; label: string }[]; rooms: { id: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [sitting, setSitting] = useState(sittings[0] ? `${sittings[0].date}|${sittings[0].slot}` : "");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [role, setRole] = useState("INVIGILATOR");
  const [who, setWho] = useState<StaffOption | null>(null);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="space-y-1.5"><Label htmlFor="d-sit">Sitting</Label><select id="d-sit" className={field} value={sitting} onChange={(e) => setSitting(e.target.value)}>{sittings.map((s) => <option key={`${s.date}|${s.slot}`} value={`${s.date}|${s.slot}`}>{s.label}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="d-room">Room</Label><select id="d-room" className={field} value={roomId} onChange={(e) => setRoomId(e.target.value)}>{rooms.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="d-role">Role</Label><select id="d-role" className={field} value={role} onChange={(e) => setRole(e.target.value)}><option value="INVIGILATOR">Invigilator</option><option value="CHIEF_SUPERINTENDENT">Chief superintendent</option><option value="RELIEVER">Reliever</option></select></div>
      <StaffPicker value={who} onChange={setWho} label="Staff member" />
      <div className="sm:col-span-2 lg:col-span-4">
        <Button size="sm" disabled={!who || !sitting || !roomId || pending} onClick={() => {
          const [date, slot] = sitting.split("|");
          run(() => assignInvigilatorAction(sessionId, { userId: who!.id, roomId, date, slot, role }));
          setWho(null);
        }}>{pending && <Loader2 className="animate-spin" />} Assign duty</Button>
      </div>
    </div>
  );
}

export function RemoveDutyButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="xs" variant="ghost" disabled={pending} onClick={() => run(() => removeDutyAction(id))}>Remove</Button>;
}

export function AssignValuersForm({ examinationId, valuers, rounds }: { examinationId: string; valuers: { id: string; label: string }[]; rounds: (1 | 2 | 3)[] }) {
  const { pending, run } = useRun();
  const [round, setRound] = useState<1 | 2 | 3>(rounds[0] ?? 1);
  const [picked, setPicked] = useState<string[]>([]);
  if (!rounds.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Round" className="h-8 rounded-lg border bg-card px-2 text-[13px]" value={round} onChange={(e) => setRound(Number(e.target.value) as 1 | 2 | 3)}>
        {rounds.map((r) => <option key={r} value={r}>{r === 1 ? "First valuation" : r === 2 ? "Second valuation" : "Third valuation"}</option>)}
      </select>
      {valuers.map((v) => (
        <label key={v.id} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-xs">
          <input type="checkbox" className="accent-[var(--primary)]" checked={picked.includes(v.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, v.id] : p.filter((x) => x !== v.id)))} /> {v.label}
        </label>
      ))}
      <Button size="xs" disabled={!picked.length || pending} onClick={() => run(() => assignValuersAction(examinationId, { round, valuerIds: picked }), (r) => {
        const d = r.data as { assigned: number; skipped: number };
        return `${d.assigned} script(s) assigned${d.skipped ? `, ${d.skipped} skipped (no eligible valuer)` : ""}`;
      })}>Assign</Button>
    </div>
  );
}

export function ScriptAttendanceButton({ scriptId, absent }: { scriptId: string; absent: boolean }) {
  const { pending, run } = useRun();
  return (
    <Button size="xs" variant="ghost" disabled={pending} onClick={() => {
      if (!confirm(absent ? "Mark this candidate as present?" : "Mark this candidate absent? Their script will not be valued.")) return;
      run(() => setScriptAttendanceAction(scriptId, { absent: !absent }));
    }}>{absent ? "Mark present" : "Mark absent"}</Button>
  );
}
