import "server-only";
import { z } from "zod";
import type { BreachStatus, DataRequestStatus, NoticeAudience, Prisma } from "@/generated/prisma/client";
import { addDays, addHours, currentDecisions, isMinor, needsDecision } from "@/lib/domain/compliance";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { requestMeta } from "@/server/request-context";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";
import { saveFile } from "@/server/storage";

/**
 * Digital Personal Data Protection Act 2023 and the DPDP Rules 2025.
 *
 *  - Notices: each purpose has a versioned notice. Required notices must be acknowledged before using the
 *    system; optional purposes (directory listing, publicity photographs, the AI assistant…) can be granted
 *    and withdrawn at any time. For a student who is a minor, a linked guardian decides optional purposes.
 *  - The consent ledger is append-only (database trigger) and is the evidence of every decision.
 *  - Data principals raise requests (access, correction, erasure, nomination, grievance); the DPO works
 *    them to a deadline. An access request can be answered with a machine-readable export of the
 *    person's records. Records the institution must keep by law (results, fees, audit trail) are not erased.
 *  - Personal-data breaches are logged with the 72-hour Board notification deadline.
 *  - Retention rules purge operational data (sign-in attempts, expired sessions, read notifications…).
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const assertDpo = (ctx: AuthContext) => {
  if (!can(ctx, "privacy.manage")) throw forbidden();
};

function audienceFor(ctx: AuthContext): NoticeAudience[] {
  const t = ctx.user.userType;
  return ["ALL", t === "STUDENT" ? "STUDENT" : t === "GUARDIAN" ? "GUARDIAN" : "STAFF"];
}

// ───────────────────────── Notices ─────────────────────────

const noticeSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_.-]{2,40}$/, "Lower-case letters, digits, dot, dash or underscore"),
  title: z.string().trim().min(3).max(160),
  purpose: z.string().trim().min(5).max(500),
  body: z.string().trim().min(20).max(20_000),
  audience: z.enum(["ALL", "STUDENT", "STAFF", "GUARDIAN"]),
  required: z.boolean(),
});

/** Publishing a notice with an existing key creates its next version and retires the previous one. */
export async function publishNotice(ctx: AuthContext, raw: unknown) {
  assertDpo(ctx);
  const v = noticeSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const last = await tx.consentNotice.findFirst({ where: { key: v.key }, orderBy: { version: "desc" } });
    if (last) await tx.consentNotice.updateMany({ where: { key: v.key }, data: { active: false } });
    const n = await tx.consentNotice.create({ data: { ...v, version: (last?.version ?? 0) + 1, createdById: ctx.user.id } });
    await audit({ ...actor(ctx), action: "privacy.notice.publish", resourceType: "consentNotice", resourceId: n.id, summary: `${v.key} v${n.version}: ${v.title}${v.required ? " (required)" : ""}` }, tx);
    return n;
  });
}

export async function retireNotice(ctx: AuthContext, id: string) {
  assertDpo(ctx);
  const n = await db.consentNotice.findUnique({ where: { id } });
  if (!n) throw notFound("Notice");
  await db.consentNotice.update({ where: { id }, data: { active: false } });
  await audit({ ...actor(ctx), action: "privacy.notice.retire", resourceType: "consentNotice", resourceId: id, summary: `${n.key} v${n.version}` });
}

async function decisionsFor(userId: string, studentId: string | null = null) {
  const rows = await db.consentRecord.findMany({ where: { userId, studentId }, include: { notice: { select: { key: true, version: true } } } });
  return currentDecisions(rows.map((r) => ({ noticeKey: r.notice.key, version: r.notice.version, decision: r.decision, createdAt: r.createdAt, noticeId: r.noticeId })));
}

/** Active notices addressed to the user, with their current decision. */
export async function myNotices(ctx: AuthContext) {
  const [notices, decisions] = await Promise.all([db.consentNotice.findMany({ where: { active: true, audience: { in: audienceFor(ctx) } }, orderBy: [{ required: "desc" }, { title: "asc" }] }), decisionsFor(ctx.user.id)]);
  return notices.map((n) => {
    const d = decisions.get(n.key);
    return { notice: n, decision: d?.decision ?? null, decidedVersion: d?.version ?? null, decidedAt: d?.createdAt ?? null, needsDecision: needsDecision(n, decisions) };
  });
}

