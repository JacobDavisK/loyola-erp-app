import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/server/db";

/**
 * Domain events (transactional outbox).
 *
 * `emitEvent` writes the event in the caller's transaction, so an event exists if and only if the
 * change that caused it was committed. The worker (`npm run worker`) dispatches handlers
 * registered with `onEvent` and marks the event processed. Handlers must be idempotent: an event
 * can be delivered more than once if the worker crashes mid-way.
 */

export interface DomainEventInput {
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload?: Record<string, unknown>;
  actorId?: string | null;
}

export interface StoredEvent {
  id: bigint;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  actorId: string | null;
  occurredAt: Date;
}

type Handler = (e: StoredEvent) => Promise<void>;
const handlers = new Map<string, Handler[]>();

export function onEvent(type: string, handler: Handler) {
  (handlers.get(type) ?? handlers.set(type, []).get(type)!).push(handler);
}

export async function emitEvent(tx: Tx, e: DomainEventInput) {
  await tx.domainEvent.create({
    data: {
      type: e.type,
      aggregateType: e.aggregateType,
      aggregateId: e.aggregateId,
      payload: JSON.parse(JSON.stringify(e.payload ?? {})) as Prisma.InputJsonValue,
      actorId: e.actorId ?? null,
    },
  });
}

const MAX_ATTEMPTS = 5;

/** Claim and dispatch a batch of unprocessed events. Returns the number processed. */
export async function processEvents(limit = 50): Promise<number> {
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const done = await db.$transaction(async (tx) => {
      const [ev] = await tx.$queryRaw<StoredEvent[]>`
        SELECT "id", "type", "aggregateType", "aggregateId", "payload", "actorId", "occurredAt"
        FROM "DomainEvent"
        WHERE "processedAt" IS NULL AND "attempts" < ${MAX_ATTEMPTS}
        ORDER BY "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
      if (!ev) return false;
      try {
        for (const h of handlers.get(ev.type) ?? []) await h(ev);
        await tx.domainEvent.update({ where: { id: ev.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
      } catch (err) {
        await tx.domainEvent.update({ where: { id: ev.id }, data: { attempts: { increment: 1 }, lastError: err instanceof Error ? err.message.slice(0, 1000) : String(err) } });
      }
      return true;
    });
    if (!done) break;
    processed++;
  }
  return processed;
}

export async function eventStats() {
  const [pending, failed, last] = await Promise.all([
    db.domainEvent.count({ where: { processedAt: null, attempts: { lt: MAX_ATTEMPTS } } }),
    db.domainEvent.count({ where: { processedAt: null, attempts: { gte: MAX_ATTEMPTS } } }),
    db.domainEvent.findFirst({ where: { processedAt: { not: null } }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
  ]);
  return { pending, failed, lastProcessedAt: last?.processedAt ?? null };
}
