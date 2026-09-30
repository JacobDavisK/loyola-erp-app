"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, ThumbsUp } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recommendSetterAction } from "@/features/papers/actions";

export function RecommendSetterDialog({ examinationId, setters }: { examinationId: string; setters: { id: string; name: string; dept: string | null }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [setterId, setSetterId] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline"><ThumbsUp /> Recommend setter</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Recommend a paper setter</DialogTitle>
          <DialogDescription>Your recommendation is sent to the Examination Cell. The Controller makes the final appointment.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="rec-setter">Faculty member</Label>
          <select id="rec-setter" className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm" value={setterId} onChange={(e) => setSetterId(e.target.value)}>
            <option value="">Choose…</option>
            {setters.map((s) => <option key={s.id} value={s.id}>{s.name}{s.dept ? ` (${s.dept})` : ""}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rec-note">Reason</Label>
          <Textarea id="rec-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Teaching experience with this course, prior setting record…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            disabled={!setterId || pending}
            onClick={() =>
              start(async () => {
                const res = await recommendSetterAction(examinationId, setterId, note.trim() || undefined);
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(res.message ?? "Recommended");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Recommend
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
