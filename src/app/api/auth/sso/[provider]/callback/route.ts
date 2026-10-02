import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { ssoErrorRedirect } from "@/server/sso-redirect";
import { finishSso, kindFromSlug } from "@/server/services/sso";

/** GET /api/auth/sso/google|microsoft/callback — the provider sends the browser back here. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const kind = kindFromSlug((await params).provider);
  const to = (path: string) => NextResponse.redirect(new URL(path, env.APP_URL));
  if (!kind) return to("/login");
  const q = req.nextUrl.searchParams;
  const out = await finishSso(kind, { code: q.get("code"), state: q.get("state"), error: q.get("error") });
  if (out.status === "ok") return to("/dashboard");
  if (out.status === "mfa") return to("/login/mfa");
  return ssoErrorRedirect(out.message);
}
