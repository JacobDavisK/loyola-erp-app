import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { RoleEditor } from "@/features/admin/role-editor";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Role" };

export default async function RolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePageAuth("admin.roles.manage");
  const catalog = (await db.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] })).map((p) => ({ key: p.key, module: p.module, description: p.description }));
  if (id === "new") {
    return <RoleEditor id={null} system={false} catalog={catalog} initial={{ key: "", name: "", description: "", isGlobal: false, permissions: ["academic.view"] }} />;
  }
  const r = await db.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } });
  if (!r) notFound();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{r.name}</h2>
        {r.isSystem && <p className="text-xs text-muted-foreground">System role — its key and scope are fixed; permissions can be adjusted.</p>}
      </div>
      <RoleEditor id={r.id} system={r.isSystem} catalog={catalog} initial={{ key: r.key, name: r.name, description: r.description ?? "", isGlobal: r.isGlobal, permissions: r.permissions.map((p) => p.permission.key) }} />
    </div>
  );
}
