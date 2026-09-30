import { NextResponse, type NextRequest } from "next/server";

/**
 * Network-edge guard: cheap cookie presence check + CSRF origin check for mutating API calls.
 * Real session validation and authorisation happen on the server for every page, action and route.
 */
const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/api/health", "/verify", "/api/payments/webhook", "/apply"];
const COOKIES = ["examcore_session", "__Host-examcore_session"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Signed server-to-server webhooks carry no browser Origin; they authenticate with the provider signature.
  const signedWebhook = pathname === "/api/payments/webhook";
  if (pathname.startsWith("/api/") && !signedWebhook && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const origin = req.headers.get("origin");
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    if (!origin || new URL(origin).host !== host) {
      return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
    }
  }

  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasSession = COOKIES.some((c) => req.cookies.has(c));
  if (!isPublic && !hasSession && !pathname.startsWith("/api/")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|woff2?)$).*)"],
};
