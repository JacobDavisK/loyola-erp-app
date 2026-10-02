import "server-only";
import { NextResponse } from "next/server";
import { env } from "@/server/env";

/** Back to the sign-in page with the reason in a short-lived cookie (never in the URL, so links can't fake messages). */
export function ssoErrorRedirect(message: string) {
  const res = NextResponse.redirect(new URL("/login?sso_error=1", env.APP_URL));
  res.cookies.set("examcore_sso_msg", message.slice(0, 200), { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/login", maxAge: 60 });
  return res;
}
