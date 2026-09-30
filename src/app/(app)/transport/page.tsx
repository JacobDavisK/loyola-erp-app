import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { issuePassAction, saveRouteAction } from "@/features/campus/actions";
import { CancelPassButton } from "@/features/campus/controls";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Transport" };

const ROUTE_FIELDS: FormField[] = [
  { name: "code", label: "Code", type: "text", upper: true },
  { name: "name", label: "Name", type: "text" },
  { name: "vehicle", label: "Vehicle", type: "text", optional: true },
  { name: "driver", label: "Driver", type: "text", optional: true },
  { name: "capacity", label: "Seats", type: "number", min: 1, max: 200 },
  { name: "feePerTerm", label: "Fee per term", type: "number", min: 0, step: 0.01 },
  { name: "stops", label: "Stops in boarding order (one per line: Stop | 07:15)", type: "textarea" },
  { name: "isActive", label: "Active", type: "checkbox" },
];

export default async function TransportPage({ searchParams }: { searchParams: Promise<{ route?: string }> }) {
  await requirePageAuth("transport.manage");
  const sp = await searchParams;
  const today = new Date();
  const [routes, inst] = await Promise.all([
    db.transportRoute.findMany({ orderBy: { code: "asc" }, include: { passes: { where: { cancelledAt: null, validTo: { gte: today } }, orderBy: { stop: "asc" }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } } } } } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const selected = routes.find((r) => r.id === sp.route) ?? routes[0];
  const stopsText = (s: unknown) => (s as { name: string; time: string | null }[]).map((x) => `${x.name}${x.time ? ` | ${x.time}` : ""}`).join("\n");
  return (
    <div className="space-y-6">
      <PageHeader title="Transport" description="Routes, stops and student passes. Seat capacity is enforced by the database; the transport fee is invoiced when a pass is issued." actions={<FormDialog title="Route" columns={2} fields={ROUTE_FIELDS} action={saveRouteAction} initial={{ capacity: 40, feePerTerm: 0, isActive: true }} trigger={<Button size="sm"><Plus /> Route</Button>} />} />
      <Section title="Routes" bodyClassName="p-0">
        <DataTable head={[{ label: "Route" }, { label: "Stops" }, { label: "Vehicle" }, { label: "Passes", className: "text-right" }, { label: "Fee", className: "text-right" }, { label: "" }]} empty="No routes.">
          {routes.map((r) => (
            <tr key={r.id} className={selected?.id === r.id ? "bg-primary/5" : undefined}>
              <Td><a href={`?route=${r.id}`} className="font-medium hover:text-primary">{r.code}</a> <span className="text-sm">{r.name}</span></Td>
              <Td className="max-w-md text-xs">{(r.stops as { name: string; time: string | null }[]).map((s) => `${s.name}${s.time ? ` ${s.time}` : ""}`).join(" → ")}</Td>
              <Td className="text-xs">{r.vehicle ?? "—"}</Td>
              <Td className={r.passes.length >= r.capacity ? "text-right font-medium text-tone-danger tabular" : "text-right tabular"}>{r.passes.length}/{r.capacity}</Td>
              <Td className="text-right tabular">{formatMoney(toMinor(r.feePerTerm), inst.currency, inst.locale)}</Td>
              <Td className="text-right"><FormDialog title="Route" columns={2} id={r.id} fields={ROUTE_FIELDS} action={saveRouteAction} initial={{ code: r.code, name: r.name, vehicle: r.vehicle, driver: r.driver, capacity: r.capacity, feePerTerm: Number(r.feePerTerm), stops: stopsText(r.stops), isActive: r.isActive }} /></Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {selected && (
        <Section title={`Passes on ${selected.code}`} actions={<FormDialog title="Transport pass" action={issuePassAction} submitLabel="Issue" trigger={<Button size="xs">Issue pass</Button>} initial={{ routeId: selected.id, validFrom: today.toISOString().slice(0, 10), raiseFee: true }}
          fields={[{ name: "studentNo", label: "Student number", type: "text", upper: true }, { name: "routeId", label: "Route", type: "select", options: routes.map((r) => ({ value: r.id, label: `${r.code} ${r.name}` })) }, { name: "stop", label: "Boarding stop", type: "select", options: (selected.stops as { name: string }[]).map((s) => ({ value: s.name, label: s.name })) }, { name: "validFrom", label: "Valid from", type: "date" }, { name: "validTo", label: "Valid to", type: "date" }, { name: "raiseFee", label: "Raise the transport fee invoice", type: "checkbox" }]} />} bodyClassName="p-0">
          <DataTable head={[{ label: "Student" }, { label: "Stop" }, { label: "Valid" }, { label: "" }]} empty="No current passes.">
            {selected.passes.map((p) => (
              <tr key={p.id}>
                <Td>{p.student.firstName} {p.student.lastName}<div className="font-mono text-[11px] text-muted-foreground">{p.student.studentNo}</div></Td>
                <Td className="text-sm">{p.stop}</Td>
                <Td className="text-xs">{fmtDate(p.validFrom)} – {fmtDate(p.validTo)}</Td>
                <Td className="text-right"><CancelPassButton id={p.id} /></Td>
              </tr>
            ))}
          </DataTable>
        </Section>
      )}
    </div>
  );
}