/** Required notices the user still has to acknowledge (blocks the app until done). */
export async function pendingRequiredNotices(ctx: AuthContext) {
  return (await myNotices(ctx)).filter((x) => x.notice.required && (x.needsDecision || x.decision !== "GRANTED")).map((x) => x.notice);
}

export async function decideConsent(ctx: AuthContext, raw: unknown) {
  const v = z.object({ noticeId: z.string(), decision: z.enum(["GRANTED", "WITHDRAWN"]), studentId: z.string().nullable().optional() }).parse(raw);
  const n = await db.consentNotice.findUnique({ where: { id: v.noticeId } });
  if (!n || !n.active) throw notFound("Notice");
  const studentId = v.studentId ?? null;
  if (studentId) {
    // A guardian decides on behalf of a ward who is a minor.
    if (!ctx.subject.wardStudentIds.includes(studentId)) throw forbidden();
    const s = await db.student.findUniqueOrThrow({ where: { id: studentId }, select: { dateOfBirth: true } });
    const { adultAge } = await getSetting("privacy");
    if (!isMinor(s.dateOfBirth, new Date(), adultAge)) throw workflowError("Your ward is an adult and decides for themselves.");
    if (!["ALL", "STUDENT"].includes(n.audience)) throw invalid("This notice is not for students.");
  } else if (!audienceFor(ctx).includes(n.audience)) throw invalid("This notice is not addressed to you.");
  if (n.required && v.decision === "WITHDRAWN") throw workflowError("This notice covers processing the institution needs to run your studies or employment. Raise a grievance with the Data Protection Officer if you object.");
  const meta = await requestMeta();
  await db.consentRecord.create({ data: { userId: ctx.user.id, noticeId: n.id, decision: v.decision, studentId, ip: meta.ip, userAgent: meta.userAgent?.slice(0, 300) ?? null } });
  await audit({ ...actor(ctx), action: `privacy.consent.${v.decision.toLowerCase()}`, resourceType: "consentNotice", resourceId: n.id, summary: `${n.key} v${n.version}${studentId ? " (for a minor ward)" : ""}` });
}

/** Whether a user (or, for a minor student, their guardian) has granted an optional purpose. */
export async function hasConsent(userId: string, key: string): Promise<boolean> {
  const d = (await decisionsFor(userId)).get(key);
  return d?.decision === "GRANTED";
}

/** Optional purposes for a minor ward, decided by the guardian. */
export async function wardNotices(ctx: AuthContext) {
  if (!ctx.subject.wardStudentIds.length) return [];
  const { adultAge } = await getSetting("privacy");
  const wards = await db.student.findMany({ where: { id: { in: ctx.subject.wardStudentIds } }, select: { id: true, firstName: true, lastName: true, dateOfBirth: true } });
  const minors = wards.filter((w) => isMinor(w.dateOfBirth, new Date(), adultAge));
  if (!minors.length) return [];
  const notices = await db.consentNotice.findMany({ where: { active: true, required: false, audience: { in: ["ALL", "STUDENT"] } }, orderBy: { title: "asc" } });
  return Promise.all(minors.map(async (w) => {
    const d = await decisionsFor(ctx.user.id, w.id);
    return { ward: w, notices: notices.map((n) => ({ notice: n, decision: d.get(n.key)?.decision ?? null })) };
  }));
}

// ───────────────────────── Data-principal requests ─────────────────────────

export async function raiseDataRequest(ctx: AuthContext, raw: unknown) {
  const v = z.object({ type: z.enum(["ACCESS", "CORRECTION", "ERASURE", "NOMINATION", "GRIEVANCE"]), details: z.string().trim().min(10).max(5000) }).parse(raw);
  const cfg = await getSetting("privacy");
  const open = await db.dataRequest.count({ where: { userId: ctx.user.id, status: { in: ["OPEN", "IN_PROGRESS"] }, type: v.type } });
  if (open) throw workflowError("You already have an open request of this kind.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "privacy.request", { prefix: "DPR/{YYYY}/", padding: 5 });
    const r = await tx.dataRequest.create({ data: { number, userId: ctx.user.id, type: v.type, details: v.details, dueAt: addDays(new Date(), cfg.requestDays) } });
    const dpos = (await usersWithPermission("privacy.manage", undefined, tx)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: dpos, type: "privacy.request", title: `Data-principal request ${number} (${v.type.toLowerCase()})`, link: `/privacy/requests/${r.id}`, email: true }, tx);
    await audit({ ...actor(ctx), action: "privacy.request.raise", resourceType: "dataRequest", resourceId: r.id, summary: `${number}: ${v.type}` }, tx);
    return r;
  });
}

