"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { postManualEntryAction } from "@/features/finance/actions";

type Line = { accountId: string; debit: string; credit: string };

/** Manual journal entry. The totals must agree before it can be posted (the database checks again). */
export function JournalForm({ accounts }: { accounts: { id: string; label: string }[] }) {
  const router = useRouter();
  const blank = (): Line => ({ accountId: accounts[0]?.id ?? "", debit: "", credit: "" });
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [memo, setMemo] = useState("");
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [pending, start] = useTransition();
  const cents = (s: string) => Math.round(Number(s || 0) * 100);
  const dr = lines.reduce((a, l) => a + cents(l.debit), 0);
  const cr = lines.reduce((a, l) => a + cents(l.credit), 0);
  const set = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div className="space-y-1"><Label htmlFor="je-date">Date</Label><Input id="je-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="je-memo">Narration</Label><Input id="je-memo" value={memo} onChange={(e) => setMemo(e.target.value)} /></div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-[1fr_120px_120px_auto] gap-2">
          <select aria-label="Account" className="h-9 rounded-lg border bg-card px-2 text-sm" value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
          <Input aria-label="Debit" inputMode="decimal" placeholder="Debit" value={l.debit} onChange={(e) => set(i, { debit: e.target.value.replace(/[^0-9.]/g, ""), credit: "" })} />
          <Input aria-label="Credit" inputMode="decimal" placeholder="Credit" value={l.credit} onChange={(e) => set(i, { credit: e.target.value.replace(/[^0-9.]/g, ""), debit: "" })} />
          <Button size="icon-sm" variant="ghost" aria-label="Remove line" disabled={lines.length <= 2} onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 /></Button>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="xs" variant="outline" onClick={() => setLines([...lines, blank()])}><Plus /> Line</Button>
        <span className={`text-xs tabular ${dr === cr && dr > 0 ? "text-tone-success" : "text-muted-foreground"}`}>Debit {(dr / 100).toFixed(2)} · Credit {(cr / 100).toFixed(2)}{dr !== cr ? ` · difference ${((dr - cr) / 100).toFixed(2)}` : ""}</span>
        <Button size="sm" className="ml-auto" disabled={pending || dr !== cr || dr === 0 || memo.trim().length < 5} onClick={() => start(async () => {
          const r = await postManualEntryAction({ date, memo, lines: lines.filter((l) => cents(l.debit) || cents(l.credit)).map((l) => ({ accountId: l.accountId, debit: cents(l.debit) / 100, credit: cents(l.credit) / 100 })) });
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success(`Posted ${r.data.number}`);
          setMemo("");
          setLines([blank(), blank()]);
          router.refresh();
        })}>{pending && <Loader2 className="animate-spin" />} Post entry</Button>
      </div>
    </div>
  );
}
