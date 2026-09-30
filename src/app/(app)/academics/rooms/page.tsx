import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { saveSetupAction } from "@/features/academic-ops/actions";
import { hasGlobal, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Rooms" };

const ROOM_TYPE = { CLASSROOM: "Classroom", LAB: "Laboratory", SEMINAR_HALL: "Seminar hall", EXAM_HALL: "Examination hall", AUDITORIUM: "Auditorium", OTHER: "Other" } as const;

export default async function RoomsPage() {
  const ctx = await requirePageAuth(["academic.view", "timetable.manage"]);
  const manage = hasGlobal(ctx, "timetable.manage");
  const [buildings, rooms, campuses] = await Promise.all([
    db.building.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, include: { campus: { select: { code: true } }, _count: { select: { rooms: true } } } }),
    db.room.findMany({ orderBy: [{ building: { code: "asc" } }, { code: "asc" }], include: { building: { select: { code: true } }, _count: { select: { slots: true } } } }),
    db.campus.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } }),
  ]);
  const buildingFields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true },
    { name: "name", label: "Name", type: "text" },
    { name: "campusId", label: "Campus", type: "select", optional: true, options: campuses.map((c) => ({ value: c.id, label: c.name })) },
  ];
  const roomFields: FormField[] = [
    { name: "code", label: "Code", type: "text", upper: true, placeholder: "AB-101" },
    { name: "name", label: "Name", type: "text" },
    { name: "buildingId", label: "Building", type: "select", optional: true, options: buildings.map((b) => ({ value: b.id, label: `${b.code} — ${b.name}` })) },
    { name: "type", label: "Type", type: "select", options: Object.entries(ROOM_TYPE).map(([value, label]) => ({ value, label })) },
    { name: "capacity", label: "Teaching capacity", type: "number", min: 1 },
    { name: "examCapacity", label: "Examination seats", type: "number", optional: true, min: 0, hint: "Used for exam seating plans" },
    { name: "isActive", label: "Available for booking", type: "checkbox" },
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Buildings & rooms" description="Teaching and examination spaces. The timetable refuses double-bookings." />
      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Section title="Buildings" actions={manage && <FormDialog title="Building" fields={buildingFields} action={saveSetupAction.bind(null, "building")} />} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Rooms", className: "text-right" }, { label: "" }]}>
            {buildings.map((b) => (
              <tr key={b.id}>
                <Td className="font-mono text-xs">{b.code}</Td>
                <Td>{b.name}{b.campus && <div className="text-[11px] text-muted-foreground">{b.campus.code}</div>}</Td>
                <Td className="text-right tabular">{b._count.rooms}</Td>
                <Td className="text-right">{manage && <FormDialog title="Building" fields={buildingFields} action={saveSetupAction.bind(null, "building")} id={b.id} initial={{ code: b.code, name: b.name, campusId: b.campusId }} />}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <Section title="Rooms" actions={manage && <FormDialog title="Room" fields={roomFields} columns={2} action={saveSetupAction.bind(null, "room")} initial={{ type: "CLASSROOM", capacity: 60, isActive: true }} />} bodyClassName="p-0">
          <DataTable head={[{ label: "Room" }, { label: "Type" }, { label: "Capacity", className: "text-right" }, { label: "Exam seats", className: "text-right" }, { label: "Weekly classes", className: "text-right" }, { label: "" }]}>
            {rooms.map((r) => (
              <tr key={r.id} className={r.isActive ? undefined : "opacity-60"}>
                <Td><span className="font-mono text-xs">{r.code}</span> {r.name}{r.building && <div className="text-[11px] text-muted-foreground">{r.building.code}{r.isActive ? "" : " · unavailable"}</div>}</Td>
                <Td className="text-xs">{ROOM_TYPE[r.type]}</Td>
                <Td className="text-right tabular">{r.capacity}</Td>
                <Td className="text-right tabular">{r.examCapacity ?? "—"}</Td>
                <Td className="text-right tabular">{r._count.slots}</Td>
                <Td className="text-right">{manage && <FormDialog title="Room" fields={roomFields} columns={2} action={saveSetupAction.bind(null, "room")} id={r.id} initial={{ code: r.code, name: r.name, buildingId: r.buildingId, type: r.type, capacity: r.capacity, examCapacity: r.examCapacity, isActive: r.isActive }} />}</Td>
              </tr>
            ))}
          </DataTable>
          {rooms.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No rooms yet.</p>}
        </Section>
      </div>
    </div>
  );
}
