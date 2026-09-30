import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { FormDialog } from "@/components/app/form-dialog";
import { DataTable, Td } from "@/components/app/list";
import { KeyValue, PageHeader, Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { saveAlumniProfileAction } from "@/features/campus/actions";
import { DOC_TYPES, DocumentUpload } from "@/features/campus/controls";
import { DOCUMENT_STATUS } from "@/features/campus/labels";
import { fmtDate } from "@/lib/format";
import { requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { signedAssetUrl } from "@/server/storage";

export const metadata: Metadata = { title: "Campus services" };

/** A student's hostel, transport, library and documents in one place (and the alumni profile after graduation). */
export default async function StudentServicesPage() {
  const ctx = await requirePageAuth("self.portal");
  const studentId = ctx.subject.studentId;
  if (!studentId) redirect("/portal");
  const now = new Date();
  const [student, bed, passes, loans, docs, alumni] = await Promise.all([
    db.student.findUniqueOrThrow({ where: { id: studentId }, select: { status: true, email: true } }),
    db.hostelAllocation.findFirst({ where: { studentId, vacatedAt: null }, include: { room: { include: { hostel: { include: { warden: { select: { name: true, phone: true } } } } } } } }),
    db.transportPass.findMany({ where: { studentId, cancelledAt: null, validTo: { gte: now } }, include: { route: true } }),
    db.libraryLoan.count({ where: { studentId, returnedAt: null } }),
    db.studentDocument.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, include: { file: { select: { id: true, originalName: true } } } }),
    db.alumniProfile.findUnique({ where: { studentId } }),
  ]);
  const graduate = student.status === "GRADUATED";
  return (
    <div className="space-y-6">
      <PageHeader title="Campus services" breadcrumbs={[{ label: "My studies" }, { label: "Services" }]} actions={<Button asChild size="sm" variant="outline"><Link href="/helpdesk">Need help? Raise a ticket</Link></Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Hostel">
          {bed ? <KeyValue items={[["Hostel", bed.room.hostel.name], ["Room", bed.room.number], ["Since", fmtDate(bed.fromDate)], ["Warden", bed.room.hostel.warden ? `${bed.room.hostel.warden.name}${bed.room.hostel.warden.phone ? ` · ${bed.room.hostel.warden.phone}` : ""}` : "—"]]} /> : <p className="text-sm text-muted-foreground">No hostel room. Contact the warden&apos;s office to apply.</p>}
        </Section>
        <Section title="Transport">
          {passes.length ? passes.map((p) => {
            const stop = (p.route.stops as { name: string; time: string | null }[]).find((s) => s.name === p.stop);
            return <KeyValue key={p.id} items={[["Route", `${p.route.code} — ${p.route.name}`], ["Boarding stop", `${p.stop}${stop?.time ? ` at ${stop.time}` : ""}`], ["Valid", `${fmtDate(p.validFrom)} – ${fmtDate(p.validTo)}`], ["Vehicle", p.route.vehicle ?? "—"]]} />;
          }) : <p className="text-sm text-muted-foreground">No transport pass.</p>}
        </Section>
      </div>
      <Section title="Library" actions={<Button asChild size="xs" variant="outline"><Link href="/library/my">My loans</Link></Button>}><p className="text-sm">{loans} item(s) on loan. <Link className="text-primary hover:underline" href="/library">Search the catalogue</Link>.</p></Section>
      <Section title="My documents" description="Upload clear scans (PDF or photo). The office verifies them against the originals." bodyClassName="p-0">
        <div className="border-b px-5 py-3"><DocumentUpload studentId={studentId} /></div>
        <DataTable head={[{ label: "Document" }, { label: "File" }, { label: "Uploaded" }, { label: "Status" }]} empty="No documents uploaded.">
          {docs.map((d) => (
            <tr key={d.id}>
              <Td className="text-sm">{DOC_TYPES[d.type] ?? d.type}</Td>
              <Td className="text-xs"><a className="text-primary hover:underline" href={signedAssetUrl(d.file.id, 600, "attachment")}>{d.file.originalName}</a></Td>
              <Td className="text-xs">{fmtDate(d.createdAt)}</Td>
              <Td><StatusBadge meta={DOCUMENT_STATUS[d.status]} />{d.note && <div className="text-[11px] text-muted-foreground">{d.note}</div>}</Td>
            </tr>
          ))}
        </DataTable>
      </Section>
      {graduate && (
        <Section title="Alumni profile" description="Stay in touch. Share only what you want; you choose whether other alumni can see you in the directory." actions={
          <FormDialog title="Alumni profile" columns={2} action={saveAlumniProfileAction} trigger={<Button size="xs">{alumni ? "Update" : "Create"} profile</Button>}
            initial={{ email: alumni?.email ?? student.email, phone: alumni?.phone ?? null, employer: alumni?.employer ?? null, designation: alumni?.designation ?? null, city: alumni?.city ?? null, higherStudies: alumni?.higherStudies ?? null, linkedin: alumni?.linkedin ?? null, inDirectory: alumni?.inDirectory ?? false }}
            fields={[{ name: "email", label: "E-mail", type: "email" }, { name: "phone", label: "Phone", type: "text", optional: true }, { name: "employer", label: "Employer", type: "text", optional: true }, { name: "designation", label: "Designation", type: "text", optional: true }, { name: "city", label: "City", type: "text", optional: true }, { name: "higherStudies", label: "Higher studies", type: "text", optional: true }, { name: "linkedin", label: "LinkedIn URL", type: "text", optional: true, wide: true }, { name: "inDirectory", label: "List me in the alumni directory", type: "checkbox", wide: true }]} />
        }>
          {alumni ? <KeyValue items={[["Employer", alumni.employer ?? "—"], ["Designation", alumni.designation ?? "—"], ["City", alumni.city ?? "—"], ["Directory", alumni.inDirectory ? "Listed" : "Not listed"]]} /> : <p className="text-sm text-muted-foreground">Create your alumni profile.</p>}
        </Section>
      )}
    </div>
  );
}
