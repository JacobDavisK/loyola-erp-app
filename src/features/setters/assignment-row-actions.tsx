"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CalendarClock, Loader2, MoreHorizontal, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cancelAssignmentAction, updateAssignmentAction } from "@/features/papers/actions";

export function AssignmentRowActions({ id, deadline, canCancel }: { id: string; deadline: string; canCancel: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"deadline" | "cancel" | null>(null);
  const [date, setDate] = useState(deadline.slice(0, 10));
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = mode === "deadline" ? await updateAssignmentAction(id, { deadline: date }) : await cancelAssignmentAction(id, reason);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message ?? "Done");
      setMode(null);
      router.refresh();
    });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon-xs" variant="ghost" aria-label="Assignment actions"><MoreHorizontal /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setMode("deadline")}><CalendarClock /> Change deadline</DropdownMenuItem>
          {canCancel && <DropdownMenuItem variant="destructive" onSelect={() => setMode("cancel")}><XCircle /> Withdraw assignment</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!mode} onOpenChange={(o) => !o && setMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{mode === "deadline" ? "Change deadline" : "Withdraw assignment"}</DialogTitle>
            <DialogDescription>{mode === "deadline" ? "The setter is notified of the new deadline." : "The setter is notified. A draft paper, if any, is withdrawn (kept for audit)."}</DialogDescription>
          </DialogHeader>
          {mode === "deadline" ? (
            <div className="space-y-1.5">
              <Label htmlFor="new-deadline">New deadline</Label>
              <Input id="new-deadline" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="cancel-reason">Reason</Label>
              <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant={mode === "cancel" ? "destructive" : "default"} disabled={pending || (mode === "cancel" && !reason.trim())} onClick={run}>
              {pending && <Loader2 className="animate-spin" />} {mode === "deadline" ? "Save deadline" : "Withdraw"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
