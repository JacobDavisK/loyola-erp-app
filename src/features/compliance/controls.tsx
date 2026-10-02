"use client";

import { useRef, useState } from "react";
import { BadgeCheck, Check, Download, FileUp, Loader2, LogOut, Save, ShieldCheck, X } from "lucide-react";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  decideConsentAction, fulfilAccessRequestAction, requestExitAction, reviewExternalCreditAction, setApaarAction, setComponentOutcomesAction, setCoPoMatrixAction,
  setNadBatchStatusAction, submitExternalCreditAction, updateBreachAction, updateDataRequestAction, verifyApaarAction,
} from "@/features/compliance/actions";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

// ───────────────────────── APAAR ─────────────────────────

export function ApaarEditor({ studentId, apaarId, verified, canEdit, canVerify }: { studentId: string; apaarId: string | null; verified: boolean; canEdit: boolean; canVerify: boolean }) {
  const { pending, run } = useRun();
  const [value, setValue] = useState(apaarId ?? "");
  return (
    <div className="space-y-3">
      {canEdit && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run(() => setApaarAction(studentId, value.trim() || null)); }}>
          <div className="space-y-1">
            <Label htmlFor="apaar" className="text-xs">APAAR ID (12 digits)</Label>
            <Input id="apaar" inputMode="numeric" autoComplete="off" className="w-52 font-mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="1234 5678 9012" />
          </div>
          <Button size="sm" variant="outline" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
        </form>
      )}
      {canVerify && apaarId && (
        <Button size="sm" variant={verified ? "ghost" : "default"} disabled={pending} onClick={() => run(() => verifyApaarAction(studentId, !verified))}>
          {verified ? <><X /> Withdraw verification</> : <><BadgeCheck /> Mark verified (checked against the APAAR card)</>}
        </Button>
      )}
    </div>
  );
}

export function NadBatchActions({ id, status }: { id: string; status: string }) {
  const { pending, run } = useRun();
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  if (status === "GENERATED") return <Button size="sm" disabled={pending} onClick={() => run(() => setNadBatchStatusAction(id, { status: "SUBMITTED" }))}><FileUp /> Mark uploaded to the portal</Button>;
  if (status !== "SUBMITTED") return null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor="nad-ref" className="text-xs">Portal reference</Label><Input id="nad-ref" className="w-56" value={reference} onChange={(e) => setReference(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor="nad-rem" className="text-xs">Remarks</Label><Input id="nad-rem" className="w-64" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => setNadBatchStatusAction(id, { status: "ACKNOWLEDGED", reference: reference || null, remarks: remarks || null }))}><Check /> Accepted</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setNadBatchStatusAction(id, { status: "REJECTED", reference: reference || null, remarks: remarks || null }))}><X /> Rejected</Button>
    </div>
  );
}

// ───────────────────────── NEP: exits and credit transfer ─────────────────────────

export function ExitRequestForm({ studentId, awards }: { studentId: string; awards: { id: string; title: string; eligible: boolean }[] }) {
  const { pending, run } = useRun();
  const eligible = awards.filter((a) => a.eligible);
  const [awardId, setAwardId] = useState(eligible.at(-1)?.id ?? "");
  const [reason, setReason] = useState("");
  if (!eligible.length) return <p className="text-sm text-muted-foreground">No exit award is available yet.</p>;
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); if (confirm("Leave the programme with this award? Your status will change to Exited once the HoD and the Registrar approve.")) run(() => requestExitAction(studentId, { awardId, reason }), () => setReason("")); }}>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="ex-award" className="text-xs">Award</Label><select id="ex-award" className={field} value={awardId} onChange={(e) => setAwardId(e.target.value)}>{eligible.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></div>
      </div>
      <div className="space-y-1"><Label htmlFor="ex-reason" className="text-xs">Reason</Label><Textarea id="ex-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
      <Button size="sm" variant="outline" disabled={pending || reason.trim().length < 10}>{pending ? <Loader2 className="animate-spin" /> : <LogOut />} Request exit</Button>
    </form>
  );
}

