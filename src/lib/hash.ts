import { createHash } from "node:crypto";

/** Stable JSON (sorted object keys) so hashes don't depend on key order (jsonb reorders keys). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export interface ChainFields {
  actorId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  oldValue: unknown;
  newValue: unknown;
  createdAt: Date;
}

/** Audit hash chain: sha256(prevHash | canonical(entry)). */
export function chainHash(prevHash: string | null, r: ChainFields): string {
  return sha256(
    (prevHash ?? "GENESIS") +
      canonicalJson({
        actorId: r.actorId,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        oldValue: r.oldValue ?? null,
        newValue: r.newValue ?? null,
        createdAt: r.createdAt.toISOString(),
      }),
  );
}
