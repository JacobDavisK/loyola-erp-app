"use client";

import { useEffect, useState, useTransition } from "react";
import { Dices, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { builderQuestionsAction, generatePreviewAction } from "@/features/papers/actions";
import type { GenerationResult, PoolAnalysis } from "@/lib/domain/generator";
import type { PaperItemData } from "@/lib/domain/paper-types";
import { CheckRow } from "./blueprint-panel";

export function GenerateDialog({
  open,
  onOpenChange,
  paperId,
  sections,
  onApply,
  initialSections,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  paperId: string;
  sections: { label: string; questionIds: string[] }[];
  onApply: (bySection: Record<string, PaperItemData[]>) => void;
  initialSections?: string[];
}) {
  // Remounted (via key) on every open, so state starts fresh from props.
  const [selected, setSelected] = useState<string[]>(() => (initialSections?.length ? initialSections : sections.map((s) => s.label)));
  const [allowReuse, setAllowReuse] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 100000));
  const [preview, setPreview] = useState<{ analysis: PoolAnalysis[]; result: GenerationResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [applying, startApply] = useTransition();

  const run = (nextSeed = seed) =>
    start(async () => {
      setError(null);
      const keep = Object.fromEntries(sections.filter((s) => !selected.includes(s.label)).map((s) => [s.label, s.questionIds]));
      const res = await generatePreviewAction(paperId, { sections: selected, seed: nextSeed, allowRecentReuse: allowReuse, keep });
      if (!res.ok) return setError(res.error);
      setPreview(res.data);
    });

  useEffect(() => {
    if (open && selected.length) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected.join(","), allowReuse]);

  const apply = () =>
    startApply(async () => {
      if (!preview) return;
      const ids = selected.flatMap((l) => preview.result.sections[l] ?? []);
      const res = await builderQuestionsAction(paperId, ids);
      if (!res.ok) { toast.error(res.error); return; }
      const byId = new Map(res.data.map((q) => [q.questionId, q]));
      const out: Record<string, PaperItemData[]> = {};
      for (const l of selected) out[l] = (preview.result.sections[l] ?? []).map((id) => byId.get(id)!).filter(Boolean);
      onApply(out);
      onOpenChange(false);
      toast.success(`Generated ${ids.length} question${ids.length === 1 ? "" : "s"}. Review and save the paper.`);
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /> Generate from blueprint</DialogTitle>
          <DialogDescription>
            Questions are selected to satisfy unit coverage, difficulty and Bloom targets while avoiding recently used and near-duplicate questions. Nothing is saved until you apply and save.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[1fr_1.2fr]">
          <div className="space-y-4">
            <fieldset>
              <legend className="eyebrow mb-2">Sections to generate</legend>
              <div className="space-y-2">
                {sections.map((s) => (
                  <label key={s.label} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.includes(s.label)}
                      onCheckedChange={(v) => setSelected((cur) => (v ? [...cur, s.label] : cur.filter((x) => x !== s.label)))}
                    />
                    Section {s.label}
                    <span className="text-xs text-muted-foreground">({s.questionIds.length} current — will be replaced)</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start justify-between gap-3 text-sm">
              <span>
                Allow recently used questions
                <span className="block text-xs text-muted-foreground">Off: questions from the last sessions (cool-off window) are excluded.</span>
              </span>
              <Switch checked={allowReuse} onCheckedChange={setAllowReuse} />
            </label>
            {preview && (
              <div>
                <div className="eyebrow mb-2">Question bank capacity</div>
                <table className="w-full text-xs">
                  <thead className="text-muted-foreground">
                    <tr><th scope="col" className="text-left font-medium">Section</th><th scope="col" className="text-right font-medium">Needed</th><th scope="col" className="text-right font-medium">Eligible</th><th scope="col" className="text-right font-medium">Fresh</th></tr>
                  </thead>
                  <tbody>
                    {preview.analysis.map((a) => (
                      <tr key={a.section} className={a.ok ? "" : "font-semibold text-tone-danger"}>
                        <td>§{a.section}</td><td className="text-right tabular">{a.needed}</td><td className="text-right tabular">{a.eligible}</td><td className="text-right tabular">{a.fresh}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border bg-surface/50 p-4">
            <div className="eyebrow mb-2">Paper generation rules</div>
            {pending && !preview && <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Analysing question bank…</div>}
            {error && <p className="text-sm text-destructive">{error}</p>}
            {preview && (
              <>
                <ul>
                  {preview.result.rules.map((r) => (
                    <CheckRow key={r.key} status={r.ok ? "pass" : "warn"} label={r.label} detail={r.detail} />
                  ))}
                </ul>
                {preview.result.shortfalls.length > 0 && (
                  <div className="mt-3 rounded-lg border border-tone-warning/30 bg-tone-warning/5 p-3 text-xs">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-tone-warning"><TriangleAlert className="size-3.5" /> Not enough suitable questions</div>
                    {preview.result.shortfalls.map((s) => (
                      <div key={s.section}>Section {s.section}: {s.missing} missing — {s.reason}</div>
                    ))}
                    <div className="mt-1 text-muted-foreground">Add questions to the bank or allow reuse. Empty slots are left for you to fill manually.</div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => { const s = Math.floor(Math.random() * 100000); setSeed(s); run(s); }} disabled={pending || !selected.length}>
            {pending ? <Loader2 className="animate-spin" /> : <Dices />} Try another selection
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={apply} disabled={!preview || pending || applying || !selected.length}>
              {applying && <Loader2 className="animate-spin" />} Apply to paper
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
