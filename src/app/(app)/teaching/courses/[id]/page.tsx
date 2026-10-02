import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText, Link2, Megaphone, Plug, Plus, PlayCircle, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { EmptyState, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteAnnouncementAction, deleteItemAction, deleteModuleAction, postAnnouncementAction, saveAssignmentAction, saveItemAction, saveModuleAction, saveQuizAction } from "@/features/lms/actions";
import { TransferForm, UploadMaterialDialog } from "@/features/lms/controls";
import { ItemOutcomePicker } from "@/features/success/controls";
import { addLtiLinkAction } from "@/features/teaching/actions";
import { toolFields } from "@/features/teaching/fields";
import { ANNOUNCEMENT_FIELDS, assignmentFields, ITEM_FIELDS, MODULE_FIELDS, quizFields } from "@/features/lms/fields";
import { fmtDateTimeZoned, toZonedInput } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { courseSpace, gradebook } from "@/server/services/lms";

export const metadata: Metadata = { title: "Course space" };

const ICON = { PAGE: FileText, FILE: FileText, LINK: Link2, VIDEO: PlayCircle, LTI: Plug } as const;

export default async function TeacherCoursePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab = "content" } = await searchParams;
  const ctx = await requirePageAuth();
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role === "student") notFound();
  const o = s.offering;
  const edit = s.role === "teacher";
  const inst = await getInstitution();
  const tz = inst.timezone;
  const [modules, students] = await Promise.all([
    db.courseModule.findMany({ where: { offeringId: id }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { items: { orderBy: [{ order: "asc" }, { createdAt: "asc" }], include: { file: { select: { originalName: true, size: true } }, outcomes: { select: { outcomeId: true } }, _count: { select: { views: true } } } } } }),
    db.courseRegistration.count({ where: { offeringId: id, status: { in: ["REGISTERED", "COMPLETED"] } } }),
  ]);
  const moduleOpts = modules.map((m) => ({ id: m.id, title: m.title }));
  const tools = edit ? await db.ltiTool.findMany({ where: { enabled: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }) : [];
  const outcomes = await db.learningOutcome.findMany({ where: { courseId: o.course.id }, orderBy: { code: "asc" }, select: { id: true, code: true } });
  const tabs = ["content", "announcements", "assignments", "quizzes", "gradebook"].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), href: `?tab=${k}` }));
  const now = new Date();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${o.course.code}-${o.section} · ${o.term.name}`}
        title={o.course.title}
        breadcrumbs={[{ label: "My teaching", href: "/teaching" }, { label: `${o.course.code}-${o.section}` }]}
        description={`${students} student(s) · instructors: ${o.instructors.map((i) => i.user.name).join(", ") || "none"}${edit ? "" : " · view only"}`}
        actions={<><Button asChild size="sm" variant="outline"><Link href={`/obe/classes/${id}`}>Outcome attainment</Link></Button><Button asChild size="sm" variant="outline"><Link href={`/academics/offerings/${id}`}>Class record</Link></Button></>}
      />
      <LinkTabs tabs={tabs} active={tab} />

      {tab === "content" && (
        <div className="space-y-4">
          {edit && <div className="flex justify-end"><FormDialog title="Module" fields={MODULE_FIELDS} action={saveModuleAction.bind(null, id)} initial={{ order: modules.length, isPublished: false }} trigger={<Button size="sm"><Plus /> Module</Button>} /></div>}
          {modules.length === 0 && <EmptyState icon={FileText} title="No content yet" description={edit ? "Organise the course into modules (units or weeks), then add pages, files and links." : "The instructors have not added content."} />}
          {modules.map((m) => (
            <Section
              key={m.id}
              title={m.title}
              description={`${m.isPublished ? "Visible" : "Hidden from students"}${m.description ? ` · ${m.description}` : ""}`}
              actions={edit && (
                <div className="flex gap-1.5">
                  <FormDialog title="Item" columns={2} fields={ITEM_FIELDS} action={saveItemAction.bind(null, m.id)} initial={{ kind: "PAGE", order: m.items.length, isPublished: true }} trigger={<Button size="xs" variant="outline"><Plus /> Item</Button>} />
                  <UploadMaterialDialog moduleId={m.id} />
                  {tools.length > 0 && <FormDialog title="External tool" fields={toolFields(tools)} action={addLtiLinkAction.bind(null, m.id)} submitLabel="Add tool" initial={{ toolId: tools[0].id }} trigger={<Button size="xs" variant="outline"><Plug /> Tool</Button>} />}
                  <FormDialog title="Module" id={m.id} fields={MODULE_FIELDS} action={saveModuleAction.bind(null, id)} initial={{ title: m.title, description: m.description, order: m.order, isPublished: m.isPublished }} />
                  {m.items.length === 0 && <ActionButton size="xs" label="" ariaLabel="Delete module" icon={<Trash2 />} variant="ghost" run={deleteModuleAction.bind(null, m.id)} confirmText={`Delete module "${m.title}"?`} />}
                </div>
              )}
              bodyClassName="p-0"
            >
              {m.items.length === 0 ? <p className="px-5 py-3 text-sm text-muted-foreground">No items.</p> : (
                <ul className="divide-y">
                  {m.items.map((it) => {
                    const Icon = ICON[it.kind];
                    return (
                      <li key={it.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                        <Icon className="size-4 text-muted-foreground" aria-hidden />
                        <Link href={`/courses/items/${it.id}`} className="min-w-40 flex-1 text-sm hover:text-primary">{it.title}{it.file && <span className="ml-2 text-xs text-muted-foreground">{it.file.originalName} · {Math.ceil(it.file.size / 1024)} KB</span>}</Link>
                        <span className="text-xs text-muted-foreground">{!it.isPublished ? "hidden" : it.availableFrom && it.availableFrom > now ? `from ${fmtDateTimeZoned(it.availableFrom, tz)}` : `${it._count.views}/${students} opened`}</span>
                        {edit && it.kind !== "FILE" && <FormDialog title="Item" columns={2} id={it.id} fields={ITEM_FIELDS} action={saveItemAction.bind(null, m.id)} initial={{ kind: it.kind, title: it.title, url: it.url, body: it.body, order: it.order, isPublished: it.isPublished, availableFrom: toZonedInput(it.availableFrom, tz) }} />}
                        {edit && <ItemOutcomePicker itemId={it.id} outcomes={outcomes} selected={it.outcomes.map((x) => x.outcomeId)} />}
                        {edit && <ActionButton size="xs" variant="ghost" label="" ariaLabel="Delete item" icon={<Trash2 />} run={deleteItemAction.bind(null, it.id)} confirmText={`Delete "${it.title}"?`} />}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          ))}
        </div>
      )}

      {tab === "announcements" && <Announcements offeringId={id} edit={edit} tz={tz} />}
      {tab === "assignments" && <Assignments offeringId={id} edit={edit} tz={tz} modules={moduleOpts} students={students} />}
      {tab === "quizzes" && <Quizzes offeringId={id} edit={edit} tz={tz} modules={moduleOpts} />}
      {tab === "gradebook" && <Gradebook offeringId={id} edit={edit} />}
    </div>
  );
}

async function Announcements({ offeringId, edit, tz }: { offeringId: string; edit: boolean; tz: string }) {
  const list = await db.courseAnnouncement.findMany({ where: { offeringId }, orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } });
  return (
    <Section title="Announcements" description="Students are notified of each new announcement." actions={edit && <FormDialog title="Announcement" fields={ANNOUNCEMENT_FIELDS} action={postAnnouncementAction.bind(null, offeringId)} submitLabel="Post" trigger={<Button size="xs"><Megaphone /> Post</Button>} />}>
      {list.length === 0 ? <p className="text-sm text-muted-foreground">No announcements.</p> : (
        <ul className="space-y-4">
          {list.map((a) => (
            <li key={a.id} className="border-b pb-3 last:border-0">
              <div className="flex items-start justify-between gap-3"><h3 className="font-medium">{a.title}</h3>{edit && <ActionButton size="xs" variant="ghost" label="" ariaLabel="Delete announcement" icon={<Trash2 />} run={deleteAnnouncementAction.bind(null, a.id)} confirmText="Delete this announcement?" />}</div>
              <p className="text-xs text-muted-foreground">{a.author.name} · {fmtDateTimeZoned(a.createdAt, tz)}</p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm">{a.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

async function Assignments({ offeringId, edit, tz, modules, students }: { offeringId: string; edit: boolean; tz: string; modules: { id: string; title: string }[]; students: number }) {
  const list = await db.assignment.findMany({ where: { offeringId }, orderBy: { dueAt: "asc" }, include: { submissions: { select: { studentId: true, status: true } } } });
  return (
    <Section title="Assignments" actions={edit && <FormDialog title="Assignment" columns={2} fields={assignmentFields(modules)} action={saveAssignmentAction.bind(null, offeringId)} initial={{ maxMarks: 10, latePenaltyPercent: 0, maxAttempts: 1, maxFiles: 3, allowText: true, allowFiles: true, isPublished: false }} trigger={<Button size="xs"><Plus /> Assignment</Button>} />} bodyClassName="p-0">
      <DataTable head={[{ label: "Assignment" }, { label: "Due" }, { label: "Marks", className: "text-right" }, { label: "Submitted", className: "text-right" }, { label: "To grade", className: "text-right" }, { label: "Status" }]} empty="No assignments yet.">
        {list.map((a) => {
          const who = new Set(a.submissions.map((x) => x.studentId));
          const toGrade = a.submissions.filter((x) => x.status === "SUBMITTED").length;
          return (
            <tr key={a.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/teaching/courses/${offeringId}/assignments/${a.id}`}>{a.title}</Link></Td>
              <Td className="text-xs whitespace-nowrap">{fmtDateTimeZoned(a.dueAt, tz)}{a.closesAt ? <span className="block text-muted-foreground">late until {fmtDateTimeZoned(a.closesAt, tz)}</span> : null}</Td>
              <Td className="text-right tabular">{a.maxMarks}</Td>
              <Td className="text-right tabular">{who.size}/{students}</Td>
              <Td className={toGrade ? "text-right font-medium text-tone-warning tabular" : "text-right tabular"}>{toGrade}</Td>
              <Td className="text-xs">{!a.isPublished ? "Draft" : a.gradesReleasedAt ? "Marks released" : "Published"}</Td>
            </tr>
          );
        })}
      </DataTable>
    </Section>
  );
}

