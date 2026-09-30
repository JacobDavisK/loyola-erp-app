import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { Prisma } from "@/generated/prisma/client";
import { DataTable, SearchForm, Td } from "@/components/app/list";
import { PageHeader, Section } from "@/components/app/page";
import { can, requirePageAuth } from "@/server/auth/current";
import { db } from "@/server/db";
import { alumniWhere, invalidIfNotGraduate } from "@/server/services/placements";

export const metadata: Metadata = { title: "Alumni" };

export default async function AlumniPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requirePageAuth();
  // The directory is for staff with alumni.view and for graduates; everyone else gets a 404.
  if (!(await invalidIfNotGraduate(ctx).then(() => true, () => false))) notFound();
  const { q } = await searchParams;
  const staff = can(ctx, "alumni.view");
  const and: Prisma.AlumniProfileWhereInput[] = [alumniWhere(ctx)];
  if (q) and.push({ OR: [{ employer: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }, { student: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } }] });
  const [rows, total, graduates] = await Promise.all([
    db.alumniProfile.findMany({ where: { AND: and }, orderBy: { updatedAt: "desc" }, take: 200, include: { student: { select: { studentNo: true, firstName: true, lastName: true, program: { select: { code: true } }, batch: { select: { admissionYear: true } } } } } }),
    db.alumniProfile.count({ where: { AND: and } }),
    staff ? db.student.count({ where: { status: "GRADUATED" } }) : 0,
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Alumni" description={staff ? `${total} profile(s) from ${graduates} graduate(s). Contact details are shown to staff; other alumni see only people who opted into the directory.` : "Graduates who chose to be listed in the directory."} />
      <div className="flex justify-end"><SearchForm defaultValue={q} placeholder="Name, employer or city" /></div>
      <Section title="Directory" bodyClassName="p-0">
        <DataTable head={[{ label: "Name" }, { label: "Programme" }, { label: "Employer" }, { label: "City" }, ...(staff ? [{ label: "Contact" }] : [])]} empty="No alumni profiles yet.">
          {rows.map((a) => (
            <tr key={a.id}>
              <Td>{a.student.firstName} {a.student.lastName}<div className="text-[11px] text-muted-foreground">{staff ? `${a.student.studentNo} · ` : ""}batch of {a.student.batch.admissionYear}</div></Td>
              <Td className="text-xs">{a.student.program.code}</Td>
              <Td className="text-xs">{[a.designation, a.employer].filter(Boolean).join(", ") || a.higherStudies || "—"}</Td>
              <Td className="text-xs">{a.city ?? "—"}</Td>
              {staff && <Td className="text-xs">{a.email}{a.phone ? ` · ${a.phone}` : ""}</Td>}
            </tr>
          ))}
        </DataTable>
      </Section>
    </div>
  );
}
