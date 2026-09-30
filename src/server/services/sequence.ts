import "server-only";
import type { Tx } from "@/server/db";

export interface SequenceDefaults {
  /** Supports {YYYY} and {YY} tokens, e.g. "INV/{YYYY}/" */
  prefix?: string;
  padding?: number;
}

/**
 * Next number of a named sequence, allocated atomically inside the caller's transaction
 * (INSERT … ON CONFLICT DO UPDATE takes a row lock, so concurrent callers never get the same value).
 * If the transaction rolls back, the number is released with it — sequences stay gap-free for committed rows.
 */
export async function nextNumber(tx: Tx, key: string, defaults: SequenceDefaults = {}, at = new Date()): Promise<string> {
  const rows = await tx.$queryRaw<{ value: number; prefix: string; padding: number }[]>`
    INSERT INTO "NumberSequence" ("key", "prefix", "next", "padding", "updatedAt")
    VALUES (${key}, ${defaults.prefix ?? ""}, 2, ${defaults.padding ?? 5}, now())
    ON CONFLICT ("key") DO UPDATE SET "next" = "NumberSequence"."next" + 1, "updatedAt" = now()
    RETURNING "next" - 1 AS value, "prefix", "padding"`;
  const { value, prefix, padding } = rows[0];
  return formatSequence(prefix, Number(value), padding, at);
}

export function formatSequence(prefix: string, value: number, padding: number, at = new Date()): string {
  const year = String(at.getFullYear());
  return prefix.replaceAll("{YYYY}", year).replaceAll("{YY}", year.slice(2)) + String(value).padStart(padding, "0");
}
