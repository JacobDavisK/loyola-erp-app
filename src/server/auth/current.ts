import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { departmentsForScope, type OrgMap } from "@/lib/domain/org-scope";
import type { PermissionKey } from "@/lib/domain/permissions";
import { readSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { forbidden, unauthenticated } from "@/server/errors";

export interface RoleGrant {
  key: string;
  name: string;
  rank: number;
  isGlobal: boolean;
  departmentId: string | null;
  departmentName: string | null;
}

/** Everything the server needs to authorise a request. Built once per request. */
export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    name: string;
    email: string;
    employeeId: string;
    designation: string | null;
    departmentId: string | null;
    departmentName: string | null;
    avatarAssetId: string | null;
    mfaEnabled: boolean;
    mustChangePassword: boolean;
    userType: "STAFF" | "STUDENT" | "GUARDIAN" | "EXTERNAL";
  };
  roles: RoleGrant[];
  primaryRole: RoleGrant;
  /** Self-service links: the student record of a student account, the wards of a guardian account. */
  subject: { studentId: string | null; wardStudentIds: string[]; employeeId: string | null };
  /** permission → null (global) or set of department ids the permission is scoped to */
  grants: Map<PermissionKey, Set<string> | null>;
}

export const getAuth = cache(async (): Promise<AuthContext | null> => {
  const session = await readSession();
  if (!session || session.mfaPending) return null;
  return buildAuthContext(session.userId, session.id);
});

/** Departments and units — small tables, read when a unit/campus-scoped grant needs resolving. */
export async function loadOrgMap(): Promise<OrgMap> {
  const [departments, units] = await Promise.all([
    db.department.findMany({ where: { deletedAt: null }, select: { id: true, academicUnitId: true, campusId: true } }),
    db.academicUnit.findMany({ where: { deletedAt: null }, select: { id: true, parentId: true, campusId: true } }),
  ]);
  return { departments, units };
}

/** Resolve a user's roles and permission grants into an AuthContext (also used by tests and scripts). */
export async function buildAuthContext(userId: string, sessionId: string): Promise<AuthContext | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: {
      department: { select: { name: true } },
      studentProfile: { select: { id: true, deletedAt: true } },
      guardianOf: { select: { studentId: true, student: { select: { deletedAt: true } } } },
      employeeProfile: { select: { id: true, deletedAt: true } },
      roles: {
        include: {
          department: { select: { name: true } },
          academicUnit: { select: { name: true } },
          campus: { select: { name: true } },
          role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
        },
      },
    },
  });
  if (!user || user.deletedAt || user.status !== "ACTIVE") return null;

  const now = new Date();
  const active = user.roles.filter((ur) => !ur.validUntil || ur.validUntil > now);
  const needsOrg = active.some((ur) => !ur.role.isGlobal && (ur.academicUnitId || ur.campusId));
  const org: OrgMap = needsOrg ? await loadOrgMap() : { departments: [], units: [] };

  const grants = new Map<PermissionKey, Set<string> | null>();
  const roles: RoleGrant[] = [];
  for (const ur of active) {
    roles.push({
      key: ur.role.key,
      name: ur.role.name,
      rank: ur.role.rank,
      isGlobal: ur.role.isGlobal,
      departmentId: ur.departmentId,
      departmentName: ur.department?.name ?? ur.academicUnit?.name ?? ur.campus?.name ?? null,
    });
    // a non-global role without an explicit scope falls back to the user's own department
    const depts = ur.role.isGlobal ? [] : departmentsForScope(org, ur, user.departmentId);
    for (const rp of ur.role.permissions) {
      const key = rp.permission.key as PermissionKey;
      const current = grants.get(key);
      if (current === null) continue; // already global
      if (ur.role.isGlobal) grants.set(key, null);
      else {
        const set = current ?? new Set<string>();
        for (const d of depts) set.add(d);
        grants.set(key, set);
      }
    }
  }
  if (!roles.length) return null;
  roles.sort((a, b) => a.rank - b.rank);

  return {
    sessionId,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      employeeId: user.employeeId,
      designation: user.designation,
      departmentId: user.departmentId,
      departmentName: user.department?.name ?? null,
      avatarAssetId: user.avatarAssetId,
      mfaEnabled: user.mfaEnabled,
      mustChangePassword: user.mustChangePassword,
      userType: user.userType,
    },
    roles,
    primaryRole: roles[0],
    subject: {
      studentId: user.studentProfile && !user.studentProfile.deletedAt ? user.studentProfile.id : null,
      wardStudentIds: user.guardianOf.filter((g) => !g.student.deletedAt).map((g) => g.studentId),
      employeeId: user.employeeProfile && !user.employeeProfile.deletedAt ? user.employeeProfile.id : null,
    },
    grants,
  };
}

export function can(ctx: AuthContext, perm: PermissionKey, departmentId?: string | null): boolean {
  if (!ctx.grants.has(perm)) return false;
  const scope = ctx.grants.get(perm);
  if (scope === null) return true;
  if (departmentId === undefined) return true; // permission held somewhere; caller must scope queries
  return !!departmentId && !!scope?.has(departmentId);
}

export function canAny(ctx: AuthContext, perms: PermissionKey[]): boolean {
  return perms.some((p) => can(ctx, p));
}

export function hasGlobal(ctx: AuthContext, perm: PermissionKey): boolean {
  return ctx.grants.has(perm) && ctx.grants.get(perm) === null;
}

/** Department ids the permission is scoped to; null = all departments; [] = none. */
export function scopeOf(ctx: AuthContext, perm: PermissionKey): string[] | null {
  if (!ctx.grants.has(perm)) return [];
  const s = ctx.grants.get(perm);
  return s === null ? null : [...(s ?? [])];
}

export function hasRole(ctx: AuthContext, key: string): boolean {
  return ctx.roles.some((r) => r.key === key);
}

/**
 * The Super Admin may stand in for any relationship-bound actor (task assignee, instructor, moderator,
 * scrutiniser, valuer) and open any student's portal. Integrity rules still apply: nobody decides their own
 * request, and every action is audited under the Super Admin's own name.
 */
export function isSuperAdmin(ctx: AuthContext): boolean {
  return hasRole(ctx, "SUPER_ADMIN");
}

/** For server actions / route handlers: throws typed errors. */
export async function requireAuth(perm?: PermissionKey): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) throw unauthenticated();
  if (perm && !can(ctx, perm)) throw forbidden();
  return ctx;
}

/** For pages/layouts: redirects instead of throwing. */
export async function requirePageAuth(perm?: PermissionKey | PermissionKey[]): Promise<AuthContext> {
  const ctx = await getAuth();
  if (!ctx) redirect("/login");
  if (perm) {
    const list = Array.isArray(perm) ? perm : [perm];
    if (!list.some((p) => can(ctx, p))) redirect("/forbidden");
  }
  return ctx;
}
