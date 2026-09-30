import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page";
import { ImportWizard } from "@/features/students/import-wizard";
import { requirePageAuth } from "@/server/auth/current";
import { IMPORT_COLUMNS } from "@/server/services/student-import";

export const metadata: Metadata = { title: "Import students" };

export default async function ImportStudentsPage() {
  await requirePageAuth("student.create");
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Import students"
        description="Bulk-create student records from a CSV file. Every row is validated before anything is written, and the import runs in the background as a single transaction."
        breadcrumbs={[{ label: "Students", href: "/students" }, { label: "Import" }]}
      />
      <ImportWizard columns={IMPORT_COLUMNS} />
    </div>
  );
}
