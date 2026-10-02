import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, FileText, Link2, PlayCircle, Plug } from "lucide-react";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { reviewVisibility } from "@/lib/domain/lms";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { courseSpace } from "@/server/services/lms";

export const metadata: Metadata = { title: "Course" };

const ICON = { PAGE: FileText, FILE: FileText, LINK: Link2, VIDEO: PlayCircle, LTI: Plug } as const;

export default async function StudentCoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "content" } = await searchParams;
  const ctx = await requirePageAuth("self.portal");
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role !== "student") notFound();
  const studentId = s.studentId!;
  const o = s.offering;
  const now = new Date();
  const { timezone: tz } = await getInstitution();
  const tabs = [["content", "Content"], ["announcements", "Announcements"], ["assignments", "Assignments"], ["quizzes", "Quizzes"], ["grades", "Grades"]].map(([k, l]) => ({ key: k, label: l, href: `?tab=${k}` }));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={`${o.course.code}-${o.section} · ${o.term.name}`} title={o.course.title} breadcrumbs={[{ label: "My courses", href: "/portal/courses" }, { label: o.course.code }]} description={o.instructors.map((i) => i.user.name).join(", ")} />
      <LinkTabs tabs={tabs} active={tab} />
      {tab === "content" && <Content offeringId={id} studentId={studentId} now={now} tz={tz} />}
      {tab === "announcements" && <Announcements offeringId={id} tz={tz} />}
      {tab === "assignments" && <Assignments offeringId={id} studentId={studentId} tz={tz} now={now} />}
      {tab === "quizzes" && <Quizzes offeringId={id} studentId={studentId} tz={tz} now={now} />}
      {tab === "grades" && <Grades offeringId={id} studentId={studentId} now={now} />}
    </div>
  );
}

