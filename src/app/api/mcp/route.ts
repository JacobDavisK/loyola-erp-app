import { NextResponse, type NextRequest } from "next/server";
import { handleMcp } from "@/server/mcp";
import { ApiAuthError, authenticateBearer } from "@/server/services/api-tokens";

/**
 * AI connector (Model Context Protocol, Streamable HTTP). Add it to an assistant as a remote MCP server with
 * this URL and a personal access token as the bearer token.
 */
export async function POST(req: NextRequest) {
  let auth;
  try {
    auth = await authenticateBearer(req.headers.get("authorization"), req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
  } catch (e) {
    const status = e instanceof ApiAuthError ? e.status : 401;
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: e instanceof Error ? e.message : "Unauthorised" } }, { status, headers: status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }
  const batch = Array.isArray(body) ? body.slice(0, 20) : [body];
  const results = (await Promise.all(batch.map((m) => handleMcp(m as never, auth.ctx, auth.scopes)))).filter((r): r is object => r !== null);
  if (!results.length) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? results : results[0], { headers: { "Cache-Control": "no-store" } });
}

export function GET() {
  return NextResponse.json({ error: "This MCP server answers POST requests only (no server-sent event stream)." }, { status: 405, headers: { Allow: "POST" } });
}
