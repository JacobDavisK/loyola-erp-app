import "server-only";
import { createHmac } from "node:crypto";
import webpush from "web-push";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { env } from "@/server/env";
import { forbidden, invalid } from "@/server/errors";
import { decryptString, encryptString, safeEqual } from "@/server/security/crypto";
import { audit } from "@/server/services/audit";
import { getSetting } from "@/server/services/settings";

/**
 * Delivery beyond the in-app bell:
 *  - Web Push to the installed app / browser (free; needs no provider). Keys (VAPID) are generated once.
 *  - SMS (Twilio) and WhatsApp (Meta Cloud API) for the alert types listed in settings, only to people who
 *    opted in. Without a configured provider the messages are recorded in the outbox but not sent.
 * A worker job dispatches new notifications every minute. The WhatsApp number also answers a few
 * commands (ATTENDANCE, FEES, RESULTS, HELP) for students who opted in, from their own records.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });

// ───────────────────────── Web Push ─────────────────────────

async function vapid() {
  const k = await db.signingKey.findFirst({ where: { purpose: "vapid", active: true } });
  if (k) return { publicKey: (k.publicJwk as { publicKey: string }).publicKey, privateKey: decryptString(k.privateKey) };
  const keys = webpush.generateVAPIDKeys();
  await db.signingKey.create({ data: { purpose: "vapid", kid: `vapid-${Date.now()}`, privateKey: encryptString(keys.privateKey), publicJwk: { publicKey: keys.publicKey } } });
  return keys;
}

export async function pushPublicKey() {
  return (await vapid()).publicKey;
}

const subSchema = z.object({ endpoint: z.string().url().max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

export async function subscribePush(ctx: AuthContext, raw: unknown, userAgent: string | null) {
  const v = subSchema.parse(raw);
  if (!/^https:\/\//.test(v.endpoint)) throw invalid("Push endpoints must use https.");
  await db.pushSubscription.upsert({
    where: { endpoint: v.endpoint },
    create: { userId: ctx.user.id, endpoint: v.endpoint, p256dh: v.keys.p256dh, auth: v.keys.auth, userAgent: userAgent?.slice(0, 200) ?? null },
    update: { userId: ctx.user.id, p256dh: v.keys.p256dh, auth: v.keys.auth },
  });
}

export async function unsubscribePush(ctx: AuthContext, endpoint: string) {
  await db.pushSubscription.deleteMany({ where: { endpoint, userId: ctx.user.id } });
}

// ───────────────────────── SMS / WhatsApp preferences ─────────────────────────

export async function savePreferences(ctx: AuthContext, raw: unknown) {
  const v = z.object({ phone: z.string().trim().max(20).nullable().optional(), sms: z.boolean(), whatsapp: z.boolean() }).parse(raw);
  const phone = v.phone ? v.phone.replace(/[\s-]/g, "") : null;
  if ((v.sms || v.whatsapp) && !(phone && /^\+[1-9]\d{7,14}$/.test(phone))) throw invalid("Enter your mobile number with the country code, e.g. +91 98765 43210.");
  await db.contactPreference.upsert({ where: { userId: ctx.user.id }, create: { userId: ctx.user.id, phone, sms: v.sms, whatsapp: v.whatsapp }, update: { phone, sms: v.sms, whatsapp: v.whatsapp } });
  await audit({ ...actor(ctx), action: "messaging.preferences", resourceType: "user", resourceId: ctx.user.id, summary: `SMS ${v.sms ? "on" : "off"}, WhatsApp ${v.whatsapp ? "on" : "off"}` });
}

// ───────────────────────── Providers ─────────────────────────

async function sendSms(to: string, body: string): Promise<{ id?: string; error?: string; skipped?: boolean }> {
  if (env.SMS_DRIVER !== "twilio" || !env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) return { skipped: true };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: to, From: env.TWILIO_FROM, Body: body.slice(0, 600) }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
  return res.ok ? { id: data.sid } : { error: data.message ?? `HTTP ${res.status}` };
}

async function sendWhatsApp(to: string, body: string, freeform = false): Promise<{ id?: string; error?: string; skipped?: boolean }> {
  if (env.WHATSAPP_DRIVER !== "meta" || !env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return { skipped: true };
  const message = freeform
    ? { messaging_product: "whatsapp", to: to.replace("+", ""), type: "text", text: { body: body.slice(0, 4000) } }
    : { messaging_product: "whatsapp", to: to.replace("+", ""), type: "template", template: { name: env.WHATSAPP_TEMPLATE, language: { code: "en" }, components: [{ type: "body", parameters: [{ type: "text", text: body.slice(0, 1000) }] }] } };
  const res = await fetch(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(message), signal: AbortSignal.timeout(15_000),
  });
  const data = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string } };
  return res.ok ? { id: data.messages?.[0]?.id } : { error: data.error?.message ?? `HTTP ${res.status}` };
}

async function deliver(row: { id: string; channel: "SMS" | "WHATSAPP"; to: string; body: string }, freeform = false) {
  const r = row.channel === "SMS" ? await sendSms(row.to, row.body) : await sendWhatsApp(row.to, row.body, freeform);
  await db.messageOutbox.update({ where: { id: row.id }, data: r.skipped ? {} : r.error ? { status: "FAILED", error: r.error.slice(0, 300) } : { status: "SENT", providerId: r.id ?? null, sentAt: new Date() } });
}

/** A one-off SMS to a number that may have no account (e.g. a guardian). Queued in the outbox and sent now. */
export async function sendDirectSms(to: string, body: string, userId: string | null = null) {
  const digits = to.replace(/[^0-9+]/g, "");
  const phone = digits.startsWith("+") ? digits : `+91${digits.slice(-10)}`;
  if (!/^[+][1-9][0-9]{7,14}$/.test(phone)) return false;
  const row = await db.messageOutbox.create({ data: { channel: "SMS", userId, to: phone, body: body.slice(0, 600) } });
  await deliver(row);
  return true;
}

