import { NextResponse } from "next/server";
import { didDocument } from "@/server/services/vc";

export const runtime = "nodejs";

/** did:web document: the public keys verifiers use to check the institution's credentials. */
export async function GET() {
  return NextResponse.json(await didDocument(), { headers: { "Content-Type": "application/did+json", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
