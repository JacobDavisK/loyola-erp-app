"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, Check, ExternalLink, Loader2, Save, Send, Tag, TicketPlus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useRun } from "@/components/app/use-run";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { raiseTicketAction } from "@/features/campus/actions";
import {
  addCaseNoteAction, askAssistantAction, assignCaseAction, assignMentorAction, setCaseStatusAction, setItemOutcomesAction, setPlanEntryAction, toggleActionItemAction,
} from "@/features/success/actions";
import { cn } from "@/lib/utils";

const field = "h-9 w-full rounded-lg border bg-card px-2.5 text-sm";

// ───────────────────────── Support cases ─────────────────────────

export function CaseNoteForm({ id, staff }: { id: string; staff: boolean }) {
  const { pending, run } = useRun();
  const [kind, setKind] = useState("NOTE");
  const [body, setBody] = useState("");
  return (
    <div className="space-y-2">
      <Textarea aria-label="Note" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={staff ? "What happened, what was agreed, who was contacted" : "Add an update"} />
      <div className="flex flex-wrap items-center gap-2">
        {staff && (
          <select aria-label="Kind of note" className={`${field} w-48`} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="NOTE">Note</option><option value="CONTACT">Contact with student / guardian</option><option value="REFERRAL">Referral</option>
          </select>
        )}
        <Button size="sm" disabled={pending || body.trim().length < 3} onClick={() => run(() => addCaseNoteAction(id, { kind, body }), () => setBody(""))}>{pending ? <Loader2 className="animate-spin" /> : <Send />} Add</Button>
      </div>
    </div>
  );
}

export function CaseControls({ id, status, manage, assignee, staff }: { id: string; status: string; manage: boolean; assignee: string | null; staff: { id: string; name: string }[] }) {
  const { pending, run } = useRun();
  const [to, setTo] = useState(assignee ?? "");
  const [resolution, setResolution] = useState("");
  if (status === "CLOSED") return null;
  return (
    <div className="space-y-3">
      {manage && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="cc-as" className="text-xs">Assigned to</Label><select id="cc-as" className={`${field} w-60`} value={to} onChange={(e) => setTo(e.target.value)}><option value="">—</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <Button size="sm" variant="outline" disabled={pending || !to || to === assignee} onClick={() => run(() => assignCaseAction(id, to))}><UserPlus /> Assign</Button>
        </div>
      )}
      {status !== "RESOLVED" && (
        <div className="space-y-2">
          <Textarea aria-label="Resolution" rows={2} value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder="How was it resolved? (needed to resolve)" />
          <Button size="sm" disabled={pending || resolution.trim().length < 10} onClick={() => run(() => setCaseStatusAction(id, { status: "RESOLVED", resolution }))}><Check /> Resolve</Button>
        </div>
      )}
      {manage && status === "RESOLVED" && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setCaseStatusAction(id, { status: "CLOSED" }))}>Close case</Button>}
      {status === "RESOLVED" && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setCaseStatusAction(id, { status: "IN_PROGRESS" }))}>Reopen</Button>}
    </div>
  );
}

// ───────────────────────── Mentoring ─────────────────────────

export function AssignMentorForm({ mentors, students }: { mentors: { id: string; name: string }[]; students: { id: string; label: string; mentor: string | null }[] }) {
  const { pending, run } = useRun();
  const [mentor, setMentor] = useState(mentors[0]?.id ?? "");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [onlyUnassigned, setOnlyUnassigned] = useState(true);
  const list = students.filter((s) => !onlyUnassigned || !s.mentor);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1"><Label htmlFor="am-m" className="text-xs">Mentor</Label><select id="am-m" className={`${field} w-64`} value={mentor} onChange={(e) => setMentor(e.target.value)}>{mentors.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} /> Only students without a mentor</label>
        <Button size="sm" disabled={pending || !mentor || !picked.size} onClick={() => run(() => assignMentorAction({ mentorId: mentor, studentIds: [...picked] }), () => setPicked(new Set()))}>{pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Assign {picked.size || ""}</Button>
      </div>
      <div className="max-h-72 overflow-y-auto rounded-lg border">
        {list.map((s) => (
          <label key={s.id} className="flex items-center gap-2 border-b px-3 py-1.5 text-sm last:border-0">
            <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={picked.has(s.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(s.id); else n.delete(s.id); setPicked(n); }} />
            <span className="flex-1">{s.label}</span>
            {s.mentor && <span className="text-xs text-muted-foreground">mentor: {s.mentor}</span>}
          </label>
        ))}
        {!list.length && <p className="px-3 py-2 text-sm text-muted-foreground">Every student in scope has a mentor.</p>}
      </div>
    </div>
  );
}

