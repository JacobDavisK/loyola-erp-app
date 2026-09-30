import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { chainHash } from "@/lib/hash";
import { db, type Tx } from "@/server/db";
import { requestMeta } from "@/server/request-context";

export interface AuditEntry {
  actorId?: string | null;
  actorName?: string | null;
  action: string; // e.g. paper.submit, auth.login.failed
  resourceType: string;
  resourceId?: string | null;
  summary?: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: Record<string, unknown>;
}

const toJson = (v: unknown) =>
  v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/**
 * Append an entry to the tamper-evident audit chain.
 * Each row stores sha256(prevHash + canonical(entry)); a DB trigger forbids UPDATE/DELETE.
 * An advisory lock serialises writers so the chain stays linear.
 */
export async function audit(entry: AuditEntry, tx?: Tx): Promise<void> {
  const meta = await requestMeta();
  const run = async (t: Tx) => {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(4242001)`;
    const prev = await t.auditLog.findFirst({ orderBy: { id: "desc" }, select: { hash: true } });
    const createdAt = new Date();
    const oldValue = toJson(entry.oldValue);
    const newValue = toJson(entry.newValue);
    const hash = chainHash(prev?.hash ?? null, {
      actorId: entry.actorId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId ?? null,
      oldValue,
      newValue,
      createdAt,
    });
    await t.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        actorName: entry.actorName ?? null,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId ?? null,
        summary: entry.summary,
        ip: meta.ip,
        userAgent: meta.userAgent,
        oldValue,
        newValue,
        metadata: toJson(entry.metadata),
        prevHash: prev?.hash ?? null,
        hash,
        createdAt,
      },
    });
  };
  if (tx) await run(tx);
  else await db.$transaction(run);
}

/** Recompute the chain; returns the first broken row id, or null when intact. */
export async function verifyAuditChain(limit = 20000): Promise<{ checked: number; brokenAt: string | null }> {
  const rows = await db.auditLog.findMany({ orderBy: { id: "asc" }, take: limit });
  let prev: string | null = null;
  for (const r of rows) {
    if (r.prevHash !== prev || r.hash !== chainHash(prev, r)) return { checked: rows.length, brokenAt: r.id.toString() };
    prev = r.hash;
  }
  return { checked: rows.length, brokenAt: null };
}
