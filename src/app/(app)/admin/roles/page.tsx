import Link from "next/link";
import { Fragment } from "react";
import { Check, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Roles & permissions" };

export default async function RolesPage() {
  await requirePageAuth("admin.roles.manage");
  const [roles, perms] = await Promise.all([
    db.role.findMany({ orderBy: { rank: "asc" }, include: { permissions: { select: { permissionId: true } }, _count: { select: { users: true } } } }),
    db.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] }),
  ]);
  const modules = [...new Set(perms.map((p) => p.module))];
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{roles.length} roles · {perms.length} permissions. Every backend operation re-checks these grants — the interface never decides access on its own.</p>
        <Button asChild size="sm"><Link href="/admin/roles/new"><Plus /> New role</Link></Button>
      </div>
      <div className="surface-card relative overflow-x-auto">
        <table className="w-full text-xs">
          <caption className="sr-only">Permission matrix</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="border-b">
              <th scope="col" className="px-4 py-3 text-left font-medium text-muted-foreground">Permission</th>
              {roles.map((r) => (
                <th key={r.id} scope="col" className="min-w-24 px-2 py-3 text-center align-bottom font-medium">
                  <Link href={`/admin/roles/${r.id}`} className="hover:text-primary">{r.name}</Link>
                  <div className="font-normal text-muted-foreground">{r._count.users} user{r._count.users === 1 ? "" : "s"}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((m) => (
              <Fragment key={m}>
                <tr className="bg-surface/60"><th scope="rowgroup" colSpan={roles.length + 1} className="px-4 py-1.5 text-left font-semibold">{m}</th></tr>
                {perms.filter((p) => p.module === m).map((p) => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                    <th scope="row" className="px-4 py-1.5 text-left font-normal">{p.description}</th>
                    {roles.map((r) => {
                      const has = r.permissions.some((x) => x.permissionId === p.id);
                      return <td key={r.id} className="text-center">{has ? <Check className="mx-auto size-3.5 text-primary" aria-label="Granted" /> : <span className="sr-only">Not granted</span>}</td>;
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
