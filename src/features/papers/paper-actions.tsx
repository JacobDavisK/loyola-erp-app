"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { transitionPaperAction } from "@/features/papers/actions";
import type { PaperAction } from "@/lib/domain/workflow";

export interface ActionDef {
  action: PaperAction;
  label: string;
  requiresNote: boolean;
}

const DESTRUCTIVE: PaperAction[] = ["moderation_reject", "approval_reject"];
const SECONDARY: PaperAction[] = ["moderation_request_changes", "scrutiny_return", "approval_return", "reopen", "archive"];

const CONFIRM_TEXT: Partial<Record<PaperAction, string>> = {
  submit: "An immutable version is recorded and the moderator is notified.",
  lock: "The approved version becomes permanently immutable and question usage is recorded.",
  release: "The locked paper is released to the printing/distribution workflow.",
  archive: "The paper moves to the read-only archive.",
  reopen: "The approved or rejected paper returns to the setter for revision. Explain why.",
  moderation_request_changes: "The setter will be asked to revise the paper. Describe the required changes.",
  moderation_reject: "The paper is rejected. The Examination Controller and setter are notified.",
  scrutiny_return: "The paper returns to the setter for correction.",
  approval_return: "The paper returns to the setter for revision.",
  approval_reject: "The paper is rejected.",
};

export function PaperActions({ paperId, actions, exclude = [] }: { paperId: string; actions: ActionDef[]; exclude?: PaperAction[] }) {
  const router = useRouter();
  const [active, setActive] = useState<ActionDef | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const list = actions.filter((a) => !exclude.includes(a.action));
  if (!list.length) return null;

  const run = (a: ActionDef, n?: string) =>
    start(async () => {
      const res = await transitionPaperAction(paperId, a.action, n);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`${a.label}: done`, { description: `Paper is now ${res.data.status.replaceAll("_", " ").toLowerCase()} (v${res.data.version}).` });
      setActive(null);
      setNote("");
      router.refresh();
    });

  return (
    <>
      {list.map((a) => (
        <Button
          key={a.action}
          size="sm"
          variant={DESTRUCTIVE.includes(a.action) ? "destructive" : SECONDARY.includes(a.action) ? "outline" : "default"}
          onClick={() => setActive(a)}
          disabled={pending}
        >
          {a.label}
        </Button>
      ))}
      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent>
          {active && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(active, note.trim() || undefined);
              }}
              className="space-y-4"
            >
              <DialogHeader>
                <DialogTitle>{active.label}</DialogTitle>
                <DialogDescription>{CONFIRM_TEXT[active.action] ?? "Confirm this workflow step. It will be recorded in the audit trail."}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="note">{active.requiresNote ? "Remarks (required)" : "Remarks (optional)"}</Label>
                <Textarea id="note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} required={active.requiresNote} autoFocus />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setActive(null)}>Cancel</Button>
                <Button type="submit" variant={DESTRUCTIVE.includes(active.action) ? "destructive" : "default"} disabled={pending || (active.requiresNote && !note.trim())}>
                  {pending && <Loader2 className="animate-spin" />} {active.label}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
