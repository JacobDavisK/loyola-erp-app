import Link from "next/link";
import { BadgeCheck, CircleAlert } from "lucide-react";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ApaarEditor, ExitRequestForm, ExternalCreditForm } from "@/features/compliance/controls";
import { CREDIT_SOURCE, CREDIT_STATUS, EXIT_STATUS } from "@/features/compliance/labels";
import { formatApaar, transferCreditsAvailable } from "@/lib/domain/compliance";
import { fmtDate } from "@/lib/format";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { exitOptions, programmeCredits } from "@/server/services/nep";
import { getSetting } from "@/server/services/settings";
import { signedAssetUrl } from "@/server/storage";

/**
 * APAAR / Academic Bank of Credits, credit transfer and NEP exit options for one student.
 * Shown on the staff student record and in the student's own portal ("self").
 */
export async function NepPanel({ ctx, studentId, self }: { ctx: AuthContext; studentId: string; self: boolean }) {
  const opts = await exitOptions(ctx, studentId);
  const s = opts.student;
  const [external, total, cfg] = await Promise.all([
    db.externalCredit.findMany({ where: { studentId }, include: { mappedCourse: { select: { code: true } } }, orderBy: { createdAt: "desc" } }),
    programmeCredits(studentId),
    getSetting("nep"),
  ]);
  const approved = external.filter((e) => e.status === "APPROVED").reduce((a, e) => a + e.credits, 0);
  const left = total === null ? null : transferCreditsAvailable(total, cfg.externalCreditMaxPercent, approved);
  const canEditApaar = self ? !s.apaarVerifiedAt : can(ctx, "student.update", s.departmentId);
  const canAct = self ? ["ACTIVE", "ON_LEAVE"].includes(s.status) : can(ctx, "student.status", s.departmentId) && ["ACTIVE", "ON_LEAVE"].includes(s.status);
  const lastExit = opts.history.find((h) => h.status === "APPROVED");

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="APAAR ID and Academic Bank of Credits" description="One Nation One Student ID. Your credits are uploaded to your ABC account once results are published.">
          <div className="space-y-4">
            <KeyValue items={[
              ["APAAR / ABC ID", s.apaarId ? <span key="a" className="font-mono">{formatApaar(s.apaarId)}</span> : <span key="a" className="flex items-center gap-1 text-tone-warning"><CircleAlert className="size-4" /> Not recorded</span>],
              ["Verification", s.apaarVerifiedAt ? <span key="v" className="flex items-center gap-1 text-tone-success"><BadgeCheck className="size-4" /> Verified {fmtDate(s.apaarVerifiedAt)}</span> : s.apaarId ? "Awaiting verification by the office" : "—"],
            ]} />
            <ApaarEditor studentId={studentId} apaarId={s.apaarId} verified={!!s.apaarVerifiedAt} canEdit={canEditApaar} canVerify={!self && can(ctx, "apaar.manage")} />
            {self && !s.apaarId && <p className="text-xs text-muted-foreground">Create your APAAR ID through DigiLocker or your institution&apos;s APAAR camp, then enter it here.</p>}
          </div>
        </Section>
        <Section title="Credits and exit options" description="Under NEP 2020 you may leave with an intermediate award and re-enter later with your credits.">
          <KeyValue items={[
            ["Credits earned", `${opts.credits}${total ? ` of ${total}` : ""}`],
            ["Years of study", String(opts.years)],
            ["Best award available now", opts.best ? opts.best.title : "None yet"],
            ...(lastExit?.reentryUntil ? ([["Re-entry allowed until", fmtDate(lastExit.reentryUntil)]] as [string, string][]) : []),
          ]} />
          {opts.awards.length > 0 && (
            <ul className="mt-4 space-y-1.5 text-sm">
              {opts.awards.map((a) => (
                <li key={a.id} className="flex items-start gap-2">
                  <span className={a.eligible ? "text-tone-success" : "text-muted-foreground"}>{a.eligible ? "✓" : "○"}</span>
                  <span><span className="font-medium">{a.title}</span> <span className="text-xs text-muted-foreground">({a.minCredits} credits, {a.minYears} yr){!a.eligible && ` — ${a.reasons.join(" ")}`}</span></span>
                </li>
              ))}
            </ul>
          )}
          {opts.pending ? (
            <p className="mt-4 text-sm">Exit request for <span className="font-medium">{opts.pending.award.title}</span> is awaiting approval{opts.pending.workflowId && !self ? <> — <Link className="text-primary hover:underline" href={`/inbox/requests/${opts.pending.workflowId}`}>open request</Link></> : null}.</p>
          ) : canAct && opts.awards.length > 0 ? (
            <div className="mt-4"><ExitRequestForm studentId={studentId} awards={opts.awards.map((a) => ({ id: a.id, title: a.title, eligible: a.eligible }))} /></div>
          ) : null}
        </Section>
      </div>

      {opts.history.length > 0 && (
        <Section title="Exit requests" bodyClassName="p-0">
          <DataTable head={[{ label: "Award" }, { label: "Credits" }, { label: "Requested" }, { label: "Status" }, { label: "Re-entry until" }]}>
            {opts.history.map((h) => (
              <tr key={h.id}>
                <Td className="font-medium">{h.award.title}</Td>
                <Td>{h.creditsEarned}</Td>
                <Td className="text-xs">{fmtDate(h.createdAt)}</Td>
                <Td><StatusBadge meta={EXIT_STATUS[h.status]} /></Td>
                <Td className="text-xs">{fmtDate(h.reentryUntil)}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}

      <Section title="Credit transfer (SWAYAM, NPTEL, MOOCs, other institutions)" description={`Up to ${cfg.externalCreditMaxPercent}% of programme credits${left !== null ? ` — ${left} more credit(s) can be accepted` : ""}.`}>
        <div className="space-y-5">
          {external.length > 0 && (
            <DataTable head={[{ label: "Course" }, { label: "Source" }, { label: "Credits" }, { label: "Completed" }, { label: "Certificate" }, { label: "Status" }]}>
              {external.map((e) => (
                <tr key={e.id}>
                  <Td><span className="font-medium">{e.courseTitle}</span>{e.mappedCourse && <div className="text-xs text-muted-foreground">counts as {e.mappedCourse.code}</div>}{e.remarks && <div className="text-xs text-muted-foreground">{e.remarks}</div>}</Td>
                  <Td className="text-xs">{CREDIT_SOURCE[e.source]} · {e.provider}</Td>
                  <Td>{e.credits}</Td>
                  <Td className="text-xs">{fmtDate(e.completedOn)}</Td>
                  <Td>{e.certificateAssetId ? <a className="text-xs text-primary hover:underline" href={signedAssetUrl(e.certificateAssetId)} target="_blank" rel="noreferrer">View</a> : "—"}</Td>
                  <Td><StatusBadge meta={CREDIT_STATUS[e.status]} /></Td>
                </tr>
              ))}
            </DataTable>
          )}
          {(self || can(ctx, "student.update", s.departmentId)) && !["GRADUATED", "WITHDRAWN", "DISCONTINUED"].includes(s.status) && <ExternalCreditForm studentId={studentId} />}
        </div>
      </Section>
    </div>
  );
}
