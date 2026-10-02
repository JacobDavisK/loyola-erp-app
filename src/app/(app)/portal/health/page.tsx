import Link from "next/link";
import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { visitsFor } from "@/server/services/clinic";
import { getInstitution } from "@/server/services/directory";
import { getT } from "@/server/i18n";

export const metadata: Metadata = { title: "Health record" };

export default async function MyHealthPage() {
  const ctx = await requirePageAuth("enrollment.self");
  const t = await getT();
  const studentId = ctx.subject.studentId;
  const { timezone } = await getInstitution();
  const visits = studentId ? await visitsFor(ctx, { studentId }) : [];
  return (
    <div className="space-y-6">
      <PageHeader title={t("Health record")} description="Your visits to the campus health centre. Only you and the health centre can see this." />
      <Section title="Visits" bodyClassName="p-0">
        <DataTable head={[{ label: "When" }, { label: "Complaint" }, { label: "Diagnosis" }, { label: "Rest" }]} empty="No visits.">
          {visits.map((v) => (
            <tr key={v.id}>
              <Td className="text-xs"><Link className="hover:text-primary" href={`/health/${v.id}`}>{fmtDateTimeZoned(v.visitedAt, timezone)}</Link></Td>
              <Td className="text-xs">{v.complaint}</Td>
              <Td className="text-xs">{v.diagnosis ?? "—"}</Td>
              <Td className="text-xs">{v.restDays ? `${v.restDays} day(s)` : "—"}{v.certificate ? " · certificate" : ""}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
