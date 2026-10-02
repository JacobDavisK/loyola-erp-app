import { NextResponse } from "next/server";
import { platformJwks } from "@/server/services/lti";

export const runtime = "nodejs";

/** Public keys tools use to verify our id_tokens. */
export async function GET() {
  return NextResponse.json(await platformJwks(), { headers: { "Cache-Control": "public, max-age=300" } });
}
