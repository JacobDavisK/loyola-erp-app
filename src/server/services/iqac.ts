import "server-only";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { cycleProgress, parseOutline } from "@/lib/domain/quality";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { computeSource, SOURCES, type Period } from "@/server/services/iqac-sources";
import { notify } from "@/server/services/notifications";
import { saveFile } from "@/server/storage";

/**
 * IQAC / accreditation: frameworks with a metric tree, yearly cycles, and one response per metric per cycle.
 * The IQAC coordinator (iqac.manage) assigns each metric to a data owner. The owner writes the value and
 * narrative, can adopt a platform-computed value, attaches evidence and submits. IQAC approves or returns
 * it (never their own). Holders of iqac.view see everything read-only.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const needManage = (ctx: AuthContext) => {
  if (!can(ctx, "iqac.manage")) throw forbidden();
};

// ───────────────────────── Frameworks ─────────────────────────

export async function saveFramework(ctx: AuthContext, id: string | null, raw: unknown) {
  needManage(ctx);
  const v = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,20}$/), name: z.string().trim().min(3).max(160), description: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  const f = id ? await db.accreditationFramework.update({ where: { id }, data: { name: v.name, description: v.description || null } }) : await db.accreditationFramework.create({ data: { code: v.code, name: v.name, description: v.description || null } });
  await audit({ ...actor(ctx), action: id ? "iqac.framework.update" : "iqac.framework.create", resourceType: "accreditationFramework", resourceId: f.id, summary: `${f.code} ${f.name}` });
  return f;
}

/**
 * Add or update metrics from an outline (see parseOutline). Existing codes are updated in place so that
 * responses keep pointing at them; metrics are never removed here.
 */
export async function importMetrics(ctx: AuthContext, frameworkId: string, text: string) {
  needManage(ctx);
  if (!(await db.accreditationFramework.count({ where: { id: frameworkId } }))) throw notFound("Framework");
  const { lines, errors } = parseOutline(String(text ?? ""));
  if (errors.length) throw invalid(errors.slice(0, 5).join("; "));
  if (!lines.length) throw invalid("Paste at least one metric line.");
  const unknown = lines.filter((l) => l.source && !SOURCES[l.source]).map((l) => l.source);
  if (unknown.length) throw invalid(`Unknown data source(s): ${[...new Set(unknown)].join(", ")}. Available: ${Object.keys(SOURCES).join(", ")}.`);
  let created = 0;
  let updated = 0;
  await db.$transaction(async (tx) => {
    const ids = new Map((await tx.accreditationMetric.findMany({ where: { frameworkId }, select: { id: true, code: true } })).map((m) => [m.code, m.id]));
    for (const [order, l] of lines.entries()) {
      const parentId = l.parentCode ? ids.get(l.parentCode) ?? null : null;
      const data = { title: l.title, kind: l.kind, weight: l.weight, source: l.source, unit: l.unit, parentId, order };
      const existing = ids.get(l.code);
      if (existing) { await tx.accreditationMetric.update({ where: { id: existing }, data }); updated++; }
      else { ids.set(l.code, (await tx.accreditationMetric.create({ data: { ...data, frameworkId, code: l.code } })).id); created++; }
    }
    await audit({ ...actor(ctx), action: "iqac.metrics.import", resourceType: "accreditationFramework", resourceId: frameworkId, summary: `${created} added, ${updated} updated` }, tx);
  });
  return { created, updated };
}

// ───────────────────────── Cycles ─────────────────────────

