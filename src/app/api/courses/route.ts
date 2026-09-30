import { api } from "@/server/api";
import { db } from "@/server/db";

export const GET = api(async ({ req }) => {
  const q = req.nextUrl.searchParams.get("q");
  return db.course.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ code: { contains: q, mode: "insensitive" } }, { title: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { code: "asc" },
    include: { units: { orderBy: { number: "asc" }, include: { topics: { orderBy: { order: "asc" } } } }, outcomes: true, department: { select: { code: true } }, program: { select: { code: true } } },
    take: 500,
  });
}, { perm: "academic.view" });
