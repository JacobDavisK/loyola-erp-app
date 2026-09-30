"use client";

import { useRef, useTransition } from "react";
import { Database, Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportConfigAction, restoreSettingsAction } from "@/features/admin/actions";

export function BackupPanel() {
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Configuration backup</h2>
        <p className="mt-1 text-sm text-muted-foreground">Downloads roles, permissions, settings, templates, watermarks, academic structure and blueprints as JSON. Examination content (questions, papers) is never exported through the browser.</p>
        <Button
          className="mt-4"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await exportConfigAction();
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              const url = URL.createObjectURL(new Blob([r.data], { type: "application/json" }));
              const a = document.createElement("a");
              a.href = url;
              a.download = `examcore-config-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              URL.revokeObjectURL(url);
              toast.success("Configuration backup downloaded");
            })
          }
        >
          {pending ? <Loader2 className="animate-spin" /> : <Download />} Download configuration
        </Button>
      </section>
      <section className="surface-card p-5">
        <h2 className="text-sm font-semibold">Restore settings</h2>
        <p className="mt-1 text-sm text-muted-foreground">Restores the security and examination-rule settings from a configuration backup. Every value is validated before it is applied, and the restore is audited.</p>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (!confirm("Replace current security and workflow settings with the values in this backup?")) return;
            const text = await f.text();
            start(async () => {
              const r = await restoreSettingsAction(text);
              if (!r.ok) {
                toast.error(r.error);
                return;
              }
              toast.success(`${r.data} setting group(s) restored`);
            });
          }}
        />
        <Button variant="outline" className="mt-4" disabled={pending} onClick={() => fileRef.current?.click()}><Upload /> Choose backup file</Button>
      </section>
      <section className="surface-card p-5 lg:col-span-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><Database className="size-4" /> Database backups</h2>
        <p className="mt-1 text-sm text-muted-foreground">Full backups of examination data must be taken at the database level: enable automated encrypted snapshots on your managed PostgreSQL service, or schedule <code className="rounded bg-muted px-1">pg_dump --format=custom</code> to encrypted, access-controlled storage, and test restores each term. The private file store (<code className="rounded bg-muted px-1">STORAGE_DIR</code> or object bucket) must be backed up with the same schedule. See the README “Backup & restore” section.</p>
      </section>
    </div>
  );
}
