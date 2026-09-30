import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { BudgetHead, Indexing, PublicationType } from "@/generated/prisma/enums";
import { dateOnly } from "@/lib/domain/hr";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { checkExpense, normaliseDoi, utilisation } from "@/lib/domain/quality";
import { type AuthContext, can, scopeOf } from "@/server/auth/current";
import { db } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/sequence";
import { resubmitWorkflow, startWorkflow } from "@/server/services/workflow";
import type { ProposalData } from "@/server/workflow/modules/research";

/**
 * Research: sponsored projects (proposal → institutional clearance workflow → sanction → spending → completion)
 * and publications (self-reported by faculty, verified by the research office).
 *
 * Staff linked to an employee record manage their own projects and publications; `research.view` sees the
 * department scope; `research.manage` (Dean of Research) sanctions, records spending and verifies.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const money = z.number().min(0).max(1_000_000_000).refine((n) => Math.round(n * 100) === n * 100, "At most two decimals");
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function projectWhere(ctx: AuthContext): Prisma.ResearchProjectWhereInput {
  const scope = scopeOf(ctx, "research.view");
  if (scope === null) return {};
  const or: Prisma.ResearchProjectWhereInput[] = [];
  if (scope.length) or.push({ departmentId: { in: scope } });
  if (ctx.subject.employeeId) or.push({ members: { some: { employeeId: ctx.subject.employeeId } } });
  return or.length ? { OR: or } : { id: "__none__" };
}

export function publicationWhere(ctx: AuthContext): Prisma.PublicationWhereInput {
  const scope = scopeOf(ctx, "research.view");
  if (scope === null) return {};
  const or: Prisma.PublicationWhereInput[] = [];
  if (scope.length) or.push({ departmentId: { in: scope } });
  if (ctx.subject.employeeId) or.push({ authors: { some: { employeeId: ctx.subject.employeeId } } });
  return or.length ? { OR: or } : { id: "__none__" };
}

export async function loadProjectFor(ctx: AuthContext, id: string) {
  const p = await db.researchProject.findFirst({
    where: { AND: [{ id }, projectWhere(ctx)] },
    include: { department: true, members: { include: { employee: { select: { id: true, firstName: true, lastName: true, designation: true, userId: true } } } }, budget: true, expenses: { orderBy: { date: "asc" } }, publications: { select: { id: true, title: true, year: true } } },
  });
  if (!p) throw notFound("Project");
  const pi = p.members.find((m) => m.role === "PI");
  const isPi = !!pi && pi.employeeId === ctx.subject.employeeId;
  const isMember = p.members.some((m) => m.employeeId === ctx.subject.employeeId);
  const u = utilisation(p.budget.map((b) => ({ head: b.head, amount: toMinor(b.amount) })), p.expenses.map((e) => ({ head: e.head, amount: toMinor(e.amount) })));
  return { project: p, isPi, isMember, manage: can(ctx, "research.manage"), utilisation: u };
}

// ───────────────────────── Projects ─────────────────────────

export const projectSchema = z.object({
  title: z.string().trim().min(5).max(300),
  abstract: z.string().trim().min(20).max(10_000),
  fundingAgency: z.string().trim().min(2).max(200),
  scheme: z.string().trim().max(200).nullable().optional(),
  durationMonths: z.number().int().min(1).max(120),
  budget: z.array(z.object({ head: z.enum(BudgetHead), amount: money })).min(1).max(6),
  members: z.array(z.object({ employeeId: z.string().min(1), role: z.enum(["CO_PI", "MEMBER"]) })).max(20).default([]),
});

function budgetRows(budget: z.infer<typeof projectSchema>["budget"]) {
  const heads = budget.map((b) => b.head);
  if (new Set(heads).size !== heads.length) throw invalid("Each budget head can appear once.");
  return budget.filter((b) => b.amount > 0).map((b) => ({ head: b.head, amount: b.amount.toFixed(2) }));
}

export async function createProject(ctx: AuthContext, raw: unknown) {
  const piId = ctx.subject.employeeId;
  if (!piId) throw forbidden("Only staff with an employee record can propose research projects.");
  const v = projectSchema.parse(raw);
  const members = v.members.filter((m) => m.employeeId !== piId);
  if (members.length && (await db.employee.count({ where: { id: { in: members.map((m) => m.employeeId) }, deletedAt: null } })) !== new Set(members.map((m) => m.employeeId)).size) throw invalid("Choose team members from the staff list.");
  const pi = await db.employee.findUniqueOrThrow({ where: { id: piId } });
  const budget = budgetRows(v.budget);
  const total = budget.reduce((a, b) => a + toMinor(b.amount), 0);
  return db.$transaction(async (tx) => {
    const code = await nextNumber(tx, "research.project", { prefix: "RP/{YYYY}/", padding: 4 });
    const p = await tx.researchProject.create({
      data: {
        code, title: v.title, abstract: v.abstract, fundingAgency: v.fundingAgency, scheme: v.scheme || null, durationMonths: v.durationMonths, departmentId: pi.departmentId, proposedAmount: fromMinor(total), createdById: ctx.user.id,
        budget: { create: budget }, members: { create: [{ employeeId: piId, role: "PI" as const }, ...members] },
      },
    });
    await audit({ ...actor(ctx), action: "research.project.create", resourceType: "researchProject", resourceId: p.id, summary: `${code} ${v.title}` }, tx);
    return p;
  });
}

export async function updateProject(ctx: AuthContext, id: string, raw: unknown) {
  const { project, isPi } = await loadProjectFor(ctx, id);
  if (!isPi) throw forbidden("Only the principal investigator edits the proposal.");
  if (project.status !== "DRAFT") throw workflowError("Only a draft (or returned) proposal can be edited.");
  const v = projectSchema.parse(raw);
  const piId = ctx.subject.employeeId!;
  const members = v.members.filter((m) => m.employeeId !== piId);
  const budget = budgetRows(v.budget);
  await db.$transaction(async (tx) => {
    await tx.projectBudgetLine.deleteMany({ where: { projectId: id } });
    await tx.projectMember.deleteMany({ where: { projectId: id, role: { not: "PI" } } });
    await tx.researchProject.update({
      where: { id },
      data: { title: v.title, abstract: v.abstract, fundingAgency: v.fundingAgency, scheme: v.scheme || null, durationMonths: v.durationMonths, proposedAmount: fromMinor(budget.reduce((a, b) => a + toMinor(b.amount), 0)), budget: { create: budget }, members: { create: members } },
    });
    await audit({ ...actor(ctx), action: "research.project.update", resourceType: "researchProject", resourceId: id, summary: project.code }, tx);
  });
}

/** Send the proposal for institutional clearance (or resubmit it after it was returned). */
export async function submitProject(ctx: AuthContext, id: string) {
  const { project, isPi } = await loadProjectFor(ctx, id);
  if (!isPi) throw forbidden("Only the principal investigator submits the proposal.");
  if (project.status !== "DRAFT") throw workflowError("This proposal has already been submitted.");
  const pi = project.members.find((m) => m.role === "PI")!.employee;
  const data: ProposalData = { projectId: id, code: project.code, title: project.title, pi: `${pi.firstName} ${pi.lastName}`, department: project.department?.name ?? "—", agency: project.fundingAgency, amount: Number(project.proposedAmount), months: project.durationMonths };
  await db.$transaction(async (tx) => {
    await tx.researchProject.update({ where: { id }, data: { status: "UNDER_REVIEW" } });
    const returned = await tx.workflowInstance.findFirst({ where: { resourceType: "researchProject", resourceId: id, status: "RETURNED" } });
    if (returned) await resubmitWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, returned.id, data as unknown as Record<string, unknown>);
    else await startWorkflow(tx, { id: ctx.user.id, name: ctx.user.name }, { key: "research.proposal", resourceType: "researchProject", resourceId: id, title: `Research proposal ${project.code}: ${project.title}`, summary: `${project.fundingAgency} · ${Number(project.proposedAmount).toFixed(2)}`, departmentId: project.departmentId, data: data as unknown as Record<string, unknown> });
  });
}

