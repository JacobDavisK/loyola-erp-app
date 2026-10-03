import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { recordingForStreaming, verifyPlayback } from "@/server/services/video/recordings";
import { log } from "@/server/video/log";
import { recordingStorage } from "@/server/video/recording-storage";

/**
 * GET /api/video/recordings/:rid/media?exp&d&sig — streams a recording to an authorised viewer.
 * Three checks every time (including each seek / Range request): a signed-in session, a link signed for
 * this viewer and not expired, and the recording's access rules. Storage addresses are never revealed.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ rid: string }> }) {
  const { rid } = await params;
  const ctx = await getAuth();
  if (!ctx) return new NextResponse("Please sign in.", { status: 401 });
  const q = req.nextUrl.searchParams;
  if (!verifyPlayback(rid, ctx.user.id, q.get("exp"), q.get("d"), q.get("sig"))) return new NextResponse("This link has expired. Open the recording again.", { status: 403 });
  let rec;
  try {
    rec = await recordingForStreaming(ctx, rid);
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
  const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.get("range") ?? "");
  try {
    const obj = await recordingStorage().read(rec.r.storagePath!, m ? { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined } : undefined);
    const headers: Record<string, string> = {
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Length": String(obj.contentLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `${q.get("d") === "attachment" ? "attachment" : "inline"}; filename="${rec.m.publicId}.mp4"`,
    };
    if (obj.contentRange) headers["Content-Range"] = obj.contentRange;
    return new NextResponse(obj.body, { status: obj.status, headers });
  } catch (e) {
    log("error", "video.recording_stream_failed", { recording: rid, detail: e instanceof Error ? e.message : String(e) });
    return new NextResponse("The recording is not reachable right now. Please try again later.", { status: 503 });
  }
}
