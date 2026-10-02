import { NextResponse } from "next/server";
import { hit } from "@/server/security/rate-limit";
import { feedByToken } from "@/server/services/calendar";

/** GET /api/calendar/<secret>.ics — a person's private calendar subscription. */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const token = (await params).file.replace(/\.ics$/, "");
  if (!hit(`calendar:${token.slice(0, 12)}`, 30, 60_000)) return new NextResponse("Too many requests", { status: 429 });
  const ics = await feedByToken(token);
  if (!ics) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=900", "Content-Disposition": "inline; filename=\"university.ics\"", "X-Robots-Tag": "noindex" } });
}
