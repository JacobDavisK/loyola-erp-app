import Link from "next/link";
import type { Metadata } from "next";
import { PageHeader, Section } from "@/components/app/page";
import { BLOOM_K, BLOOM_LABEL, DIFFICULTY_LABEL, QUESTION_TYPE_LABEL } from "@/lib/domain/labels";
import { questionWhere } from "@/server/auth/access";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Taxonomy" };

const BLOOM_VERBS: Record<string, string> = {
  REMEMBER: "define, list, state, recall, name",
  UNDERSTAND: "explain, describe, distinguish, summarise",
  APPLY: "compute, solve, construct, demonstrate",
  ANALYZE: "compare, analyse, differentiate, examine",
  EVALUATE: "justify, evaluate, critically assess, recommend",
  CREATE: "design, formulate, compose, propose",
};

export default async function TaxonomyPage({ searchParams }: { searchParams: Promise<{ courseId?: string }> }) {
  const ctx = await requirePageAuth("question.view");
  const { courseId } = await searchParams;
  const scope = questionWhere(ctx);
  const courses = await db.course.findMany({ where: { deletedAt: null, questions: { some: scope } }, select: { id: true, code: true, title: true }, orderBy: { code: "asc" } });
  const selected = courses.find((c) => c.id === courseId) ?? courses[0];
  const [course, byDiff, byBloom, byType, tags] = await Promise.all([
    selected
      ? db.course.findUnique({
          where: { id: selected.id },
          include: {
            units: { orderBy: { number: "asc" }, include: { topics: { orderBy: { order: "asc" }, include: { _count: { select: { questions: { where: scope } } } } }, _count: { select: { questions: { where: scope } } } } },
            outcomes: { orderBy: { code: "asc" }, include: { _count: { select: { questions: { where: scope } } } } },
          },
        })
      : null,
    db.question.groupBy({ by: ["difficulty"], where: { AND: [scope, { status: "ACTIVE" }] }, _count: { _all: true } }),
    db.question.groupBy({ by: ["bloom"], where: { AND: [scope, { status: "ACTIVE" }] }, _count: { _all: true } }),
    db.question.groupBy({ by: ["type"], where: { AND: [scope, { status: "ACTIVE" }] }, _count: { _all: true } }),
    db.tag.findMany({ include: { _count: { select: { questions: { where: { question: scope } } } } }, orderBy: { name: "asc" } }),
  ]);
  const diffCount = new Map(byDiff.map((r) => [r.difficulty as string, r._count._all]));
  const bloomCount = new Map(byBloom.map((r) => [r.bloom as string, r._count._all]));
  const typeCount = new Map(byType.map((r) => [r.type as string, r._count._all]));

  return (
    <div className="space-y-6">
      <PageHeader title="Taxonomy" description="Units, topics, learning outcomes, difficulty levels, Bloom's taxonomy, question types and tags used to classify the question bank." />
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Section
          title="Units, topics & outcomes"
          description={course ? `${course.code} — ${course.title}` : "No courses in scope"}
          actions={
            <form className="flex items-center gap-2">
              <select name="courseId" defaultValue={selected?.id} aria-label="Course" className="h-8 max-w-[260px] rounded-lg border bg-card px-2 text-[13px]">
                {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
              </select>
              <button className="h-8 rounded-lg border px-3 text-[13px] hover:bg-muted">Show</button>
            </form>
          }
        >
          {course && (
            <div className="space-y-5">
              <ol className="space-y-3">
                {course.units.map((u) => (
                  <li key={u.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-medium">Unit {u.number} · {u.title}</div>
                      <Link href={`/question-bank?courseId=${course.id}&unit=${u.number}`} className="text-xs text-primary hover:underline">{u._count.questions} questions</Link>
                    </div>
                    {u.topics.length > 0 && (
                      <ul className="mt-2 flex flex-wrap gap-1.5">
                        {u.topics.map((t) => <li key={t.id} className="rounded-md bg-muted px-2 py-0.5 text-xs">{t.title} <span className="text-muted-foreground tabular">· {t._count.questions}</span></li>)}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
              <div>
                <div className="eyebrow mb-2">Course outcomes</div>
                <ul className="space-y-1.5 text-sm">
                  {course.outcomes.map((o) => (
                    <li key={o.id} className="flex gap-3"><span className="w-10 font-mono text-xs font-semibold">{o.code}</span><span className="flex-1">{o.description}</span><span className="text-xs text-muted-foreground tabular">{o.bloom ? BLOOM_K[o.bloom] : ""} · {o._count.questions} q</span></li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Section>
        <div className="space-y-6">
          <Section title="Bloom's taxonomy" bodyClassName="p-0">
            <table className="w-full text-sm">
              <tbody className="divide-y">
                {Object.entries(BLOOM_LABEL).map(([k, l]) => (
                  <tr key={k}>
                    <td className="px-5 py-2.5 font-mono text-xs font-semibold">{BLOOM_K[k as keyof typeof BLOOM_K]}</td>
                    <td className="py-2.5"><div className="font-medium">{l}</div><div className="text-xs text-muted-foreground">{BLOOM_VERBS[k]}</div></td>
                    <td className="px-5 text-right tabular">{bloomCount.get(k) ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Difficulty">
            <ul className="grid grid-cols-3 gap-3 text-center">
              {Object.entries(DIFFICULTY_LABEL).map(([k, l]) => (
                <li key={k} className="rounded-lg border p-3"><div className="text-xl font-semibold tabular">{diffCount.get(k) ?? 0}</div><div className="text-xs text-muted-foreground">{l}</div></li>
              ))}
            </ul>
          </Section>
          <Section title="Question types" bodyClassName="p-0">
            <ul className="divide-y text-sm">
              {Object.entries(QUESTION_TYPE_LABEL).map(([k, l]) => (
                <li key={k} className="flex justify-between px-5 py-2"><Link href={`/question-bank?type=${k}`} className="hover:text-primary">{l}</Link><span className="tabular text-muted-foreground">{typeCount.get(k) ?? 0}</span></li>
              ))}
            </ul>
          </Section>
          <Section title="Tags">
            <ul className="flex flex-wrap gap-2">
              {tags.map((t) => <li key={t.id}><Link href={`/question-bank?tag=${encodeURIComponent(t.name)}`} className="rounded-full border px-2.5 py-1 text-xs hover:border-primary/40">#{t.name} <span className="text-muted-foreground tabular">{t._count.questions}</span></Link></li>)}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
