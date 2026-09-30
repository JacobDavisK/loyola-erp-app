import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "My courses" };

export default async function MyCoursesPage() {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  const now = new Date();
  const [regs, { timezone: tz }] = await Promise.all([
    db.courseRegistration.findMany({
      where: { studentId, status: { in: ["REGISTERED", "COMPLETED"] }, offering: { status: { not: "CANCELLED" } } },
      orderBy: [{ offering: { term: { startDate: "desc" } } }, { offering: { course: { code: "asc" } } }],
      include: {
        offering: {
          include: {
            course: { select: { code: true, title: true } },
            term: { select: { name: true, isCurrent: true } },
            instructors: { include: { user: { select: { name: true } } } },
            assignments: { where: { isPublished: true, dueAt: { gte: now } }, orderBy: { dueAt: "asc" }, take: 1, include: { submissions: { where: { studentId }, select: { id: true } } } },
            _count: { select: { announcements: true } },
          },
        },
      },
    }),
    getInstitution(),
  ]);
  const current = regs.filter((r) => r.offering.term.isCurrent);
  const past = regs.filter((r) => !r.offering.term.isCurrent);
  const card = (r: (typeof regs)[number]) => {
    const next = r.offering.assignments[0];
    return (
      <li key={r.id}>
        <Link href={`/portal/courses/${r.offeringId}`} className="block rounded-xl border p-4 hover:border-primary/40 hover:bg-muted/30">
          <div className="font-mono text-xs text-muted-foreground">{r.offering.course.code}-{r.offering.section} · {r.offering.term.name}</div>
          <div className="mt-0.5 font-medium">{r.offering.course.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{r.offering.instructors.map((i) => i.user.name).join(", ") || "Instructor to be announced"}</div>
          {next && <div className="mt-2 text-xs">{next.submissions.length ? "Submitted" : "Next due"}: <b>{next.title}</b> · {fmtDateTimeZoned(next.dueAt, tz)}</div>}
        </Link>
      </li>
    );
  };
  return (
    <div className="space-y-6">
      <PageHeader title="My courses" breadcrumbs={[{ label: "My studies" }, { label: "Courses" }]} description="Course material, announcements, assignments and quizzes for your classes." />
      {regs.length === 0 ? <EmptyState icon={BookOpen} title="No courses" description="You are not registered in any class yet." /> : (
        <>
          <Section title="This term"><ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">{current.map(card)}</ul>{current.length === 0 && <p className="text-sm text-muted-foreground">No classes this term.</p>}</Section>
          {past.length > 0 && <Section title="Earlier terms"><ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(260px,1fr))]">{past.map(card)}</ul></Section>}
        </>
      )}
    </div>
  );
}
