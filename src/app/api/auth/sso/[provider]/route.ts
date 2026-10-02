import { NextResponse, type NextRequest } from "next/server";
import { ssoErrorRedirect } from "@/server/sso-redirect";
import { hit } from "@/server/security/rate-limit";
import { kindFromSlug, startSso } from "@/server/services/sso";

/** GET /api/auth/sso/google|microsoft — begin single sign-on. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const kind = kindFromSlug((await params).provider);
  const back = (msg: string) => ssoErrorRedirect(msg);
  if (!kind) return back("Unknown sign-in provider.");
  if (!hit(`sso:${req.headers.get("x-forwarded-for") ?? "local"}`, 20, 60_000)) return back("Too many attempts; wait a minute.");
  try {
    return NextResponse.redirect(await startSso(kind, req.nextUrl.searchParams.get("remember") === "1"));
  } catch {
    return back("That sign-in option is not available right now.");
  }
}