export async function loadDataRequest(ctx: AuthContext, id: string) {
  const r = await db.dataRequest.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, email: true, userType: true } } } });
  if (!r || (r.userId !== ctx.user.id && !can(ctx, "privacy.manage"))) throw notFound("Request");
  return r;
}

const MOVES: Record<DataRequestStatus, DataRequestStatus[]> = { OPEN: ["IN_PROGRESS", "COMPLETED", "REJECTED"], IN_PROGRESS: ["COMPLETED", "REJECTED"], COMPLETED: [], REJECTED: [] };

export async function updateDataRequest(ctx: AuthContext, id: string, raw: unknown) {
  assertDpo(ctx);
  const v = z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "REJECTED"]), response: z.string().trim().max(5000).nullable().optional() }).parse(raw);
  const r = await loadDataRequest(ctx, id);
  if (r.userId === ctx.user.id) throw forbidden("Another officer must handle your own request.");
  if (!MOVES[r.status].includes(v.status)) throw workflowError(`A ${r.status.toLowerCase().replace("_", " ")} request cannot move to ${v.status.toLowerCase().replace("_", " ")}.`);
  if (v.status !== "IN_PROGRESS" && (v.response ?? "").length < 10) throw invalid("Write the response to the data principal (at least 10 characters).");
  await db.dataRequest.update({ where: { id }, data: { status: v.status, response: v.response ?? r.response, handledById: ctx.user.id, closedAt: v.status === "IN_PROGRESS" ? null : new Date() } });
  if (v.status !== "IN_PROGRESS") await notify({ userIds: [r.userId], type: "privacy.request", title: `Your request ${r.number} was ${v.status === "COMPLETED" ? "completed" : "declined"}`, body: v.response ?? undefined, link: "/me/privacy" });
  await audit({ ...actor(ctx), action: "privacy.request.update", resourceType: "dataRequest", resourceId: id, summary: `${r.number}: ${r.status} → ${v.status}` });
}