async function Quizzes({ offeringId, edit, tz, modules }: { offeringId: string; edit: boolean; tz: string; modules: { id: string; title: string }[] }) {
  const list = await db.quiz.findMany({ where: { offeringId }, orderBy: { opensAt: "asc" }, include: { _count: { select: { questions: true, attempts: { where: { status: "SUBMITTED" } } } } } });
  const now = new Date();
  return (
    <Section title="Quizzes" actions={edit && <FormDialog title="Quiz" columns={2} fields={quizFields(modules)} action={saveQuizAction.bind(null, offeringId)} initial={{ maxAttempts: 1, reviewPolicy: "AFTER_CLOSE", timeLimitMinutes: 20, shuffleQuestions: true, isPublished: false }} trigger={<Button size="xs"><Plus /> Quiz</Button>} />} bodyClassName="p-0">
      <DataTable head={[{ label: "Quiz" }, { label: "Window" }, { label: "Questions", className: "text-right" }, { label: "Attempts", className: "text-right" }, { label: "Status" }]} empty="No quizzes yet.">
        {list.map((q) => (
          <tr key={q.id}>
            <Td><Link className="font-medium hover:text-primary" href={`/teaching/courses/${offeringId}/quizzes/${q.id}`}>{q.title}</Link></Td>
            <Td className="text-xs whitespace-nowrap">{fmtDateTimeZoned(q.opensAt, tz)} – {fmtDateTimeZoned(q.closesAt, tz)}{q.timeLimitMinutes ? ` · ${q.timeLimitMinutes} min` : ""}</Td>
            <Td className="text-right tabular">{q._count.questions}</Td>
            <Td className="text-right tabular">{q._count.attempts}</Td>
            <Td className="text-xs">{!q.isPublished ? "Draft" : now < q.opensAt ? "Scheduled" : now > q.closesAt ? "Closed" : "Open"}</Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}

async function Gradebook({ offeringId, edit }: { offeringId: string; edit: boolean }) {
  const ctx = await requirePageAuth();
  const [gb, components] = await Promise.all([gradebook(ctx, offeringId), db.assessmentComponent.findMany({ where: { offeringId, examinationId: null }, orderBy: { order: "asc" } })]);
  return (
    <div className="space-y-6">
      {edit && <Section title="Use in internal marks" description="Scores are scaled to the component's maximum and saved through the normal marks sheet (draft sheets only, audited)."><TransferForm offeringId={offeringId} columns={gb.columns} components={components.map((c) => ({ id: c.id, name: c.name, maxMarks: c.maxMarks }))} /></Section>}
      <Section title="Gradebook" description="Assignments: latest graded attempt after any late penalty. Quizzes: best submitted attempt." bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, ...gb.columns.map((c) => ({ label: `${c.title} /${c.max}`, className: "text-right" }))]} empty="No students.">
          {gb.rows.map((r) => (
            <tr key={r.student.id}>
              <Td>{r.student.firstName} {r.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{r.student.studentNo}</div></Td>
              {gb.columns.map((c) => <Td key={c.key} className="text-right tabular">{r.cells[c.key] ?? "—"}</Td>)}
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