/** Record the agency's sanction: amount, reference, start date and the sanctioned budget by head. */
export async function recordSanction(ctx: AuthContext, id: string, raw: unknown) {
  if (!can(ctx, "research.manage")) throw forbidden();
  const { project } = await loadProjectFor(ctx, id);
  if (project.status !== "APPROVED") throw workflowError("Only a proposal cleared by the institution can be sanctioned.");
  const v = z.object({ grantRef: z.string().trim().min(3).max(100), startDate: ymd, budget: z.array(z.object({ head: z.enum(BudgetHead), amount: money })).min(1).max(6) }).parse(raw);
  const budget = budgetRows(v.budget);
  const total = budget.reduce((a, b) => a + toMinor(b.amount), 0);
  if (total <= 0) throw invalid("Enter the sanctioned amounts.");
  const start = dateOnly(v.startDate);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + project.durationMonths, start.getUTCDate() - 1));
  await db.$transaction(async (tx) => {
    await tx.projectBudgetLine.deleteMany({ where: { projectId: id } });
    await tx.researchProject.update({ where: { id }, data: { status: "SANCTIONED", grantRef: v.grantRef, startDate: start, endDate: end, sanctionedAmount: fromMinor(total), budget: { create: budget } } });
    await audit({ ...actor(ctx), action: "research.project.sanction", resourceType: "researchProject", resourceId: id, summary: `${project.code}: ${(total / 100).toFixed(2)} sanctioned (${v.grantRef})` }, tx);
  });
}

