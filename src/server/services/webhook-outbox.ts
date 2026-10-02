import "server-only";
import { webhookMatches } from "@/lib/domain/integrations";
import { db, type Tx } from "@/server/db";

/**
 * Queues webhook deliveries for an audited action, in the same transaction as the change itself (an
 * outbox), so a notification is sent if and only if the change was committed. Kept free of other service
 * imports because the audit writer calls it.
 */

let cache: { at: number; list: { id: string; events: string[] }[] } | null = null;

export function invalidateWebhookCache() {
  cache = null;
}

async function endpoints() {
  if (!cache || Date.now() - cache.at > 30_000) cache = { at: Date.now(), list: await db.webhookEndpoint.findMany({ where: { active: true }, select: { id: true, events: true } }) };
  return cache.list;
}

export async function enqueueWebhooks(tx: Tx, e: { action: string; resourceType: string; resourceId?: string | null; summary?: string; actorId?: string | null; actorName?: string | null; at: Date }) {
  const list = await endpoints();
  if (!list.length) return;
  const targets = list.filter((x) => webhookMatches(e.action, x.events));
  if (!targets.length) return;
  const payload = {
    event: e.action,
    occurredAt: e.at.toISOString(),
    resource: { type: e.resourceType, id: e.resourceId ?? null },
    summary: e.summary ?? null,
    actor: e.actorId ? { id: e.actorId, name: e.actorName ?? null } : null,
  };
  await tx.webhookDelivery.createMany({ data: targets.map((t) => ({ endpointId: t.id, event: e.action, payload })) });
}
