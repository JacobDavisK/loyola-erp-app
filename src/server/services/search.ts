import "server-only";
import { examinationWhere, paperWhere, questionWhere } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";

export interface SearchHit {
  category: "Courses" | "Questions" | "Papers" | "Examinations" | "Users" | "Departments";
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

/** Global search across entities, each query constrained to the caller's authorised scope. */
export async function globalSearch(ctx: AuthContext, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const contains = { contains: q, mode: "insensitive" as const };
  const tasks: Promise<SearchHit[]>[] = [];

  if (can(ctx, "academic.view")) {
    tasks.push(
      db.course
        .findMany({ where: { deletedAt: null, OR: [{ code: contains }, { title: contains }] }, take: 5, include: { program: { select: { code: true } } } })
        .then((r) => r.map((c) => ({ category: "Courses" as const, id: c.id, title: `${c.code} — ${c.title}`, subtitle: c.program.code, href: `/academics/courses/${c.id}` }))),
      db.department
        .findMany({ where: { deletedAt: null, OR: [{ code: contains }, { name: contains }] }, take: 3 })
        .then((r) => r.map((d) => ({ category: "Departments" as const, id: d.id, title: d.name, subtitle: d.code, href: `/academics/structure#${d.code}` }))),
    );
  }
  if (can(ctx, "question.view")) {
    tasks.push(
      db.question
        .findMany({ where: { AND: [questionWhere(ctx), { OR: [{ code: contains }, { plainText: contains }] }] }, take: 6, include: { course: { select: { code: true } } } })
        .then((r) => r.map((x) => ({ category: "Questions" as const, id: x.id, title: x.plainText.slice(0, 90), subtitle: `${x.code} · ${x.course.code} · ${x.marks} marks`, href: `/question-bank/${x.id}` }))),
    );
  }
  tasks.push(
    db.questionPaper
      .findMany({
        where: { AND: [paperWhere(ctx), { OR: [{ code: contains }, { title: contains }, { examination: { course: { title: contains } } }] }] },
        take: 5,
        include: { examination: { select: { course: { select: { title: true } } } } },
      })
      .then((r) => r.map((p) => ({ category: "Papers" as const, id: p.id, title: p.code, subtitle: p.examination.course.title, href: `/papers/${p.id}` }))),
  );
  if (can(ctx, "exam.view")) {
    tasks.push(
      db.examination
        .findMany({
          where: { AND: [examinationWhere(ctx), { OR: [{ course: { code: contains } }, { course: { title: contains } }, { session: { name: contains } }] }] },
          take: 5,
          include: { course: { select: { code: true, title: true } }, session: { select: { code: true } } },
        })
        .then((r) => r.map((e) => ({ category: "Examinations" as const, id: e.id, title: `${e.course.code} — ${e.course.title}`, subtitle: e.session.code, href: `/examinations/${e.id}` }))),
    );
  }
  if (can(ctx, "user.directory")) {
    tasks.push(
      db.user
        .findMany({ where: { deletedAt: null, OR: [{ name: contains }, { email: contains }, { employeeId: contains }] }, take: 5, include: { department: { select: { name: true } } } })
        .then((r) =>
          r.map((u) => ({
            category: "Users" as const,
            id: u.id,
            title: u.name,
            subtitle: [u.designation, u.department?.name].filter(Boolean).join(" · "),
            href: can(ctx, "admin.users.manage") ? `/admin/users/${u.id}` : `/setters?user=${u.id}`,
          })),
        ),
    );
  }
  return (await Promise.all(tasks)).flat();
}