/** Open a cycle: one response per leaf metric of the framework. */
export async function createCycle(ctx: AuthContext, raw: unknown) {
  needManage(ctx);
  const v = z.object({ frameworkId: z.string().min(1), academicYearId: z.string().min(1), name: z.string().trim().min(3).max(160), yearsCovered: z.number().int().min(1).max(10).default(1), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional().or(z.literal("")) }).parse(raw);
  if (await db.accreditationCycle.findUnique({ where: { frameworkId_academicYearId: { frameworkId: v.frameworkId, academicYearId: v.academicYearId } } })) throw conflict("A cycle for this framework and year already exists.");
  const metrics = await db.accreditationMetric.findMany({ where: { frameworkId: v.frameworkId }, select: { id: true, children: { select: { id: true } } } });
  const leaves = metrics.filter((m) => m.children.length === 0);
  if (!leaves.length) throw invalid("The framework has no metrics yet.");
  return db.$transaction(async (tx) => {
    const c = await tx.accreditationCycle.create({ data: { frameworkId: v.frameworkId, academicYearId: v.academicYearId, name: v.name, yearsCovered: v.yearsCovered, dueDate: v.dueDate ? new Date(`${v.dueDate}T00:00:00Z`) : null } });
    await tx.metricResponse.createMany({ data: leaves.map((m) => ({ cycleId: c.id, metricId: m.id })) });
    await audit({ ...actor(ctx), action: "iqac.cycle.create", resourceType: "accreditationCycle", resourceId: c.id, summary: `${v.name}: ${leaves.length} metric(s)` }, tx);
    return c;
  });
}

export async function closeCycle(ctx: AuthContext, id: string, closed: boolean) {
  needManage(ctx);
  const c = await db.accreditationCycle.update({ where: { id }, data: { isClosed: closed } });
  await audit({ ...actor(ctx), action: closed ? "iqac.cycle.close" : "iqac.cycle.reopen", resourceType: "accreditationCycle", resourceId: id, summary: c.name });
}

/** Assign one response, or every response under a metric code prefix, to a data owner. */
export async function assignMetrics(ctx: AuthContext, cycleId: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ codePrefix: z.string().trim().min(1).max(20), userId: z.string().min(1) }).parse(raw);
  const u = await db.user.findFirst({ where: { id: v.userId, userType: "STAFF", status: "ACTIVE", deletedAt: null }, select: { id: true, name: true } });
  if (!u) throw invalid("Choose an active staff member.");
  const responses = await db.metricResponse.findMany({ where: { cycleId, status: { in: ["NOT_STARTED", "DRAFT", "RETURNED"] }, metric: { OR: [{ code: v.codePrefix }, { code: { startsWith: `${v.codePrefix}.` } }] } }, select: { id: true } });
  if (!responses.length) throw invalid("No open metric matches that code.");
  const cycle = await db.accreditationCycle.findUniqueOrThrow({ where: { id: cycleId } });
  await db.$transaction(async (tx) => {
    await tx.metricResponse.updateMany({ where: { id: { in: responses.map((r) => r.id) } }, data: { assigneeId: u.id } });
    await notify({ userIds: [u.id], type: "iqac.assigned", title: `${responses.length} accreditation metric(s) assigned to you`, body: `${cycle.name} · ${v.codePrefix}`, link: "/iqac/my" }, tx);
    await audit({ ...actor(ctx), action: "iqac.assign", resourceType: "accreditationCycle", resourceId: cycleId, summary: `${v.codePrefix} (${responses.length}) → ${u.name}` }, tx);
  });
  return { assigned: responses.length };
}

export async function progressFor(cycleId: string) {
  const rs = await db.metricResponse.findMany({ where: { cycleId }, select: { status: true, metric: { select: { weight: true, code: true } } } });
  return cycleProgress(rs.map((r) => ({ weight: r.metric.weight, status: r.status })));
}

// ───────────────────────── Responses ─────────────────────────