export function ExternalCreditForm({ studentId }: { studentId: string }) {
  const { pending, run } = useRun();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form ref={ref} className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); run(() => submitExternalCreditAction(studentId, new FormData(ref.current!)), () => ref.current?.reset()); }}>
      <div className="space-y-1"><Label htmlFor="xc-src" className="text-xs">Source</Label><select id="xc-src" name="source" className={field}><option value="SWAYAM">SWAYAM</option><option value="NPTEL">NPTEL</option><option value="MOOC">Other MOOC</option><option value="INSTITUTION">Another institution</option></select></div>
      <div className="space-y-1"><Label htmlFor="xc-prov" className="text-xs">Provider / institution</Label><Input id="xc-prov" name="provider" required /></div>
      <div className="space-y-1"><Label htmlFor="xc-code" className="text-xs">Course code (optional)</Label><Input id="xc-code" name="courseCode" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="xc-title" className="text-xs">Course title</Label><Input id="xc-title" name="courseTitle" required /></div>
      <div className="space-y-1"><Label htmlFor="xc-cr" className="text-xs">Credits</Label><Input id="xc-cr" name="credits" type="number" step="0.5" min="0.5" max="40" required /></div>
      <div className="space-y-1"><Label htmlFor="xc-grade" className="text-xs">Grade (optional)</Label><Input id="xc-grade" name="grade" /></div>
      <div className="space-y-1"><Label htmlFor="xc-date" className="text-xs">Completed on</Label><Input id="xc-date" name="completedOn" type="date" required /></div>
      <div className="space-y-1"><Label htmlFor="xc-cert" className="text-xs">Certificate no. (optional)</Label><Input id="xc-cert" name="certificateNo" /></div>
      <div className="space-y-1 sm:col-span-2"><Label htmlFor="xc-file" className="text-xs">Certificate (PDF or image)</Label><Input id="xc-file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" required /></div>
      <div className="flex items-end"><Button size="sm" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <FileUp />} Submit for review</Button></div>
    </form>
  );
}

export function ReviewCreditControls({ id, credits, courses }: { id: string; credits: number; courses: { id: string; label: string }[] }) {
  const { pending, run } = useRun();
  const [cr, setCr] = useState(String(credits));
  const [course, setCourse] = useState("");
  const [remarks, setRemarks] = useState("");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1"><Label htmlFor={`rc-cr-${id}`} className="text-xs">Credits</Label><Input id={`rc-cr-${id}`} className="w-20" type="number" step="0.5" value={cr} onChange={(e) => setCr(e.target.value)} /></div>
      <div className="space-y-1"><Label htmlFor={`rc-co-${id}`} className="text-xs">Equivalent course</Label><select id={`rc-co-${id}`} className={`${field} w-56`} value={course} onChange={(e) => setCourse(e.target.value)}><option value="">None (elective credits)</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      <div className="space-y-1"><Label htmlFor={`rc-rem-${id}`} className="text-xs">Remarks</Label><Input id={`rc-rem-${id}`} className="w-56" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></div>
      <Button size="sm" disabled={pending} onClick={() => run(() => reviewExternalCreditAction(id, { decision: "APPROVED", credits: Number(cr), mappedCourseId: course || null, remarks: remarks || null }))}><Check /> Accept</Button>
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => reviewExternalCreditAction(id, { decision: "REJECTED", remarks }))}><X /> Decline</Button>
    </div>
  );
}

// ───────────────────────── Outcome-based education ─────────────────────────

