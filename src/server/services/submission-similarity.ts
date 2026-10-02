import "server-only";
import { inflateSync } from "node:zlib";
import JSZip from "jszip";
import type { Prisma } from "@/generated/prisma/client";
import { similarityPairs } from "@/lib/domain/teaching";
import { type AuthContext } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, notFound } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { courseSpace } from "@/server/services/lms";
import { storage } from "@/server/storage";

/**
 * Similarity checking for assignment submissions. The text typed into a submission and the text of
 * attached files (plain text, Word .docx, and PDFs with a text layer) is compared between every pair of
 * submissions of the assignment using overlapping five-word sequences. Pairs above the threshold are
 * listed with a sample of the shared wording for the teacher to judge — a high score is a prompt to
 * look, not a finding of misconduct. Scanned PDFs and images have no text and are listed as unreadable.
 * AI-writing detectors are not used: they are unreliable and unfair to students.
 */

const MIN_TEXT = 80;

function decodePdfString(s: string): string {
  return s.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_, c: string) => (/^[0-7]+$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : ({ n: "\n", r: "\r", t: "\t", b: "", f: "" } as Record<string, string>)[c] ?? c));
}

/** Best-effort text from a PDF's content streams (Tj / TJ operators); fonts with custom encodings yield little. */
export function pdfText(buf: Buffer): string {
  const raw = buf.toString("latin1");
  const parts: string[] = [];
  const re = /stream\r?\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const start = m.index + m[0].length;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    const header = raw.slice(Math.max(0, m.index - 300), m.index);
    let body = buf.subarray(start, end);
    if (/\/FlateDecode/.test(header)) {
      try {
        body = inflateSync(body);
      } catch {
        continue;
      }
    } else if (/\/Filter/.test(header)) continue;
    const text = body.toString("latin1");
    for (const t of text.matchAll(/\[((?:[^\]\\]|\\.)*)\]\s*TJ|\(((?:[^()\\]|\\.)*)\)\s*(?:Tj|'|")/g)) {
      if (t[1] !== undefined) parts.push([...t[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((x) => decodePdfString(x[1])).join(""));
      else parts.push(decodePdfString(t[2]));
      parts.push(" ");
    }
    re.lastIndex = end;
  }
  return parts.join("").replace(/\s+/g, " ").trim();
}

async function docxText(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file("word/document.xml")?.async("string");
  if (!xml) return "";
  return xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

export async function extractText(asset: { storageKey: string; mimeType: string }): Promise<string> {
  const buf = await storage.get(asset.storageKey);
  if (asset.mimeType.startsWith("text/")) return buf.toString("utf8");
  if (asset.mimeType === "application/pdf") return pdfText(buf);
  if (asset.mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return docxText(buf);
  return "";
}

export async function checkAssignmentSimilarity(ctx: AuthContext, assignmentId: string, threshold = 30) {
  const a = await db.assignment.findUnique({ where: { id: assignmentId } });
  if (!a) throw notFound("Assignment");
  const s = await courseSpace(ctx, a.offeringId);
  if (s.role !== "teacher" && s.role !== "manager") throw forbidden();
  // The latest submission of each student.
  const subs = await db.submission.findMany({ where: { assignmentId }, orderBy: [{ studentId: "asc" }, { attempt: "desc" }], distinct: ["studentId"], include: { files: { include: { file: { select: { storageKey: true, mimeType: true, originalName: true } } } } } });
  const docs: { id: string; text: string }[] = [];
  const unreadable: { submissionId: string; files: string[] }[] = [];
  for (const sub of subs) {
    const texts = [sub.text ?? ""];
    const unread: string[] = [];
    for (const f of sub.files) {
      const t = await extractText(f.file).catch(() => "");
      if (t.trim().length < MIN_TEXT) unread.push(f.file.originalName);
      texts.push(t);
    }
    const text = texts.join("\n").trim();
    if (text.length >= MIN_TEXT) docs.push({ id: sub.id, text });
    else if (unread.length || !text) unreadable.push({ submissionId: sub.id, files: unread });
  }
  const pairs = similarityPairs(docs, threshold);
  const report = await db.similarityReport.create({
    data: { assignmentId, computedById: ctx.user.id, threshold, pairs: pairs.map((p) => ({ submissionA: p.a, submissionB: p.b, score: p.score, shared: p.shared, sample: p.sample })) as unknown as Prisma.InputJsonValue, unreadable: unreadable as unknown as Prisma.InputJsonValue },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "lms.similarity", resourceType: "assignment", resourceId: assignmentId, summary: `${a.title}: ${docs.length} compared, ${pairs.length} pair(s) ≥ ${threshold}%` });
  return { report, compared: docs.length };
}

export async function latestSimilarity(assignmentId: string) {
  const r = await db.similarityReport.findFirst({ where: { assignmentId }, orderBy: { computedAt: "desc" } });
  if (!r) return null;
  const pairs = r.pairs as { submissionA: string; submissionB: string; score: number; shared: number; sample: string | null }[];
  const ids = [...new Set(pairs.flatMap((p) => [p.submissionA, p.submissionB]).concat((r.unreadable as { submissionId: string }[]).map((u) => u.submissionId)))];
  const subs = await db.submission.findMany({ where: { id: { in: ids } }, select: { id: true, student: { select: { studentNo: true, firstName: true, lastName: true } } } });
  const who = (id: string) => { const s = subs.find((x) => x.id === id)?.student; return s ? `${s.firstName} ${s.lastName} (${s.studentNo})` : id; };
  return { report: r, pairs: pairs.map((p) => ({ ...p, a: who(p.submissionA), b: who(p.submissionB) })), unreadable: (r.unreadable as { submissionId: string; files: string[] }[]).map((u) => ({ ...u, who: who(u.submissionId) })) };
}
