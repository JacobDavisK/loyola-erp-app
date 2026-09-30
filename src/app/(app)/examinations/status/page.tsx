import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { cn } from "@/lib/utils";
import { deadlineText } from "@/lib/format";
import { examinationWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Status board" };

const COLUMNS = [
  { key: "unassigned", label: "No setter" },
  { key: "assigned", label: "Awaiting acceptance" },
  { key: "setting", label: "Setting" },
  { key: "moderation", label: "Moderation" },
  { key: "scrutiny", label: "Scrutiny" },
  { key: "approval", label: "Approval" },
  { key: "locked", label: "Locked" },
] as const;
type Col = (typeof COLUMNS)[number]["key"];

export default async function StatusBoard({ searchParams }: { searchParams: Promise<{ session?: string }> }) {
  const ctx = await requirePageAuth("exam.view");
  const sp = await searchParams;
  const sessions = await db.examinationSession.findMany({ where: { status: { not: "ARCHIVED" } }, orderBy: { startDate: "asc" }, select: { id: true, code: true, name: true } });
  const sessionId = sp.session ?? sessions.find((s) => s.code)?.id;
  const exams = sessionId
    ? await db.examination.findMany({
        where: { AND: [examinationWhere(ctx), { sessionId }] },
        orderBy: { course: { code: "asc" } },
        include: {
          course: { include: { department: { select: { code: true } } } },
          assignments: { where: { status: { notIn: ["CANCELLED", "DECLINED"] } }, include: { setter: { select: { name: true } } } },
          papers: { where: { deletedAt: null }, select: { status: true } },
        },
      })
    : [];

  const colOf = (e: (typeof exams)[number]): Col => {
    const p = e.papers[0]?.status;
    if (p) {
      if (["LOCKED", "RELEASED", "ARCHIVED"].includes(p)) return "locked";
      if (["AWAITING_APPROVAL", "APPROVED"].includes(p)) return "approval";
      if (p === "UNDER_SCRUTINY") return "scrutiny";
      if (["SUBMITTED", "RESUBMITTED", "UNDER_MODERATION"].includes(p)) return "moderation";
      return "setting";
    }
    if (!e.assignments.length) return "unassigned";
    return e.assignments.some((a) => a.status === "ASSIGNED") ? "assigned" : "setting";
  };
  const grouped = new Map<Col, typeof exams>(COLUMNS.map((c) => [c.key, []]));
  for (const e of exams) grouped.get(colOf(e))!.push(e);

  return (
    <div>
      <PageHeader
        title="Status board"
        description="Where every examination of the session stands in the question-paper lifecycle."
        actions={
          <form className="flex gap-2">
            <select name="session" defaultValue={sessionId} aria-label="Session" className="h-8 rounded-lg border bg-card px-2 text-[13px]">
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button>
          </form>
        }
      />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map((c) => {
          const list = grouped.get(c.key)!;
          return (
            <section key={c.key} aria-label={c.label} className="flex w-60 shrink-0 flex-col rounded-xl bg-surface/70 p-2">
              <h2 className="flex items-center justify-between px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                {c.label}
                <span className="rounded-full bg-card px-2 text-foreground tabular ring-1 ring-border">{list.length}</span>
              </h2>
              <ul className="mt-1 space-y-2">
                {list.map((e) => {
                  const a = e.assignments[0];
                  const dl = a && ["ASSIGNED", "ACCEPTED", "IN_PROGRESS", "RETURNED"].includes(a.status) ? deadlineText(a.deadline) : null;
                  return (
                    <li key={e.id}>
                      <Link href={`/examinations/${e.id}`} className={cn("block rounded-lg border bg-card p-2.5 text-[12.5px] shadow-[var(--shadow-soft)] transition-colors hover:border-primary/40", dl?.tone === "danger" && "border-tone-danger/40")}>
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-medium">{e.course.code}</span>
                          <span className="text-[10.5px] text-muted-foreground">{e.course.department.code}</span>
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-muted-foreground">{e.course.title}</div>
                        {a && <div className="mt-1.5 truncate text-[11px]">{a.setter.name}</div>}
                        {dl && <div className={cn("mt-0.5 text-[11px]", dl.tone === "danger" ? "font-semibold text-tone-danger" : dl.tone === "warning" ? "text-tone-warning" : "text-muted-foreground")}>{dl.text}</div>}
                      </Link>
                    </li>
                  );
                })}
                {list.length === 0 && <li className="px-2 py-6 text-center text-[11px] text-muted-foreground">—</li>}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
