import Link from "next/link";
import { ClipboardList } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, SearchForm, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ASSIGNMENT_STATUS, PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { examinationWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Examinations" };

export default async function ExaminationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("exam.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;
  const filters: Prisma.ExaminationWhereInput[] = [examinationWhere(ctx)];
  if (sp.session) filters.push({ sessionId: sp.session });
  if (sp.dept) filters.push({ course: { departmentId: sp.dept } });
  if (sp.q) filters.push({ OR: [{ course: { code: { contains: sp.q, mode: "insensitive" } } }, { course: { title: { contains: sp.q, mode: "insensitive" } } }] });
  const where = { AND: filters };
  const [rows, total, sessions, depts] = await Promise.all([
    db.examination.findMany({
      where,
      orderBy: [{ session: { startDate: "desc" } }, { course: { code: "asc" } }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        course: { include: { department: { select: { code: true } } } },
        session: { select: { code: true } },
        schedule: true,
        assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, take: 1, include: { setter: { select: { name: true } } } },
        papers: { where: { deletedAt: null }, take: 1, select: { status: true } },
      },
    }),
    db.examination.count({ where }),
    db.examinationSession.findMany({ orderBy: { startDate: "desc" }, select: { id: true, code: true } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, select: { id: true, code: true } }),
  ]);
  const base = { session: sp.session, dept: sp.dept, q: sp.q };
  return (
    <div>
      <PageHeader title="Examinations" description="One examination per course per session." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="flex flex-wrap gap-2">
          {sp.q && <input type="hidden" name="q" value={sp.q} />}
          <select name="session" defaultValue={sp.session ?? ""} aria-label="Session" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All sessions</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
          <select name="dept" defaultValue={sp.dept ?? ""} aria-label="Department" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
            <option value="">All departments</option>
            {depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}
          </select>
          <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Apply</button>
        </form>
        <div className="ml-auto">
          <SearchForm defaultValue={sp.q} placeholder="Course code or title" hidden={{ session: sp.session, dept: sp.dept }} />
        </div>
      </div>
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6">
            <EmptyState icon={ClipboardList} title="No examinations" description="Examinations are created from a session by adding courses." />
          </div>
        ) : (
          <DataTable head={[{ label: "Course" }, { label: "Session" }, { label: "Dept" }, { label: "Date" }, { label: "Setter" }, { label: "Paper" }]}>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-muted/40">
                <Td>
                  <Link href={`/examinations/${e.id}`} className="font-medium hover:text-primary">
                    <span className="font-mono text-xs text-muted-foreground">{e.course.code}</span> {e.course.title}
                  </Link>
                </Td>
                <Td className="text-xs">{e.session.code}</Td>
                <Td className="text-xs">{e.course.department.code}</Td>
                <Td className="whitespace-nowrap text-xs">{e.schedule ? `${fmtDate(e.schedule.date)} ${e.schedule.slot}` : "—"}</Td>
                <Td>
                  {e.assignments[0] ? (
                    <span className="flex items-center gap-2 text-sm">
                      {e.assignments[0].setter.name}
                      <StatusBadge meta={ASSIGNMENT_STATUS[e.assignments[0].status]} />
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </Td>
                <Td>{e.papers[0] ? <StatusBadge meta={PAPER_STATUS[e.papers[0].status]} /> : <span className="text-xs text-muted-foreground">—</span>}</Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/examinations${qs(base, { page: p })}`} />
      </div>
    </div>
  );
}
