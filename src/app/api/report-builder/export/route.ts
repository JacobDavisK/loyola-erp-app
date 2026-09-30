import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { assertRate } from "@/server/security/rate-limit";
import { exportCsv, loadReportFor } from "@/server/services/report-builder";

export const runtime = "nodejs";

function csvResponse(csv: string, name: string) {
  const safe = name.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "report";
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safe}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handle(run: () => Promise<Response>) {
  try {
    return await run();
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[report export]", e);
    return NextResponse.json({ error: "Export failed." }, { status: 500 });
  }
}

/** Export a saved report (the viewer's own scope applies). */
export async function GET(req: NextRequest) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return handle(async () => {
    assertRate(`export:${ctx.user.id}`, 10, 60_000);
    const r = await loadReportFor(ctx, req.nextUrl.searchParams.get("id") ?? "");
    const { csv } = await exportCsv(ctx, r.definition, r.name);
    return csvResponse(csv, r.name);
  });
}

/** Export an unsaved definition from the builder (same-origin POST; the proxy blocks cross-origin requests). */
export async function POST(req: NextRequest) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  return handle(async () => {
    assertRate(`export:${ctx.user.id}`, 10, 60_000);
    const body = (await req.json().catch(() => null)) as { definition?: unknown; name?: string } | null;
    const { csv } = await exportCsv(ctx, body?.definition, body?.name ?? "report");
    return csvResponse(csv, body?.name ?? "report");
  });
}
