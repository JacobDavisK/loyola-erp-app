import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { PermissionKey } from "@/lib/domain/permissions";
import { type AuthContext, can, getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";

type Handler<P> = (args: { req: NextRequest; ctx: AuthContext; params: P }) => Promise<unknown>;

/**
 * JSON API wrapper: session auth, optional permission, per-user rate limit, typed error mapping.
 * Mutating requests are additionally protected by the same-origin check in src/proxy.ts (CSRF).
 */
export function api<P = Record<string, string>>(handler: Handler<P>, opts: { perm?: PermissionKey } = {}) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      const ctx = await getAuth();
      if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
      if (opts.perm && !can(ctx, opts.perm)) return NextResponse.json({ error: "You don't have permission to perform this action." }, { status: 403 });
      assertRate(`api:${ctx.user.id}`, 240, 60_000);
      const data = await handler({ req, ctx, params: await route.params });
      return NextResponse.json({ data }, { headers: { "Cache-Control": "private, no-store" } });
    } catch (e) {
      if (e instanceof z.ZodError) return NextResponse.json({ error: "Validation failed.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422 });
      if (isAppError(e)) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status });
      const msg = e instanceof Error ? e.message : "";
      if (msg.includes("EXAMCORE:")) return NextResponse.json({ error: msg.slice(msg.indexOf("EXAMCORE:") + 10).split("\n")[0] }, { status: 403 });
      console.error("[api]", e);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
    }
  };
}

export async function body(req: NextRequest): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}
