import { notFound } from "next/navigation";
import { Send, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/features/academic-ops/controls";
import { deleteAssignmentAction, releaseGradesAction, saveAssignmentAction } from "@/features/lms/actions";
import { GradeForm } from "@/features/lms/controls";
import { assignmentFields } from "@/features/lms/fields";
import { fmtDateTimeZoned, toZonedInput } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { courseSpace } from "@/server/services/lms";
import { signedAssetUrl } from "@/server/storage";
import { aiStatus } from "@/server/ai/gateway";
import { checkSimilarityAction } from "@/features/teaching/actions";
import { latestSimilarity } from "@/server/services/submission-similarity";
import { DataTable, Td } from "@/components/app/list";
import { ScanSearch } from "lucide-react";

export const metadata: Metadata = { title: "Assignment" };

const STATUS = { SUBMITTED: "To grade", GRADED: "Graded", RETURNED: "Returned for rework" } as const;

export default async function TeacherAssignmentPage({ params, searchParams }: { params: Promise<{ id: string; aid: string }>; searchParams: Promise<{ show?: string }> }) {
  const { id, aid } = await params;
  const { show = "latest" } = await searchParams;
  const ctx = await requirePageAuth();
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role === "student") notFound();
  const a = await db.assignment.findFirst({ where: { id: aid, offeringId: id } });
  if (!a) notFound();
  const edit = s.role === "teacher";
  const [{ timezone: tz }, ai] = await Promise.all([getInstitution(), aiStatus()]);
  const aiOn = ai.configured && ai.enabled && ai.features.feedbackDrafts;
  const [regs, subs, modules] = await Promise.all([
    db.courseRegistration.findMany({ where: { offeringId: id, status: { in: ["REGISTERED", "COMPLETED"] } }, include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true } } }, orderBy: { student: { studentNo: "asc" } } }),
    db.submission.findMany({ where: { assignmentId: aid }, orderBy: [{ attempt: "desc" }], include: { files: { include: { file: { select: { id: true, originalName: true, size: true } } } } } }),
    db.courseModule.findMany({ where: { offeringId: id }, select: { id: true, title: true } }),
  ]);
  const similarity = await latestSimilarity(aid);
  const latest = new Map<string, (typeof subs)[number]>();
  for (const x of subs) if (!latest.has(x.studentId)) latest.set(x.studentId, x);
  const rows = regs.filter((r) => show === "all" || (show === "missing" ? !latest.has(r.student.id) : latest.has(r.student.id)));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`${s.offering.course.code}-${s.offering.section}`}
        title={a.title}
        breadcrumbs={[{ label: "Course space", href: `/teaching/courses/${id}?tab=assignments` }, { label: a.title }]}
        description={`${a.isPublished ? "Published" : "Draft"} · due ${fmtDateTimeZoned(a.dueAt, tz)} · ${latest.size}/${regs.length} submitted${a.gradesReleasedAt ? " · marks released" : ""}`}
        actions={edit && (
          <div className="flex flex-wrap gap-2">
            <FormDialog title="Assignment" columns={2} id={a.id} fields={assignmentFields(modules)} action={saveAssignmentAction.bind(null, id)} trigger={<Button size="sm" variant="outline">Edit</Button>}
              initial={{ title: a.title, instructions: a.instructions, moduleId: a.moduleId, maxMarks: a.maxMarks, dueAt: toZonedInput(a.dueAt, tz), closesAt: toZonedInput(a.closesAt, tz), latePenaltyPercent: a.latePenaltyPercent, maxAttempts: a.maxAttempts, maxFiles: a.maxFiles, allowText: a.allowText, allowFiles: a.allowFiles, isPublished: a.isPublished }} />
            {a.isPublished && !a.gradesReleasedAt && <ActionButton label="Release marks" variant="default" icon={<Send />} run={releaseGradesAction.bind(null, a.id)} confirmText="Release marks and feedback to students? Students with graded work are notified." />}
            {subs.length === 0 && <ActionButton label="Delete" icon={<Trash2 />} run={deleteAssignmentAction.bind(null, a.id)} confirmText="Delete this assignment?" />}
          </div>
        )}
      />
      <Section title="Brief">
        <p className="whitespace-pre-wrap text-sm">{a.instructions}</p>
        <KeyValue className="mt-4" items={[["Maximum marks", String(a.maxMarks)], ["Late work", a.closesAt ? `until ${fmtDateTimeZoned(a.closesAt, tz)}, −${a.latePenaltyPercent}%` : "not accepted"], ["Attempts", String(a.maxAttempts)], ["Answer", [a.allowText && "typed", a.allowFiles && `up to ${a.maxFiles} file(s)`].filter(Boolean).join(" and ")]]} />
      </Section>
      {latest.size >= 2 && (
        <Section
          title="Similarity check"
          description={similarity ? `Checked ${fmtDateTimeZoned(similarity.report.computedAt, tz)} — pairs sharing at least ${similarity.report.threshold}% of their wording. A high score is a reason to look, not proof of copying.` : "Compare the text of every submission with every other one (typed answers, text files, Word documents and PDFs with a text layer)."}
          actions={<ActionButton label={similarity ? "Check again" : "Check similarity"} icon={<ScanSearch />} run={checkSimilarityAction.bind(null, aid)} />}
          bodyClassName={similarity ? "p-0" : undefined}
        >
          {similarity ? (
            <>
              <DataTable head={[{ label: "Submissions" }, { label: "Overlap" }, { label: "Shared wording (sample)" }]} empty="No pair reaches the threshold.">
                {similarity.pairs.map((p, i) => (
                  <tr key={i}>
                    <Td className="text-sm">{p.a}<br />{p.b}</Td>
                    <Td className={p.score >= 60 ? "font-semibold text-tone-danger" : "font-medium text-tone-warning"}>{p.score}%</Td>
                    <Td className="text-xs text-muted-foreground">{p.sample ? `“…${p.sample}…”` : "—"}</Td>
                  </tr>
                ))}
              </DataTable>
              {similarity.unreadable.length > 0 && <p className="px-5 py-3 text-xs text-muted-foreground">No readable text (scanned or image files): {similarity.unreadable.map((u) => u.who).join(", ")}.</p>}
            </>
          ) : <p className="text-sm text-muted-foreground">Not checked yet.</p>}
        </Section>
      )}
      <nav className="flex gap-3 text-sm" aria-label="Filter">
        {[["latest", "Submitted"], ["missing", "Not submitted"], ["all", "Everyone"]].map(([k, l]) => <a key={k} href={`?show=${k}`} className={show === k ? "font-medium text-primary" : "text-muted-foreground hover:text-foreground"}>{l}</a>)}
      </nav>
      <div className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nobody here.</p>}
        {rows.map((r) => {
          const sub = latest.get(r.student.id);
          return (
            <section key={r.student.id} className="surface-card p-4" aria-label={`${r.student.firstName} ${r.student.lastName}`}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium">{r.student.firstName} {r.student.lastName}</span>
                <span className="font-mono text-xs text-muted-foreground">{r.student.studentNo}</span>
                {sub ? <span className="text-xs text-muted-foreground">attempt {sub.attempt} · {fmtDateTimeZoned(sub.submittedAt, tz)}{sub.isLate ? " · late" : ""} · {STATUS[sub.status]}{sub.finalMarks !== null ? ` · ${sub.finalMarks}/${a.maxMarks}` : ""}</span> : <span className="text-xs text-tone-warning">not submitted</span>}
              </div>
              {sub && (
                <div className="mt-3 grid gap-4 lg:grid-cols-[1fr_360px]">
                  <div className="space-y-2 text-sm">
                    {sub.text && <p className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/40 p-3">{sub.text}</p>}
                    {sub.files.length > 0 && <ul className="space-y-1">{sub.files.map((f) => <li key={f.fileId}><a className="text-primary hover:underline" href={signedAssetUrl(f.file.id, 900, "attachment")}>{f.file.originalName}</a> <span className="text-xs text-muted-foreground">{Math.ceil(f.file.size / 1024)} KB</span></li>)}</ul>}
                  </div>
                  {edit ? <GradeForm submissionId={sub.id} max={a.maxMarks} marks={sub.marks} feedback={sub.feedback} penalty={sub.penalty} assignmentTitle={a.title} aiAvailable={aiOn} /> : sub.feedback && <p className="text-sm">{sub.feedback}</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
