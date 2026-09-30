import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { SubmitAssignmentForm } from "@/features/lms/controls";
import { checkWindow } from "@/lib/domain/lms";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";
import { attemptsAllowed, courseSpace } from "@/server/services/lms";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Assignment" };

export default async function StudentAssignmentPage({ params }: { params: Promise<{ id: string; aid: string }> }) {
  const { id, aid } = await params;
  const ctx = await requirePageAuth("self.portal");
  const s = await courseSpace(ctx, id).catch(() => null);
  if (!s || s.role !== "student") notFound();
  const a = await db.assignment.findFirst({ where: { id: aid, offeringId: id, isPublished: true } });
  if (!a) notFound();
  const { timezone: tz } = await getInstitution();
  const subs = await db.submission.findMany({ where: { assignmentId: aid, studentId: s.studentId! }, orderBy: { attempt: "desc" }, include: { files: { include: { file: { select: { id: true, originalName: true, size: true } } } } } });
  const now = new Date();
  const w = checkWindow(a, now);
  const left = attemptsAllowed(a.maxAttempts, subs) - subs.length;
  const registered = await db.courseRegistration.count({ where: { offeringId: id, studentId: s.studentId!, status: "REGISTERED" } });
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={`${s.offering.course.code} · assignment`} title={a.title} breadcrumbs={[{ label: s.offering.course.code, href: `/portal/courses/${id}?tab=assignments` }, { label: a.title }]} />
      <Section title="Brief">
        <p className="whitespace-pre-wrap text-sm">{a.instructions}</p>
        <KeyValue className="mt-4" items={[["Due", fmtDateTimeZoned(a.dueAt, tz)], ["Late work", a.closesAt ? `accepted until ${fmtDateTimeZoned(a.closesAt, tz)} with a ${a.latePenaltyPercent}% penalty` : "not accepted"], ["Maximum marks", String(a.maxMarks)], ["Attempts", `${subs.length} of ${attemptsAllowed(a.maxAttempts, subs)} used`]]} />
      </Section>
      {registered && w.open && left > 0 ? (
        <Section title={subs.length ? "Submit again" : "Your submission"} description={w.late ? `The due time has passed: this submission will be marked late (−${w.penalty * 100}%).` : "Submissions are final once sent; each one is kept."}>
          <SubmitAssignmentForm assignmentId={a.id} allowText={a.allowText} allowFiles={a.allowFiles} maxFiles={a.maxFiles} />
        </Section>
      ) : (
        <p className="text-sm text-muted-foreground">{!w.open ? w.reason : left <= 0 ? "You have used all your attempts." : "Submissions are closed for this class."}</p>
      )}
      {subs.map((sub) => (
        <Section key={sub.id} title={`Attempt ${sub.attempt}`} description={`${fmtDateTimeZoned(sub.submittedAt, tz)}${sub.isLate ? " · late" : ""}`}>
          {sub.text && <p className="whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{sub.text}</p>}
          {sub.files.length > 0 && <ul className="mt-2 space-y-1 text-sm">{sub.files.map((f) => <li key={f.fileId}><a className="text-primary hover:underline" href={signedAssetUrl(f.file.id, 900, "attachment")}>{f.file.originalName}</a></li>)}</ul>}
          {sub.status === "RETURNED" && <p className="mt-3 text-sm"><b>Returned for rework:</b> {sub.feedback}</p>}
          {sub.status === "GRADED" && (a.gradesReleasedAt ? (
            <div className="mt-3 rounded-lg border p-3 text-sm"><b>{sub.finalMarks} / {a.maxMarks}</b>{sub.penalty ? <span className="text-muted-foreground"> ({sub.marks} before the late penalty)</span> : null}{sub.feedback && <p className="mt-1 whitespace-pre-wrap">{sub.feedback}</p>}</div>
          ) : <p className="mt-3 text-sm text-muted-foreground">Graded — marks will appear when your instructor releases them.</p>)}
        </Section>
      ))}
    </div>
  );
}