export async function recordExpense(ctx: AuthContext, id: string, raw: unknown) {
  const { project, isPi, manage, utilisation: u } = await loadProjectFor(ctx, id);
  if (!isPi && !manage) throw forbidden();
  if (project.status !== "SANCTIONED") throw workflowError("Spending can be recorded only on a sanctioned, running project.");
  const v = z.object({ head: z.enum(BudgetHead), amount: z.number().min(-1_000_000_000).max(1_000_000_000), date: ymd, voucherNo: z.string().trim().max(60).nullable().optional(), description: z.string().trim().min(5).max(500) }).parse(raw);
  const amount = Math.round(v.amount * 100);
  if (amount < 0 && !manage) throw forbidden("Only the research office records corrections.");
  const err = checkExpense(u.heads.find((h) => h.head === v.head), amount);
  if (err) throw invalid(err);
  const date = dateOnly(v.date);
  if (project.startDate && date < project.startDate) throw invalid("The expense is dated before the project started.");
  const e = await db.projectExpense.create({ data: { projectId: id, head: v.head, amount: fromMinor(amount), date, voucherNo: v.voucherNo || null, description: v.description, recordedById: ctx.user.id } });
  await audit({ ...actor(ctx), action: amount < 0 ? "research.expense.correct" : "research.expense", resourceType: "researchProject", resourceId: id, summary: `${project.code} ${v.head.toLowerCase()}: ${(amount / 100).toFixed(2)} — ${v.description}` });
  return e;
}

export async function completeProject(ctx: AuthContext, id: string, outcome: string) {
  const { project, isPi, manage } = await loadProjectFor(ctx, id);
  if (!isPi && !manage) throw forbidden();
  if (project.status !== "SANCTIONED") throw workflowError("Only a running project can be completed.");
  if (String(outcome ?? "").trim().length < 20) throw invalid("Summarise the outcomes (at least 20 characters).");
  await db.researchProject.update({ where: { id }, data: { status: "COMPLETED", outcome: outcome.trim() } });
  await audit({ ...actor(ctx), action: "research.project.complete", resourceType: "researchProject", resourceId: id, summary: project.code });
}

// ───────────────────────── Publications ─────────────────────────

export const publicationSchema = z.object({
  type: z.enum(PublicationType),
  title: z.string().trim().min(5).max(500),
  venue: z.string().trim().min(2).max(300),
  year: z.number().int().min(1900).max(2200),
  volume: z.string().trim().max(40).nullable().optional(),
  pages: z.string().trim().max(40).nullable().optional(),
  doi: z.string().trim().max(200).nullable().optional(),
  isbn: z.string().trim().max(40).nullable().optional(),
  url: z.string().trim().url().max(500).nullable().optional().or(z.literal("")),
  authorsText: z.string().trim().min(3).max(2000),
  indexing: z.enum(Indexing).default("NONE"),
  impactFactor: z.number().min(0).max(500).nullable().optional(),
  projectId: z.string().nullable().optional().or(z.literal("")),
  authorIds: z.array(z.string()).max(30).default([]),
});

