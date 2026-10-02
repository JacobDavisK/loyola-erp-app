import Link from "next/link";
import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { saveConvocationAction } from "@/features/campuslife/actions";
import { fmtDateTimeZoned } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { getInstitution } from "@/server/services/directory";

export const metadata: Metadata = { title: "Convocation" };

const FIELDS: FormField[] = [
  { name: "title", label: "Title", type: "text", wide: true, placeholder: "12th Annual Convocation" },
  { name: "heldOn", label: "Date and time", type: "datetime-local" },
  { name: "venue", label: "Venue", type: "text" },
  { name: "registrationCloses", label: "Registration closes", type: "datetime-local" },
  { name: "maxGuests", label: "Guests per graduate", type: "number", min: 0, max: 10 },
];

export default async function ConvocationListPage() {
  await requirePageAuth("convocation.manage");
  const [list, { timezone: tz }] = await Promise.all([db.convocation.findMany({ orderBy: { heldOn: "desc" }, include: { _count: { select: { graduates: true } } } }), getInstitution()]);
  return (
    <div className="space-y-6">
      <PageHeader title="Convocation" description="Graduates with an issued degree certificate and no fees outstanding are invited; they register to attend in person or in absentia, and seats are allotted when registration closes." actions={<FormDialog title="Convocation" columns={2} fields={FIELDS} action={saveConvocationAction} initial={{ maxGuests: 2 }} trigger={<Button size="sm"><Plus /> Convocation</Button>} />} />
      <Section bodyClassName="p-0">
        <DataTable head={[{ label: "Convocation" }, { label: "Date" }, { label: "Graduates" }, { label: "Status" }]} empty="No convocations yet.">
          {list.map((c) => (
            <tr key={c.id}>
              <Td><Link className="font-medium hover:text-primary" href={`/convocation/${c.id}`}>{c.title}</Link><div className="text-xs text-muted-foreground">{c.venue}</div></Td>
              <Td className="text-xs">{fmtDateTimeZoned(c.heldOn, tz)}</Td>
              <Td>{c._count.graduates}</Td>
              <Td className="text-xs">{c.status.toLowerCase().replace(/_/g, " ")}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
