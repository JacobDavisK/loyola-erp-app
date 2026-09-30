"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { addExaminationsAction, setSessionStatusAction } from "@/features/examinations/actions";
import type { SessionStatus } from "@/generated/prisma/enums";
import { SESSION_STATUS } from "@/lib/domain/labels";

const FLOW: SessionStatus[] = ["PLANNING", "OPEN", "PAPER_SETTING", "MODERATION", "SCRUTINY", "APPROVAL", "LOCKED", "PUBLISHED", "ARCHIVED"];

export function SessionStatusControls({ id, status }: { id: string; status: SessionStatus }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const i = FLOW.indexOf(status);
  const move = (to: SessionStatus) => {
    if (!confirm(`Move this session to “${SESSION_STATUS[to].label}”?`)) return;
    start(async () => {
      const res = await setSessionStatusAction(id, to);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Session is now ${SESSION_STATUS[to].label.toLowerCase()}`);
      router.refresh();
    });
  };
  return (
    <div className="flex items-center gap-1.5">
      {i > 0 && !["LOCKED", "PUBLISHED", "ARCHIVED"].includes(status) && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => move(FLOW[i - 1])}><ChevronLeft /> {SESSION_STATUS[FLOW[i - 1]].label}</Button>
      )}
      {i < FLOW.length - 1 && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => move(FLOW[i + 1])}>
          {pending && <Loader2 className="animate-spin" />} Advance to {SESSION_STATUS[FLOW[i + 1]].label} <ChevronRight />
        </Button>
      )}
    </div>
  );
}

export function AddExaminationsDialog({ sessionId, courses }: { sessionId: string; courses: { id: string; code: string; title: string; program: string; semester: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={!courses.length}><Plus /> Add courses</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add examinations</DialogTitle>
          <DialogDescription>Each course becomes one examination in this session, using the course&apos;s blueprint (or the standard pattern) and the default paper template.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-between text-xs">
          <button type="button" className="text-primary hover:underline" onClick={() => setSelected(courses.map((c) => c.id))}>Select all ({courses.length})</button>
          <button type="button" className="text-muted-foreground hover:underline" onClick={() => setSelected([])}>Clear</button>
        </div>
        <ul className="max-h-80 divide-y overflow-y-auto rounded-lg border">
          {courses.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={selected.includes(c.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.id] : s.filter((x) => x !== c.id)))} />
                <span className="w-20 font-mono text-xs">{c.code}</span>
                <span className="flex-1">{c.title}</span>
                <span className="text-xs text-muted-foreground">{c.program} · {c.semester}</span>
              </label>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!selected.length || pending}
            onClick={() =>
              start(async () => {
                const res = await addExaminationsAction(sessionId, selected);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`${res.data} examination(s) added`);
                setOpen(false);
                setSelected([]);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Add {selected.length || ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
