import { NextResponse, type NextRequest } from "next/server";
import { paymentGateway } from "@/server/payments/gateway";
import { settleGatewayPayment } from "@/server/services/finance";

export const runtime = "nodejs";

/**
 * Gateway webhook. Authenticated by the provider's HMAC signature over the raw body (not by session or
 * Origin). Settlement re-fetches the payment from the gateway and is idempotent.
 */
export async function POST(req: NextRequest) {
  const gw = paymentGateway();
  if (!gw) return NextResponse.json({ error: "Online payments are not configured." }, { status: 404 });
  const raw = await req.text();
  let ref: { paymentId: string; orderId: string } | null;
  try {
    ref = gw.parseWebhook(raw, req.headers);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
  }
  if (!ref) return NextResponse.json({ ok: true, ignored: true });
  try {
    await settleGatewayPayment({ orderId: ref.orderId, paymentId: ref.paymentId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    // Return 200 for business refusals so the provider does not retry forever; log for reconciliation.
    console.error("[payments.webhook]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false });
  }
}
