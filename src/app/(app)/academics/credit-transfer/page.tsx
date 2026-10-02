import Link from "next/link";
import type { Metadata } from "next";
import { DataTable, LinkTabs, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { ReviewCreditControls } from "@/features/compliance/controls";
import { CREDIT_SOURCE, CREDIT_STATUS } from "@/features/compliance/labels";
import { fmtDate } from "@/lib/format";
import { requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Credit transfer" };

export default async function CreditTransferPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const ctx = await requirePageAuth("credittransfer.review");
  const { view = "pending" } = await searchParams;
  const scope = scopeOf(ctx, "credittransfer.review");
  const deptFilter = scope === null ? {} : { departmentId: { in: scope } };
  const cfg = await getSetting("nep");
  const items = await db.externalCredit.findMany({
    where: { student: { deletedAt: null, ...deptFilter }, ...(view === "pending" ? { status: "PENDING" } : { status: { not: "PENDING" } }) },
    orderBy: { createdAt: view === "pending" ? "asc" : "desc" },
    take: 200,
    include: { student: { select: { id: true, studentNo: true, firstName: true, lastName: true, programId: true } }, mappedCourse: { select: { code: true } } },
  });
  const programIds = [...new Set(items.map((i) => i.student.programId))];
  const courses = await db.course.findMany({ where: { programId: { in: programIds }, deletedAt: null }, select: { id: true, code: true, title: true, programId: true }, orderBy: { code: "asc" } });
  return (
    <div className="space-y-6">
      <PageHeader title="Credit transfer" description={`Credits students earned on SWAYAM, NPTEL, other MOOCs or at another institution. Accept them as an equivalent course or as elective credits, up to ${cfg.externalCreditMaxPercent}% of the programme.`} />
      <LinkTabs tabs={[{ key: "pending", label: "To review", href: "?view=pending" }, { key: "decided", label: "Decided", href: "?view=decided" }]} active={view} />
      <Section title={`${items.length} request(s)`} bodyClassName="p-0">
        <DataTable head={[{ label: "Student" }, { label: "Course" }, { label: "Credits" }, { label: "Certificate" }, { label: view === "pending" ? "Decision" : "Status" }]} empty="Nothing here.">
          {items.map((e) => (
            <tr key={e.id} className="align-top">
              <Td><Link className="font-medium hover:text-primary" href={`/students/${e.student.id}?tab=nep`}>{e.student.firstName} {e.student.lastName}</Link><div className="font-mono text-xs text-muted-foreground">{e.student.studentNo}</div></Td>
              <Td><div className="font-medium">{e.courseTitle}</div><div className="text-xs text-muted-foreground">{CREDIT_SOURCE[e.source]} · {e.provider}{e.courseCode ? ` · ${e.courseCode}` : ""} · completed {fmtDate(e.completedOn)}{e.grade ? ` · grade ${e.grade}` : ""}</div></Td>
              <Td>{e.credits}</Td>
              <Td>{e.certificateAssetId ? <a className="text-xs text-primary hover:underline" href={signedAssetUrl(e.certificateAssetId)} target="_blank" rel="noreferrer">View{e.certificateNo ? ` (${e.certificateNo})` : ""}</a> : "—"}</Td>
              <Td>
                {e.status === "PENDING" ? (
                  <ReviewCreditControls id={e.id} credits={e.credits} courses={courses.filter((c) => c.programId === e.student.programId).map((c) => ({ id: c.id, label: `${c.code} — ${c.title}` }))} />
                ) : (
                  <div className="space-y-1"><StatusBadge meta={CREDIT_STATUS[e.status]} />{e.mappedCourse && <div className="text-xs text-muted-foreground">as {e.mappedCourse.code}</div>}{e.remarks && <div className="text-xs text-muted-foreground">{e.remarks}</div>}</div>
                )}
              </Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
