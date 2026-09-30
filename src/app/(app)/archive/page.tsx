import Link from "next/link";
import { Archive, Eye, Lock } from "lucide-react";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, Pagination, qs, Td } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { PAPER_STATUS } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { paperWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentVersionLabel } from "@/server/services/papers";

export const metadata: Metadata = { title: "Archive" };

const sel = "h-8 rounded-lg border bg-card px-2 text-[13px]";

export default async function ArchivePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("paper.view.scope");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 25;
  const f: Prisma.QuestionPaperWhereInput[] = [paperWhere(ctx), { status: { in: ["LOCKED", "RELEASED", "ARCHIVED"] } }];
  if (sp.year) f.push({ examination: { session: { academicYearId: sp.year } } });
  if (sp.session) f.push({ examination: { sessionId: sp.session } });
  if (sp.program) f.push({ examination: { course: { programId: sp.program } } });
  if (sp.dept) f.push({ examination: { course: { departmentId: sp.dept } } });
  if (sp.semester) f.push({ examination: { course: { semesterId: sp.semester } } });
  if (sp.regulation) f.push({ examination: { course: { regulationId: sp.regulation } } });
  if (sp.q) f.push({ OR: [{ code: { contains: sp.q, mode: "insensitive" } }, { examination: { course: { title: { contains: sp.q, mode: "insensitive" } } } }] });
  const where = { AND: f };
  const [rows, total, years, sessions, programs, depts, semesters, regulations] = await Promise.all([
    db.questionPaper.findMany({
      where,
      orderBy: [{ lockedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { examination: { include: { course: { include: { program: { select: { code: true } }, semester: { select: { name: true } }, regulation: { select: { code: true } }, department: { select: { code: true } } } }, session: { select: { name: true } } } } },
    }),
    db.questionPaper.count({ where }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" } }),
    db.examinationSession.findMany({ orderBy: { startDate: "desc" } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
    db.semester.findMany({ orderBy: { number: "asc" } }),
    db.regulation.findMany({ orderBy: { code: "asc" } }),
  ]);
  const base = { year: sp.year, session: sp.session, program: sp.program, dept: sp.dept, semester: sp.semester, regulation: sp.regulation, q: sp.q };
  const select = (name: keyof typeof base, label: string, opts: { id: string; label: string }[]) => (
    <select name={name} defaultValue={sp[name] ?? ""} aria-label={label} className={sel}>
      <option value="">{label}: all</option>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  );
  return (
    <div>
      <PageHeader title="Archive" description="Locked, released and archived papers. Archived papers are read-only; the final version is reproducible exactly as it was locked." />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        {select("year", "Academic year", years.map((y) => ({ id: y.id, label: y.label })))}
        {select("session", "Examination", sessions.map((s) => ({ id: s.id, label: s.code })))}
        {select("program", "Programme", programs.map((p) => ({ id: p.id, label: p.code })))}
        {select("dept", "Department", depts.map((d) => ({ id: d.id, label: d.code })))}
        {select("semester", "Semester", semesters.map((s) => ({ id: s.id, label: s.name })))}
        {select("regulation", "Regulation", regulations.map((r) => ({ id: r.id, label: r.code })))}
        <input name="q" defaultValue={sp.q} placeholder="Course or paper code" aria-label="Course or paper code" className="h-8 rounded-lg border bg-card px-2 text-[13px]" />
        <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Filter</button>
      </form>
      <div className="surface-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-6"><EmptyState icon={Archive} title="Nothing archived yet" description="Papers appear here once they are locked." /></div>
        ) : (
          <DataTable head={[{ label: "Paper" }, { label: "Course" }, { label: "Examination" }, { label: "Programme" }, { label: "Version" }, { label: "Locked" }, { label: "Status" }, { label: "" }]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <Td><Link href={`/papers/${p.id}`} className="font-mono text-[13px] text-primary hover:underline">{p.code}</Link></Td>
                <Td>{p.examination.course.title}<div className="text-[11px] text-muted-foreground">{p.examination.course.department.code} · {p.examination.course.regulation.code}</div></Td>
                <Td className="text-xs">{p.examination.session.name}</Td>
                <Td className="text-xs whitespace-nowrap">{p.examination.course.program.code} · {p.examination.course.semester.name}</Td>
                <Td className="text-xs tabular"><span className="inline-flex items-center gap-1"><Lock className="size-3" /> {currentVersionLabel(p)}</span></Td>
                <Td className="text-xs whitespace-nowrap">{fmtDate(p.lockedAt)}</Td>
                <Td><StatusBadge meta={PAPER_STATUS[p.status]} /></Td>
                <Td className="text-right"><Button asChild size="sm" variant="ghost"><Link href={`/papers/${p.id}/preview`}><Eye /> View</Link></Button></Td>
              </tr>
            ))}
          </DataTable>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/archive${qs(base, { page: p })}`} />
      </div>
    </div>
  );
}
