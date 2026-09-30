"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveStructureAction } from "@/features/academics/actions";
import type { StructureKind } from "@/server/services/academics";

export interface FieldSpec {
  name: string;
  label: string;
  type: "text" | "number" | "date" | "select" | "checkbox";
  options?: { value: string; label: string }[];
  upper?: boolean;
}

export function StructureDialog({ kind, title, fields, id, initial }: { kind: StructureKind; title: string; fields: FieldSpec[]; id?: string; initial?: Record<string, string | number | boolean> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string | number | boolean>>(initial ?? Object.fromEntries(fields.map((f) => [f.name, f.type === "checkbox" ? false : f.type === "select" ? (f.options?.[0]?.value ?? "") : ""])));
  const [pending, start] = useTransition();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {id ? <Button size="icon-xs" variant="ghost" aria-label={`Edit ${title}`}><Pencil /></Button> : <Button size="xs" variant="outline"><Plus /> Add</Button>}
      </DialogTrigger>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const payload = Object.fromEntries(fields.map((f) => [f.name, f.type === "number" ? Number(v[f.name]) : v[f.name]]));
              const res = await saveStructureAction(kind, id ?? null, payload);
              if (!res.ok) {
                toast.error(res.error, { description: res.fieldErrors ? Object.values(res.fieldErrors).flat().join(" · ") : undefined });
                return;
              }
              toast.success(`${title} saved`);
              setOpen(false);
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{id ? `Edit ${title.toLowerCase()}` : `New ${title.toLowerCase()}`}</DialogTitle>
          </DialogHeader>
          {fields.map((f) => (
            <div key={f.name} className={f.type === "checkbox" ? "flex items-center gap-2" : "space-y-1.5"}>
              {f.type === "checkbox" ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={!!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} /> {f.label}
                </label>
              ) : (
                <>
                  <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
                  {f.type === "select" ? (
                    <select id={`f-${f.name}`} className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm" value={String(v[f.name] ?? "")} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <Input id={`f-${f.name}`} type={f.type} value={String(v[f.name] ?? "")} onChange={(e) => setV({ ...v, [f.name]: f.upper ? e.target.value.toUpperCase() : e.target.value })} required />
                  )}
                </>
              )}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
