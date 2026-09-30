import { z } from "zod";
import { api, body } from "@/server/api";
import { settleGatewayPayment } from "@/server/services/finance";

export const runtime = "nodejs";

/** Called by the checkout page after the provider returns. Verified server-side; the browser's word is not trusted. */
export const POST = api(async ({ req }) => {
  const v = z.object({ orderId: z.string().min(1), paymentId: z.string().min(1), signature: z.string().min(1) }).parse(await body(req));
  const p = await settleGatewayPayment(v);
  return { status: p.status, receiptNo: p.receiptNo };
});
