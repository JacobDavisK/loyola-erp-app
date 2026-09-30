"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { WatermarkOverlay } from "@/components/paper/paper-document";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { saveTemplateAction, saveWatermarkAction } from "@/features/templates/actions";

export interface TemplateValue {
  name: string;
  headerTitle: string;
  headerSubtitle: string;
  instructions: string;
  footerText: string;
  fontFamily: "Times New Roman" | "Georgia" | "Cambria" | "Arial" | "Calibri";
  fontSizePt: number;
  marginMm: number;
  showLogo: boolean;
  showRegNoBoxes: boolean;
  isDefault: boolean;
}

export function TemplateDialog({ id, initial }: { id?: string; initial?: TemplateValue }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<TemplateValue>(
    initial ?? { name: "", headerTitle: "", headerSubtitle: "", instructions: "", footerText: "Confidential", fontFamily: "Times New Roman", fontSizePt: 12, marginMm: 18, showLogo: true, showRegNoBoxes: true, isDefault: false },
  );
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{id ? <Button size="icon-sm" variant="ghost" aria-label={`Edit ${initial?.name}`}><Pencil /></Button> : <Button size="sm"><Plus /> New template</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveTemplateAction(id ?? null, { ...v, headerTitle: v.headerTitle || null, headerSubtitle: v.headerSubtitle || null, instructions: v.instructions || null, footerText: v.footerText || null });
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Template saved");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <DialogHeader><DialogTitle>{id ? "Edit template" : "New question-paper template"}</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="t-name">Name</Label><Input id="t-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="t-h1">Header title</Label><Input id="t-h1" value={v.headerTitle} placeholder="Defaults to the institution name" onChange={(e) => setV({ ...v, headerTitle: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="t-h2">Header subtitle</Label><Input id="t-h2" value={v.headerSubtitle} onChange={(e) => setV({ ...v, headerSubtitle: e.target.value })} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="t-ins">Default instructions to candidates (one per line)</Label><Textarea id="t-ins" rows={3} value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} /></div>
          <div className="space-y-1.5"><Label htmlFor="t-foot">Footer text</Label><Input id="t-foot" value={v.footerText} onChange={(e) => setV({ ...v, footerText: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="t-font">Typeface</Label>
              <select id="t-font" className="h-9 w-full rounded-lg border bg-card px-2 text-sm" value={v.fontFamily} onChange={(e) => setV({ ...v, fontFamily: e.target.value as TemplateValue["fontFamily"] })}>
                {["Times New Roman", "Georgia", "Cambria", "Arial", "Calibri"].map((f) => <option key={f}>{f}</option>)}
              </select>
            </div>
            <div className="space-y-1.5"><Label htmlFor="t-size">Body size (pt)</Label><Input id="t-size" type="number" min={9} max={16} value={v.fontSizePt} onChange={(e) => setV({ ...v, fontSizePt: Number(e.target.value) })} /></div>
            <div className="space-y-1.5"><Label htmlFor="t-margin">Margins (mm)</Label><Input id="t-margin" type="number" min={10} max={30} value={v.marginMm} onChange={(e) => setV({ ...v, marginMm: Number(e.target.value) })} /></div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm">
            <label className="flex items-center gap-2"><Switch checked={v.showLogo} onCheckedChange={(c) => setV({ ...v, showLogo: c })} /> University logo</label>
            <label className="flex items-center gap-2"><Switch checked={v.showRegNoBoxes} onCheckedChange={(c) => setV({ ...v, showRegNoBoxes: c })} /> Register-number boxes</label>
            <label className="flex items-center gap-2"><Switch checked={v.isDefault} onCheckedChange={(c) => setV({ ...v, isDefault: c })} /> Default template</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const KINDS = [
  ["PREVIEW", "On-screen preview"],
  ["DRAFT_PDF", "Draft PDF"],
  ["MODERATION_PDF", "Moderation PDF"],
  ["FINAL_PDF", "Final PDF"],
] as const;

export function WatermarkDialog({ id, initial }: { id?: string; initial?: { name: string; text: string; opacity: number; angle: number; appliesTo: string[]; isActive: boolean } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial ?? { name: "", text: "CONFIDENTIAL — {USER} · {SESSION} · {TIMESTAMP}", opacity: 0.08, angle: -30, appliesTo: ["PREVIEW"], isActive: true });
  const [pending, start] = useTransition();
  const sample = v.text.replaceAll("{USER}", "Dr. Meera Krishnan (EMP1002)").replaceAll("{SESSION}", "NOV2026").replaceAll("{TIMESTAMP}", "24 Sep 2026, 14:05").replaceAll("{PAPER}", "BCS301-NOV2026-A");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{id ? <Button size="icon-sm" variant="ghost" aria-label={`Edit ${initial?.name}`}><Pencil /></Button> : <Button size="sm" variant="outline"><Plus /> New watermark</Button>}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveWatermarkAction(id ?? null, v);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success("Watermark saved");
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <DialogHeader><DialogTitle>{id ? "Edit watermark" : "New watermark"}</DialogTitle></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="w-name">Name</Label><Input id="w-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
          <div className="space-y-1.5">
            <Label htmlFor="w-text">Text</Label>
            <Input id="w-text" value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} required />
            <p className="text-xs text-muted-foreground">Placeholders: {"{USER}"} {"{SESSION}"} {"{TIMESTAMP}"} {"{PAPER}"} — filled in per viewer, per download.</p>
          </div>
          <div className="relative h-36 overflow-hidden rounded-lg border bg-white" aria-label="Watermark preview">
            <WatermarkOverlay text={sample} opacity={v.opacity} angle={v.angle} />
            <div className="relative p-4 font-serif text-xs text-neutral-700">1. Define a data structure. Give two examples of linear data structures. (2)</div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label htmlFor="w-op">Opacity ({Math.round(v.opacity * 100)}%)</Label><input id="w-op" type="range" min={0.02} max={0.3} step={0.01} value={v.opacity} onChange={(e) => setV({ ...v, opacity: Number(e.target.value) })} className="w-full accent-[var(--primary)]" /></div>
            <div className="space-y-1.5"><Label htmlFor="w-angle">Angle ({v.angle}°)</Label><input id="w-angle" type="range" min={-90} max={90} value={v.angle} onChange={(e) => setV({ ...v, angle: Number(e.target.value) })} className="w-full accent-[var(--primary)]" /></div>
          </div>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium">Applies to</legend>
            <div className="flex flex-wrap gap-2">
              {KINDS.map(([k, l]) => (
                <label key={k} className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
                  <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={v.appliesTo.includes(k)} onChange={(e) => setV({ ...v, appliesTo: e.target.checked ? [...v.appliesTo, k] : v.appliesTo.filter((x) => x !== k) })} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="flex items-center gap-2 text-sm"><Switch checked={v.isActive} onCheckedChange={(c) => setV({ ...v, isActive: c })} /> Active</label>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
