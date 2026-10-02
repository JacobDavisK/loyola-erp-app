import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import type { ApiScope } from "@/lib/domain/integrations";
import type { AuthContext } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { ApiAuthError, authenticateBearer } from "@/server/services/api-tokens";

type Handler<P> = (args: { req: NextRequest; ctx: AuthContext; params: P; query: URLSearchParams }) => Promise<unknown>;

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

/**
 * Public REST API (version 1). Authenticated only by a personal access token — never by the session
 * cookie, so it is not exposed to cross-site requests. Each endpoint needs one token scope; inside it the
 * owner's own permissions and record-level scoping apply exactly as on the website.
 */
export function v1<P = Record<string, string>>(scope: ApiScope, handler: Handler<P>) {
  return async (req: NextRequest, route: { params: Promise<P> }) => {
    try {
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
      const { ctx, scopes } = await authenticateBearer(req.headers.get("authorization"), ip);
      if (!scopes.includes(scope)) return NextResponse.json({ error: `This token lacks the "${scope}" scope.` }, { status: 403, headers });
      const data = await handler({ req, ctx, params: await route.params, query: req.nextUrl.searchParams });
      return NextResponse.json({ data }, { headers });
    } catch (e) {
      if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { ...headers, ...(e.status === 401 ? { "WWW-Authenticate": "Bearer" } : {}) } });
      if (e instanceof z.ZodError) return NextResponse.json({ error: "Validation failed.", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 422, headers });
      if (isAppError(e)) return NextResponse.json({ error: e.message, code: e.code }, { status: e.status, headers });
      console.error("[api/v1]", e);
      return NextResponse.json({ error: "Something went wrong." }, { status: 500, headers });
    }
  };
}

export const page = (q: URLSearchParams) => {
  const size = Math.min(100, Math.max(1, Number(q.get("limit")) || 25));
  const offset = Math.max(0, Number(q.get("offset")) || 0);
  return { take: size, skip: offset };
};
