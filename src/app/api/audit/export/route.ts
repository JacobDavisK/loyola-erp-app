import { NextResponse, type NextRequest } from "next/server";
import type { Prisma } from "@/generated/prisma/client";
import { can, getAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { audit } from "@/server/services/audit";

export const runtime = "nodejs";

const esc = (v: unknown) => {
  let s = v == null ? "" : typeof v === "string" ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET(req: NextRequest) {
  const ctx = await getAuth();
  if (!ctx) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (!can(ctx, "audit.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const f: Prisma.AuditLogWhereInput[] = [];
  const q = sp.get("q");
  if (q) f.push({ OR: [{ actorName: { contains: q, mode: "insensitive" } }, { summary: { contains: q, mode: "insensitive" } }, { action: { contains: q, mode: "insensitive" } }] });
  if (sp.get("from")) f.push({ createdAt: { gte: new Date(sp.get("from")!) } });
  if (sp.get("to")) f.push({ createdAt: { lte: new Date(`${sp.get("to")}T23:59:59`) } });
  const rows = await db.auditLog.findMany({ where: { AND: f }, orderBy: { id: "asc" }, take: 100_000 });
  const header = ["id", "created_at", "user", "action", "resource_type", "resource_id", "summary", "ip", "user_agent", "old_value", "new_value", "prev_hash", "hash"];
  const lines = [header.join(",")];
  for (const r of rows) lines.push([r.id.toString(), r.createdAt.toISOString(), r.actorName, r.action, r.resourceType, r.resourceId, r.summary, r.ip, r.userAgent, r.oldValue, r.newValue, r.prevHash, r.hash].map(esc).join(","));
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "audit.export", resourceType: "audit", summary: `${rows.length} audit entries exported` });
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="examcore-audit-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "private, no-store" },
  });
}
