import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { PERMISSIONS, type PermissionKey } from "@/lib/domain/permissions";
import { revokeAllSessions } from "@/server/auth/session";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound } from "@/server/errors";
import { randomToken, sha256 } from "@/server/security/crypto";
import { hashPassword } from "@/server/security/password";
import { audit } from "@/server/services/audit";
import { SETTING_SCHEMAS, type SettingKey } from "@/server/services/settings";
import { saveFile } from "@/server/storage";
import { BRAND } from "@/lib/brand";

const need = (ctx: AuthContext, perm: PermissionKey) => {
  if (!can(ctx, perm)) throw forbidden();
};

// ───────────────────────── Users ─────────────────────────

export const userSchema = z.object({
  name: z.string().trim().min(3).max(120),
  email: z.string().trim().toLowerCase().email(),
  employeeId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,20}$/, "3–20 letters or digits"),
  designation: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  departmentId: z.string().nullable().optional(),
});

export async function sendInvite(userId: string, email: string, name: string) {
  const token = randomToken(32);
  await db.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3_600_000) } });
  await db.emailOutbox.create({
    data: {
      to: email,
      subject: `${BRAND.mailTag} Your account has been created`,
      text: `Dear ${name},\n\nAn account on the ${BRAND.name} university platform has been created for you.\nSet your password within 72 hours: ${env.APP_URL}/reset-password?token=${token}\n\nIf you were not expecting this, contact the IT helpdesk.`,
    },
  });
}

/** New users receive an invitation link to set their own password — administrators never see or set passwords. */
export async function createUser(ctx: AuthContext, raw: unknown) {
  need(ctx, "admin.users.manage");
  const v = userSchema.extend({ roles: z.array(z.object({ roleId: z.string(), departmentId: z.string().nullable() })).min(1, "Grant at least one role") }).parse(raw);
  if (await db.user.findFirst({ where: { OR: [{ email: v.email }, { employeeId: v.employeeId }] } })) throw conflict("A user with this e-mail or employee ID already exists.");
  const user = await db.user.create({
    data: {
      name: v.name,
      email: v.email,
      employeeId: v.employeeId,
      designation: v.designation ?? null,
      phone: v.phone ?? null,
      departmentId: v.departmentId || null,
      status: "ACTIVE",
      mustChangePassword: true,
      passwordHash: await hashPassword(randomToken(24)), // unusable until the invitation is accepted
      roles: { create: v.roles.map((r) => ({ roleId: r.roleId, departmentId: r.departmentId || null, grantedById: ctx.user.id })) },
    },
  });
  await sendInvite(user.id, user.email, user.name);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "user.create", resourceType: "user", resourceId: user.id, summary: `${v.name} <${v.email}> created; invitation e-mailed`, newValue: { ...v } });
  return user;
}

export async function updateUser(ctx: AuthContext, id: string, raw: unknown) {
  need(ctx, "admin.users.manage");
  const v = userSchema.parse(raw);
  const before = await db.user.findUnique({ where: { id } });
  if (!before) throw notFound("User");
  const clash = await db.user.findFirst({ where: { id: { not: id }, OR: [{ email: v.email }, { employeeId: v.employeeId }] } });
  if (clash) throw conflict("Another user already has this e-mail or employee ID.");
  await db.user.update({ where: { id }, data: { ...v, designation: v.designation ?? null, phone: v.phone ?? null, departmentId: v.departmentId || null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "user.update", resourceType: "user", resourceId: id, summary: v.name, oldValue: { name: before.name, email: before.email, employeeId: before.employeeId, departmentId: before.departmentId }, newValue: v });
}

export async function userSecurityAction(ctx: AuthContext, id: string, op: "suspend" | "activate" | "unlock" | "reset-mfa" | "resend-invite" | "sign-out") {
  need(ctx, "admin.users.manage");
  const u = await db.user.findUnique({ where: { id } });
  if (!u) throw notFound("User");
  if (id === ctx.user.id && op === "suspend") throw invalid("You cannot suspend your own account.");
  switch (op) {
    case "suspend":
      await db.user.update({ where: { id }, data: { status: "SUSPENDED" } });
      await revokeAllSessions(id);
      break;
    case "activate":
      await db.user.update({ where: { id }, data: { status: "ACTIVE" } });
      break;
    case "unlock":
      await db.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 } });
      break;
    case "reset-mfa":
      await db.user.update({ where: { id }, data: { mfaEnabled: false, mfaSecretEnc: null } });
      await revokeAllSessions(id);
      break;
    case "resend-invite":
      await sendInvite(u.id, u.email, u.name);
      break;
    case "sign-out":
      await revokeAllSessions(id);
      break;
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `user.${op}`, resourceType: "user", resourceId: id, summary: `${u.name}: ${op.replace("-", " ")}` });
}

