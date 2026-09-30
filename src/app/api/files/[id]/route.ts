import { NextResponse, type NextRequest } from "next/server";
import { getAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";
import { storage, verifySignedUrl } from "@/server/storage";

/** Private file delivery: requires a valid session AND an unexpired HMAC signature. Never public. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuth();
  if (!ctx) return new NextResponse("Unauthorised", { status: 401 });
  const sp = req.nextUrl.searchParams;
  if (!verifySignedUrl(id, sp.get("exp"), sp.get("d"), sp.get("sig"))) {
    return new NextResponse("This link has expired or is invalid.", { status: 403 });
  }
  const asset = await db.fileAsset.findFirst({ where: { id, deletedAt: null } });
  if (!asset) return new NextResponse("Not found", { status: 404 });
  const data = await storage.get(asset.storageKey);
  if (asset.kind === "EXPORT" || asset.kind === "PACKAGE") {
    await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "file.download", resourceType: "file", resourceId: id, summary: asset.originalName });
  }
  const disposition = sp.get("d") === "attachment" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": asset.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(asset.originalName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // Uploaded text is rendered as an isolated, script-less document (defence in depth; HTML is never accepted).
      ...(asset.mimeType.startsWith("text/") ? { "Content-Security-Policy": "sandbox; default-src 'none'" } : {}),
    },
  });
}
