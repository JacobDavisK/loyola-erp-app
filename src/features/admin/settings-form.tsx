"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveSettingAction } from "@/features/admin/actions";
import type { SettingKey } from "@/server/services/settings";

export interface SettingField {
  key: string;
  label: string;
  hint?: string;
  type: "number" | "boolean" | "roles";
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}

export function SettingsForm({ settingKey, fields, initial, groups, roleOptions }: { settingKey: SettingKey; fields: SettingField[]; initial: Record<string, unknown>; groups: { title: string; keys: string[] }[]; roleOptions?: { key: string; name: string }[] }) {
  const router = useRouter();
  const [v, setV] = useState<Record<string, unknown>>(initial);
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveSettingAction(settingKey, v);
          if (!r.ok) {
            toast.error(r.error, { description: r.fieldErrors ? Object.entries(r.fieldErrors).map(([k, m]) => `${k}: ${m[0]}`).join(" · ") : undefined });
            return;
          }
          toast.success("Settings saved");
          router.refresh();
        });
      }}
    >
      {groups.map((g) => (
        <section key={g.title} className="surface-card">
          <h2 className="border-b px-5 py-3 text-sm font-semibold">{g.title}</h2>
          <div className="divide-y">
            {fields.filter((f) => g.keys.includes(f.key)).map((f) => (
              <div key={f.key} className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0 max-w-xl">
                  <Label htmlFor={`s-${f.key}`} className="text-sm">{f.label}</Label>
                  {f.hint && <p className="mt-0.5 text-xs text-muted-foreground">{f.hint}</p>}
                </div>
                {f.type === "boolean" ? (
                  <Switch id={`s-${f.key}`} checked={!!v[f.key]} onCheckedChange={(c) => setV({ ...v, [f.key]: c })} />
                ) : f.type === "roles" ? (
                  <div className="flex max-w-md flex-wrap justify-end gap-1.5">
                    {roleOptions?.map((r) => {
                      const list = (v[f.key] as string[]) ?? [];
                      return (
                        <label key={r.key} className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs">
                          <input type="checkbox" className="size-3.5 accent-[var(--primary)]" checked={list.includes(r.key)} onChange={(e) => setV({ ...v, [f.key]: e.target.checked ? [...list, r.key] : list.filter((x) => x !== r.key) })} />
                          {r.name}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Input id={`s-${f.key}`} type="number" className="w-28 text-right tabular" min={f.min} max={f.max} step={f.step ?? 1} value={String(v[f.key] ?? "")} onChange={(e) => setV({ ...v, [f.key]: Number(e.target.value) })} />
                    {f.suffix && <span className="w-16 text-xs text-muted-foreground">{f.suffix}</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save settings</Button></div>
    </form>
  );
}
