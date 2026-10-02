import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const runtime = "nodejs";

/** Download a verifiable credential: the signed JWT (for wallets) or the decoded JSON (?format=json). Holder only. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const { id } = await params;
  const vc = await db.verifiableCredential.findUnique({ where: { id } });
  if (!vc || vc.studentId !== ctx.subject.studentId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const json = req.nextUrl.searchParams.get("format") === "json";
  const body = json ? JSON.stringify(JSON.parse(Buffer.from(vc.jwt.split(".")[1], "base64url").toString()).vc, null, 2) : vc.jwt;
  return new NextResponse(body, {
    headers: {
      "Content-Type": json ? "application/json; charset=utf-8" : "application/jwt",
      "Content-Disposition": `attachment; filename="credential-${vc.id}.${json ? "json" : "jwt"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
