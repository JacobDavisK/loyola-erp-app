/**
 * Brings an existing database's permission catalogue and system roles up to date with the code
 * (src/lib/domain/permissions.ts). Run after `npm run db:migrate` when upgrading:
 *
 *   npm run rbac:sync            apply
 *   npm run rbac:sync -- --dry   report only
 *
 * It only ADDS: new permissions, new system roles, and new default permissions on system roles.
 * Permissions an administrator removed from a system role are re-added only with --reset-system-roles.
 * Custom roles are never touched. Every change is written to the audit log.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "../src/generated/prisma/client";
import { chainHash } from "../src/lib/hash";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/lib/domain/permissions";

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const dry = process.argv.includes("--dry");
const reset = process.argv.includes("--reset-system-roles");

async function audit(summary: string, newValue: unknown) {
  if (dry) return;
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242001)`;
    const prev = await tx.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
    const createdAt = new Date();
    const value = JSON.parse(JSON.stringify(newValue)) as Prisma.InputJsonValue;
    const hash = chainHash(prev?.hash ?? null, { actorId: null, action: "rbac.sync", resourceType: "system", resourceId: null, oldValue: undefined, newValue: value, createdAt });
    await tx.auditLog.create({ data: { actorName: "rbac:sync", action: "rbac.sync", resourceType: "system", summary, newValue: value, prevHash: prev?.hash ?? null, hash, createdAt, userAgent: "scripts/sync-rbac.ts" } });
  });
}

async function main() {
  const existing = new Map((await db.permission.findMany()).map((p) => [p.key, p]));
  const newPerms = Object.entries(PERMISSIONS).filter(([k]) => !existing.has(k));
  for (const [key, meta] of newPerms) {
    console.log(`+ permission ${key}`);
    if (!dry) existing.set(key, await db.permission.create({ data: { key, module: meta.module, description: meta.description } }));
  }
  if (newPerms.length) await audit(`${newPerms.length} permission(s) added`, { permissions: newPerms.map(([k]) => k) });

  for (const [key, def] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.findUnique({ where: { key }, include: { permissions: { include: { permission: true } } } });
    if (!role) {
      console.log(`+ role ${key} (${def.permissions.length} permissions)`);
      if (!dry) {
        await db.role.create({
          data: { key, name: def.name, description: def.description, rank: def.rank, isSystem: true, isGlobal: def.global, permissions: { create: def.permissions.map((p) => ({ permissionId: existing.get(p)!.id })) } },
        });
      }
      await audit(`System role ${def.name} created`, { role: key, permissions: def.permissions });
      continue;
    }
    if (!role.isSystem) continue;
    const held = new Set(role.permissions.map((rp) => rp.permission.key));
    const addedSinceCreation = def.permissions.filter((p) => !held.has(p));
    const missing = reset ? addedSinceCreation : addedSinceCreation.filter((p) => newPerms.some(([k]) => k === p) || !role.updatedAt || role.updatedAt <= role.createdAt);
    if (!missing.length) continue;
    console.log(`~ role ${key}: + ${missing.join(", ")}`);
    if (!dry) await db.rolePermission.createMany({ data: missing.map((p) => ({ roleId: role.id, permissionId: existing.get(p)!.id })), skipDuplicates: true });
    await audit(`System role ${role.name}: ${missing.length} default permission(s) added`, { role: key, added: missing });
  }
  console.log(dry ? "Dry run — nothing changed." : "RBAC catalogue is up to date.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