async function superAdminsRemaining(excludingGrantId?: string) {
  return db.userRole.count({ where: { role: { key: "SUPER_ADMIN" }, user: { status: "ACTIVE", deletedAt: null }, ...(excludingGrantId ? { id: { not: excludingGrantId } } : {}) } });
}

export const grantScopeSchema = z.object({
  type: z.enum(["own", "department", "unit", "campus"]).default("own"),
  id: z.string().nullable().optional(),
  validUntil: z.coerce.date().nullable().optional(),
});

/**
 * Grant a role. Global roles ignore the scope. Departmental roles are scoped to one department,
 * one academic unit (and its sub-units) or one campus; "own" pins the user's current department.
 */
export async function grantRole(ctx: AuthContext, userId: string, roleId: string, rawScope: unknown) {
  need(ctx, "admin.roles.manage");
  const scope = grantScopeSchema.parse(rawScope ?? {});
  const role = await db.role.findUnique({ where: { id: roleId } });
  if (!role) throw notFound("Role");
  const target = await db.user.findUnique({ where: { id: userId }, select: { departmentId: true, name: true } });
  if (!target) throw notFound("User");
  if (scope.validUntil && scope.validUntil <= new Date()) throw invalid("The expiry date must be in the future.");
  let departmentId: string | null = null;
  let academicUnitId: string | null = null;
  let campusId: string | null = null;
  let label = "institution-wide";
  if (!role.isGlobal) {
    if (scope.type === "unit") {
      const u = await db.academicUnit.findFirst({ where: { id: scope.id ?? "", deletedAt: null } });
      if (!u) throw invalid("Choose a faculty, school or centre.");
      academicUnitId = u.id;
      label = u.name;
    } else if (scope.type === "campus") {
      const c = await db.campus.findFirst({ where: { id: scope.id ?? "", deletedAt: null } });
      if (!c) throw invalid("Choose a campus.");
      campusId = c.id;
      label = c.name;
    } else {
      departmentId = (scope.type === "department" ? scope.id : null) || target.departmentId;
      const d = departmentId ? await db.department.findUnique({ where: { id: departmentId } }) : null;
      label = d?.name ?? "own records only";
    }
  }
  const exists = await db.userRole.findFirst({ where: { userId, roleId, departmentId, academicUnitId, campusId } });
  if (exists) throw conflict("The user already holds this role for that scope.");
  const g = await db.userRole.create({ data: { userId, roleId, departmentId, academicUnitId, campusId, validUntil: scope.validUntil ?? null, grantedById: ctx.user.id } });
  await audit({
    actorId: ctx.user.id, actorName: ctx.user.name, action: "role.grant", resourceType: "user", resourceId: userId,
    summary: `Granted ${role.name} (${label}) to ${target.name}`,
    newValue: { role: role.key, departmentId, academicUnitId, campusId, validUntil: scope.validUntil ?? null },
  });
  return g;
}

export async function revokeRole(ctx: AuthContext, grantId: string) {
  need(ctx, "admin.roles.manage");
  const g = await db.userRole.findUnique({ where: { id: grantId }, include: { role: true, user: true } });
  if (!g) throw notFound("Role grant");
  if (g.role.key === "SUPER_ADMIN" && (await superAdminsRemaining(grantId)) === 0) throw invalid("At least one active Super Admin must remain.");
  const others = await db.userRole.count({ where: { userId: g.userId, id: { not: grantId } } });
  if (!others) throw invalid("A user must keep at least one role. Suspend the account instead.");
  await db.userRole.delete({ where: { id: grantId } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "role.revoke", resourceType: "user", resourceId: g.userId, summary: `Revoked ${g.role.name} from ${g.user.name}`, oldValue: { role: g.role.key, departmentId: g.departmentId, academicUnitId: g.academicUnitId, campusId: g.campusId, validUntil: g.validUntil } });
}

// ───────────────────────── Roles & permissions ─────────────────────────

export async function saveRole(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "admin.roles.manage");
  const v = z
    .object({
      key: z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9_]{2,30}$/, "UPPER_SNAKE_CASE"),
      name: z.string().trim().min(3).max(60),
      description: z.string().max(300).nullable().optional(),
      isGlobal: z.boolean(),
      permissions: z.array(z.string()).refine((ps) => ps.every((p) => p in PERMISSIONS), "Unknown permission"),
    })
    .parse(raw);
  const before = id ? await db.role.findUnique({ where: { id }, include: { permissions: { include: { permission: true } } } }) : null;
  if (id && !before) throw notFound("Role");
  if (before?.key === "SUPER_ADMIN" && !v.permissions.includes("admin.roles.manage")) throw invalid("Super Admin must keep role management (prevents lock-out).");
  const perms = await db.permission.findMany({ where: { key: { in: v.permissions } } });
  const role = await db.$transaction(async (tx) => {
    const r = id
      ? await tx.role.update({ where: { id }, data: { name: v.name, description: v.description ?? null, isGlobal: before!.isSystem ? before!.isGlobal : v.isGlobal } })
      : await tx.role.create({ data: { key: v.key, name: v.name, description: v.description ?? null, isGlobal: v.isGlobal, rank: 70 } });
    await tx.rolePermission.deleteMany({ where: { roleId: r.id } });
    await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: r.id, permissionId: p.id })) });
    await audit(
      {
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        action: id ? "role.permissions.update" : "role.create",
        resourceType: "role",
        resourceId: r.id,
        summary: `${v.name}: ${perms.length} permission(s)`,
        oldValue: before ? { permissions: before.permissions.map((p) => p.permission.key).sort() } : undefined,
        newValue: { permissions: [...v.permissions].sort() },
      },
      tx,
    );
    return r;
  });
  return role;
}