async function Content({ offeringId, studentId, now, tz }: { offeringId: string; studentId: string; now: Date; tz: string }) {
  const modules = await db.courseModule.findMany({
    where: { offeringId, isPublished: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    include: { items: { where: { isPublished: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { views: { where: { studentId }, select: { lastViewedAt: true } } } } },
  });
  if (!modules.length) return <EmptyState icon={FileText} title="No material yet" description="Your instructors have not published course material." />;
  const all = modules.flatMap((m) => m.items.filter((i) => !i.availableFrom || i.availableFrom <= now));
  const seen = all.filter((i) => i.views.length).length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{seen} of {all.length} item(s) opened.</p>
      {modules.map((m) => (
        <Section key={m.id} title={m.title} description={m.description ?? undefined} bodyClassName="p-0">
          <ul className="divide-y">
            {m.items.length === 0 && <li className="px-5 py-3 text-sm text-muted-foreground">Nothing here yet.</li>}
            {m.items.map((it) => {
              const Icon = ICON[it.kind];
              const later = it.availableFrom && it.availableFrom > now;
              return (
                <li key={it.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Icon className="size-4 text-muted-foreground" aria-hidden />
                  {later ? <span className="flex-1 text-muted-foreground">{it.title} · available {fmtDateTimeZoned(it.availableFrom, tz)}</span> : <Link href={`/courses/items/${it.id}`} className="flex-1 hover:text-primary">{it.title}</Link>}
                  {it.views.length > 0 && <CheckCircle2 className="size-4 text-tone-success" aria-label="Opened" />}
                </li>
              );
            })}
          </ul>
        </Section>
      ))}
    </div>
  );
}

async function Announcements({ offeringId, tz }: { offeringId: string; tz: string }) {
  const list = await db.courseAnnouncement.findMany({ where: { offeringId }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } });
  return (
    <Section title="Announcements">
      {list.length === 0 ? <p className="text-sm text-muted-foreground">No announcements.</p> : (
        <ul className="space-y-4">{list.map((a) => <li key={a.id} className="border-b pb-3 last:border-0"><h3 className="font-medium">{a.title}</h3><p className="text-xs text-muted-foreground">{a.author.name} · {fmtDateTimeZoned(a.createdAt, tz)}</p><p className="mt-1.5 whitespace-pre-wrap text-sm">{a.body}</p></li>)}</ul>
      )}
    </Section>
  );
}

async function Assignments({ offeringId, studentId, tz, now }: { offeringId: string; studentId: string; tz: string; now: Date }) {
  const list = await db.assignment.findMany({ where: { offeringId, isPublished: true }, orderBy: { dueAt: "asc" }, include: { submissions: { where: { studentId }, orderBy: { attempt: "desc" }, take: 1 } } });
  return (
    <Section title="Assignments" bodyClassName="p-0">
      <DataTable head={[{ label: "Assignment" }, { label: "Due" }, { label: "Status" }, { label: "Marks", className: "text-right" }]} empty="No assignments.">
        {list.map((a) => {
          const sub = a.submissions[0];
          const closed = now > (a.closesAt ?? a.dueAt);
          const status = sub ? (sub.status === "RETURNED" ? "Returned for rework" : sub.isLate ? "Submitted late" : "Submitted") : closed ? "Missed" : now > a.dueAt ? "Overdue — late work accepted" : "To do";
          return (
            <tr key={a.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/portal/courses/${offeringId}/assignments/${a.id}`}>{a.title}</Link></Td>
              <Td className="text-xs whitespace-nowrap">{fmtDateTimeZoned(a.dueAt, tz)}</Td>
              <Td className={!sub && !closed && now > a.dueAt ? "text-xs text-tone-warning" : !sub && closed ? "text-xs text-tone-danger" : "text-xs"}>{status}</Td>
              <Td className="text-right tabular">{a.gradesReleasedAt && sub?.finalMarks != null ? `${sub.finalMarks}/${a.maxMarks}` : "—"}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Quizzes({ offeringId, studentId, tz, now }: { offeringId: string; studentId: string; tz: string; now: Date }) {
  const list = await db.quiz.findMany({ where: { offeringId, isPublished: true }, orderBy: { opensAt: "asc" }, include: { attempts: { where: { studentId }, orderBy: { attemptNo: "asc" } } } });
  return (
    <Section title="Quizzes" bodyClassName="p-0">
      <DataTable head={[{ label: "Quiz" }, { label: "Window" }, { label: "Attempts", className: "text-right" }, { label: "Best score", className: "text-right" }]} empty="No quizzes.">
        {list.map((q) => {
          const done = q.attempts.filter((a) => a.status === "SUBMITTED");
          const vis = reviewVisibility(q.reviewPolicy, now > q.closesAt);
          const best = done.length ? Math.max(...done.map((a) => a.score ?? 0)) : null;
          return (
            <tr key={q.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/portal/courses/${offeringId}/quizzes/${q.id}`}>{q.title}</Link></Td>
              <Td className="text-xs whitespace-nowrap">{fmtDateTimeZoned(q.opensAt, tz)} – {fmtDateTimeZoned(q.closesAt, tz)}</Td>
              <Td className="text-right tabular">{q.attempts.length}/{q.maxAttempts}</Td>
              <Td className="text-right tabular">{best !== null && vis.score ? `${best}/${done[0].maxScore}` : "—"}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Grades({ offeringId, studentId, now }: { offeringId: string; studentId: string; now: Date }) {
  const [assignments, quizzes] = await Promise.all([
    db.assignment.findMany({ where: { offeringId, isPublished: true, gradesReleasedAt: { not: null } }, orderBy: { dueAt: "asc" }, include: { submissions: { where: { studentId, status: "GRADED" }, orderBy: { attempt: "desc" }, take: 1 } } }),
    db.quiz.findMany({ where: { offeringId, isPublished: true }, orderBy: { opensAt: "asc" }, include: { attempts: { where: { studentId, status: "SUBMITTED" } } } }),
  ]);
  const rows = [
    ...assignments.map((a) => ({ key: a.id, title: a.title, kind: "Assignment", score: a.submissions[0]?.finalMarks ?? null, max: a.maxMarks, feedback: a.submissions[0]?.feedback ?? null })),
    ...quizzes.filter((q) => reviewVisibility(q.reviewPolicy, now > q.closesAt).score && q.attempts.length).map((q) => ({ key: q.id, title: q.title, kind: "Quiz", score: Math.max(...q.attempts.map((a) => a.score ?? 0)), max: q.attempts[0].maxScore, feedback: null })),
  ];
  return (
    <Section title="Grades" description="Assignment marks appear once your instructor releases them. Internal-assessment marks that count towards your result are under Results." bodyClassName="p-0">
      <DataTable head={[{ label: "Item" }, { label: "Type" }, { label: "Score", className: "text-right" }, { label: "Feedback" }]} empty="No released grades yet.">
        {rows.map((r) => (
          <tr key={r.key}>
            <Td>{r.title}</Td>
            <Td className="text-xs">{r.kind}</Td>
            <Td className="text-right tabular">{r.score ?? "—"} / {r.max}</Td>
            <Td className="max-w-md text-xs"><span className="line-clamp-3">{r.feedback ?? ""}</span></Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}
