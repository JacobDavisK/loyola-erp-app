import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { createSurveyAction, createTermSurveysAction } from "@/features/teaching/actions";
import { fmtDate } from "@/lib/format";
import { can, isSuperAdmin, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentTerm } from "@/server/services/academic-setup";
import { mySurveys } from "@/server/services/surveys";

export const metadata: Metadata = { title: "Surveys" };

const KIND: Record<string, string> = { COURSE_EXIT: "Course exit", TEACHER_FEEDBACK: "Teacher feedback", STUDENT_SATISFACTION: "Student satisfaction", ALUMNI: "Alumni", EMPLOYER: "Employer", GENERAL: "General" };

export default async function SurveysPage() {
  const ctx = await requirePageAuth();
  const toAnswer = await mySurveys(ctx);
  const staff = ctx.user.userType === "STAFF";
  const scope = scopeOf(ctx, "survey.results");
  const manageScope = scopeOf(ctx, "survey.manage");
  const where = isSuperAdmin(ctx) || scope === null
    ? {}
    : { OR: [{ createdById: ctx.user.id }, { offering: { instructors: { some: { userId: ctx.user.id } } } }, ...(scope.length ? [{ offering: { course: { departmentId: { in: scope } } } }] : [])] };
  const [surveys, term, terms] = staff
    ? await Promise.all([
        db.survey.findMany({ where, orderBy: { createdAt: "desc" }, take: 200, include: { offering: { select: { section: true, course: { select: { code: true } } } }, _count: { select: { responses: true } } } }),
        currentTerm(),
        db.academicTerm.findMany({ orderBy: { startDate: "desc" }, take: 6, select: { id: true, name: true } }),
      ])
    : [[], null, []];
  const now = new Date();
  const week = new Date(now.getTime() + 14 * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 16);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Surveys"
        description={staff ? "Course-exit surveys (they feed outcome attainment), teacher feedback, the student satisfaction survey, and alumni and employer surveys. Teachers see feedback on their classes once at least five students answer." : "Feedback your teachers and the institution have asked for. Teacher feedback and satisfaction surveys are anonymous."}
        actions={staff && can(ctx, "survey.manage") ? (
          <>
            {term && (
              <FormDialog title="Surveys for every class" action={createTermSurveysAction} submitLabel="Create" initial={{ termId: term.id, opensAt: iso(now), closesAt: iso(week) }} trigger={<Button size="sm" variant="outline">For all classes of a term</Button>}
                description={manageScope === null ? "A teacher-feedback survey and a course-exit survey for every class of the term (drafts; open them when ready)." : "For every class of the term in your departments."}
                fields={[{ name: "termId", label: "Term", type: "select", options: terms.map((t) => ({ value: t.id, label: t.name })) }, { name: "opensAt", label: "Opens", type: "datetime-local" }, { name: "closesAt", label: "Closes", type: "datetime-local" }]} />
            )}
            <FormDialog title="Survey" action={createSurveyAction} submitLabel="Create" columns={2} initial={{ kind: "STUDENT_SATISFACTION", audience: "STUDENTS", anonymous: true, opensAt: iso(now), closesAt: iso(week) }} trigger={<Button size="sm"><Plus /> New survey</Button>}
              description="Satisfaction surveys get the NAAC questionnaire. Alumni and employer surveys should use a public link."
              fields={[
                { name: "title", label: "Title", type: "text", wide: true },
                { name: "kind", label: "Kind", type: "select", options: [{ value: "STUDENT_SATISFACTION", label: "Student satisfaction (NAAC)" }, { value: "ALUMNI", label: "Alumni" }, { value: "EMPLOYER", label: "Employer" }, { value: "GENERAL", label: "General" }] },
                { name: "audience", label: "Who answers", type: "select", options: [{ value: "STUDENTS", label: "All students" }, { value: "STAFF", label: "All staff" }, { value: "PUBLIC_LINK", label: "Anyone with the link" }] },
                { name: "opensAt", label: "Opens", type: "datetime-local" },
                { name: "closesAt", label: "Closes", type: "datetime-local" },
                { name: "anonymous", label: "Anonymous", type: "checkbox" },
              ]} />
          </>
        ) : undefined}
      />
      {toAnswer.length > 0 && (
        <Section title="Waiting for your answer" bodyClassName="p-0">
          <DataTable head={[{ label: "Survey" }, { label: "Closes" }, { label: "" }]}>
            {toAnswer.map((s) => (
              <tr key={s.id}>
                <Td><span className="font-medium">{s.title}</span>{s.anonymous && <span className="ml-2 text-xs text-muted-foreground">anonymous</span>}</Td>
                <Td className="text-xs">{fmtDate(s.closesAt)}</Td>
                <Td className="text-right">{s.answered ? <span className="text-xs text-tone-success">Answered — thank you</span> : <Button asChild size="xs"><Link href={`/surveys/${s.id}/respond`}>Answer</Link></Button>}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
      {!staff && toAnswer.length === 0 && <EmptyState icon={ClipboardList} title="Nothing to answer" description="You will be notified when a survey opens." />}
      {staff && (
        <Section title="Surveys" bodyClassName="p-0">
          <DataTable head={[{ label: "Survey" }, { label: "Kind" }, { label: "Responses" }, { label: "Closes" }, { label: "Status" }]} empty="No surveys yet.">
            {surveys.map((s) => (
              <tr key={s.id}>
                <Td><Link className="font-medium hover:text-primary" href={`/surveys/${s.id}`}>{s.title}</Link>{s.offering && <div className="font-mono text-xs text-muted-foreground">{s.offering.course.code}-{s.offering.section}</div>}</Td>
                <Td className="text-xs">{KIND[s.kind]}</Td>
                <Td>{s._count.responses}</Td>
                <Td className="text-xs">{fmtDate(s.closesAt)}</Td>
                <Td className="text-xs">{s.status.toLowerCase()}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
