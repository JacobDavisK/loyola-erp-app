import type { PaperStatus } from "@/generated/prisma/enums";
import { api } from "@/server/api";
import { paperWhere } from "@/server/auth/access";
import { db } from "@/server/db";
import { currentVersionLabel } from "@/server/services/papers";

/** GET /api/papers?status=&page= — papers in the caller's scope (metadata only, no content). */
export const GET = api(async ({ req, ctx }) => {
  const sp = req.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const status = sp.get("status") as PaperStatus | null;
  const where = { AND: [paperWhere(ctx), status ? { status } : {}] };
  const [rows, total] = await Promise.all([
    db.questionPaper.findMany({ where, orderBy: { updatedAt: "desc" }, skip: (page - 1) * 50, take: 50, include: { examination: { select: { course: { select: { code: true, title: true } }, session: { select: { code: true } } } }, setter: { select: { name: true } } } }),
    db.questionPaper.count({ where }),
  ]);
  return {
    total,
    page,
    items: rows.map((p) => ({ id: p.id, code: p.code, status: p.status, version: currentVersionLabel(p), course: p.examination.course, session: p.examination.session.code, setter: p.setter.name, updatedAt: p.updatedAt })),
  };
});
