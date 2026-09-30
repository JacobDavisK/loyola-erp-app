import { api } from "@/server/api";
import { db } from "@/server/db";

export const GET = api(async () => {
  const roles = await db.role.findMany({ orderBy: { rank: "asc" }, include: { permissions: { include: { permission: { select: { key: true } } } } } });
  return roles.map((r) => ({ id: r.id, key: r.key, name: r.name, isGlobal: r.isGlobal, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission.key) }));
}, { perm: "admin.roles.manage" });