export function ActionItems({ meetingId, items, editable }: { meetingId: string; items: { text: string; done: boolean }[]; editable: boolean }) {
  const { pending, run } = useRun();
  if (!items.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((it, i) => (
        <li key={i}>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" disabled={!editable || pending} checked={it.done} onChange={() => run(() => toggleActionItemAction(meetingId, i))} />
            <span className={cn(it.done && "text-muted-foreground line-through")}>{it.text}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

// ───────────────────────── Degree planner ─────────────────────────

export function PlanSelect({ studentId, courseId, value, from, to }: { studentId: string; courseId: string; value: number | null; from: number; to: number }) {
  const { pending, run } = useRun();
  const options = Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
  return (
    <select aria-label="Plan for semester" disabled={pending} className={cn("h-8 rounded-md border bg-card px-2 text-sm", value && "border-primary/40 bg-primary/5")} value={value ?? ""} onChange={(e) => run(() => setPlanEntryAction(studentId, { courseId, semester: e.target.value ? Number(e.target.value) : null }))}>
      <option value="">Not planned</option>
      {options.map((s) => <option key={s} value={s}>Semester {s}</option>)}
    </select>
  );
}

// ───────────────────────── Learning recommendations ─────────────────────────

export function ItemOutcomePicker({ itemId, outcomes, selected }: { itemId: string; outcomes: { id: string; code: string }[]; selected: string[] }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(new Set(selected));
  if (!outcomes.length) return null;
  if (!open) return <Button size="xs" variant="ghost" aria-label="Tag with course outcomes" onClick={() => setOpen(true)}><Tag /> {selected.length ? outcomes.filter((o) => selected.includes(o.id)).map((o) => o.code).join(", ") : "COs"}</Button>;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {outcomes.map((o) => (
        <label key={o.id} className={cn("flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]", v.has(o.id) && "border-primary/40 bg-primary/5")}>
          <input type="checkbox" className="size-3 accent-[var(--primary)]" checked={v.has(o.id)} onChange={(e) => { const n = new Set(v); if (e.target.checked) n.add(o.id); else n.delete(o.id); setV(n); }} /> {o.code}
        </label>
      ))}
      <Button size="xs" disabled={pending} onClick={() => run(() => setItemOutcomesAction(itemId, [...v]), () => setOpen(false))}>{pending ? <Loader2 className="animate-spin" /> : <Save />}</Button>
    </span>
  );
}

// ───────────────────────── Assistant ─────────────────────────

type Action = { type: "ticket" | "link"; label: string; href?: string; category?: string; subject?: string; description?: string };
type Msg = { role: "user" | "assistant"; content: string; sources?: { title: string; slug: string }[]; action?: Action | null; mode?: "ai" | "search" };

export function AssistantChat({ suggestions, aiReady, recordsAllowed, categories }: { suggestions: string[]; aiReady: boolean; recordsAllowed: boolean; categories: string[] }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [msgs]);

  async function ask(q: string) {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    const history = msgs.map((m) => ({ role: m.role, content: m.content }));
    setMsgs((m) => [...m, { role: "user", content: question }]);
    setText("");
    setBusy(true);
    const r = await askAssistantAction({ message: question, history });
    setBusy(false);
    if (!r.ok) {
      toast.error(r.error);
      setMsgs((m) => [...m, { role: "assistant", content: `Sorry — ${r.error}` }]);
      return;
    }
    const d = r.data as { answer: string; sources: { title: string; slug: string }[]; action: Action | null; mode: "ai" | "search" };
    setMsgs((m) => [...m, { role: "assistant", content: d.answer, sources: d.sources, action: d.action, mode: d.mode }]);
  }

  async function raiseTicket(a: Action) {
    const category = a.category && categories.includes(a.category) ? a.category : categories[0];
    const r = await raiseTicketAction(null, { category, priority: "NORMAL", subject: (a.subject ?? "Question from the assistant").slice(0, 200), description: a.description && a.description.length >= 10 ? a.description : `${a.subject ?? ""} (raised from the student assistant)` });
    if (r.ok) toast.success("Ticket raised. The helpdesk will reply in your Helpdesk page.");
    else toast.error(r.error);
  }

  return (
    <div className="flex min-h-[28rem] flex-col">
      <div className="flex-1 space-y-4" aria-live="polite">
        {msgs.length === 0 && (
          <div className="space-y-3 text-sm text-muted-foreground">
            <p>{aiReady ? "Ask about rules, procedures, or your own studies." : "AI is not switched on for this installation, so I answer from the knowledge base and your records directly."}{recordsAllowed ? "" : " I can't see your records yet — allow it under Privacy & consent if you want answers about your attendance, fees and results."}</p>
            <div className="flex flex-wrap gap-2">{suggestions.map((s) => <Button key={s} size="xs" variant="outline" onClick={() => ask(s)}>{s}</Button>)}</div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" && "justify-end")}>
            {m.role === "assistant" && <Bot className="mt-1 size-5 shrink-0 text-primary" aria-hidden />}
            <div className={cn("max-w-[85%] rounded-2xl px-4 py-2.5 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
              <p className="whitespace-pre-wrap">{m.content}</p>
              {!!m.sources?.length && <p className="mt-2 text-xs text-muted-foreground">Sources: {m.sources.map((s, j) => <span key={s.slug}>{j > 0 && " · "}<Link className="underline" href={`/knowledge/${s.slug}`}>{s.title}</Link></span>)}</p>}
              {m.action?.type === "link" && m.action.href && <Button asChild size="xs" variant="outline" className="mt-2"><Link href={m.action.href}><ExternalLink /> {m.action.label}</Link></Button>}
              {m.action?.type === "ticket" && <Button size="xs" variant="outline" className="mt-2" onClick={() => raiseTicket(m.action!)}><TicketPlus /> {m.action.label}</Button>}
              {m.mode === "ai" && <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">AI-generated · check important details</p>}
            </div>
          </div>
        ))}
        {busy && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Thinking…</p>}
        <div ref={end} />
      </div>
      <form className="mt-4 flex gap-2 border-t pt-4" onSubmit={(e) => { e.preventDefault(); ask(text); }}>
        <Input aria-label="Your question" value={text} onChange={(e) => setText(e.target.value)} placeholder="Ask a question…" maxLength={1000} />
        <Button disabled={busy || text.trim().length < 2}><Send /> Ask</Button>
      </form>
    </div>
  );
}
