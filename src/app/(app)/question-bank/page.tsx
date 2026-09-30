import Link from "next/link";
import { History, Library, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Pagination, qs } from "@/components/app/list";
import { EmptyState, PageHeader } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { QuestionFilterBar } from "@/features/question-bank/filter-bar";
import { QuestionMeta, toItem } from "@/features/papers/builder/question-meta";
import { QUESTION_STATUS_LABEL } from "@/lib/domain/labels";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { questionWhere } from "@/server/auth/access";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { searchQuestions } from "@/server/services/questions";

export const metadata: Metadata = { title: "Question bank" };

export default async function QuestionBankPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requirePageAuth("question.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = Object.fromEntries(Object.entries(sp).filter(([, v]) => v));
  let result: Awaited<ReturnType<typeof searchQuestions>>;
  let filterError: string | null = null;
  try {
    result = await searchQuestions(ctx, { ...filters, page, pageSize: 20 });
  } catch {
    filterError = "Some filters were not recognised and were ignored.";
    result = await searchQuestions(ctx, { page, pageSize: 20 });
  }

  const scope = questionWhere(ctx);
  const [courseRows, tagRows, saved, total, pending] = await Promise.all([
    db.course.findMany({ where: { deletedAt: null, questions: { some: scope } }, select: { id: true, code: true, title: true }, orderBy: { code: "asc" } }),
    db.tag.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
    db.savedFilter.findMany({ where: { userId: ctx.user.id, scope: "question-bank" }, orderBy: { createdAt: "asc" } }),
    db.question.count({ where: { AND: [scope, { status: { not: "RETIRED" } }] } }),
    db.question.count({ where: { AND: [scope, { status: "PENDING_REVIEW" }] } }),
  ]);
  const units = sp.courseId ? (await db.courseUnit.findMany({ where: { courseId: sp.courseId }, select: { number: true }, orderBy: { number: "asc" } })).map((u) => u.number) : [1, 2, 3, 4, 5];

  return (
    <div>
      <PageHeader
        title="Question bank"
        description={`${total.toLocaleString("en-IN")} questions in your scope${pending ? ` · ${pending} awaiting review` : ""}. Searches run on the server — the bank is never downloaded wholesale.`}
        actions={
          <>
            <Button asChild variant="outline" size="sm"><Link href="/question-bank/usage"><History /> Usage history</Link></Button>
            {can(ctx, "question.create") && <Button asChild size="sm"><Link href="/question-bank/new"><Plus /> New question</Link></Button>}
          </>
        }
      />
      <Suspense>
        <QuestionFilterBar courses={courseRows} units={units} tags={tagRows.map((t) => t.name)} saved={saved.map((s) => ({ id: s.id, name: s.name, query: s.query as Record<string, string> }))} />
      </Suspense>
      {filterError && <p className="mt-3 text-xs text-tone-warning">{filterError}</p>}
      <div className="mt-4 text-xs text-muted-foreground" aria-live="polite">{result.total.toLocaleString("en-IN")} result{result.total === 1 ? "" : "s"}</div>
      <div className="surface-card mt-2 overflow-hidden">
        {result.rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Library}
              title={sp.q ? "No questions match your search" : "No questions yet"}
              description={sp.q ? "Try fewer words or remove a filter." : "Questions you author, or that belong to courses in your scope, appear here."}
              action={can(ctx, "question.create") ? <Button asChild size="sm"><Link href="/question-bank/new"><Plus /> New question</Link></Button> : undefined}
            />
          </div>
        ) : (
          <ul className="divide-y">
            {result.rows.map((r) => {
              const item = toItem(r);
              return (
                <li key={r.id}>
                  <Link href={`/question-bank/${r.id}`} className="flex gap-4 px-5 py-3.5 hover:bg-muted/40 focus-visible:bg-muted/40">
                    <div className="w-24 shrink-0">
                      <div className="font-mono text-xs font-medium">{r.code}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{r.course.code}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-[14px] leading-snug">{r.plainText}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                        <QuestionMeta item={item} />
                        {r.tags.slice(0, 3).map((t) => <span key={t.tag.name} className="text-[11px] text-muted-foreground">#{t.tag.name}</span>)}
                      </div>
                    </div>
                    <div className="hidden w-40 shrink-0 text-right text-[11px] text-muted-foreground md:block">
                      <div className={cn("font-medium", r.status === "PENDING_REVIEW" && "text-tone-warning", r.status === "RETIRED" && "text-tone-danger")}>{QUESTION_STATUS_LABEL[r.status]} · v{r.currentVersion}</div>
                      <div>{r.usageCount ? `Used ${r.usageCount}× · ${r.lastUsedSessionId}` : "Never used"}</div>
                      <div>{r.author.name} · {fmtDate(r.createdAt)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination page={result.page} pageSize={result.pageSize} total={result.total} hrefFor={(p) => `/question-bank${qs(filters, { page: p })}`} />
      </div>
    </div>
  );
}
