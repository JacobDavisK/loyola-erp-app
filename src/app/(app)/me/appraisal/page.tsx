import { redirect } from "next/navigation";
import { Star } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState, KeyValue, PageHeader, Section } from "@/components/app/page";
import { AppraisalForm } from "@/features/hr/controls";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import type { Criterion } from "@/server/services/appraisals";

export const metadata: Metadata = { title: "Appraisal" };

const STATUS = { SELF_REVIEW: "Awaiting self-review", MANAGER_REVIEW: "With reviewer", COMPLETED: "Completed" } as const;

export default async function MyAppraisalPage() {
  const ctx = await requirePageAuth();
  const employeeId = ctx.subject.employeeId;
  if (!employeeId) redirect("/dashboard");
  const [mine, toReview] = await Promise.all([
    db.appraisal.findMany({ where: { employeeId }, orderBy: { cycle: { year: "desc" } }, include: { cycle: true } }),
    db.appraisal.findMany({ where: { reviewerId: employeeId, status: "MANAGER_REVIEW" }, include: { cycle: true, employee: { select: { firstName: true, lastName: true, designation: true } } } }),
  ]);
  const now = new Date();
  return (
    <div className="space-y-6">
      <PageHeader title="Appraisal" breadcrumbs={[{ label: "My work" }, { label: "Appraisal" }]} description="Rate each criterion from 1 (needs improvement) to 5 (outstanding)." />
      {toReview.map((a) => {
        const criteria = a.cycle.criteria as unknown as Criterion[];
        const self = (a.selfRatings ?? {}) as Record<string, number>;
        return (
          <Section key={a.id} title={`Review: ${a.employee.firstName} ${a.employee.lastName}`} description={`${a.cycle.name} · ${a.employee.designation}`}>
            <KeyValue items={criteria.map((c) => [c.label, `self-rating ${self[c.key] ?? "—"}`] as [string, string])} />
            <p className="my-3 whitespace-pre-wrap rounded-lg bg-muted/40 p-3 text-sm">{a.selfComments}</p>
            <AppraisalForm id={a.id} mode="manager" criteria={criteria} />
          </Section>
        );
      })}
      {mine.length === 0 && toReview.length === 0 && <EmptyState icon={Star} title="No appraisal cycles" description="HR opens appraisal cycles; they will appear here." />}
      {mine.map((a) => {
        const criteria = a.cycle.criteria as unknown as Criterion[];
        const open = now >= a.cycle.opensAt && now <= a.cycle.closesAt;
        return (
          <Section key={a.id} title={a.cycle.name} description={`${STATUS[a.status]} · window ${fmtDate(a.cycle.opensAt)} – ${fmtDate(a.cycle.closesAt)}`}>
            {a.status === "SELF_REVIEW" && open ? <AppraisalForm id={a.id} mode="self" criteria={criteria} /> : a.status === "SELF_REVIEW" ? <p className="text-sm text-muted-foreground">The window is closed.</p> : (
              <div className="space-y-3 text-sm">
                <KeyValue items={criteria.map((c) => [c.label, `self ${(a.selfRatings as Record<string, number> | null)?.[c.key] ?? "—"}${a.status === "COMPLETED" ? ` · reviewer ${(a.ratings as Record<string, number> | null)?.[c.key] ?? "—"}` : ""}`] as [string, string])} />
                {a.status === "COMPLETED" && <p><b>Score {a.score}</b> / 5 — {a.comments}</p>}
              </div>
            )}
          </Section>
        );
      })}
    </div>
  );
}