// ───────────────────────── Settings & institution ─────────────────────────

export async function saveSetting(ctx: AuthContext, key: SettingKey, raw: unknown) {
  need(ctx, "admin.settings.manage");
  const value = SETTING_SCHEMAS[key].parse(raw);
  const before = await db.systemSetting.findUnique({ where: { key } });
  await db.systemSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue, updatedById: ctx.user.id }, update: { value: value as Prisma.InputJsonValue, updatedById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `settings.${key}.update`, resourceType: "settings", resourceId: key, oldValue: before?.value, newValue: value });
}

export const institutionSchema = z.object({
  name: z.string().trim().min(3).max(160),
  shortName: z.string().trim().min(2).max(20),
  tagline: z.string().trim().max(160).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().nullable().optional().or(z.literal("")),
  website: z.string().trim().url().nullable().optional().or(z.literal("")),
});

export async function saveInstitution(ctx: AuthContext, raw: unknown) {
  need(ctx, "admin.institution.manage");
  const v = institutionSchema.parse(raw);
  const inst = await db.institution.findFirstOrThrow();
  await db.institution.update({ where: { id: inst.id }, data: { ...v, email: v.email || null, website: v.website || null } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "institution.update", resourceType: "institution", resourceId: inst.id, oldValue: inst, newValue: v });
}

export async function uploadLogo(ctx: AuthContext, data: Buffer, name: string) {
  need(ctx, "admin.institution.manage");
  const asset = await saveFile({ data, name, kind: "LOGO", ownerId: ctx.user.id });
  const inst = await db.institution.findFirstOrThrow();
  await db.institution.update({ where: { id: inst.id }, data: { logoAssetId: asset.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "institution.logo", resourceType: "institution", resourceId: inst.id, summary: `Logo updated (${asset.originalName})` });
  return asset;
}

// ───────────────────────── Backup ─────────────────────────

/**
 * Configuration backup (roles, permissions, settings, templates, watermarks, academic structure,
 * blueprints). Examination content is backed up at the database level (pg_dump / managed backups),
 * never exported through the browser.
 */
export async function exportConfiguration(ctx: AuthContext) {
  need(ctx, "admin.backup");
  const [institution, roles, settings, templates, watermarks, departments, programs, regulations, years, semesters, blueprints] = await Promise.all([
    db.institution.findFirst(),
    db.role.findMany({ include: { permissions: { include: { permission: { select: { key: true } } } } } }),
    db.systemSetting.findMany(),
    db.template.findMany(),
    db.watermark.findMany(),
    db.department.findMany({ where: { deletedAt: null } }),
    db.program.findMany({ where: { deletedAt: null } }),
    db.regulation.findMany(),
    db.academicYear.findMany(),
    db.semester.findMany(),
    db.blueprint.findMany({ where: { deletedAt: null }, include: { sections: true, rules: true } }),
  ]);
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "backup.export", resourceType: "system", summary: "Configuration backup downloaded" });
  return {
    format: "examcore-config",
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: ctx.user.name,
    institution,
    roles: roles.map((r) => ({ key: r.key, name: r.name, description: r.description, isGlobal: r.isGlobal, isSystem: r.isSystem, permissions: r.permissions.map((p) => p.permission.key) })),
    settings,
    templates,
    watermarks,
    departments,
    programs,
    regulations,
    academicYears: years,
    semesters,
    blueprints,
  };
}

/** Restore the settings portion of a configuration backup (validated against the current schemas). */
export async function restoreSettings(ctx: AuthContext, raw: unknown) {
  need(ctx, "admin.backup");
  const file = z.object({ format: z.literal("examcore-config"), settings: z.array(z.object({ key: z.string(), value: z.unknown() })) }).parse(raw);
  let restored = 0;
  for (const s of file.settings) {
    if (!(s.key in SETTING_SCHEMAS)) continue;
    await saveSetting({ ...ctx, grants: new Map([...ctx.grants, ["admin.settings.manage", null]]) }, s.key as SettingKey, s.value);
    restored++;
  }
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "backup.restore", resourceType: "system", summary: `${restored} setting group(s) restored from backup` });
  return restored;
}
