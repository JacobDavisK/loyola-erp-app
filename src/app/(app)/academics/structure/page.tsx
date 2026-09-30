import type { Metadata } from "next";
import { DataTable, Td } from "@/components/app/list";
import { FormDialog, type FormField } from "@/components/app/form-dialog";
import { PageHeader, Section } from "@/components/app/page";
import { saveStructureAction } from "@/features/academics/actions";
import { fmtDate } from "@/lib/format";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import type { StructureKind } from "@/server/services/academics";

export const metadata: Metadata = { title: "Institution structure" };

const iso = (d: Date) => d.toISOString().slice(0, 10);
const UNIT_TYPE = { FACULTY: "Faculty", SCHOOL: "School", CENTRE: "Centre", DIVISION: "Division" } as const;
type Init = Record<string, string | number | boolean | null>;

export default async function StructurePage() {
  const ctx = await requirePageAuth("academic.view");
  const manage = can(ctx, "academic.manage");
  const [campuses, units, departments, programs, regulations, years, semesters] = await Promise.all([
    db.campus.findMany({ where: { deletedAt: null }, orderBy: [{ isMain: "desc" }, { code: "asc" }], include: { _count: { select: { departments: true, units: true } } } }),
    db.academicUnit.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, include: { parent: { select: { code: true } }, campus: { select: { code: true } }, _count: { select: { departments: true, children: true } } } }),
    db.department.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, include: { academicUnit: { select: { code: true } }, campus: { select: { code: true } }, _count: { select: { programs: true, courses: true, members: true } } } }),
    db.program.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" }, include: { department: { select: { code: true } }, _count: { select: { courses: true } } } }),
    db.regulation.findMany({ orderBy: { effectiveFromYear: "desc" }, include: { _count: { select: { courses: true } } } }),
    db.academicYear.findMany({ orderBy: { startDate: "desc" }, include: { _count: { select: { sessions: true } } } }),
    db.semester.findMany({ orderBy: { number: "asc" }, include: { _count: { select: { courses: true } } } }),
  ]);
  const campusOptions = campuses.map((c) => ({ value: c.id, label: `${c.code} — ${c.name}` }));
  const unitOptions = units.map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
  const deptOptions = departments.map((d) => ({ value: d.id, label: `${d.code} — ${d.name}` }));

  const F: Record<StructureKind, FormField[]> = {
    campus: [
      { name: "code", label: "Code", type: "text", upper: true },
      { name: "name", label: "Name", type: "text" },
      { name: "address", label: "Address", type: "textarea", optional: true },
      { name: "isMain", label: "Main campus", type: "checkbox" },
    ],
    academicUnit: [
      { name: "code", label: "Code", type: "text", upper: true },
      { name: "name", label: "Name", type: "text" },
      { name: "type", label: "Type", type: "select", options: Object.entries(UNIT_TYPE).map(([value, label]) => ({ value, label })) },
      { name: "parentId", label: "Part of", type: "select", optional: true, options: unitOptions, hint: "For example, a school inside a faculty." },
      { name: "campusId", label: "Campus", type: "select", optional: true, options: campusOptions },
    ],
    department: [
      { name: "code", label: "Code", type: "text", upper: true },
      { name: "name", label: "Name", type: "text" },
      { name: "academicUnitId", label: "Faculty / school", type: "select", optional: true, options: unitOptions },
      { name: "campusId", label: "Campus", type: "select", optional: true, options: campusOptions },
    ],
    program: [
      { name: "code", label: "Code", type: "text", upper: true },
      { name: "name", label: "Name", type: "text" },
      { name: "departmentId", label: "Department", type: "select", options: deptOptions },
      { name: "level", label: "Level", type: "select", options: [{ value: "UG", label: "Undergraduate" }, { value: "PG", label: "Postgraduate" }, { value: "DIPLOMA", label: "Diploma" }, { value: "DOCTORAL", label: "Doctoral" }] },
      { name: "durationYears", label: "Duration (years)", type: "number", min: 1, max: 8 },
    ],
    regulation: [
      { name: "code", label: "Code", type: "text", upper: true },
      { name: "name", label: "Name", type: "text" },
      { name: "effectiveFromYear", label: "Effective from (year)", type: "number" },
      { name: "description", label: "Description", type: "textarea", optional: true },
    ],
    academicYear: [
      { name: "label", label: "Label (e.g. 2027-28)", type: "text" },
      { name: "startDate", label: "Starts", type: "date" },
      { name: "endDate", label: "Ends", type: "date" },
      { name: "isCurrent", label: "Current academic year", type: "checkbox" },
    ],
    semester: [
      { name: "number", label: "Number", type: "number", min: 1, max: 12 },
      { name: "name", label: "Name", type: "text" },
      { name: "termType", label: "Term", type: "select", options: [{ value: "ODD", label: "Odd" }, { value: "EVEN", label: "Even" }] },
    ],
  };
  const dialog = (kind: StructureKind, title: string, id?: string, initial?: Init) =>
    manage ? <FormDialog title={title} fields={F[kind]} action={saveStructureAction.bind(null, kind)} id={id} initial={initial} /> : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Institution structure"
        description="Campuses, faculties and schools, departments, programmes, regulations, academic years and semesters. Every other module references these records."
      />
      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Campuses" actions={dialog("campus", "Campus")} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Units", className: "text-right" }, { label: "Depts", className: "text-right" }, { label: "" }]}>
            {campuses.map((c) => (
              <tr key={c.id}>
                <Td className="font-mono text-xs">{c.code}</Td>
                <Td>
                  {c.name}
                  {c.isMain && <span className="ml-2 rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">Main</span>}
                  {c.address && <div className="text-[11px] text-muted-foreground">{c.address}</div>}
                </Td>
                <Td className="text-right tabular">{c._count.units}</Td>
                <Td className="text-right tabular">{c._count.departments}</Td>
                <Td className="text-right">{dialog("campus", "Campus", c.id, { code: c.code, name: c.name, address: c.address, isMain: c.isMain })}</Td>
              </tr>
            ))}
          </DataTable>
          {campuses.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No campuses recorded. A single-campus institution can leave this empty.</p>}
        </Section>
        <Section title="Faculties, schools & centres" actions={dialog("academicUnit", "Academic unit")} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Part of" }, { label: "Campus" }, { label: "Depts", className: "text-right" }, { label: "" }]}>
            {units.map((u) => (
              <tr key={u.id}>
                <Td className="font-mono text-xs">{u.code}</Td>
                <Td>
                  {u.name}
                  <div className="text-[11px] text-muted-foreground">{UNIT_TYPE[u.type]}{u._count.children ? ` · ${u._count.children} sub-unit(s)` : ""}</div>
                </Td>
                <Td className="font-mono text-xs">{u.parent?.code ?? "—"}</Td>
                <Td className="font-mono text-xs">{u.campus?.code ?? "—"}</Td>
                <Td className="text-right tabular">{u._count.departments}</Td>
                <Td className="text-right">{dialog("academicUnit", "Academic unit", u.id, { code: u.code, name: u.name, type: u.type, parentId: u.parentId, campusId: u.campusId })}</Td>
              </tr>
            ))}
          </DataTable>
          {units.length === 0 && <p className="px-5 py-4 text-sm text-muted-foreground">No faculties or schools yet. Departments can exist without one.</p>}
        </Section>
        <Section title="Departments" actions={dialog("department", "Department")} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Unit" }, { label: "Programmes", className: "text-right" }, { label: "Courses", className: "text-right" }, { label: "Staff", className: "text-right" }, { label: "" }]}>
            {departments.map((d) => (
              <tr key={d.id} id={d.code}>
                <Td className="font-mono text-xs">{d.code}</Td>
                <Td>{d.name}{d.campus && <div className="text-[11px] text-muted-foreground">{d.campus.code}</div>}</Td>
                <Td className="font-mono text-xs">{d.academicUnit?.code ?? "—"}</Td>
                <Td className="text-right tabular">{d._count.programs}</Td>
                <Td className="text-right tabular">{d._count.courses}</Td>
                <Td className="text-right tabular">{d._count.members}</Td>
                <Td className="text-right">{dialog("department", "Department", d.id, { code: d.code, name: d.name, academicUnitId: d.academicUnitId, campusId: d.campusId })}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <Section title="Programmes" actions={dialog("program", "Programme")} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "Dept" }, { label: "Level" }, { label: "Courses", className: "text-right" }, { label: "" }]}>
            {programs.map((p) => (
              <tr key={p.id}>
                <Td className="font-mono text-xs">{p.code}</Td>
                <Td>{p.name}<div className="text-[11px] text-muted-foreground">{p.durationYears} years</div></Td>
                <Td className="text-xs">{p.department.code}</Td>
                <Td className="text-xs">{p.level}</Td>
                <Td className="text-right tabular">{p._count.courses}</Td>
                <Td className="text-right">{dialog("program", "Programme", p.id, { code: p.code, name: p.name, departmentId: p.departmentId, level: p.level, durationYears: p.durationYears })}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <Section title="Regulations" actions={dialog("regulation", "Regulation")} bodyClassName="p-0">
          <DataTable head={[{ label: "Code" }, { label: "Name" }, { label: "From", className: "text-right" }, { label: "Courses", className: "text-right" }, { label: "" }]}>
            {regulations.map((r) => (
              <tr key={r.id}>
                <Td className="font-mono text-xs">{r.code}</Td>
                <Td>{r.name}</Td>
                <Td className="text-right tabular">{r.effectiveFromYear}</Td>
                <Td className="text-right tabular">{r._count.courses}</Td>
                <Td className="text-right">{dialog("regulation", "Regulation", r.id, { code: r.code, name: r.name, effectiveFromYear: r.effectiveFromYear, description: r.description })}</Td>
              </tr>
            ))}
          </DataTable>
        </Section>
        <div className="space-y-6">
          <Section title="Academic years" actions={dialog("academicYear", "Academic year")} bodyClassName="p-0">
            <DataTable head={[{ label: "Year" }, { label: "Period" }, { label: "Sessions", className: "text-right" }, { label: "" }]}>
              {years.map((y) => (
                <tr key={y.id}>
                  <Td className="font-medium">{y.label}{y.isCurrent && <span className="ml-2 rounded-full bg-primary/10 px-2 text-[11px] font-semibold text-primary">Current</span>}</Td>
                  <Td className="text-xs">{fmtDate(y.startDate)} – {fmtDate(y.endDate)}</Td>
                  <Td className="text-right tabular">{y._count.sessions}</Td>
                  <Td className="text-right">{dialog("academicYear", "Academic year", y.id, { label: y.label, startDate: iso(y.startDate), endDate: iso(y.endDate), isCurrent: y.isCurrent })}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
          <Section title="Semesters" actions={dialog("semester", "Semester")} bodyClassName="p-0">
            <DataTable head={[{ label: "No." }, { label: "Name" }, { label: "Term" }, { label: "Courses", className: "text-right" }, { label: "" }]}>
              {semesters.map((s) => (
                <tr key={s.id}>
                  <Td className="tabular">{s.number}</Td>
                  <Td>{s.name}</Td>
                  <Td className="text-xs">{s.termType === "ODD" ? "Odd" : "Even"}</Td>
                  <Td className="text-right tabular">{s._count.courses}</Td>
                  <Td className="text-right">{dialog("semester", "Semester", s.id, { number: s.number, name: s.name, termType: s.termType })}</Td>
                </tr>
              ))}
            </DataTable>
          </Section>
        </div>
      </div>
    </div>
  );
}
