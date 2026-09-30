import { api, body } from "@/server/api";
import { db } from "@/server/db";
import { createUser } from "@/server/services/admin";

/** GET /api/users?q= — directory (no credentials or security fields are ever returned). */
export const GET = api(async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q");
  const rows = await db.user.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { employeeId: { contains: q, mode: "insensitive" } }] } : {}) },
    select: { id: true, name: true, email: true, employeeId: true, designation: true, status: true, department: { select: { code: true } }, roles: { select: { role: { select: { key: true } }, department: { select: { code: true } } } } },
    orderBy: { name: "asc" },
    take: 200,
  });
  return rows;
}, { perm: "user.directory" });

export const POST = api(async ({ req, ctx }) => {
  const u = await createUser(ctx, await body(req));
  return { id: u.id };
}, { perm: "admin.users.manage" });
