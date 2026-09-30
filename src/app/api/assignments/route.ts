import { api, body } from "@/server/api";
import { examinationWhere } from "@/server/auth/access";
import { can } from "@/server/auth/current";
import { db } from "@/server/db";
import { createAssignment } from "@/server/services/assignments";

/** GET /api/assignments — managers see assignments in scope; setters see their own. */
export const GET = api(async ({ ctx }) => {
  const where = can(ctx, "assignment.manage") ? { examination: examinationWhere(ctx) } : { OR: [{ setterId: ctx.user.id }, { backupSetterId: ctx.user.id }] };
  const rows = await db.setterAssignment.findMany({ where, orderBy: { deadline: "asc" }, include: { examination: { select: { course: { select: { code: true, title: true } }, session: { select: { code: true } } } }, setter: { select: { name: true } } }, take: 1000 });
  return rows.map((a) => ({ id: a.id, status: a.status, setLabel: a.setLabel, deadline: a.deadline, course: a.examination.course, session: a.examination.session.code, setter: a.setter.name }));
});

/** POST /api/assignments — appoint a setter { examinationId, setterId, backupSetterId?, setLabel, deadline, instructions? } */
export const POST = api(async ({ req, ctx }) => {
  const a = await createAssignment(ctx, await body(req));
  return { id: a.id };
}, { perm: "assignment.manage" });
