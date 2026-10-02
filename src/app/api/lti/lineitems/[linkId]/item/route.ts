import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@/server/errors";
import { lineItem } from "@/server/services/lti";

export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  try {
    const { linkId } = await params;
    return NextResponse.json(await lineItem(req.headers.get("authorization"), linkId), { headers: { "Content-Type": "application/vnd.ims.lis.v2.lineitem+json" } });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
