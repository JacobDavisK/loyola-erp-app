"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { aiAnnouncementAction, aiFeedbackAction, saveAiSettingsAction } from "@/features/insight/actions";

interface AiSettings { enabled: boolean; reportAssistant: boolean; feedbackDrafts: boolean; announcementDrafts: boolean; dailyRequestsPerUser: number }

export function AiSettingsForm({ initial }: { initial: AiSettings }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const box = (k: keyof AiSettings, label: string) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /> {label}</label>;
  return (
    <div className="space-y-3">
      {box("enabled", "AI assistance enabled for this institution")}
      <div className="ml-6 space-y-1.5">
        {box("reportAssistant", "Report builder: draft a report from a question")}
        {box("feedbackDrafts", "Teachers: draft assignment feedback from notes")}
        {box("announcementDrafts", "Announcements: draft from bullet points")}
      </div>
      <div className="flex items-end gap-2"><div className="space-y-1"><Label htmlFor="ai-limit" className="text-xs">Requests per user per day</Label><Input id="ai-limit" type="number" min={1} max={1000} className="w-28" value={v.dailyRequestsPerUser} onChange={(e) => setV({ ...v, dailyRequestsPerUser: Number(e.target.value) })} /></div>
        <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await saveAiSettingsAction(v); if (!r.ok) toast.error(r.error); else { toast.success("Saved"); router.refresh(); } })}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save</Button>
      </div>
    </div>
  );
}

/** Drafts feedback from the teacher's notes; the teacher edits it before saving the grade. */
export function FeedbackDraftButton({ assignmentTitle, maxMarks, marks, notes, onDraft }: { assignmentTitle: string; maxMarks: number; marks: number | null; notes: string; onDraft: (text: string) => void }) {
  const [pending, start] = useTransition();
  return (
    <Button type="button" size="xs" variant="ghost" disabled={pending || notes.trim().length < 5} title="Write rough notes in the feedback box first" onClick={() => start(async () => {
      const r = await aiFeedbackAction({ assignmentTitle, maxMarks, marks, notes });
      if (!r.ok) toast.error(r.error);
      else onDraft((r.data as { text: string }).text);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Polish with AI</Button>
  );
}

export function AnnouncementDraft() {
  const [pending, start] = useTransition();
  const [points, setPoints] = useState("");
  const [audience, setAudience] = useState("EVERYONE");
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  return (
    <div className="space-y-2">
      <Textarea aria-label="Key points" rows={3} placeholder="Key points, e.g. campus closed Friday 2 Oct; classes move to Saturday; hostel mess open" value={points} onChange={(e) => setPoints(e.target.value)} />
      <div className="flex gap-2">
        <select aria-label="Audience" className="h-8 rounded-lg border bg-card px-2 text-[13px]" value={audience} onChange={(e) => setAudience(e.target.value)}><option value="EVERYONE">Everyone</option><option value="STAFF">Staff</option><option value="STUDENTS">Students</option><option value="GUARDIANS">Guardians</option></select>
        <Button size="sm" variant="outline" disabled={pending || points.trim().length < 5} onClick={() => start(async () => { const r = await aiAnnouncementAction({ points, audience }); if (!r.ok) toast.error(r.error); else setDraft(r.data as { title: string; body: string }); })}>{pending ? <Loader2 className="animate-spin" /> : <Sparkles />} Draft</Button>
      </div>
      {draft && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="font-medium">{draft.title}</p>
          <p className="mt-1 whitespace-pre-wrap">{draft.body}</p>
          <p className="mt-2 text-xs text-muted-foreground">Copy this into a new announcement and check every fact before publishing.</p>
        </div>
      )}
    </div>
  );
}
