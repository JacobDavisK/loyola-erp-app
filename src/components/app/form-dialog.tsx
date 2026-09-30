"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Value = string | number | boolean | null;

export interface FormField {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "datetime-local" | "time" | "select" | "checkbox" | "textarea";
  options?: { value: string; label: string }[];
  /** optional fields send null when empty */
  optional?: boolean;
  upper?: boolean;
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  /** span both columns in the two-column layout */
  wide?: boolean;
}

export type FormAction = (id: string | null, payload: Record<string, Value>) => Promise<
  { ok: true; message?: string; data?: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[]> }
>;

function emptyFor(f: FormField): Value {
  if (f.type === "checkbox") return false;
  if (f.type === "select" && !f.optional) return f.options?.[0]?.value ?? "";
  return "";
}

/**
 * Generic create/edit dialog for master data. `action` is a server action taking (id, payload);
 * validation and authorisation happen on the server — field errors are shown inline.
 */
export function FormDialog({
  title,
  description,
  fields,
  action,
  id,
  initial,
  trigger,
  submitLabel = "Save",
  columns = 1,
  onSaved,
}: {
  title: string;
  description?: string;
  fields: FormField[];
  action: FormAction;
  id?: string;
  initial?: Record<string, Value>;
  trigger?: React.ReactNode;
  submitLabel?: string;
  columns?: 1 | 2;
  onSaved?: (data: unknown) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const blank = () => Object.fromEntries(fields.map((f) => [f.name, initial?.[f.name] ?? emptyFor(f)]));
  const [v, setV] = useState<Record<string, Value>>(blank);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [pending, start] = useTransition();

  const payload = () =>
    Object.fromEntries(
      fields.map((f) => {
        const raw = v[f.name];
        if (f.type === "checkbox") return [f.name, !!raw];
        if (raw === "" || raw === null || raw === undefined) return [f.name, f.optional ? null : f.type === "number" ? null : ""];
        if (f.type === "number") return [f.name, Number(raw)];
        return [f.name, raw];
      }),
    );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setV(blank());
          setErrors({});
        }
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (id ? <Button size="icon-xs" variant="ghost" aria-label={`Edit ${title.toLowerCase()}`}><Pencil /></Button> : <Button size="xs" variant="outline"><Plus /> Add</Button>)}
      </DialogTrigger>
      <DialogContent className={columns === 2 ? "sm:max-w-2xl" : undefined}>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await action(id ?? null, payload());
              if (!res.ok) {
                setErrors(res.fieldErrors ?? {});
                toast.error(res.error);
                return;
              }
              toast.success(res.message ?? `${title} saved`);
              setOpen(false);
              onSaved?.(res.data);
              router.refresh();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>{id ? `Edit ${title.toLowerCase()}` : `New ${title.toLowerCase()}`}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <div className={cn("grid gap-3", columns === 2 && "sm:grid-cols-2")}>
            {fields.map((f) => {
              const fid = `fd-${f.name}`;
              const err = errors[f.name];
              const describedBy = [f.hint ? `${fid}-hint` : null, err ? `${fid}-err` : null].filter(Boolean).join(" ") || undefined;
              const common = { id: fid, "aria-invalid": err ? true : undefined, "aria-describedby": describedBy };
              return (
                <div key={f.name} className={cn(f.type === "checkbox" ? "flex items-center" : "space-y-1.5", (f.wide || f.type === "textarea") && "sm:col-span-2")}>
                  {f.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4 accent-[var(--primary)]" {...common} checked={!!v[f.name]} onChange={(e) => setV({ ...v, [f.name]: e.target.checked })} /> {f.label}
                    </label>
                  ) : (
                    <>
                      <Label htmlFor={fid}>
                        {f.label}
                        {f.optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
                      </Label>
                      {f.type === "select" ? (
                        <select {...common} className="h-9 w-full rounded-lg border bg-card px-2.5 text-sm" value={String(v[f.name] ?? "")} onChange={(e) => setV({ ...v, [f.name]: e.target.value })}>
                          {f.optional && <option value="">—</option>}
                          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : f.type === "textarea" ? (
                        <Textarea {...common} rows={3} placeholder={f.placeholder} value={String(v[f.name] ?? "")} onChange={(e) => setV({ ...v, [f.name]: e.target.value })} />
                      ) : (
                        <Input
                          {...common}
                          type={f.type}
                          min={f.min}
                          max={f.max}
                          step={f.step}
                          placeholder={f.placeholder}
                          value={String(v[f.name] ?? "")}
                          onChange={(e) => setV({ ...v, [f.name]: f.upper ? e.target.value.toUpperCase() : e.target.value })}
                        />
                      )}
                    </>
                  )}
                  {f.hint && <p id={`${fid}-hint`} className="text-xs text-muted-foreground">{f.hint}</p>}
                  {err && <p id={`${fid}-err`} className="text-xs text-destructive">{err.join(" ")}</p>}
                </div>
              );
            })}
          </div>
          {errors._ && <p className="text-sm text-destructive">{errors._.join(" ")}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />} {submitLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