// ───────────────────────── Dispatch job ─────────────────────────

/** Push, SMS and WhatsApp for notifications created in the last day that have not been dispatched yet. */
export async function dispatchNotifications(now = new Date()): Promise<{ push: number; messages: number }> {
  const pending = await db.notification.findMany({ where: { dispatchedAt: null, createdAt: { gte: new Date(now.getTime() - 86_400_000) } }, orderBy: { createdAt: "asc" }, take: 500 });
  if (!pending.length) return { push: 0, messages: 0 };
  const userIds = [...new Set(pending.map((n) => n.userId))];
  const [subs, prefs, cfg] = await Promise.all([db.pushSubscription.findMany({ where: { userId: { in: userIds } } }), db.contactPreference.findMany({ where: { userId: { in: userIds } } }), getSetting("campus")]);
  let push = 0;
  let messages = 0;
  const keys = subs.length ? await vapid() : null;
  if (keys) webpush.setVapidDetails(env.PUSH_CONTACT, keys.publicKey, keys.privateKey);
  for (const n of pending) {
    for (const s of subs.filter((x) => x.userId === n.userId)) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title: n.title, body: n.body ?? "", url: n.link ?? "/dashboard" }), { TTL: 3600 });
        push++;
        await db.pushSubscription.update({ where: { id: s.id }, data: { lastUsedAt: now } });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }
    const pref = prefs.find((p) => p.userId === n.userId);
    if (pref?.phone && cfg.importantTypes.includes(n.type)) {
      const text = `${n.title}${n.body ? ` — ${n.body}` : ""}`.slice(0, 600);
      for (const channel of [pref.sms ? "SMS" : null, pref.whatsapp ? "WHATSAPP" : null].filter(Boolean) as ("SMS" | "WHATSAPP")[]) {
        const row = await db.messageOutbox.create({ data: { channel, userId: n.userId, to: pref.phone, body: text, notificationId: n.id } });
        await deliver(row);
        messages++;
      }
    }
  }
  await db.notification.updateMany({ where: { id: { in: pending.map((n) => n.id) } }, data: { dispatchedAt: now } });
  return { push, messages };
}

