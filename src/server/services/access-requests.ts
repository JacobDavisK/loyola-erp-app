import "server-only";
import { z } from "zod";
import { SYSTEM_ROLES, type SystemRoleKey } from "@/lib/domain/permissions";
import type { AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { invalid, notFound } from "@/server/errors";
import { startWorkflow } from "@/server/services/workflow";
import type { AccessRequestData } from "@/server/workflow/modules/access";

/** Roles that can only be granted directly by an administrator, never requested. */
const NOT_REQUESTABLE = new Set(["SUPER_ADMIN", "STUDENT", "GUARDIAN"]);

const schema = z.object({
  roleId: z.string().min(1),
  scopeType: z.enum(["global", "department", "unit", "campus"]),
  scopeId: z.string().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
  reason: z.string().trim().min(10, "Explain why you need this access (at least 10 characters)").max(1000),
});

export async function requestableRoles() {
  const roles = await db.role.findMany({ orderBy: [{ rank: "asc" }, { name: "asc" }], select: { id: true, key: true, name: true, isGlobal: true, description: true } });
  return roles.filter((r) => !NOT_REQUESTABLE.has(r.key));
}

export async function requestAccess(ctx: AuthContext, raw: unknown) {
  const v = schema.parse(raw);
  const role = await db.role.findUnique({ where: { id: v.roleId } });
  if (!role || NOT_REQUESTABLE.has(role.key)) throw notFound("Role");
  if (v.validUntil && (v.validUntil <= new Date() || v.validUntil.getTime() - Date.now() > 366 * 86_400_000)) throw invalid("Access can be requested for at most one year.");

  const scopeType = role.isGlobal ? "global" : v.scopeType === "global" ? "department" : v.scopeType;
  let departmentId: string | null = null;
  let academicUnitId: string | null = null;
  let campusId: string | null = null;
  let scopeLabel = "Institution-wide";
  let subjectDepartment: string | null = ctx.user.departmentId;
  if (scopeType === "department") {
    const d = await db.department.findFirst({ where: { id: v.scopeId ?? ctx.user.departmentId ?? "", deletedAt: null } });
    if (!d) throw invalid("Choose the department the access is for.");
    departmentId = d.id;
    subjectDepartment = d.id;
    scopeLabel = d.name;
  } else if (scopeType === "unit") {
    const u = await db.academicUnit.findFirst({ where: { id: v.scopeId ?? "", deletedAt: null } });
    if (!u) throw invalid("Choose the faculty, school or centre the access is for.");
    academicUnitId = u.id;
    scopeLabel = u.name;
  } else if (scopeType === "campus") {
    const c = await db.campus.findFirst({ where: { id: v.scopeId ?? "", deletedAt: null } });
    if (!c) throw invalid("Choose the campus the access is for.");
    campusId = c.id;
    scopeLabel = c.name;
  }
  const held = await db.userRole.findFirst({ where: { userId: ctx.user.id, roleId: role.id, departmentId, academicUnitId, campusId, OR: [{ validUntil: null }, { validUntil: { gt: new Date() } }] } });
  if (held) throw invalid("You already hold this role for that scope.");

  const data: AccessRequestData = {
    userId: ctx.user.id, userName: ctx.user.name, roleId: role.id, roleKey: role.key, roleName: role.name, scopeType, departmentId, academicUnitId, campusId,
    scopeLabel, validUntil: v.validUntil ? v.validUntil.toISOString() : null, reason: v.reason, departmentScoped: scopeType === "department",
  };
  return db.$transaction((tx) =>
    startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, {
      key: "access.request",
      resourceType: "accessRequest",
      resourceId: `${ctx.user.id}:${role.id}:${departmentId ?? academicUnitId ?? campusId ?? "global"}`,
      title: `${role.name} for ${ctx.user.name}`,
      summary: `${scopeLabel}${data.validUntil ? ` · until ${data.validUntil.slice(0, 10)}` : " · no expiry"} — ${v.reason}`,
      departmentId: subjectDepartment,
      subjectUserId: ctx.user.id,
      data: data as unknown as Record<string, unknown>,
    }),
  );
}

export const roleScopeHint = (key: string) => SYSTEM_ROLES[key as SystemRoleKey]?.defaultScope ?? "department";
