import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { reportToCsv, reportToPdf, reportToXlsx } from "@/server/services/report-export";
import { buildReport, REPORT_KINDS, type ReportKind } from "@/server/services/reports";
import { BRAND } from "@/lib/brand";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!REPORT_KINDS.some((k) => k.key === kind)) return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  try {
    const report = await buildReport(ctx, kind as ReportKind, { sessionId: req.nextUrl.searchParams.get("session") ?? undefined });
    const inst = await db.institution.findFirst({ select: { name: true } });
    const base = `examcore-${kind}-report-${new Date().toISOString().slice(0, 10)}`;
    let body: Buffer | string;
    let type: string;
    let ext: string;
    if (format === "xlsx") {
      body = await reportToXlsx(report, ctx.user.name);
      type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      ext = "xlsx";
    } else if (format === "pdf") {
      body = await reportToPdf(report, inst?.name ?? BRAND.name, ctx.user.name);
      type = "application/pdf";
      ext = "pdf";
    } else {
      body = reportToCsv(report);
      type = "text/csv; charset=utf-8";
      ext = "csv";
    }
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "report.export", resourceType: "report", resourceId: kind, summary: `${report.title} exported as ${ext.toUpperCase()}` });
    return new NextResponse(typeof body === "string" ? body : new Uint8Array(body), {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${base}.${ext}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[report]", e);
    return NextResponse.json({ error: "The report could not be generated." }, { status: 500 });
  }
}
