"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Lock, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { approveAndLockAction, transitionPaperAction } from "@/features/papers/actions";

type Kind = "approve" | "return" | "reject" | "lock";

export function ApprovalActions({ paperId, ready, canLock, mode }: { paperId: string; ready: boolean; canLock: boolean; mode: "decide" | "lock" }) {
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const run = (k: Kind) =>
    start(async () => {
      const res =
        k === "approve"
          ? canLock
            ? await approveAndLockAction(paperId, note.trim() || undefined)
            : await transitionPaperAction(paperId, "approve", note.trim() || undefined)
          : k === "lock"
            ? await transitionPaperAction(paperId, "lock", note.trim() || undefined)
            : await transitionPaperAction(paperId, k === "return" ? "approval_return" : "approval_reject", note.trim());
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(k === "approve" ? (canLock ? "Approved and locked" : "Approved") : k === "lock" ? "Paper locked" : k === "return" ? "Returned for revision" : "Paper rejected");
      setOpen(null);
      router.refresh();
    });

  const TITLE: Record<Kind, string> = { approve: canLock ? "Approve & lock" : "Approve", return: "Return for revision", reject: "Reject paper", lock: "Lock paper" };
  const DESC: Record<Kind, string> = {
    approve: canLock ? "The current version becomes the immutable FINAL version. Question usage is recorded and the paper can no longer be edited." : "The paper is approved and awaits locking by the Controller of Examinations.",
    lock: "The approved version becomes the immutable FINAL version.",
    return: "The setter is asked to revise the paper; it will go through moderation and scrutiny again.",
    reject: "The paper is rejected. A new paper or revision will be required.",
  };
  const needsNote = open === "return" || open === "reject";

  return (
    <>
      {mode === "decide" ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="destructive" onClick={() => setOpen("reject")}><X /> Reject</Button>
          <Button variant="outline" onClick={() => setOpen("return")}><Undo2 /> Return for revision</Button>
          <Button onClick={() => setOpen("approve")} disabled={!ready}><Lock /> {canLock ? "Approve & lock" : "Approve"}</Button>
        </div>
      ) : (
        <Button onClick={() => setOpen("lock")}><Lock /> Lock paper</Button>
      )}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent>
          {open && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                run(open);
              }}
            >
              <DialogHeader>
                <DialogTitle>{TITLE[open]}</DialogTitle>
                <DialogDescription>{DESC[open]}</DialogDescription>
              </DialogHeader>
              <div className="space-y-1.5">
                <Label htmlFor="appr-note">{needsNote ? "Remarks (required)" : "Remarks (optional)"}</Label>
                <Textarea id="appr-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
                <Button type="submit" variant={open === "reject" ? "destructive" : "default"} disabled={pending || (needsNote && !note.trim())}>
                  {pending && <Loader2 className="animate-spin" />} {TITLE[open]}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
