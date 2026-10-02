import { NextResponse, type NextRequest } from "next/server";
import { isAppError } from "@/server/errors";
import { postScore } from "@/server/services/lti";

export const runtime = "nodejs";

/** A tool posts a learner's score (LTI Assignment and Grade Services). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ linkId: string }> }) {
  try {
    const { linkId } = await params;
    await postScore(req.headers.get("authorization"), linkId, await req.json());
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e && typeof e === "object" && "issues" in e) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
