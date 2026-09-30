import "server-only";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { departmentsForScope, type OrgMap } from "@/lib/domain/org-scope";
import type { PermissionKey } from "@/lib/domain/permissions";
import { db, type Tx } from "@/server/db";

export const getInstitution = cache(async () => {
  const inst = await db.institution.findFirst();
  if (!inst) throw new Error("Institution not configured. Run the seed or create one in Administration.");
  return inst;
});

async function orgMap(client: Tx | typeof db): Promise<OrgMap> {
  const [departments, units] = await Promise.all([
    client.department.findMany({ where: { deletedAt: null }, select: { id: true, academicUnitId: true, campusId: true } }),
    client.academicUnit.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true, campusId: true } }),
  ]);
  return { departments, units };
}

/**
 * Active users whose grant (matching `roleWhere`) covers `departmentId`.
 * Handles every grant scope: global roles, department grants, academic-unit grants (with descendants),
 * campus grants and unscoped grants that fall back to the holder's own department.
 * Without a department, every holder of the grant is returned.
 */
async function holders(roleWhere: Prisma.RoleWhereInput, departmentId: string | undefined | null, client: Tx | typeof db): Promise<string[]> {
  const now = new Date();
  const rows = await client.userRole.findMany({
    where: { role: roleWhere, user: { status: "ACTIVE", deletedAt: null }, OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
    select: { userId: true, departmentId: true, academicUnitId: true, campusId: true, role: { select: { isGlobal: true } }, user: { select: { departmentId: true } } },
  });
  if (!departmentId) return [...new Set(rows.map((r) => r.userId))];
  const org = rows.some((r) => r.academicUnitId || r.campusId) ? await orgMap(client) : { departments: [], units: [] };
  const out = new Set<string>();
  for (const r of rows) {
    if (r.role.isGlobal || departmentsForScope(org, r, r.user.departmentId).includes(departmentId)) out.add(r.userId);
  }
  return [...out];
}

/** Active users holding a permission (optionally only those whose scope covers a department). */
export async function usersWithPermission(perm: PermissionKey, departmentId?: string, tx?: Tx): Promise<string[]> {
  return holders({ permissions: { some: { permission: { key: perm } } } }, departmentId, tx ?? db);
}

/** Active holders of a role (by key) whose scope covers the department. */
export async function usersWithRole(roleKey: string, departmentId: string | null | undefined, tx?: Tx): Promise<string[]> {
  return holders({ key: roleKey }, departmentId, tx ?? db);
}
