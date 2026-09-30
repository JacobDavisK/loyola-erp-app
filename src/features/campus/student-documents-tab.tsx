import { DataTable, Td } from "@/components/app/list";
import { Section } from "@/components/app/page";
import { StatusBadge } from "@/components/app/status-badge";
import { DOC_TYPES, DocumentUpload, VerifyDocumentButtons } from "@/features/campus/controls";
import { DOCUMENT_STATUS } from "@/features/campus/labels";
import { fmtDate } from "@/lib/format";
import { db } from "@/server/db";
import { signedAssetUrl } from "@/server/storage";

/** Student record → Documents. The caller has already checked access to the student. */
export async function StudentDocumentsTab({ studentId, canUpload, canVerify }: { studentId: string; canUpload: boolean; canVerify: boolean }) {
  const docs = await db.studentDocument.findMany({ where: { studentId }, orderBy: { createdAt: "desc" }, include: { file: { select: { id: true, originalName: true, size: true } } } });
  const people = await db.user.findMany({ where: { id: { in: docs.flatMap((d) => [d.uploadedById, d.verifiedById].filter((x): x is string => !!x)) } }, select: { id: true, name: true } });
  const name = (id: string | null) => people.find((p) => p.id === id)?.name ?? "—";
  return (
    <Section title="Documents" description="Stored encrypted. The person who uploaded a document cannot verify it." bodyClassName="p-0">
      {canUpload && <div className="border-b px-5 py-3"><DocumentUpload studentId={studentId} /></div>}
      <DataTable head={[{ label: "Document" }, { label: "File" }, { label: "Uploaded" }, { label: "Status" }, { label: "" }]} empty="No documents.">
        {docs.map((d) => (
          <tr key={d.id}>
            <Td className="text-sm">{DOC_TYPES[d.type] ?? d.type}</Td>
            <Td className="text-xs"><a className="text-primary hover:underline" href={signedAssetUrl(d.file.id, 600, "inline")} target="_blank" rel="noopener">{d.file.originalName}</a> <span className="text-muted-foreground">{Math.ceil(d.file.size / 1024)} KB</span></Td>
            <Td className="text-xs">{fmtDate(d.createdAt)} · {name(d.uploadedById)}</Td>
            <Td><StatusBadge meta={DOCUMENT_STATUS[d.status]} />{d.verifiedById && <div className="text-[11px] text-muted-foreground">{name(d.verifiedById)}{d.note ? ` — ${d.note}` : ""}</div>}</Td>
            <Td className="text-right">{canVerify && d.status === "PENDING" && <VerifyDocumentButtons id={d.id} />}</Td>
          </tr>
        ))}
      </DataTable>
    </Section>
  );
}
