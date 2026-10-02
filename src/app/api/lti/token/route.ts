import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";
import { issueToken } from "@/server/services/lti";

export const runtime = "nodejs";

/** OAuth 2 client-credentials grant with a signed JWT client assertion (LTI Advantage). */
export async function POST(req: NextRequest) {
  try {
    assertRate(`lti-token:${req.headers.get("x-forwarded-for") ?? "local"}`, 60, 60_000);
    const form = Object.fromEntries((await req.formData()).entries()) as Record<string, string>;
    return NextResponse.json(await issueToken(form), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status === 403 ? 401 : 400 });
    return NextResponse.json({ error: "invalid_client" }, { status: 401 });
  }
}
