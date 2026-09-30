import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StudentForm } from "@/features/students/student-form";
import { loadStudentFor } from "@/server/auth/access";
import { can, requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "Edit student" };

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function EditStudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requirePageAuth("student.update");
  const s = await loadStudentFor(ctx, id).catch(() => null);
  if (!s || !can(ctx, "student.update", s.departmentId)) notFound();
  const scope = scopeOf(ctx, "student.update");
  const deptFilter = scope === null ? {} : { departmentId: { in: scope } };
  const [programs, batches] = await Promise.all([
    db.program.findMany({ where: { deletedAt: null, ...deptFilter }, orderBy: { code: "asc" } }),
    db.batch.findMany({ where: { deletedAt: null, program: deptFilter }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }] }),
  ]);
  const a = (s.address ?? {}) as Record<string, string | null>;
  const e = (s.emergencyContact ?? {}) as Record<string, string | null>;
  return (
    <div>
      <PageHeader title={`Edit ${s.firstName} ${s.lastName}`} breadcrumbs={[{ label: "Students", href: "/students" }, { label: s.studentNo, href: `/students/${id}` }, { label: "Edit" }]} description="Every change is recorded in the student's history with the previous value." />
      <StudentForm
        id={id}
        programs={programs.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
        batches={batches.map((b) => ({ id: b.id, label: b.code, programId: b.programId }))}
        initial={{
          firstName: s.firstName, lastName: s.lastName, email: s.email, phone: s.phone ?? "", dateOfBirth: iso(s.dateOfBirth), gender: s.gender ?? "", nationality: s.nationality ?? "",
          category: s.category ?? "", bloodGroup: s.bloodGroup ?? "", programId: s.programId, batchId: s.batchId, section: s.section ?? "", specialization: s.specialization ?? "",
          currentSemester: s.currentSemester, admissionNo: s.admissionNo, registrationNo: s.registrationNo ?? "", admittedOn: iso(s.admittedOn),
          line1: a.line1 ?? "", line2: a.line2 ?? "", city: a.city ?? "", state: a.state ?? "", postalCode: a.postalCode ?? "", country: a.country ?? "",
          emergencyName: e.name ?? "", emergencyRelation: e.relation ?? "", emergencyPhone: e.phone ?? "",
        }}
      />
    </div>
  );
}
