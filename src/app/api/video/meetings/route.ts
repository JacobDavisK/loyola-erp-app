import { api, body } from "@/server/api";
import { z } from "zod";
import { db } from "@/server/db";
import { meetingWhere } from "@/server/services/video/access";
import { createMeeting } from "@/server/services/video/meetings";

const VIEWS = { upcoming: "upcoming", today: "today", past: "past", cancelled: "cancelled" } as const;

/** GET /api/video/meetings?view=upcoming|today|past|cancelled — meetings the caller may see. */
export const GET = api(async ({ ctx, req }) => {
  const view = VIEWS[(req.nextUrl.searchParams.get("view") ?? "upcoming") as keyof typeof VIEWS] ?? "upcoming";
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const extra = view === "today" ? { scheduledStart: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) }, status: { notIn: ["CANCELLED" as const] } }
    : view === "past" ? { status: { in: ["ENDED" as const] } }
    : view === "cancelled" ? { status: { in: ["CANCELLED" as const] } }
    : { status: { in: ["SCHEDULED" as const, "STARTING" as const, "LIVE" as const] }, scheduledEnd: { gte: now } };
  const rows = await db.videoMeeting.findMany({ where: { AND: [meetingWhere(ctx), extra] }, include: { host: { select: { name: true } } }, orderBy: { scheduledStart: view === "past" ? "desc" : "asc" }, take: 100 });
  return rows.map((m) => ({ id: m.id, publicId: m.publicId, title: m.title, type: m.meetingType, status: m.status, host: m.host.name, scheduledStart: m.scheduledStart, scheduledEnd: m.scheduledEnd }));
});

/** POST /api/video/meetings — schedule (or { draft: true } to save a draft). */
export const POST = api(async ({ ctx, req }) => {
  const b = (await body(req)) as Record<string, unknown>;
  const draft = z.boolean().optional().parse(b.draft) ?? false;
  const m = await createMeeting(ctx, b, { draft });
  return { id: m.id, publicId: m.publicId, status: m.status };
}, { perm: "video.schedule" });
