"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Forward, Loader2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelRequestAction, decideTaskAction, delegateTaskAction, reassignTaskAction } from "@/features/workflow/actions";
import { StaffPicker, type StaffOption } from "@/features/workflow/staff-picker";

type Decision = "approve" | "reject" | "return";
const COPY: Record<Decision, { title: string; verb: string; needsComment: boolean }> = {
  approve: { title: "Approve request", verb: "Approve", needsComment: false },
  reject: { title: "Reject request", verb: "Reject", needsComment: true },
  return: { title: "Return for correction", verb: "Return", needsComment: true },
};

export function DecisionPanel({ taskId, allowReturn, allowDelegate }: { taskId: string; allowReturn: boolean; allowDelegate: boolean }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [delegating, setDelegating] = useState(false);
  const [to, setTo] = useState<StaffOption | null>(null);
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      if (!decision) return;
      const r = await decideTaskAction(taskId, { decision, comment: comment.trim() || undefined });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(decision === "approve" ? (r.data.status === "APPROVED" ? "Approved — the request is complete." : "Approved — sent to the next step.") : COPY[decision].verb + "ed");
      setDecision(null);
      router.push("/inbox");
      router.refresh();
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDecision("approve")}><Check /> Approve</Button>
        {allowReturn && <Button variant="outline" onClick={() => setDecision("return")}><Undo2 /> Return</Button>}
        <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDecision("reject")}><X /> Reject</Button>
        {allowDelegate && <Button variant="ghost" onClick={() => setDelegating(true)}><Forward /> Delegate</Button>}
      </div>

      <Dialog open={!!decision} onOpenChange={(o) => !o && setDecision(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{decision && COPY[decision].title}</DialogTitle>
            <DialogDescription>
              {decision === "approve" ? "Your approval is recorded with your name and time in the request history and the audit log." : "The requester sees your reason. It is kept in the request history."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decision-comment">{decision && COPY[decision].needsComment ? "Reason" : "Comment (optional)"}</Label>
            <Textarea id="decision-comment" rows={4} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              variant={decision === "reject" ? "destructive" : "default"}
              disabled={pending || (!!decision && COPY[decision].needsComment && comment.trim().length < 3)}
              onClick={submit}
            >
              {pending && <Loader2 className="animate-spin" />} {decision && COPY[decision].verb}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={delegating} onOpenChange={setDelegating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delegate this approval</DialogTitle>
            <DialogDescription>The colleague receives the task instead of you. The delegation is recorded in the history.</DialogDescription>
          </DialogHeader>
          <StaffPicker value={to} onChange={setTo} />
          <div className="space-y-1.5">
            <Label htmlFor="delegate-note">Note (optional)</Label>
            <Textarea id="delegate-note" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDelegating(false)}>Cancel</Button>
            <Button
              disabled={!to || pending}
              onClick={() =>
                start(async () => {
                  const r = await delegateTaskAction(taskId, { toUserId: to!.id, comment: comment.trim() || undefined });
                  if (!r.ok) {
                    toast.error(r.error);
                    return;
                  }
                  toast.success(`Delegated to ${to!.name}`);
                  router.push("/inbox");
                  router.refresh();
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Delegate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function WithdrawButton({ instanceId }: { instanceId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() => {
        const reason = prompt("Why are you withdrawing this request?");
        if (reason === null) return;
        start(async () => {
          const r = await cancelRequestAction(instanceId, reason);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success("Request withdrawn");
            router.refresh();
          }
        });
      }}
    >
      {pending && <Loader2 className="animate-spin" />} Withdraw request
    </Button>
  );
}

export function ReassignButton({ taskId }: { taskId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState<StaffOption | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="xs" variant="outline" onClick={() => setOpen(true)}>Reassign</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reassign task</DialogTitle>
            <DialogDescription>Use this when the approver is unavailable. The change is audited.</DialogDescription>
          </DialogHeader>
          <StaffPicker value={to} onChange={setTo} label="New approver" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!to || pending}
              onClick={() =>
                start(async () => {
                  const r = await reassignTaskAction(taskId, to!.id);
                  if (!r.ok) toast.error(r.error);
                  else {
                    toast.success("Reassigned");
                    setOpen(false);
                    router.refresh();
                  }
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
