import { NextResponse, type NextRequest } from "next/server";
import { toCsv } from "@/lib/domain/csv";
import { getAuth } from "@/server/auth/current";
import { isAppError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { batchColumns, loadNadBatch } from "@/server/services/nad";

export const runtime = "nodejs";

/** The frozen rows of an ABC / NAD upload batch, as the CSV uploaded to the portal. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  try {
    const { id } = await params;
    const { batch, rows } = await loadNadBatch(ctx, id);
    const cols = batchColumns(rows);
    const csv = toCsv(cols, rows.map((r) => cols.map((c) => r[c] ?? "")));
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "nad.batch.download", resourceType: "nadBatch", resourceId: id, summary: `${batch.number}: ${rows.length} row(s)` });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${batch.number.replace(/\//g, "-")}-${batch.kind.toLowerCase()}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[nad.csv]", e);
    return NextResponse.json({ error: "The download failed." }, { status: 500 });
  }
}