/** Everything the institution holds about a person, as JSON (answer to an access request). */
export async function personalDataExport(userId: string) {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, employeeId: true, phone: true, designation: true, userType: true, status: true, createdAt: true, lastLoginAt: true, roles: { select: { role: { select: { name: true } }, department: { select: { name: true } } } } },
  });
  const student = await db.student.findUnique({
    where: { userId },
    include: {
      program: { select: { code: true, name: true } }, batch: { select: { code: true } }, guardians: { select: { name: true, relation: true, phone: true, email: true } },
      registrations: { select: { status: true, offering: { select: { course: { select: { code: true, title: true } }, term: { select: { name: true } } } } } },
      courseResults: { where: { isCurrent: true, publishedAt: { not: null } }, select: { grade: true, credits: true, status: true, course: { select: { code: true } } } },
      termResults: { where: { isCurrent: true, publishedAt: { not: null } }, select: { sgpa: true, cgpa: true, termId: true } },
      invoices: { select: { number: true, total: true, status: true, dueDate: true } },
      payments: { select: { receiptNo: true, amount: true, method: true, status: true, receivedAt: true } },
      documents: { select: { type: true, status: true, createdAt: true } },
      credentials: { select: { type: true, serialNo: true, status: true, issuedAt: true } },
      hostelAllocations: { select: { fromDate: true, vacatedAt: true } },
      libraryLoans: { select: { issuedAt: true, dueAt: true, returnedAt: true } },
    },
  });
  const [attendance, sessions, consents, tickets, requests] = await Promise.all([
    student ? db.attendanceRecord.groupBy({ by: ["mark"], where: { studentId: student.id }, _count: { _all: true } }) : [],
    db.session.findMany({ where: { userId }, select: { createdAt: true, lastSeenAt: true, ip: true, deviceLabel: true, revokedAt: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.consentRecord.findMany({ where: { userId }, select: { decision: true, createdAt: true, notice: { select: { key: true, version: true, title: true } } }, orderBy: { createdAt: "asc" } }),
    db.ticket.findMany({ where: { requesterId: userId }, select: { number: true, subject: true, status: true, createdAt: true } }),
    db.dataRequest.findMany({ where: { userId }, select: { number: true, type: true, status: true, createdAt: true } }),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    notice: "Personal data held by the institution about you, provided under the Digital Personal Data Protection Act 2023. Examination question papers and other people's data are not included.",
    account: user,
    student,
    attendanceSummary: attendance.map((a) => ({ mark: a.mark, sessions: a._count._all })),
    signInSessions: sessions,
    consents,
    helpdeskTickets: tickets,
    dataRequests: requests,
  };
}

/** Prepare the export for an access request and attach it; the requester downloads it from their privacy page. */
export async function fulfilAccessRequest(ctx: AuthContext, id: string) {
  assertDpo(ctx);
  const r = await loadDataRequest(ctx, id);
  if (r.type !== "ACCESS") throw invalid("Exports answer access requests only.");
  if (r.userId === ctx.user.id) throw forbidden("Another officer must handle your own request.");
  if (!["OPEN", "IN_PROGRESS"].includes(r.status)) throw workflowError("The request is closed.");
  const data = await personalDataExport(r.userId);
  const asset = await saveFile({ data: Buffer.from(JSON.stringify(data, null, 2)), name: `personal-data-${r.number.replace(/\//g, "-")}.json`, kind: "EXPORT", ownerId: r.userId });
  await db.dataRequest.update({ where: { id }, data: { exportAssetId: asset.id, status: "IN_PROGRESS", handledById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "privacy.request.export", resourceType: "dataRequest", resourceId: id, summary: `${r.number}: personal-data export prepared (${asset.size} bytes)` });
}

// ───────────────────────── Breach register ─────────────────────────

const breachSchema = z.object({
  title: z.string().trim().min(5).max(200),
  description: z.string().trim().min(10).max(10_000),
  detectedAt: z.coerce.date(),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  dataCategories: z.string().trim().min(3).max(500),
  affectedCount: z.number().int().min(0),
});

export async function reportBreach(ctx: AuthContext, raw: unknown) {
  const v = breachSchema.parse(raw);
  if (v.detectedAt > new Date()) throw invalid("The detection time cannot be in the future.");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "privacy.breach", { prefix: "BR/{YYYY}/", padding: 4 });
    const b = await tx.breachIncident.create({ data: { ...v, number, reportedById: ctx.user.id } });
    const dpos = (await usersWithPermission("privacy.manage", undefined, tx)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: dpos, type: "privacy.breach", title: `Personal-data breach reported: ${number}`, body: `${v.severity}: ${v.title}`, link: "/privacy?tab=breaches", email: true }, tx);
    await audit({ ...actor(ctx), action: "privacy.breach.report", resourceType: "breachIncident", resourceId: b.id, summary: `${number} [${v.severity}] ${v.title}` }, tx);
    return b;
  });
}

const BREACH_MOVES: Record<BreachStatus, BreachStatus[]> = { OPEN: ["CONTAINED", "NOTIFIED"], CONTAINED: ["NOTIFIED"], NOTIFIED: ["CLOSED"], CLOSED: [] };

export async function updateBreach(ctx: AuthContext, id: string, raw: unknown) {
  assertDpo(ctx);
  const v = z.object({
    status: z.enum(["CONTAINED", "NOTIFIED", "CLOSED"]),
    containment: z.string().trim().max(5000).nullable().optional(),
    boardNotifiedAt: z.coerce.date().nullable().optional(),
    usersNotifiedAt: z.coerce.date().nullable().optional(),
  }).parse(raw);
  const b = await db.breachIncident.findUnique({ where: { id } });
  if (!b) throw notFound("Breach");
  if (!BREACH_MOVES[b.status].includes(v.status)) throw workflowError(`A ${b.status.toLowerCase()} breach cannot move to ${v.status.toLowerCase()}.`);
  const boardNotifiedAt = v.boardNotifiedAt ?? b.boardNotifiedAt;
  const usersNotifiedAt = v.usersNotifiedAt ?? b.usersNotifiedAt;
  if (v.status === "NOTIFIED" && (!boardNotifiedAt || !usersNotifiedAt)) throw invalid("Record when the Data Protection Board and the affected people were informed.");
  if (v.status === "CONTAINED" && !(v.containment ?? b.containment)) throw invalid("Describe how the breach was contained.");
  await db.breachIncident.update({ where: { id }, data: { status: v.status, containment: v.containment ?? b.containment, boardNotifiedAt, usersNotifiedAt, closedAt: v.status === "CLOSED" ? new Date() : null } });
  await audit({ ...actor(ctx), action: "privacy.breach.update", resourceType: "breachIncident", resourceId: id, summary: `${b.number}: ${b.status} → ${v.status}` });
}

