import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/server/db";

export const runtime = "nodejs";

/** Public revocation status of a verifiable credential. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vc = await db.verifiableCredential.findUnique({ where: { id }, select: { id: true, revokedAt: true, issuedAt: true } });
  if (!vc) return NextResponse.json({ error: "Unknown credential" }, { status: 404 });
  return NextResponse.json({ id: vc.id, revoked: !!vc.revokedAt, revokedAt: vc.revokedAt?.toISOString() ?? null, issuedAt: vc.issuedAt.toISOString() }, { headers: { "Cache-Control": "public, max-age=60", "Access-Control-Allow-Origin": "*" } });
}
