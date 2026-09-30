import "server-only";
import { z } from "zod";
import { parseCsvObjects } from "@/lib/domain/csv";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { defineJob, enqueueJob } from "@/server/services/jobs";
import { notify } from "@/server/services/notifications";
import { insertStudent, studentSchema } from "@/server/services/students";

export const IMPORT_COLUMNS = [
  "first_name", "last_name", "email", "phone", "date_of_birth", "gender", "program_code", "batch_code", "section", "semester",
  "admission_no", "registration_no", "admitted_on", "category", "nationality", "guardian_name", "guardian_relation", "guardian_phone", "guardian_email",
] as const;
const REQUIRED = ["first_name", "last_name", "email", "program_code", "batch_code", "admitted_on"] as const;
const MAX_ROWS = 5000;
const GENDERS = new Set(["FEMALE", "MALE", "OTHER", "UNDISCLOSED"]);
const RELATIONS = new Set(["FATHER", "MOTHER", "GUARDIAN", "SPOUSE", "SIBLING", "OTHER"]);

export interface ImportGuardian {
  name: string;
  relation: string;
  phone: string | null;
  email: string | null;
}

export interface ImportRow {
  line: number;
  name: string;
  program: string;
  batch: string;
  errors: string[];
  warnings: string[];
  input?: z.input<typeof studentSchema> & { guardian?: ImportGuardian };
}

export interface ImportPreview {
  total: number;
  valid: number;
  missingColumns: string[];
  unknownColumns: string[];
  rows: ImportRow[];
}

/** Validate an import file without writing anything. Every row is checked; nothing is partially applied. */
export async function previewStudentImport(ctx: AuthContext, text: string): Promise<ImportPreview> {
  if (!can(ctx, "student.create")) throw forbidden();
  if (text.length > 5_000_000) throw invalid("The file is larger than 5 MB.");
  const { headers, rows } = parseCsvObjects(text);
  if (rows.length > MAX_ROWS) throw invalid(`At most ${MAX_ROWS} rows can be imported at once.`);
  const missingColumns = REQUIRED.filter((c) => !headers.includes(c));
  const unknownColumns = headers.filter((h) => !(IMPORT_COLUMNS as readonly string[]).includes(h));
  if (missingColumns.length) return { total: rows.length, valid: 0, missingColumns, unknownColumns, rows: [] };

  const [programs, batches] = await Promise.all([
    db.program.findMany({ where: { deletedAt: null }, select: { id: true, code: true, departmentId: true } }),
    db.batch.findMany({ where: { deletedAt: null }, select: { id: true, code: true, programId: true } }),
  ]);
  const emails = rows.map((r) => r.email?.toLowerCase()).filter(Boolean);
  const admissionNos = rows.map((r) => r.admission_no).filter(Boolean);
  const regNos = rows.map((r) => r.registration_no).filter(Boolean);
  const [existingEmails, existingAdm, existingReg] = await Promise.all([
    db.student.findMany({ where: { email: { in: emails }, deletedAt: null }, select: { email: true } }),
    db.student.findMany({ where: { admissionNo: { in: admissionNos } }, select: { admissionNo: true } }),
    db.student.findMany({ where: { registrationNo: { in: regNos } }, select: { registrationNo: true } }),
  ]);
  const takenEmail = new Set(existingEmails.map((x) => x.email));
  const takenAdm = new Set(existingAdm.map((x) => x.admissionNo));
  const takenReg = new Set(existingReg.map((x) => x.registrationNo));
  const seen = { email: new Map<string, number>(), adm: new Map<string, number>(), reg: new Map<string, number>() };

  const out: ImportRow[] = rows.map((r, i) => {
    const line = i + 2; // header is line 1
    const errors: string[] = [];
    const warnings: string[] = [];
    const program = programs.find((p) => p.code === r.program_code?.toUpperCase());
    const batch = batches.find((b) => b.code === r.batch_code?.toUpperCase());
    if (!program) errors.push(`Unknown programme "${r.program_code}"`);
    if (!batch) errors.push(`Unknown batch "${r.batch_code}"`);
    else if (program && batch.programId !== program.id) errors.push(`Batch ${batch.code} does not belong to ${program.code}`);
    if (program && !can(ctx, "student.create", program.departmentId)) errors.push(`You cannot create students in ${program.code}'s department`);
    const gender = r.gender?.toUpperCase();
    if (gender && !GENDERS.has(gender)) errors.push(`Gender must be one of ${[...GENDERS].join(", ")}`);
    const email = r.email?.toLowerCase();
    for (const [key, value, taken, label] of [["email", email, takenEmail, "e-mail"], ["adm", r.admission_no, takenAdm, "admission number"], ["reg", r.registration_no, takenReg, "registration number"]] as const) {
      if (!value) continue;
      if (taken.has(value)) (key === "email" ? warnings : errors).push(`A student with this ${label} already exists`);
      const first = seen[key].get(value);
      if (first) errors.push(`Duplicate ${label} (also on line ${first})`);
      else seen[key].set(value, line);
    }
    const input = {
      firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone || null, dateOfBirth: r.date_of_birth || null,
      gender: gender || null, programId: program?.id ?? "", batchId: batch?.id ?? "", section: r.section || null,
      currentSemester: r.semester ? Number(r.semester) : 1, admissionNo: r.admission_no || null, registrationNo: r.registration_no || null,
      admittedOn: r.admitted_on, category: r.category || null, nationality: r.nationality || null,
    };
    const parsed = studentSchema.safeParse(input);
    if (!parsed.success) for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
    let guardian: ImportGuardian | undefined;
    if (r.guardian_name) {
      const relation = (r.guardian_relation || "GUARDIAN").toUpperCase();
      if (!RELATIONS.has(relation)) errors.push(`Guardian relation must be one of ${[...RELATIONS].join(", ")}`);
      guardian = { name: r.guardian_name, relation, phone: r.guardian_phone || null, email: r.guardian_email || null };
    }
    return { line, name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim(), program: program?.code ?? r.program_code ?? "", batch: batch?.code ?? r.batch_code ?? "", errors, warnings, input: errors.length ? undefined : { ...input, guardian } as ImportRow["input"] };
  });
  return { total: rows.length, valid: out.filter((r) => !r.errors.length).length, missingColumns, unknownColumns, rows: out };
}