export function CoPoMatrix({ courseId, cos, pos, cells, editable }: { courseId: string; cos: { id: string; code: string; description: string }[]; pos: { id: string; code: string; title: string }[]; cells: Record<string, number>; editable: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState<Record<string, number>>(cells);
  const avg = (po: string) => {
    const vals = cos.map((c) => v[`${c.id}:${po}`] ?? 0).filter((x) => x > 0);
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : "—";
  };
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs text-muted-foreground"><th className="px-2 py-2 text-left font-medium">Course outcome</th>{pos.map((p) => <th key={p.id} scope="col" className="px-1 py-2 text-center font-mono font-medium" title={p.title}>{p.code}</th>)}</tr>
          </thead>
          <tbody>
            {cos.map((c) => (
              <tr key={c.id} className="border-b last:border-0">
                <th scope="row" className="max-w-64 px-2 py-1.5 text-left font-normal"><span className="font-mono font-medium">{c.code}</span> <span className="text-xs text-muted-foreground">{c.description.slice(0, 70)}{c.description.length > 70 ? "…" : ""}</span></th>
                {pos.map((p) => {
                  const k = `${c.id}:${p.id}`;
                  return (
                    <td key={p.id} className="px-1 py-1 text-center">
                      {editable ? (
                        <select aria-label={`${c.code} to ${p.code}`} className={cn("h-8 w-12 rounded-md border bg-card text-center text-sm", (v[k] ?? 0) > 0 && "border-primary/40 bg-primary/5 font-medium")} value={v[k] ?? 0} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}>
                          <option value={0}>–</option><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                        </select>
                      ) : <span className="font-mono">{v[k] ? v[k] : "–"}</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-muted/40 text-xs"><th scope="row" className="px-2 py-1.5 text-left font-medium">Average correlation</th>{pos.map((p) => <td key={p.id} className="px-1 py-1.5 text-center font-mono">{avg(p.id)}</td>)}</tr>
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">1 = low, 2 = medium, 3 = high correlation; – = not related.</p>
      {editable && <Button size="sm" disabled={pending} onClick={() => run(() => setCoPoMatrixAction(courseId, v))}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save matrix</Button>}
    </div>
  );
}

export function ComponentOutcomePicker({ componentId, outcomes, selected, editable }: { componentId: string; outcomes: { id: string; code: string }[]; selected: string[]; editable: boolean }) {
  const { pending, run } = useRun();
  const [v, setV] = useState(new Set(selected));
  const dirty = v.size !== selected.length || selected.some((x) => !v.has(x));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {outcomes.map((o) => (
        <label key={o.id} className={cn("flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs", v.has(o.id) ? "border-primary/40 bg-primary/5" : "text-muted-foreground")}>
          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" disabled={!editable} checked={v.has(o.id)} onChange={(e) => { const n = new Set(v); if (e.target.checked) n.add(o.id); else n.delete(o.id); setV(n); }} /> {o.code}
        </label>
      ))}
      {editable && dirty && <Button size="xs" disabled={pending} onClick={() => run(() => setComponentOutcomesAction(componentId, [...v]))}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>}
    </div>
  );
}

// ───────────────────────── Data protection ─────────────────────────

export function ConsentButtons({ noticeId, decision, required, studentId }: { noticeId: string; decision: "GRANTED" | "WITHDRAWN" | null; required: boolean; studentId?: string }) {
  const { pending, run } = useRun();
  const decide = (d: "GRANTED" | "WITHDRAWN") => run(() => decideConsentAction({ noticeId, decision: d, studentId: studentId ?? null }));
  if (required) return decision === "GRANTED" ? <span className="flex items-center gap-1 text-xs text-tone-success"><Check className="size-3.5" /> Acknowledged</span> : <Button size="sm" disabled={pending} onClick={() => decide("GRANTED")}><Check /> I have read this notice</Button>;
  return (
    <div className="flex gap-2">
      <Button size="sm" variant={decision === "GRANTED" ? "default" : "outline"} disabled={pending || decision === "GRANTED"} onClick={() => decide("GRANTED")}><Check /> {decision === "GRANTED" ? "Allowed" : "Allow"}</Button>
      <Button size="sm" variant={decision === "WITHDRAWN" ? "default" : "outline"} disabled={pending || decision === "WITHDRAWN"} onClick={() => decide("WITHDRAWN")}><X /> {decision === "WITHDRAWN" ? "Not allowed" : decision === "GRANTED" ? "Withdraw" : "Don't allow"}</Button>
    </div>
  );
}

export function DataRequestControls({ id, status, type, hasExport }: { id: string; status: string; type: string; hasExport: boolean }) {
  const { pending, run } = useRun();
  const [response, setResponse] = useState("");
  if (status === "COMPLETED" || status === "REJECTED") return null;
  return (
    <div className="space-y-2">
      {type === "ACCESS" && !hasExport && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => fulfilAccessRequestAction(id))}><Download /> Prepare the personal-data export</Button>}
      <Textarea aria-label="Response to the data principal" rows={3} value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Response to the data principal (what was done, or why the request cannot be met — e.g. records the law requires us to keep)" />
      <div className="flex flex-wrap gap-2">
        {status === "OPEN" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => updateDataRequestAction(id, { status: "IN_PROGRESS" }))}>Start work</Button>}
        <Button size="sm" disabled={pending || response.trim().length < 10} onClick={() => run(() => updateDataRequestAction(id, { status: "COMPLETED", response }))}><Check /> Complete</Button>
        <Button size="sm" variant="outline" disabled={pending || response.trim().length < 10} onClick={() => run(() => updateDataRequestAction(id, { status: "REJECTED", response }))}><X /> Decline</Button>
      </div>
    </div>
  );
}

export function BreachControls({ id, status }: { id: string; status: string }) {
  const { pending, run } = useRun();
  const [containment, setContainment] = useState("");
  const [board, setBoard] = useState("");
  const [users, setUsers] = useState("");
  if (status === "CLOSED") return null;
  return (
    <div className="space-y-2">
      {status === "OPEN" && (
        <div className="space-y-1"><Label htmlFor={`bc-${id}`} className="text-xs">Containment</Label><Textarea id={`bc-${id}`} rows={2} value={containment} onChange={(e) => setContainment(e.target.value)} /></div>
      )}
      {(status === "OPEN" || status === "CONTAINED") && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor={`bb-${id}`} className="text-xs">Board informed at</Label><Input id={`bb-${id}`} type="datetime-local" value={board} onChange={(e) => setBoard(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor={`bu-${id}`} className="text-xs">Affected people informed at</Label><Input id={`bu-${id}`} type="datetime-local" value={users} onChange={(e) => setUsers(e.target.value)} /></div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {status === "OPEN" && <Button size="sm" variant="outline" disabled={pending || containment.trim().length < 5} onClick={() => run(() => updateBreachAction(id, { status: "CONTAINED", containment }))}><ShieldCheck /> Contained</Button>}
        {(status === "OPEN" || status === "CONTAINED") && <Button size="sm" disabled={pending || !board || !users} onClick={() => run(() => updateBreachAction(id, { status: "NOTIFIED", containment: containment || null, boardNotifiedAt: new Date(board).toISOString(), usersNotifiedAt: new Date(users).toISOString() }))}>Notifications sent</Button>}
        {status === "NOTIFIED" && <Button size="sm" disabled={pending} onClick={() => run(() => updateBreachAction(id, { status: "CLOSED" }))}><Check /> Close</Button>}
      </div>
    </div>
  );
}
