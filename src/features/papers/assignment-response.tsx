"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { respondAssignmentAction } from "@/features/papers/actions";

export function AssignmentResponse({ id, course }: { id: string; course: string }) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const respond = (accept: boolean) =>
    start(async () => {
      const res = await respondAssignmentAction(id, accept, reason.trim() || undefined);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (accept && res.data.paperId) {
        toast.success(`Assignment accepted. Your paper workspace for ${course} is ready.`);
        router.push(`/papers/${res.data.paperId}/builder`);
      } else {
        toast.success("Assignment declined. The Examination Cell has been informed.");
        setDeclining(false);
        router.refresh();
      }
    });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setDeclining(true)} disabled={pending}><X /> Decline</Button>
      <Button size="sm" onClick={() => respond(true)} disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Check />} Accept</Button>
      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Decline assignment</DialogTitle>
            <DialogDescription>The Examination Controller will be notified so that the backup setter or another faculty member can be appointed.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="decline-reason">Reason</Label>
            <Textarea id="decline-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. On leave during the setting period; taught a different syllabus" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeclining(false)}>Cancel</Button>
            <Button variant="destructive" disabled={!reason.trim() || pending} onClick={() => respond(false)}>{pending && <Loader2 className="animate-spin" />} Decline</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
