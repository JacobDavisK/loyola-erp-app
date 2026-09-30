"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { saveRoleAction } from "@/features/admin/actions";

export function RoleEditor({
  id,
  initial,
  catalog,
  system,
}: {
  id: string | null;
  initial: { key: string; name: string; description: string; isGlobal: boolean; permissions: string[] };
  catalog: { key: string; module: string; description: string }[];
  system: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const modules = [...new Set(catalog.map((c) => c.module))];
  const toggle = (k: string, on: boolean) => setV((x) => ({ ...x, permissions: on ? [...x.permissions, k] : x.permissions.filter((p) => p !== k) }));
  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveRoleAction(id, v);
          if (!r.ok) {
            toast.error(r.error);
            return;
          }
          toast.success("Role saved. Changes apply on the users' next request.");
          if (!id) router.push(`/admin/roles/${r.data.id}`);
          else router.refresh();
        });
      }}
    >
      <section className="surface-card grid gap-4 p-5 md:grid-cols-[200px_1fr_auto]">
        <div className="space-y-1.5"><Label htmlFor="r-key">Key</Label><Input id="r-key" value={v.key} disabled={!!id} onChange={(e) => setV({ ...v, key: e.target.value.toUpperCase() })} required /></div>
        <div className="space-y-1.5"><Label htmlFor="r-name">Name</Label><Input id="r-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="size-4 accent-[var(--primary)]" disabled={system} checked={v.isGlobal} onChange={(e) => setV({ ...v, isGlobal: e.target.checked })} /> Institution-wide scope</label>
        <div className="space-y-1.5 md:col-span-3"><Label htmlFor="r-desc">Description</Label><Textarea id="r-desc" rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} /></div>
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {modules.map((m) => {
          const perms = catalog.filter((c) => c.module === m);
          const all = perms.every((p) => v.permissions.includes(p.key));
          return (
            <fieldset key={m} className="surface-card p-4">
              <legend className="sr-only">{m}</legend>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{m}</h3>
                <button type="button" className="text-xs text-primary hover:underline" onClick={() => perms.forEach((p) => toggle(p.key, !all))}>{all ? "Clear" : "Select all"}</button>
              </div>
              <ul className="space-y-1.5">
                {perms.map((p) => (
                  <li key={p.key}>
                    <label className="flex items-start gap-2.5 text-sm">
                      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={v.permissions.includes(p.key)} onChange={(e) => toggle(p.key, e.target.checked)} />
                      <span>{p.description}<code className="ml-2 text-[10.5px] text-muted-foreground">{p.key}</code></span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          );
        })}
      </div>
      <div className="flex justify-end"><Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Save />} Save role</Button></div>
    </form>
  );
}
