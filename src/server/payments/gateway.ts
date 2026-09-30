import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/server/env";

/**
 * Payment gateway boundary. The application never trusts the browser about a payment: an order is
 * created server-side, and success is accepted only after the gateway's signature is verified AND the
 * payment is fetched from the gateway API and found captured for the exact amount.
 *
 * To add a provider, implement `PaymentGateway` and return it from `paymentGateway()`.
 */

export interface GatewayOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  /** Public parameters the browser needs to open the provider's checkout */
  checkout: Record<string, string | number>;
}

export interface GatewayPayment {
  paymentId: string;
  orderId: string;
  status: "captured" | "authorized" | "failed" | "pending";
  amountMinor: number;
  currency: string;
  raw: unknown;
}

export interface PaymentGateway {
  name: string;
  createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder>;
  /** Verify the signature returned to the browser after checkout. */
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Authoritative status from the gateway API. */
  fetchPayment(paymentId: string): Promise<GatewayPayment>;
  /** Verify a webhook body; returns the payment it concerns, or null for events we ignore. */
  parseWebhook(rawBody: string, headers: Headers): { paymentId: string; orderId: string } | null;
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Razorpay (https://razorpay.com/docs/api/) — orders API, checkout signature, payments API, webhooks. */
export class RazorpayGateway implements PaymentGateway {
  name = "razorpay";
  constructor(private keyId: string, private keySecret: string, private webhookSecret: string | undefined, private fetchImpl: typeof fetch = fetch) {}

  private auth() {
    return `Basic ${Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64")}`;
  }

  async createOrder(input: { amountMinor: number; currency: string; receipt: string; notes: Record<string, string> }): Promise<GatewayOrder> {
    const res = await this.fetchImpl("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { Authorization: this.auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ amount: input.amountMinor, currency: input.currency, receipt: input.receipt.slice(0, 40), notes: input.notes }),
    });
    if (!res.ok) throw new Error(`Gateway refused the order (${res.status}).`);
    const o = (await res.json()) as { id: string; amount: number; currency: string };
    return { orderId: o.id, amountMinor: o.amount, currency: o.currency, checkout: { key: this.keyId, order_id: o.id, amount: o.amount, currency: o.currency } };
  }

  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean {
    const expected = createHmac("sha256", this.keySecret).update(`${orderId}|${paymentId}`).digest("hex");
    return safeEqual(expected, signature);
  }

  async fetchPayment(paymentId: string): Promise<GatewayPayment> {
    const res = await this.fetchImpl(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: this.auth() } });
    if (!res.ok) throw new Error(`Could not fetch the payment from the gateway (${res.status}).`);
    const p = (await res.json()) as { id: string; order_id: string; status: string; amount: number; currency: string };
    const status = p.status === "captured" ? "captured" : p.status === "authorized" ? "authorized" : p.status === "failed" ? "failed" : "pending";
    return { paymentId: p.id, orderId: p.order_id, status, amountMinor: p.amount, currency: p.currency, raw: p };
  }

  parseWebhook(rawBody: string, headers: Headers) {
    if (!this.webhookSecret) return null;
    const sig = headers.get("x-razorpay-signature") ?? "";
    const expected = createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    if (!safeEqual(expected, sig)) throw new Error("Invalid webhook signature");
    const body = JSON.parse(rawBody) as { event: string; payload?: { payment?: { entity?: { id: string; order_id: string } } } };
    if (!["payment.captured", "payment.failed", "order.paid"].includes(body.event)) return null;
    const e = body.payload?.payment?.entity;
    return e ? { paymentId: e.id, orderId: e.order_id } : null;
  }
}

/** The configured gateway, or null when online payment is switched off (counter collection still works). */
export function paymentGateway(): PaymentGateway | null {
  if (env.PAYMENT_GATEWAY === "razorpay") {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
    return new RazorpayGateway(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, env.RAZORPAY_WEBHOOK_SECRET);
  }
  return null;
}

export function onlinePaymentsEnabled() {
  return paymentGateway() !== null;
}