/**
 * Queue the import. The file is re-validated here (never trust a client-side preview) and must be
 * error-free. The worker inserts every row in ONE transaction: any failure rolls back the whole file.
 */
export async function commitStudentImport(ctx: AuthContext, text: string, fileName: string) {
  const preview = await previewStudentImport(ctx, text);
  if (preview.missingColumns.length) throw invalid(`Missing required column(s): ${preview.missingColumns.join(", ")}`);
  const bad = preview.rows.filter((r) => r.errors.length);
  if (bad.length) throw invalid(`${bad.length} row(s) have errors. Fix them and upload the file again — nothing was imported.`);
  if (!preview.rows.length) throw invalid("The file has no data rows.");
  const job = await enqueueJob(db, {
    type: "students.import",
    createdById: ctx.user.id,
    maxAttempts: 1,
    payload: { fileName, actor: { id: ctx.user.id, name: ctx.user.name }, rows: preview.rows.map((r) => ({ line: r.line, input: r.input })) },
  });
  await audit({ actorId: ctx.user.id, actorName: ctx.user.name, action: "student.import.queued", resourceType: "job", resourceId: job.id, summary: `${preview.rows.length} student(s) from ${fileName}` });
  return job;
}

type JobRow = { line: number; input: NonNullable<ImportRow["input"]> };

defineJob("students.import", async (payload, job) => {
  const { rows, actor, fileName } = payload as { rows: JobRow[]; actor: { id: string; name: string }; fileName: string };
  const created: string[] = [];
  await db.$transaction(
    async (tx) => {
      for (const [i, r] of rows.entries()) {
        const { guardian, ...input } = r.input;
        try {
          const s = await insertStudent(tx, actor, studentSchema.parse(input));
          if (guardian) await tx.guardian.create({ data: { studentId: s.id, name: guardian.name, relation: guardian.relation as never, phone: guardian.phone, email: guardian.email, isPrimary: true } });
          created.push(s.studentNo);
        } catch (e) {
          throw new Error(`Line ${r.line}: ${e instanceof Error ? e.message : String(e)} — the whole file was rolled back; nothing was imported.`);
        }
        if (i % 100 === 99) await job.progress(((i + 1) / rows.length) * 100);
      }
      await audit({ actorId: actor.id, actorName: actor.name, action: "student.import", resourceType: "job", resourceId: job.jobId, summary: `${created.length} student(s) imported from ${fileName}`, newValue: { first: created[0], last: created.at(-1) } }, tx);
    },
    { timeout: 30 * 60_000, maxWait: 60_000 },
  );
  await notify({ userIds: [actor.id], type: "import.done", title: `Student import finished: ${created.length} created`, body: fileName, link: "/students?sort=-admitted", email: false });
  return { created: created.length, first: created[0], last: created.at(-1) };
});
