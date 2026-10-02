import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { PreRegisterVisitor } from "@/features/operations/controls";
import { preRegisterFields } from "@/features/operations/fields";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Visitors" };

export default async function VisitorsPage() {
  const ctx = await requirePageAuth();
  if (ctx.user.userType !== "STAFF") return null;
  const { timezone } = await getInstitution();
  const rows = await db.visitor.findMany({ where: { hostUserId: ctx.user.id }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="space-y-6">
      <PageHeader title="My visitors" description="Expecting someone? Create a pass: the visitor gets a six-digit code to show at the gate, and you are notified when they arrive. Walk-in visitors who ask for you also appear here." actions={<PreRegisterVisitor fields={preRegisterFields} />} />
      <Section title="Visitors" bodyClassName="p-0">
        <DataTable head={[{ label: "Visitor" }, { label: "Purpose" }, { label: "Pass code" }, { label: "Expected" }, { label: "Arrived" }, { label: "Left" }]} empty="No visitors yet.">
          {rows.map((v) => (
            <tr key={v.id}>
              <Td>{v.name}<div className="text-[11px] text-muted-foreground">{v.phone}</div></Td>
              <Td className="text-xs">{v.purpose}</Td>
              <Td className="font-mono">{v.passCode ?? "—"}</Td>
              <Td className="text-xs">{fmtDateTimeZoned(v.expectedAt, timezone)}</Td>
              <Td className="text-xs">{fmtDateTimeZoned(v.checkedInAt, timezone)}</Td>
              <Td className="text-xs">{fmtDateTimeZoned(v.checkedOutAt, timezone)}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
