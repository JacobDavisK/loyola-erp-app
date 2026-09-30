"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { KeyRound, Loader2, Repeat, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { provisionGuardianAccountAction, provisionStudentAccountAction, removeGuardianAction, requestStatusChangeAction } from "@/features/students/actions";
import { STUDENT_STATUS } from "@/lib/domain/labels";

export function StatusChangeDialog({ studentId, current }: { studentId: string; current: keyof typeof STUDENT_STATUS }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [effectiveOn, setEffectiveOn] = useState(new Date().toISOString().slice(0, 10));
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Repeat /> Change status</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change academic status</DialogTitle>
          <DialogDescription>The change goes to the Head of Department and the Registrar for approval, and is applied when approved.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="sc-to">New status</Label>
            <select id="sc-to" className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose…</option>
              {Object.entries(STUDENT_STATUS).filter(([k]) => k !== current).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="sc-date">Effective from</Label><Input id="sc-date" type="date" value={effectiveOn} onChange={(e) => setEffectiveOn(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="sc-reason">Reason</Label><Textarea id="sc-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!to || reason.trim().length < 10 || pending}
            onClick={() =>
              start(async () => {
                const r = await requestStatusChangeAction(studentId, { to, reason, effectiveOn });
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(r.data.status === "APPROVED" ? "Status changed" : "Sent for approval");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Submit for approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProvisionAccountButton({ studentId, guardianId, label }: { studentId: string; guardianId?: string; label: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() => {
        if (!confirm(`${label}? An invitation to set a password will be e-mailed.`)) return;
        start(async () => {
          const r = guardianId ? await provisionGuardianAccountAction(studentId, guardianId) : await provisionStudentAccountAction(studentId);
          if (!r.ok) toast.error(r.error);
          else {
            toast.success(r.message ?? "Done");
            router.refresh();
          }
        });
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <KeyRound />} {label}
    </Button>
  );
}

export function RemoveGuardianButton({ studentId, guardianId, name }: { studentId: string; guardianId: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`Remove ${name}`}
      disabled={pending}
      onClick={() => {
        if (!confirm(`Remove ${name} as a guardian?`)) return;
        start(async () => {
          const r = await removeGuardianAction(studentId, guardianId);
          if (!r.ok) toast.error(r.error);
          else router.refresh();
        });
      }}
    >
      <Trash2 />
    </Button>
  );
}
