import "server-only";
import type { PermissionKey } from "@/lib/domain/permissions";
import { db } from "@/server/db";

/** Active users holding a permission, with department and current open-assignment load. */
export async function peopleWith(perm: PermissionKey) {
  const users = await db.user.findMany({
    where: { status: "ACTIVE", deletedAt: null, roles: { some: { role: { permissions: { some: { permission: { key: perm } } } } } } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      department: { select: { code: true } },
      _count: { select: { setterAssignments: { where: { status: { in: ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"] } } } } },
    },
  });
  return users.map((u) => ({ id: u.id, name: u.name, dept: u.department?.code ?? null, load: u._count.setterAssignments }));
}