export async function loadResponseFor(ctx: AuthContext, id: string) {
  const r = await db.metricResponse.findUnique({
    where: { id },
    include: { metric: true, cycle: { include: { framework: true, academicYear: true } }, assignee: { select: { id: true, name: true } }, evidence: { include: { file: { select: { id: true, originalName: true, size: true } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!r) throw notFound("Metric");
  const owner = r.assigneeId === ctx.user.id;
  const manage = can(ctx, "iqac.manage");
  if (!owner && !manage && !can(ctx, "iqac.view")) throw notFound("Metric");
  const editable = !r.cycle.isClosed && (owner || manage) && ["NOT_STARTED", "DRAFT", "RETURNED"].includes(r.status);
  return { response: r, owner, manage, editable };
}

export function periodOf(cycle: { yearsCovered: number; academicYear: { startDate: Date; endDate: Date; label: string } }): Period {
  const from = new Date(cycle.academicYear.startDate);
  from.setUTCFullYear(from.getUTCFullYear() - (cycle.yearsCovered - 1));
  return { from, to: cycle.academicYear.endDate, label: cycle.yearsCovered > 1 ? `${cycle.yearsCovered} years to ${cycle.academicYear.label}` : cycle.academicYear.label };
}

export async function saveResponse(ctx: AuthContext, id: string, raw: unknown) {
  const { response: r, editable } = await loadResponseFor(ctx, id);
  if (!editable) throw workflowError("This response cannot be edited now.");
  const v = z.object({ value: z.number().min(-1e12).max(1e12).nullable().optional(), narrative: z.string().trim().max(20_000).nullable().optional() }).parse(raw);
  const value = v.value ?? null;
  const computed = r.computed as { value?: number } | null;
  await db.metricResponse.update({
    where: { id },
    // A typed value that differs from the adopted computed one drops the computed snapshot.
    data: { value, narrative: v.narrative || null, status: r.status === "RETURNED" ? "RETURNED" : "DRAFT", ...(computed && computed.value !== value ? { computed: Prisma.DbNull } : {}) },
  });
  await audit({ ...actor(ctx), action: "iqac.response.save", resourceType: "metricResponse", resourceId: id, summary: `${r.metric.code}: ${value ?? "—"}` });
}

/** Compute the metric's value from platform records and store it with its inputs. */
export async function adoptComputed(ctx: AuthContext, id: string) {
  const { response: r, editable } = await loadResponseFor(ctx, id);
  if (!editable) throw workflowError("This response cannot be edited now.");
  if (!r.metric.source) throw invalid("This metric has no platform data source.");
  const period = periodOf(r.cycle);
  const c = await computeSource(r.metric.source, period);
  if (!c) throw invalid("Unknown data source.");
  const snapshot = { ...c, source: r.metric.source, period: period.label, computedAt: new Date().toISOString() };
  await db.metricResponse.update({ where: { id }, data: { value: c.value, computed: snapshot as Prisma.InputJsonValue, status: r.status === "RETURNED" ? "RETURNED" : "DRAFT" } });
  await audit({ ...actor(ctx), action: "iqac.response.compute", resourceType: "metricResponse", resourceId: id, summary: `${r.metric.code}: ${c.value} ${c.unit} from ${r.metric.source}` });
  return snapshot;
}

export async function addEvidence(ctx: AuthContext, id: string, form: FormData) {
  const { response: r, editable } = await loadResponseFor(ctx, id);
  if (!editable) throw workflowError("Evidence can be added while the response is being prepared.");
  const label = String(form.get("label") ?? "").trim().slice(0, 200);
  const url = String(form.get("url") ?? "").trim();
  const file = form.get("file");
  if (label.length < 3) throw invalid("Describe the evidence (at least 3 characters).");
  let data: { fileId?: string; url?: string };
  if (file instanceof File && file.size > 0) {
    const asset = await saveFile({ data: Buffer.from(await file.arrayBuffer()), name: file.name, kind: "EVIDENCE", ownerId: ctx.user.id });
    data = { fileId: asset.id };
  } else if (url) {
    const u = z.string().url().refine((x) => /^https?:\/\//i.test(x)).safeParse(url);
    if (!u.success) throw invalid("Enter an http(s) link or choose a file.");
    data = { url };
  } else throw invalid("Choose a file or enter a link.");
  const e = await db.metricEvidence.create({ data: { responseId: id, label, addedById: ctx.user.id, ...data } });
  await audit({ ...actor(ctx), action: "iqac.evidence.add", resourceType: "metricResponse", resourceId: id, summary: `${r.metric.code}: ${label}` });
  return e;
}

export async function removeEvidence(ctx: AuthContext, evidenceId: string) {
  const e = await db.metricEvidence.findUnique({ where: { id: evidenceId } });
  if (!e) throw notFound("Evidence");
  const { editable, response: r } = await loadResponseFor(ctx, e.responseId);
  if (!editable) throw workflowError("Evidence cannot be removed now.");
  await db.metricEvidence.delete({ where: { id: evidenceId } });
  await audit({ ...actor(ctx), action: "iqac.evidence.remove", resourceType: "metricResponse", resourceId: e.responseId, summary: `${r.metric.code}: ${e.label}` });
}

export async function submitResponse(ctx: AuthContext, id: string) {
  const { response: r, editable } = await loadResponseFor(ctx, id);
  if (!editable) throw workflowError("This response cannot be submitted now.");
  if (r.metric.kind === "QUANTITATIVE" && r.value === null) throw invalid("Enter or compute the value first.");
  if (r.metric.kind === "QUALITATIVE" && (r.narrative ?? "").length < 50) throw invalid("Write the narrative (at least 50 characters).");
  await db.$transaction(async (tx) => {
    await tx.metricResponse.update({ where: { id }, data: { status: "SUBMITTED", submittedAt: new Date() } });
    const reviewers = (await usersWithPermission("iqac.manage", undefined, tx)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: reviewers, type: "iqac.submitted", title: `Metric ${r.metric.code} submitted for review`, body: r.metric.title, link: `/iqac/responses/${id}` }, tx);
    await audit({ ...actor(ctx), action: "iqac.response.submit", resourceType: "metricResponse", resourceId: id, summary: r.metric.code }, tx);
  });
}

export async function reviewResponse(ctx: AuthContext, id: string, raw: unknown) {
  needManage(ctx);
  const { response: r } = await loadResponseFor(ctx, id);
  const v = z.object({ decision: z.enum(["approve", "return"]), note: z.string().trim().max(2000).nullable().optional() }).parse(raw);
  if (r.status !== "SUBMITTED") throw workflowError("Only submitted responses can be reviewed.");
  if (r.assigneeId === ctx.user.id) throw forbidden("You cannot review a response you prepared.");
  if (v.decision === "return" && (v.note ?? "").length < 5) throw invalid("Say what needs to change.");
  await db.$transaction(async (tx) => {
    await tx.metricResponse.update({ where: { id }, data: { status: v.decision === "approve" ? "APPROVED" : "RETURNED", reviewNote: v.note || null, reviewedAt: new Date(), reviewedById: ctx.user.id } });
    if (r.assigneeId) await notify({ userIds: [r.assigneeId], type: "iqac.reviewed", title: `Metric ${r.metric.code} ${v.decision === "approve" ? "approved" : "returned"}`, body: v.note ?? undefined, link: `/iqac/responses/${id}` }, tx);
    await audit({ ...actor(ctx), action: `iqac.response.${v.decision}`, resourceType: "metricResponse", resourceId: id, summary: r.metric.code, newValue: v.note ? { note: v.note } : undefined }, tx);
  });
}

/** Approved responses can be reopened by IQAC for correction (the history stays in the audit log). */
export async function reopenResponse(ctx: AuthContext, id: string, note: string) {
  needManage(ctx);
  const { response: r } = await loadResponseFor(ctx, id);
  if (r.cycle.isClosed) throw workflowError("The cycle is closed.");
  if (r.status !== "APPROVED") throw workflowError("Only approved responses can be reopened.");
  if (String(note ?? "").trim().length < 5) throw invalid("Give a reason.");
  await db.metricResponse.update({ where: { id }, data: { status: "RETURNED", reviewNote: note.trim(), reviewedAt: new Date(), reviewedById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "iqac.response.reopen", resourceType: "metricResponse", resourceId: id, summary: r.metric.code, newValue: { note } });
}