export async function breachDeadline(detectedAt: Date) {
  return addHours(detectedAt, (await getSetting("privacy")).breachNotifyHours);
}

// ───────────────────────── Retention ─────────────────────────

/** Datasets a retention rule may purge. Statutory records (results, fees, audit) are deliberately absent. */
export const RETENTION_DATASETS: Record<string, { label: string; purge: (before: Date) => Promise<number> }> = {
  login_attempts: { label: "Sign-in attempts", purge: async (before) => (await db.loginAttempt.deleteMany({ where: { createdAt: { lt: before } } })).count },
  ended_sessions: { label: "Ended or expired sign-in sessions", purge: async (before) => (await db.session.deleteMany({ where: { OR: [{ revokedAt: { lt: before } }, { expiresAt: { lt: before } }] } })).count },
  password_reset_tokens: { label: "Used or expired password-reset links", purge: async (before) => (await db.passwordResetToken.deleteMany({ where: { OR: [{ usedAt: { lt: before } }, { expiresAt: { lt: before } }] } })).count },
  read_notifications: { label: "Read notifications", purge: async (before) => (await db.notification.deleteMany({ where: { readAt: { lt: before } } })).count },
  sent_emails: { label: "Sent e-mail copies", purge: async (before) => (await db.emailOutbox.deleteMany({ where: { sentAt: { lt: before } } })).count },
};

export async function saveRetentionRule(ctx: AuthContext, raw: unknown) {
  assertDpo(ctx);
  const v = z.object({ dataset: z.string().refine((d) => d in RETENTION_DATASETS, "Unknown dataset"), retainDays: z.number().int().min(1).max(36500), active: z.boolean() }).parse(raw);
  await db.retentionRule.upsert({ where: { dataset: v.dataset }, create: v, update: { retainDays: v.retainDays, active: v.active } });
  await audit({ ...actor(ctx), action: "privacy.retention.save", resourceType: "retentionRule", resourceId: v.dataset, summary: `${RETENTION_DATASETS[v.dataset].label}: ${v.retainDays} days${v.active ? "" : " (paused)"}` });
}

/** Applies every active retention rule (background job). */
export async function applyRetention(now = new Date()): Promise<number> {
  let total = 0;
  for (const rule of await db.retentionRule.findMany({ where: { active: true } })) {
    const ds = RETENTION_DATASETS[rule.dataset];
    if (!ds) continue;
    const n = await ds.purge(addDays(now, -rule.retainDays));
    total += n;
    await db.retentionRule.update({ where: { id: rule.id }, data: { lastRunAt: now, lastAffected: n } });
    if (n) await audit({ actorId: null, actorName: "Retention job", action: "privacy.retention.apply", resourceType: "retentionRule", resourceId: rule.dataset, summary: `${ds.label}: ${n} record(s) older than ${rule.retainDays} days removed` });
  }
  return total;
}

export async function privacyOverview() {
  const now = new Date();
  const [openRequests, overdueRequests, openBreaches, notices] = await Promise.all([
    db.dataRequest.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.dataRequest.count({ where: { status: { in: ["OPEN", "IN_PROGRESS"] }, dueAt: { lt: now } } }),
    db.breachIncident.count({ where: { status: { not: "CLOSED" } } }),
    db.consentNotice.count({ where: { active: true } }),
  ]);
  return { openRequests, overdueRequests, openBreaches, notices };
}

export type ConsentRow = Prisma.ConsentRecordGetPayload<{ include: { notice: true } }>;
