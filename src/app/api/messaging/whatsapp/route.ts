import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { handleWhatsAppWebhook, verifyWhatsAppSignature } from "@/server/services/messaging";

export const runtime = "nodejs";

/** Meta webhook verification handshake. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  if (sp.get("hub.mode") === "subscribe" && env.WHATSAPP_VERIFY_TOKEN && sp.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN) return new NextResponse(sp.get("hub.challenge") ?? "", { status: 200 });
  return new NextResponse("Forbidden", { status: 403 });
}

/** Incoming WhatsApp messages (signed by Meta with the app secret). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("Invalid signature", { status: 401 });
  try {
    await handleWhatsAppWebhook(JSON.parse(raw));
  } catch (e) {
    console.error("[whatsapp]", e);
  }
  return new NextResponse("OK", { status: 200 });
}
