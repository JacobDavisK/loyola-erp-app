"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { RichContent } from "@/components/app/rich-content";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { replaceItemAction, searchBankAction } from "@/features/papers/actions";
import { QuestionMeta, toItem } from "@/features/papers/builder/question-meta";
import { cn } from "@/lib/utils";
import type { QuestionListRow } from "@/server/services/questions";

export function ReplaceDialog({
  open,
  onOpenChange,
  paperId,
  courseId,
  target,
  excludeIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  paperId: string;
  courseId: string;
  target: { itemId: string; code: string; marks: number; unitNumber: number } | null;
  excludeIds: string[];
  onDone: () => void;
}) {
  const [q, setQ] = useState("");
  const [sameUnit, setSameUnit] = useState(true);
  const [rows, setRows] = useState<QuestionListRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !target) return;
    const t = setTimeout(async () => {
      setLoading(true);
      const res = await searchBankAction({ courseId, marks: target.marks, unit: sameUnit ? target.unitNumber : undefined, q: q || undefined, status: "ACTIVE", excludeIds, pageSize: 20, sort: q ? "relevance" : "least-used" });
      setLoading(false);
      if (res.ok) setRows(res.data.rows);
    }, 200);
    return () => clearTimeout(t);
  }, [open, target, q, sameUnit, courseId, excludeIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Replace {target?.code}</DialogTitle>
          <DialogDescription>Choose a {target?.marks}-mark question from the bank. The replacement is recorded as a moderation action and a new version is created when moderation completes.</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search replacements" className="pl-8" aria-label="Search replacements" />
          </div>
          <label className="flex items-center gap-2 text-sm whitespace-nowrap">
            <input type="checkbox" checked={sameUnit} onChange={(e) => setSameUnit(e.target.checked)} className="size-4 accent-[var(--primary)]" /> Same unit
          </label>
        </div>
        <ul className="max-h-[340px] space-y-2 overflow-y-auto" role="listbox" aria-label="Replacement candidates">
          {loading && <li className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Searching…</li>}
          {!loading && rows.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No suitable questions found.</li>}
          {rows.map((r) => {
            const item = toItem(r);
            return (
              <li key={r.id} role="option" aria-selected={selected === r.id}>
                <button type="button" onClick={() => setSelected(r.id)} className={cn("w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40", selected === r.id && "border-primary bg-primary/5")}>
                  <div className="mb-1 font-mono text-[11px] text-muted-foreground">{r.code}{r.usageCount ? ` · used ${r.usageCount}×` : ""}</div>
                  <RichContent body={item.body} options={item.options} className="text-sm" />
                  <QuestionMeta item={item} className="mt-1.5" />
                </button>
              </li>
            );
          })}
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor="replace-reason">Reason (required)</Label>
          <Textarea id="replace-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ambiguous wording; repeated from April 2026" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={!selected || !reason.trim() || pending}
            onClick={() =>
              start(async () => {
                if (!target || !selected) return;
                const res = await replaceItemAction(paperId, target.itemId, selected, reason.trim());
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`${target.code} replaced`);
                onOpenChange(false);
                onDone();
              })
            }
          >
            {pending && <Loader2 className="animate-spin" />} Replace question
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
