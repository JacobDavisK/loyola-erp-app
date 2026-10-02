import "server-only";
import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { z } from "zod";
import { WEBHOOK_EVENTS, isPrivateAddress, retryDelayMs } from "@/lib/domain/integrations";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid, notFound } from "@/server/errors";
import { decryptString, encryptString, randomToken } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { invalidateWebhookCache } from "@/server/services/webhook-outbox";

/**
 * Outgoing webhooks. When something an endpoint subscribed to happens, a JSON notification is POSTed to its
 * URL, signed with HMAC-SHA256 over "<timestamp>.<body>" using the endpoint's secret:
 *   X-ERP-Signature: t=<unix seconds>,v1=<hex>
 * Receivers should recompute the signature and reject timestamps older than five minutes. Failed deliveries
 * are retried with increasing delays for about a day and a half, then given up.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertManage = (ctx: AuthContext) => {
  if (!can(ctx, "integration.manage")) throw forbidden();
};

const endpointSchema = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url().max(500),
  events: z.array(z.enum(Object.keys(WEBHOOK_EVENTS) as [keyof typeof WEBHOOK_EVENTS, ...(keyof typeof WEBHOOK_EVENTS)[]])).min(1),
  active: z.boolean().default(true),
});

function checkUrl(url: string) {
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (u.protocol !== "https:" && !(env.NODE_ENV !== "production" && local)) throw invalid("Webhook URLs must use https.");
  if (u.username || u.password) throw invalid("Put credentials in the receiving system, not in the URL.");
}

/** Returns the signing secret on creation (shown once). */
export async function saveEndpoint(ctx: AuthContext, id: string | null, raw: unknown) {
  assertManage(ctx);
  const v = endpointSchema.parse(raw);
  checkUrl(v.url);
  let secret: string | null = null;
  const row = id
    ? await db.webhookEndpoint.update({ where: { id }, data: { ...v, failingSince: v.active ? undefined : null } })
    : await db.webhookEndpoint.create({ data: { ...v, secretEnc: encryptString((secret = `whsec_${randomToken(24)}`)), createdById: ctx.user.id } });
  invalidateWebhookCache();
  await audit({ ...actor(ctx), action: id ? "integration.webhook.update" : "integration.webhook.create", resourceType: "webhookEndpoint", resourceId: row.id, summary: `${v.name} → ${new URL(v.url).host} (${v.events.join(", ")})` });
  return { id: row.id, secret };
}

export async function rotateSecret(ctx: AuthContext, id: string) {
  assertManage(ctx);
  const secret = `whsec_${randomToken(24)}`;
  await db.webhookEndpoint.update({ where: { id }, data: { secretEnc: encryptString(secret) } });
  await audit({ ...actor(ctx), action: "integration.webhook.rotate", resourceType: "webhookEndpoint", resourceId: id, summary: "Signing secret replaced" });
  return secret;
}

export async function deleteEndpoint(ctx: AuthContext, id: string) {
  assertManage(ctx);
  const e = await db.webhookEndpoint.delete({ where: { id } });
  invalidateWebhookCache();
  await audit({ ...actor(ctx), action: "integration.webhook.delete", resourceType: "webhookEndpoint", resourceId: id, summary: e.name });
}

/** Queue a test notification for an endpoint, whatever it subscribes to. */
export async function pingEndpoint(ctx: AuthContext, id: string) {
  assertManage(ctx);
  const e = await db.webhookEndpoint.findUnique({ where: { id } });
  if (!e) throw notFound("Webhook");
  await db.webhookDelivery.create({ data: { endpointId: id, event: "ping", payload: { event: "ping", occurredAt: new Date().toISOString(), resource: null, summary: `Test from ${ctx.user.name}`, actor: { id: ctx.user.id, name: ctx.user.name } } } });
  return deliverWebhooks();
}

export function signPayload(secret: string, body: string, ts: number) {
  return `t=${ts},v1=${createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex")}`;
}

async function resolvesPrivate(url: string): Promise<boolean> {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
  if (env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "::1"].includes(host)) return false;
  try {
    const addrs = await lookup(host, { all: true });
    return addrs.some((a) => isPrivateAddress(a.address));
  } catch {
    return false; // let the request fail normally
  }
}

/** Background job: send due deliveries. */
export async function deliverWebhooks(now = new Date(), fetcher: typeof fetch = fetch): Promise<{ delivered: number; failed: number }> {
  const due = await db.webhookDelivery.findMany({ where: { status: { in: ["PENDING", "FAILED"] }, nextAttemptAt: { lte: now } }, include: { endpoint: true }, orderBy: { createdAt: "asc" }, take: 100 });
  let delivered = 0;
  let failed = 0;
  for (const d of due) {
    if (!d.endpoint.active) continue;
    const body = JSON.stringify({ id: d.id, ...(d.payload as object) });
    const ts = Math.floor(now.getTime() / 1000);
    let status: number | null = null;
    let error: string | null = null;
    if (await resolvesPrivate(d.endpoint.url)) error = "The URL points to a private network address.";
    else {
      try {
        const res = await fetcher(d.endpoint.url, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/json", "User-Agent": "UniversityERP-Webhooks/1", "X-ERP-Event": d.event, "X-ERP-Delivery": d.id, "X-ERP-Signature": signPayload(decryptString(d.endpoint.secretEnc), body, ts) },
          body,
        });
        status = res.status;
        if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 200) : "Request failed";
      }
    }
    const attempts = d.attempts + 1;
    if (!error) {
      delivered++;
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: "DELIVERED", attempts, responseStatus: status, error: null, deliveredAt: now } });
      if (d.endpoint.failingSince) await db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { failingSince: null } });
    } else {
      failed++;
      const delay = retryDelayMs(attempts);
      await db.webhookDelivery.update({ where: { id: d.id }, data: { status: delay === null ? "GAVE_UP" : "FAILED", attempts, responseStatus: status, error, nextAttemptAt: new Date(now.getTime() + (delay ?? 0)) } });
      if (!d.endpoint.failingSince) await db.webhookEndpoint.update({ where: { id: d.endpointId }, data: { failingSince: now } });
    }
  }
  return { delivered, failed };
}

export async function redeliver(ctx: AuthContext, deliveryId: string) {
  assertManage(ctx);
  await db.webhookDelivery.update({ where: { id: deliveryId }, data: { status: "PENDING", nextAttemptAt: new Date() } });
  return deliverWebhooks();
}