// ───────────────────────── WhatsApp chatbot ─────────────────────────

export function verifyWhatsAppSignature(rawBody: string, header: string | null): boolean {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex");
  return safeEqual(expected, header.slice(7));
}

const HELP = "Reply ATTENDANCE, FEES or RESULTS for your own details, or ask a question about rules and procedures. Manage alerts in the portal under Privacy & consent → Messages.";

/** Answer one inbound message from a phone that opted in. Returns the reply text (or null to stay silent). */
export async function chatbotReply(phone: string, text: string): Promise<string | null> {
  const pref = await db.contactPreference.findFirst({ where: { phone, whatsapp: true }, include: { user: { select: { id: true, userType: true, status: true } } } });
  if (!pref || pref.user.status !== "ACTIVE") return null; // unknown numbers get no data
  const q = text.trim().toUpperCase();
  const student = await db.student.findUnique({ where: { userId: pref.user.id }, select: { id: true } });
  const { ownRecordSummary } = await import("@/server/services/assistant");
  if (["HI", "HELLO", "HELP", "MENU", "START"].includes(q)) return HELP;
  if (student && /ATTEND/.test(q)) {
    const s = await ownRecordSummary(student.id);
    return s.attendance.length ? `Attendance this term:\n${s.attendance.map((a) => `${a.course.split(" ")[0]}: ${a.percent === null ? "no classes yet" : `${a.percent}%`}`).join("\n")}` : "You have no classes this term.";
  }
  if (student && /FEE|DUE|PAY/.test(q)) {
    const s = await ownRecordSummary(student.id);
    return `Fees outstanding: ${s.fees.outstanding}${s.fees.overdueInvoices ? ` (${s.fees.overdueInvoices} invoice(s) overdue)` : ""}. Pay in the portal under Fees.`;
  }
  if (student && /RESULT|CGPA|SGPA|GRADE/.test(q)) {
    const s = await ownRecordSummary(student.id);
    return s.latestResult ? `Latest result: SGPA ${s.latestResult.sgpa ?? "—"}, CGPA ${s.latestResult.cgpa ?? "—"}.` : "No results have been published for you yet.";
  }
  const { keywords } = await import("@/server/services/knowledge");
  const words = keywords(text);
  if (words.length) {
    const a = await db.knowledgeArticle.findFirst({ where: { published: true, audience: { in: ["ALL", pref.user.userType === "STUDENT" ? "STUDENT" : "STAFF"] }, OR: words.flatMap((w) => [{ title: { contains: w, mode: "insensitive" as const } }, { tags: { has: w } }]) }, orderBy: { updatedAt: "desc" } });
    if (a) return `${a.title}:\n${a.body.replace(/\*\*/g, "").slice(0, 700)}${a.body.length > 700 ? "…" : ""}\n${env.APP_URL}/knowledge/${a.slug}`;
  }
  return `Sorry, I could not find an answer. Raise a ticket in the portal: ${env.APP_URL}/helpdesk\n${HELP}`;
}

export async function handleWhatsAppWebhook(payload: unknown) {
  const p = payload as { entry?: { changes?: { value?: { messages?: { from: string; type: string; text?: { body: string } }[] } }[] }[] };
  for (const entry of p.entry ?? []) for (const ch of entry.changes ?? []) for (const m of ch.value?.messages ?? []) {
    if (m.type !== "text" || !m.text?.body) continue;
    const phone = `+${m.from}`;
    await db.messageOutbox.create({ data: { channel: "WHATSAPP", to: phone, body: m.text.body.slice(0, 1000), inbound: true, status: "SENT" } });
    const reply = await chatbotReply(phone, m.text.body);
    if (!reply) continue;
    const row = await db.messageOutbox.create({ data: { channel: "WHATSAPP", to: phone, body: reply } });
    await deliver(row, true); // within the 24-hour customer window a free-form reply is allowed
  }
}

export function canSeeMessaging(ctx: AuthContext) {
  if (!can(ctx, "messaging.manage")) throw forbidden();
}

export type OutboxRow = Prisma.MessageOutboxGetPayload<object>;
