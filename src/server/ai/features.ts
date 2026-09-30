import "server-only";
import { z } from "zod";
import { definitionSchema, validateDefinition, type Definition } from "@/lib/domain/report";
import { type AuthContext, can } from "@/server/auth/current";
import { AppError, forbidden } from "@/server/errors";
import { extractJson, runAi } from "@/server/ai/gateway";
import { datasetsFor, fieldMeta } from "@/server/reports/engine";

/**
 * AI features. Each one is advisory: the output is shown to the user for review and nothing is saved or
 * executed on the model's say-so. The report assistant produces a definition that is validated and then run
 * by the normal, permission-checked report engine — the model never sees any records.
 */

export async function reportFromQuestion(ctx: AuthContext, question: string): Promise<Definition> {
  const q = String(question ?? "").trim();
  if (q.length < 5) throw new AppError("Ask a question, e.g. “fee balance by programme for overdue invoices”.", "VALIDATION", 422);
  const datasets = datasetsFor(ctx);
  if (!datasets.length) throw forbidden("You have no datasets to report on.");
  const catalogue = datasets.map((d) => ({ dataset: d.key, description: d.description, fields: fieldMeta(d).map((f) => ({ key: f.key, label: f.label, type: f.type, ...(f.options ? { options: f.options } : {}) })) }));
  const system = [
    "You translate a university administrator's question into a report definition for a report builder.",
    "Reply with ONE JSON object only, no prose, matching:",
    '{"dataset": string, "columns": string[], "filters": [{"field": string, "op": "eq"|"neq"|"contains"|"gt"|"gte"|"lt"|"lte"|"in"|"empty"|"notEmpty", "value"?: string|number|boolean|string[]}], "groupBy": string[] (max 2), "aggregates": [{"field": string, "fn": "count"|"sum"|"avg"|"min"|"max"}], "sort": {"field": string, "dir": "asc"|"desc"} | null, "limit": number}',
    "Rules: use only datasets and field keys from the catalogue; dates as YYYY-MM-DD; enum values exactly as listed; when grouping, include at least one aggregate and sort by a group or aggregate key (aggregate keys are 'count' or '<fn>_<field>'); when not grouping, list columns.",
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    `Catalogue: ${JSON.stringify(catalogue)}`,
  ].join("\n");
  const text = await runAi(ctx, "reportAssistant", { system, user: q, maxTokens: 600, temperature: 0 });
  const parsed = definitionSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new AppError("The suggested report was not valid. Try rephrasing the question.", "AI_FORMAT", 422);
  const ds = datasets.find((d) => d.key === parsed.data.dataset);
  if (!ds) throw new AppError("The suggestion used a dataset you cannot report on.", "AI_FORMAT", 422);
  const errors = validateDefinition(parsed.data, fieldMeta(ds));
  if (errors.length) throw new AppError(`The suggested report needs changes: ${errors.join(" ")}`, "AI_FORMAT", 422);
  return parsed.data;
}

const feedbackSchema = z.object({ assignmentTitle: z.string().trim().min(2).max(200), maxMarks: z.number().positive().max(1000), marks: z.number().min(0).max(1000).nullable().optional(), notes: z.string().trim().min(5).max(3000) });

/** Turn a teacher's rough notes into constructive feedback addressed to the student (no names are sent). */
export async function draftFeedback(ctx: AuthContext, raw: unknown): Promise<string> {
  if (!can(ctx, "marks.enter") && !can(ctx, "attendance.take")) throw forbidden();
  const v = feedbackSchema.parse(raw);
  const system = "You help a university teacher write assignment feedback. Write 3–6 sentences addressed to the student as 'you': start with what was done well, then the most important improvements, specific and actionable. Do not invent facts beyond the notes. Do not mention the marks unless given. Plain text, no headings.";
  const user = `Assignment: ${v.assignmentTitle}\nMarks: ${v.marks ?? "not given"} out of ${v.maxMarks}\nTeacher's notes:\n${v.notes}`;
  return runAi(ctx, "feedbackDrafts", { system, user, maxTokens: 400, temperature: 0.4 });
}

const announcementSchema = z.object({ points: z.string().trim().min(5).max(3000), audience: z.enum(["EVERYONE", "STAFF", "STUDENTS", "GUARDIANS"]) });

export async function draftAnnouncement(ctx: AuthContext, raw: unknown): Promise<{ title: string; body: string }> {
  if (!can(ctx, "announcement.publish")) throw forbidden();
  const v = announcementSchema.parse(raw);
  const system = 'You draft short, clear institutional announcements for a university. Reply with ONE JSON object: {"title": string (max 80 chars), "body": string (max 900 chars, plain text, short paragraphs)}. Keep every fact from the points; add nothing that is not in them; neutral, polite tone.';
  const text = await runAi(ctx, "announcementDrafts", { system, user: `Audience: ${v.audience.toLowerCase()}\nPoints:\n${v.points}`, maxTokens: 500, temperature: 0.3 });
  const out = z.object({ title: z.string().min(3).max(160), body: z.string().min(3).max(10_000) }).safeParse(extractJson(text));
  if (!out.success) throw new AppError("The draft could not be read. Try again.", "AI_FORMAT", 422);
  return out.data;
}
