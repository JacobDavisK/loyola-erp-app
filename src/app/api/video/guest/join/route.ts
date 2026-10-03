import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isAppError } from "@/server/errors";
import { joinAsGuest } from "@/server/services/video/meetings";

/** POST /api/video/guest/join { token } — guests join with their personal, time-limited link (no ERP account). */
export async function POST(req: NextRequest) {
  try {
    const { token } = z.object({ token: z.string().min(30).max(80) }).parse(await req.json());
    const out = await joinAsGuest(token, req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null);
    return NextResponse.json({ data: out }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (isAppError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e instanceof z.ZodError) return NextResponse.json({ error: "This invitation link is not valid." }, { status: 400 });
    return NextResponse.json({ error: "Unable to join right now. Please try again." }, { status: 500 });
  }
}
