import "server-only";
import { z } from "zod";
import { loadStudentFor } from "@/server/auth/access";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { notify } from "@/server/services/notifications";
import { saveFile } from "@/server/storage";

/**
 * Documents a student submits (mark sheets, transfer certificate, identity and category proofs). Students
 * upload their own from the portal; the office uploads on their behalf; holders of document.verify for the
 * student's department verify or reject them. Files are stored encrypted and never edited in place.
 */

export const DOCUMENT_TYPES = {
  MARKSHEET_10: "Class X mark sheet",
  MARKSHEET_12: "Class XII / qualifying mark sheet",
  TRANSFER_CERTIFICATE: "Transfer certificate",
  MIGRATION_CERTIFICATE: "Migration certificate",
  ID_PROOF: "Identity proof",
  CATEGORY_CERTIFICATE: "Category / community certificate",
  INCOME_CERTIFICATE: "Income certificate",
  PHOTO: "Photograph",
  OTHER: "Other",
} as const;

async function canUploadFor(ctx: AuthContext, studentId: string) {
  if (ctx.subject.studentId === studentId) return true;
  const s = await loadStudentFor(ctx, studentId).catch(() => null);
  return !!s && can(ctx, "student.update", s.departmentId);
}

export async function uploadDocument(ctx: AuthContext, studentId: string, form: FormData) {
  if (!(await canUploadFor(ctx, studentId))) throw notFound("Student");
  const type = String(form.get("type") ?? "");
  if (!(type in DOCUMENT_TYPES)) throw invalid("Choose the document type.");
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw invalid("Choose a file (PDF or image, up to 5 MB).");
  const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: file.name, kind: "STUDENT_DOCUMENT", ownerId: ctx.user.id });
  const d = await db.studentDocument.create({ data: { studentId, type, fileId: asset.id, uploadedById: ctx.user.id } });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "student.document.upload", resourceType: "student", resourceId: studentId, summary: `${DOCUMENT_TYPES[type as keyof typeof DOCUMENT_TYPES]}: ${asset.originalName}` });
  return d;
}

export async function verifyDocument(ctx: AuthContext, id: string, raw: unknown) {
  const v = z.object({ status: z.enum(["VERIFIED", "REJECTED"]), note: z.string().trim().max(500).nullable().optional() }).parse(raw);
  const d = await db.studentDocument.findUnique({ where: { id }, include: { student: { select: { id: true, departmentId: true, userId: true, studentNo: true } } } });
  if (!d) throw notFound("Document");
  if (!can(ctx, "document.verify", d.student.departmentId)) throw forbidden();
  if (d.uploadedById === ctx.user.id && v.status === "VERIFIED") throw forbidden("A document cannot be verified by the person who uploaded it.");
  if (d.status !== "PENDING") throw workflowError("This document has already been reviewed.");
  if (v.status === "REJECTED" && (v.note ?? "").length < 5) throw invalid("Say why the document was rejected.");
  await db.studentDocument.update({ where: { id }, data: { status: v.status, note: v.note || null, verifiedById: ctx.user.id, verifiedAt: new Date() } });
  if (v.status === "REJECTED" && d.student.userId) await notify({ userIds: [d.student.userId], type: "document.rejected", title: `${DOCUMENT_TYPES[d.type as keyof typeof DOCUMENT_TYPES] ?? d.type} was not accepted`, body: v.note ?? undefined, link: "/portal/services" });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: `student.document.${v.status.toLowerCase()}`, resourceType: "student", resourceId: d.studentId, summary: `${d.student.studentNo} ${d.type}${v.note ? `: ${v.note}` : ""}` });
}
