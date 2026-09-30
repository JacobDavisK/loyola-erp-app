import { Plus } from "lucide-react";
import type { Metadata } from "next";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { PageHeader, Section, StatCard } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { addRoomsAction, allocateBedAction, saveHostelAction, vacateBedAction } from "@/features/campus/actions";
import { formatMoney, toMinor } from "@/lib/domain/money";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Hostels" };

export default async function HostelsPage({ searchParams }: { searchParams: Promise<{ hostel?: string }> }) {
  await requirePageAuth("hostel.manage");
  const sp = await searchParams;
  const [hostels, campuses, wardens, inst] = await Promise.all([
    db.hostel.findMany({ orderBy: { code: "asc" }, include: { campus: { select: { name: true } }, warden: { select: { name: true } }, rooms: { where: { isActive: true }, orderBy: { number: "asc" }, include: { allocations: { where: { vacatedAt: null }, include: { student: { select: { studentNo: true, firstName: true, lastName: true } } } } } } } }),
    db.campus.findMany({ orderBy: { name: "asc" } }),
    db.user.findMany({ where: { userType: "STAFF", status: "ACTIVE", deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.institution.findFirstOrThrow({ select: { currency: true, locale: true } }),
  ]);
  const hostelFields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "gender", label: "For", type: "select", optional: true, options: [{ value: "FEMALE", label: "Women" }, { value: "MALE", label: "Men" }] },
    { name: "campusId", label: "Campus", type: "select", optional: true, options: campuses.map((c) => ({ value: c.id, label: c.name })) },
    { name: "wardenId", label: "Warden", type: "select", optional: true, options: wardens.map((w) => ({ value: w.id, label: w.name })) },
    { name: "feePerTerm", label: "Fee per term", type: "number", min: 0, step: 0.01 },
    { name: "isActive", label: "Active", type: "checkbox" },
  ];
  const selected = hostels.find((h) => h.id === sp.hostel) ?? hostels[0];
  const beds = (h: (typeof hostels)[number]) => h.rooms.reduce((a, r) => a + r.capacity, 0);
  const used = (h: (typeof hostels)[number]) => h.rooms.reduce((a, r) => a + r.allocations.length, 0);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="space-y-6">
      <PageHeader title="Hostels" description="Rooms, occupancy and bed allocations. Room capacity is enforced by the database; the hostel fee is invoiced on allocation." actions={<FormDialog title="Hostel" columns={2} fields={hostelFields} action={saveHostelAction} initial={{ feePerTerm: 0, isActive: true }} trigger={<Button size="sm"><Plus /> Hostel</Button>} />} />
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
        {hostels.map((h) => (
          <a key={h.id} href={`?hostel=${h.id}`} className={`rounded-xl border p-4 hover:border-primary/40 ${selected?.id === h.id ? "border-primary/50 bg-primary/5" : ""}`}>
            <div className="font-medium">{h.name}</div>
            <div className="text-xs text-muted-foreground">{h.code} · {h.gender === "FEMALE" ? "women" : h.gender === "MALE" ? "men" : "all"} · {formatMoney(toMinor(h.feePerTerm), inst.currency, inst.locale)}/term{h.warden ? ` · ${h.warden.name}` : ""}</div>
            <div className="mt-2 flex items-center gap-2"><Progress value={beds(h) ? (used(h) / beds(h)) * 100 : 0} aria-label="Occupancy" /><span className="text-xs tabular">{used(h)}/{beds(h)}</span></div>
          </a>
        ))}
      </div>
      {selected && (
        <>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
            <StatCard label="Rooms" value={selected.rooms.length} />
            <StatCard label="Beds free" value={beds(selected) - used(selected)} />
          </div>
          <Section
            title={`${selected.name} — rooms`}
            actions={
              <div className="flex gap-2">
                <FormDialog title="Rooms" id={selected.id} action={addRoomsAction} submitLabel="Add" fields={[{ name: "numbers", label: "Room numbers", type: "text", placeholder: "101-110, 201-205", hint: "Ranges and single numbers, comma-separated." }, { name: "capacity", label: "Beds per room", type: "number", min: 1, max: 50 }]} initial={{ capacity: 3 }} trigger={<Button size="xs" variant="outline"><Plus /> Rooms</Button>} />
                <FormDialog title="Bed allocation" action={allocateBedAction} submitLabel="Allot" initial={{ fromDate: today, raiseFee: true, roomId: selected.rooms.find((r) => r.allocations.length < r.capacity)?.id ?? null }} trigger={<Button size="xs">Allot a bed</Button>}
                  fields={[{ name: "studentNo", label: "Student number", type: "text", upper: true }, { name: "roomId", label: "Room", type: "select", options: selected.rooms.filter((r) => r.allocations.length < r.capacity).map((r) => ({ value: r.id, label: `${r.number} (${r.capacity - r.allocations.length} free)` })) }, { name: "fromDate", label: "From", type: "date" }, { name: "raiseFee", label: "Raise the hostel fee invoice", type: "checkbox" }]} />
                <FormDialog title="Hostel" columns={2} id={selected.id} fields={hostelFields} action={saveHostelAction} initial={{ code: selected.code, name: selected.name, gender: selected.gender, campusId: selected.campusId, wardenId: selected.wardenId, feePerTerm: Number(selected.feePerTerm), isActive: selected.isActive }} />
              </div>
            }
            bodyClassName="p-0"
          >
            <DataTable head={[{ label: "Room" }, { label: "Beds", className: "text-right" }, { label: "Occupants" }]} empty="No rooms yet.">
              {selected.rooms.map((r) => (
                <tr key={r.id}>
                  <Td className="font-mono text-sm">{r.number}</Td>
                  <Td className="text-right tabular">{r.allocations.length}/{r.capacity}</Td>
                  <Td>
                    <ul className="space-y-1">
                      {r.allocations.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2 text-sm">
                          {a.student.firstName} {a.student.lastName} <span className="font-mono text-[11px] text-muted-foreground">{a.student.studentNo} · since {fmtDate(a.fromDate)}</span>
                          <FormDialog title="Vacate" id={a.id} action={vacateBedAction} submitLabel="Vacate" initial={{ date: today }} fields={[{ name: "date", label: "Vacated on", type: "date" }, { name: "reason", label: "Reason", type: "text" }]} trigger={<Button size="xs" variant="ghost">Vacate</Button>} />
                        </li>
                      ))}
                    </ul>
                  </Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        </>
      )}
    </div>
  );
}
