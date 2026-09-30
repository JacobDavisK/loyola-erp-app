import { api } from "@/server/api";
import { examinationWhere } from "@/server/auth/access";
import { db } from "@/server/db";

/** GET /api/examinations?session= — examinations in scope with schedule and paper status. */
export const GET = api(async ({ req, ctx }) => {
  const session = req.nextUrl.searchParams.get("session");
  const rows = await db.examination.findMany({
    where: { AND: [examinationWhere(ctx), session ? { session: { code: session } } : {}] },
    include: { course: { select: { code: true, title: true } }, session: { select: { code: true, name: true } }, schedule: true, papers: { where: { deletedAt: null }, select: { id: true, status: true, setLabel: true } } },
    orderBy: { course: { code: "asc" } },
    take: 1000,
  });
  return rows.map((e) => ({ id: e.id, course: e.course, session: e.session, maxMarks: e.maxMarks, durationMinutes: e.durationMinutes, schedule: e.schedule, papers: e.papers }));
}, { perm: "exam.view" });
