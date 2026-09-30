import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { StudentForm } from "@/features/students/student-form";
import { requirePageAuth, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";

export const metadata: Metadata = { title: "New student" };

export default async function NewStudentPage() {
  const ctx = await requirePageAuth("student.create");
  const scope = scopeOf(ctx, "student.create");
  const deptFilter = scope === null ? {} : { departmentId: { in: scope } };
  const [programs, batches] = await Promise.all([
    db.program.findMany({ where: { deletedAt: null, ...deptFilter }, orderBy: { code: "asc" } }),
    db.batch.findMany({ where: { deletedAt: null, program: deptFilter }, orderBy: [{ admissionYear: "desc" }, { code: "asc" }] }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div>
      <PageHeader title="New student" description="The student number is generated from the configured format when the record is saved." breadcrumbs={[{ label: "Students", href: "/students" }, { label: "New" }]} />
      <StudentForm
        id={null}
        programs={programs.map((p) => ({ id: p.id, label: `${p.code} — ${p.name}` }))}
        batches={batches.map((b) => ({ id: b.id, label: b.code, programId: b.programId }))}
        initial={{
          firstName: "", lastName: "", email: "", phone: "", dateOfBirth: "", gender: "", nationality: "", category: "", bloodGroup: "", programId: "", batchId: "",
          section: "", specialization: "", currentSemester: 1, admissionNo: "", registrationNo: "", admittedOn: today, line1: "", line2: "", city: "", state: "",
          postalCode: "", country: "", emergencyName: "", emergencyRelation: "", emergencyPhone: "",
        }}
      />
    </div>
  );
}
