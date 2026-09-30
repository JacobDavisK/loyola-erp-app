import Link from "next/link";
import { History } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, Pagination, qs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section, StatCard } from "@/components/app/page";
import { fmtDate } from "@/lib/format";
import { questionWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Question usage history" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ session?: string; page?: string }> }) {
  const ctx = await requirePageAuth("question.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = 30;
  const scope = questionWhere(ctx);
  const where = { question: scope, ...(sp.session ? { sessionId: sp.session } : {}) };
  const [rows, total, sessions, usedOnce, neverUsed, mostUsed] = await Promise.all([
    db.questionUsage.findMany({
      where,
      orderBy: { usedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        question: { select: { id: true, code: true, plainText: true, usageCount: true, course: { select: { code: true } } } },
        questionVersion: { select: { version: true } },
        paper: { select: { id: true, code: true } },
        examination: { select: { session: { select: { name: true } } } },
      },
    }),
    db.questionUsage.count({ where }),
    db.examinationSession.findMany({ where: { examinations: { some: { usages: { some: {} } } } }, orderBy: { startDate: "desc" }, select: { id: true, name: true } }),
    db.question.count({ where: { AND: [scope, { usageCount: { gt: 0 } }] } }),
    db.question.count({ where: { AND: [scope, { usageCount: 0, status: "ACTIVE" }] } }),
    db.question.findMany({ where: { AND: [scope, { usageCount: { gt: 0 } }] }, orderBy: { usageCount: "desc" }, take: 5, select: { id: true, code: true, plainText: true, usageCount: true } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader breadcrumbs={[{ label: "Question bank", href: "/question-bank" }, { label: "Usage history" }]} title="Question usage history" description="An append-only record written when a paper is locked. It cannot be edited or deleted (enforced by the database)." />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Usage records" value={total} />
        <StatCard label="Questions used at least once" value={usedOnce} />
        <StatCard label="Active questions never used" value={neverUsed} href="/question-bank?usage=never" />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <div className="surface-card overflow-hidden">
          <form className="flex items-center gap-2 border-b px-5 py-3">
            <select name="session" defaultValue={sp.session ?? ""} aria-label="Session" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
              <option value="">All sessions</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Filter</button>
          </form>
          {rows.length === 0 ? (
            <div className="p-6"><EmptyState icon={History} title="No usage recorded yet" description="Usage is recorded automatically when a question paper is locked." /></div>
          ) : (
            <DataTable head={[{ label: "Question" }, { label: "Text" }, { label: "Version" }, { label: "Paper" }, { label: "Session" }, { label: "Used" }]}>
              {rows.map((u) => (
                <tr key={u.id} className="hover:bg-muted/40">
                  <Td><Link href={`/question-bank/${u.question.id}`} className="font-mono text-xs text-primary hover:underline">{u.question.code}</Link><div className="text-[11px] text-muted-foreground">{u.question.course.code}</div></Td>
                  <Td><div className="line-clamp-1 max-w-md">{u.question.plainText}</div></Td>
                  <Td className="tabular">v{u.questionVersion.version}</Td>
                  <Td><Link href={`/papers/${u.paper.id}`} className="font-mono text-xs hover:text-primary">{u.paper.code}</Link></Td>
                  <Td className="whitespace-nowrap">{u.examination.session.name}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(u.usedAt)}</Td>
                </tr>
              ))}
            </DataTable>
          )}
          <Pagination page={page} pageSize={pageSize} total={total} hrefFor={(p) => `/question-bank/usage${qs({ session: sp.session }, { page: p })}`} />
        </div>
        <Section title="Most used questions" bodyClassName="p-0">
          <ul className="divide-y">
            {mostUsed.map((q) => (
              <li key={q.id}><Link href={`/question-bank/${q.id}`} className="block px-5 py-2.5 text-sm hover:bg-muted/40"><div className="flex justify-between"><span className="font-mono text-xs">{q.code}</span><span className="text-xs font-semibold tabular">{q.usageCount}×</span></div><div className="line-clamp-1 text-xs text-muted-foreground">{q.plainText}</div></Link></li>
            ))}
            {mostUsed.length === 0 && <li className="px-5 py-4 text-sm text-muted-foreground">No usage yet.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}