export async function savePublication(ctx: AuthContext, id: string | null, raw: unknown) {
  const v = publicationSchema.parse(raw);
  const manage = can(ctx, "research.manage");
  const self = ctx.subject.employeeId;
  if (!self && !manage) throw forbidden("Only staff with an employee record can add publications.");
  const authorIds = [...new Set([...(self && !manage ? [self] : []), ...v.authorIds])];
  if (!authorIds.length) throw invalid("Choose at least one institutional author.");
  const authors = await db.employee.findMany({ where: { id: { in: authorIds }, deletedAt: null }, select: { id: true, departmentId: true } });
  if (authors.length !== authorIds.length) throw invalid("Choose authors from the staff list.");
  const doi = v.doi ? normaliseDoi(v.doi) : null;
  if (v.doi && !doi) throw invalid("That does not look like a DOI (it should start with 10.).");
  if (doi) {
    const dup = await db.publication.findFirst({ where: { doi, id: id ? { not: id } : undefined } });
    if (dup) throw conflict(`This DOI is already recorded: "${dup.title}".`);
  }
  if (v.projectId && !(await db.researchProject.count({ where: { AND: [{ id: v.projectId }, projectWhere(ctx)] } }))) throw invalid("Choose one of your projects.");
  const data = {
    type: v.type, title: v.title, venue: v.venue, year: v.year, volume: v.volume || null, pages: v.pages || null, doi, isbn: v.isbn || null, url: v.url || null, authorsText: v.authorsText,
    indexing: v.indexing, impactFactor: v.impactFactor ?? null, projectId: v.projectId || null,
    departmentId: authors.find((a) => a.id === self)?.departmentId ?? authors[0].departmentId,
  };
  return db.$transaction(async (tx) => {
    let pub;
    if (id) {
      const cur = await tx.publication.findFirst({ where: { AND: [{ id }, publicationWhere(ctx)] }, include: { authors: true } });
      if (!cur) throw notFound("Publication");
      if (!manage && !cur.authors.some((a) => a.employeeId === self)) throw forbidden("Only its authors can edit a publication.");
      if (!manage && cur.verifiedAt) throw workflowError("Verified publications can only be corrected by the research office.");
      await tx.publicationAuthor.deleteMany({ where: { publicationId: id } });
      pub = await tx.publication.update({ where: { id }, data: { ...data, authors: { create: authorIds.map((employeeId, i) => ({ employeeId, position: i + 1 })) } } });
    } else {
      pub = await tx.publication.create({ data: { ...data, createdById: ctx.user.id, authors: { create: authorIds.map((employeeId, i) => ({ employeeId, position: i + 1 })) } } });
    }
    await audit({ ...actor(ctx), action: id ? "research.publication.update" : "research.publication.create", resourceType: "publication", resourceId: pub.id, summary: `${v.type} ${v.year}: ${v.title.slice(0, 120)}` }, tx);
    return pub;
  });
}

export async function verifyPublication(ctx: AuthContext, id: string) {
  if (!can(ctx, "research.manage")) throw forbidden();
  const p = await db.publication.findUnique({ where: { id }, include: { authors: { include: { employee: { select: { userId: true } } } } } });
  if (!p) throw notFound("Publication");
  if (p.authors.some((a) => a.employee.userId === ctx.user.id)) throw forbidden("You cannot verify your own publication.");
  await db.publication.update({ where: { id }, data: { verifiedAt: new Date(), verifiedById: ctx.user.id } });
  await audit({ ...actor(ctx), action: "research.publication.verify", resourceType: "publication", resourceId: id, summary: p.title.slice(0, 120) });
}

export async function deletePublication(ctx: AuthContext, id: string) {
  const p = await db.publication.findFirst({ where: { AND: [{ id }, publicationWhere(ctx)] }, include: { authors: true } });
  if (!p) throw notFound("Publication");
  const manage = can(ctx, "research.manage");
  if (!manage && (p.verifiedAt || !p.authors.some((a) => a.employeeId === ctx.subject.employeeId))) throw forbidden();
  await db.publication.delete({ where: { id } });
  await audit({ ...actor(ctx), action: "research.publication.delete", resourceType: "publication", resourceId: id, summary: p.title.slice(0, 120) });
}
