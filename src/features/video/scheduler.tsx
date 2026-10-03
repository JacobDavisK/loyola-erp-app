"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { scheduleMeetingAction, searchMeetingPeopleAction, updateMeetingAction } from "@/features/video/actions";
import { type StaffOption, StaffPicker } from "@/features/workflow/staff-picker";
import { PANEL_ROLES } from "@/lib/domain/video";

type Opt = { id: string; label: string };
export interface SchedulerInitial {
  id?: string;
  title: string; description: string; meetingType: string; offeringId: string; mentoringStudentId: string; departmentId: string;
  date: string; start: string; end: string; visibility: string;
  people: (StaffOption & { role: string; panelRole: string })[];
  lobbyEnabled: boolean; recordingEnabled: boolean; autoRecord: boolean; chatEnabled: boolean; screenShareEnabled: boolean; participantsCanPublish: boolean;
  recordingAccess: string;
}

const sel = "h-10 w-full rounded-lg border bg-card px-2 text-sm";
const RESTRICTED = ["STUDENT_MENTORING", "PARENT_MEETING", "VIVA_VOCE", "PHD_REVIEW", "PLACEMENT_INTERVIEW", "ADMISSION_INTERVIEW", "EXAMINATION_MEETING"];

export function MeetingScheduler({ types, offerings, mentees, departments, initial, recordingAvailable, timezone }: { types: Opt[]; offerings: Opt[]; mentees: Opt[]; departments: Opt[]; initial: SchedulerInitial; recordingAvailable: boolean; timezone: string }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const set = <K extends keyof SchedulerInitial>(k: K, val: SchedulerInitial[K]) => setV((x) => ({ ...x, [k]: val }));
  const panel: readonly string[] = v.meetingType === "VIVA_VOCE" ? PANEL_ROLES.VIVA_VOCE : v.meetingType === "PHD_REVIEW" ? PANEL_ROLES.PHD_REVIEW : [];
  const restricted = RESTRICTED.includes(v.meetingType);
  const editing = !!v.id;
  const available = useMemo(() => types.filter((t) => (t.id !== "ONLINE_CLASS" || offerings.length) && (t.id !== "STUDENT_MENTORING" || mentees.length)), [types, offerings.length, mentees.length]);

  const submit = (draft: boolean) => start(async () => {
    const payload = {
      title: v.title, description: v.description || null, meetingType: v.meetingType,
      offeringId: v.meetingType === "ONLINE_CLASS" ? v.offeringId || null : null,
      mentoringStudentId: v.meetingType === "STUDENT_MENTORING" ? v.mentoringStudentId || null : null,
      departmentId: v.departmentId || null,
      startLocal: `${v.date}T${v.start}`, endLocal: `${v.date}T${v.end}`,
      visibility: restricted ? "INVITED" : v.visibility,
      participantIds: v.people.filter((p) => p.role === "PARTICIPANT").map((p) => p.id),
      coHostIds: v.people.filter((p) => p.role === "CO_HOST").map((p) => p.id),
      presenterIds: v.people.filter((p) => p.role === "PRESENTER").map((p) => p.id),
      panelRoles: Object.fromEntries(v.people.filter((p) => p.panelRole).map((p) => [p.id, p.panelRole])),
      lobbyEnabled: v.lobbyEnabled, recordingEnabled: recordingAvailable && v.recordingEnabled, autoRecord: v.autoRecord, chatEnabled: v.chatEnabled, screenShareEnabled: v.screenShareEnabled, participantsCanPublish: v.participantsCanPublish,
      recordingAccess: v.recordingAccess,
    };
    const r = editing ? await updateMeetingAction(v.id!, payload) : await scheduleMeetingAction(payload, draft);
    if (!r.ok) { setErrors(r.fieldErrors ?? {}); toast.error(r.error); return; }
    toast.success(r.message ?? "Saved");
    router.push(editing ? `/video` : `/video/${(r.data as { publicId: string }).publicId}`);
    router.refresh();
  });

  const err = (k: string) => errors[k]?.[0];

  return (
    <form className="space-y-8" onSubmit={(e) => { e.preventDefault(); submit(false); }} noValidate>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Meeting</legend>
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="m-title">Title</Label><Input id="m-title" value={v.title} onChange={(e) => set("title", e.target.value)} aria-invalid={!!err("title")} placeholder="e.g. Corporate Accounting — Unit 3" />{err("title") && <p className="text-xs text-destructive">{err("title")}</p>}</div>
        <div className="space-y-1.5"><Label htmlFor="m-type">Type</Label>
          <select id="m-type" className={sel} value={v.meetingType} disabled={editing} onChange={(e) => set("meetingType", e.target.value)}>{available.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </div>
        {v.meetingType === "ONLINE_CLASS" ? (
          <div className="space-y-1.5"><Label htmlFor="m-class">Class</Label><select id="m-class" className={sel} value={v.offeringId} disabled={editing} onChange={(e) => set("offeringId", e.target.value)}><option value="">Choose…</option>{offerings.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        ) : v.meetingType === "STUDENT_MENTORING" ? (
          <div className="space-y-1.5"><Label htmlFor="m-mentee">Mentee</Label><select id="m-mentee" className={sel} value={v.mentoringStudentId} disabled={editing} onChange={(e) => set("mentoringStudentId", e.target.value)}><option value="">Choose…</option>{mentees.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        ) : (
          <div className="space-y-1.5"><Label htmlFor="m-dept">Department</Label><select id="m-dept" className={sel} value={v.departmentId} onChange={(e) => set("departmentId", e.target.value)}><option value="">{v.meetingType === "DEPARTMENT_MEETING" ? "Choose…" : "My department"}</option>{departments.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select></div>
        )}
        <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="m-desc">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="m-desc" rows={3} value={v.description} onChange={(e) => set("description", e.target.value)} /></div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-3 text-sm font-semibold">When <span className="font-normal text-muted-foreground">({timezone})</span></legend>
        <div className="space-y-1.5"><Label htmlFor="m-date">Date</Label><Input id="m-date" type="date" value={v.date} onChange={(e) => set("date", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="m-start">Starts</Label><Input id="m-start" type="time" value={v.start} onChange={(e) => set("start", e.target.value)} /></div>
        <div className="space-y-1.5"><Label htmlFor="m-end">Ends</Label><Input id="m-end" type="time" value={v.end} onChange={(e) => set("end", e.target.value)} /></div>
        {(err("scheduledStart") || err("scheduledEnd")) && <p className="text-xs text-destructive sm:col-span-3">{err("scheduledStart") ?? err("scheduledEnd")}</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-semibold">People</legend>
        {v.meetingType === "ONLINE_CLASS" && <p className="text-sm text-muted-foreground">Everyone registered in the class is invited automatically, and its other teachers become co-hosts.</p>}
        <div className="max-w-md"><StaffPicker label="Invite someone" value={null} placeholder="Name, ID or e-mail" search={searchMeetingPeopleAction} onChange={(p) => { if (p && !v.people.some((x) => x.id === p.id)) set("people", [...v.people, { ...p, role: "PARTICIPANT", panelRole: "" }]); }} /></div>
        {v.people.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {v.people.map((p, i) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <div className="min-w-40 flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.subtitle}</div></div>
                <label className="sr-only" htmlFor={`role-${p.id}`}>Role for {p.name}</label>
                <select id={`role-${p.id}`} className="h-9 rounded-lg border bg-card px-2 text-sm" value={p.role} onChange={(e) => set("people", v.people.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)))}>
                  <option value="PARTICIPANT">Participant</option><option value="PRESENTER">Presenter</option><option value="CO_HOST">Co-host</option>
                </select>
                {panel.length > 0 && (
                  <>
                    <label className="sr-only" htmlFor={`panel-${p.id}`}>Panel role for {p.name}</label>
                    <select id={`panel-${p.id}`} className="h-9 rounded-lg border bg-card px-2 text-sm" value={p.panelRole} onChange={(e) => set("people", v.people.map((x, j) => (j === i ? { ...x, panelRole: e.target.value } : x)))}>
                      <option value="">Panel role…</option>{panel.map((r) => <option key={r} value={r}>{r.toLowerCase().replace(/_/g, " ")}</option>)}
                    </select>
                  </>
                )}
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${p.name}`} onClick={() => set("people", v.people.filter((_, j) => j !== i))}><X /></Button>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <fieldset className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-semibold">Settings</legend>
        {!restricted && (
          <div className="space-y-1.5 sm:col-span-2 sm:max-w-sm"><Label htmlFor="m-vis">Who else can find and join it</Label>
            <select id="m-vis" className={sel} value={v.visibility} onChange={(e) => set("visibility", e.target.value)}>
              <option value="INVITED">Only the people invited</option>
              {v.meetingType === "ONLINE_CLASS" && <option value="COURSE">The class (students and teachers)</option>}
              <option value="DEPARTMENT">The department</option>
              <option value="INSTITUTION">Anyone at the university</option>
            </select>
          </div>
        )}
        <Toggle label="Waiting lobby (host admits each person)" checked={v.lobbyEnabled} onChange={(b) => set("lobbyEnabled", b)} />
        <Toggle label="Chat" checked={v.chatEnabled} onChange={(b) => set("chatEnabled", b)} />
        <Toggle label="Screen sharing" checked={v.screenShareEnabled} onChange={(b) => set("screenShareEnabled", b)} />
        <Toggle label="Participants may turn on their microphone and camera" checked={v.participantsCanPublish} onChange={(b) => set("participantsCanPublish", b)} />
        {recordingAvailable ? (
          <>
            <Toggle label="Allow recording" checked={v.recordingEnabled} onChange={(b) => set("recordingEnabled", b)} />
            {v.recordingEnabled && <Toggle label="Start recording automatically" checked={v.autoRecord} onChange={(b) => set("autoRecord", b)} />}
            {v.recordingEnabled && (
              <div className="space-y-1.5 sm:col-span-2 sm:max-w-sm"><Label htmlFor="m-rec">Who can watch the recording</Label>
                <select id="m-rec" className={sel} value={v.recordingAccess} onChange={(e) => set("recordingAccess", e.target.value)}>
                  <option value="HOST_ONLY">Host and co-hosts only</option><option value="PARTICIPANTS">Participants</option>
                  {v.meetingType === "ONLINE_CLASS" && <option value="COURSE">The class</option>}
                  <option value="DEPARTMENT">The department</option><option value="ADMINS">Host and administrators</option>
                </select>
              </div>
            )}
          </>
        ) : <p className="text-sm text-muted-foreground sm:col-span-2">Recording is switched off for this installation.</p>}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t pt-6">
        <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {editing ? "Save changes" : "Schedule"}</Button>
        {!editing && <Button type="button" variant="outline" disabled={pending} onClick={() => submit(true)}>Save draft</Button>}
        <Button asChild variant="ghost"><Link href="/video">Cancel</Link></Button>
      </div>
    </form>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" className="size-[18px] accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
