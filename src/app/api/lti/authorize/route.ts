import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { authorizeLaunch } from "@/server/services/lti";

export const runtime = "nodejs";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** LTI OIDC authentication request (a top-level browser redirect from the tool). Answers with a self-submitting form. */
export async function GET(req: NextRequest) {
  const ctx = await getAuth();
  if (!ctx) return new NextResponse("Sign in, then open the tool again from the course page.", { status: 401 });
  try {
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const r = await authorizeLaunch(ctx, params);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Opening tool…</title></head><body onload="document.forms[0].submit()"><form method="post" action="${esc(r.redirectUri)}"><input type="hidden" name="id_token" value="${esc(r.idToken)}">${r.state ? `<input type="hidden" name="state" value="${esc(r.state)}">` : ""}<noscript><button>Continue</button></noscript></form></body></html>`;
    return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (e) {
    if (isAppError(e)) return new NextResponse(e.message, { status: e.status });
    if (e && typeof e === "object" && "issues" in e) return new NextResponse("The tool sent an invalid launch request.", { status: 400 });
    console.error("[lti.authorize]", e);
    return new NextResponse("The launch failed.", { status: 500 });
  }
}
