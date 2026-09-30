import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { exportPaperPdf, type ExportKind } from "@/server/services/exports";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const k = req.nextUrl.searchParams.get("kind");
  const kind: ExportKind = k === "final" ? "final" : k === "moderation" ? "moderation" : "draft";
  try {
    const { pdf, fileName, hash } = await exportPaperPdf(ctx, id, kind);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Content-SHA256": hash,
      },
    });
  } catch (e) {
    if (isAppError(e)) return new NextResponse(e.message, { status: e.status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    console.error("[export]", e);
    return new NextResponse("The PDF could not be generated. Please try again.", { status: 500 });
  }
}
