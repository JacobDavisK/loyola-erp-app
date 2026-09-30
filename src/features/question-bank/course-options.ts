import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { CourseOption } from "./question-form";

export async function loadCourseOptions(where: Prisma.CourseWhereInput): Promise<CourseOption[]> {
  const rows = await db.course.findMany({
    where,
    orderBy: { code: "asc" },
    include: { units: { orderBy: { number: "asc" }, include: { topics: { orderBy: { order: "asc" } } } }, outcomes: { orderBy: { code: "asc" } } },
  });
  return rows.map((c) => ({
    id: c.id,
    code: c.code,
    title: c.title,
    units: c.units.map((u) => ({ id: u.id, number: u.number, title: u.title, topics: u.topics.map((t) => ({ id: t.id, title: t.title })) })),
    outcomes: c.outcomes.map((o) => ({ id: o.id, code: o.code, description: o.description })),
  }));
}
