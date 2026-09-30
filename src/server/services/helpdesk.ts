import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { canMoveTicket, slaDue, type TicketState } from "@/lib/domain/campus";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { usersWithPermission } from "@/server/services/directory";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Helpdesk: anyone signed in raises tickets in a configured category; agents (helpdesk.agent) work them.
 * SLA due times come from the category and priority. Messages are append-only; internal notes are hidden
 * from the requester.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
export const isAgent = (ctx: AuthContext) => can(ctx, "helpdesk.agent") || can(ctx, "helpdesk.manage");

export function ticketWhere(ctx: AuthContext): Prisma.TicketWhereInput {
  return isAgent(ctx) ? {} : { requesterId: ctx.user.id };
}

export async function loadTicketFor(ctx: AuthContext, id: string) {
  const t = await db.ticket.findFirst({
    where: { AND: [{ id }, ticketWhere(ctx)] },
    include: { requester: { select: { id: true, name: true, email: true, userType: true } }, assignee: { select: { id: true, name: true } }, messages: { where: isAgent(ctx) ? {} : { internal: false }, orderBy: { createdAt: "asc" }, include: { author: { select: { name: true } } } } },
  });
  if (!t) throw notFound("Ticket");
  return { ticket: t, agent: isAgent(ctx), own: t.requesterId === ctx.user.id };
}

export async function raiseTicket(ctx: AuthContext, raw: unknown) {
  const cfg = await getSetting("helpdesk");
  const v = z.object({ category: z.string(), subject: z.string().trim().min(5).max(200), description: z.string().trim().min(10).max(10_000), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL") }).parse(raw);
  const cat = cfg.categories.find((c) => c.key === v.category);
  if (!cat) throw invalid("Choose a category.");
  // Requesters cannot self-declare an emergency; agents re-prioritise when needed.
  const priority = v.priority === "URGENT" && !isAgent(ctx) ? "HIGH" : v.priority;
  const now = new Date();
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "helpdesk.ticket", { prefix: cfg.prefix, padding: 5 });
    const t = await tx.ticket.create({ data: { number, requesterId: ctx.user.id, category: cat.key, subject: v.subject, priority, dueAt: slaDue(now, cat.slaHours, priority), messages: { create: { authorId: ctx.user.id, body: v.description } } } });
    const agents = (await usersWithPermission("helpdesk.agent", undefined, tx)).filter((u) => u !== ctx.user.id);
    await notify({ userIds: agents, type: "helpdesk.new", title: `New ticket ${number}: ${v.subject}`, body: `${cat.label} · ${priority.toLowerCase()}`, link: `/helpdesk/${t.id}`, email: false }, tx);
    await audit({ ...actor(ctx), action: "helpdesk.raise", resourceType: "ticket", resourceId: t.id, summary: `${number} [${cat.key}] ${v.subject}` }, tx);
    return t;
  });
}

export async function replyTicket(ctx: AuthContext, id: string, raw: unknown) {
  const { ticket: t, agent, own } = await loadTicketFor(ctx, id);
  const v = z.object({ body: z.string().trim().min(2).max(10_000), internal: z.boolean().default(false) }).parse(raw);
  if (t.status === "CLOSED") throw workflowError("The ticket is closed. Raise a new one if you still need help.");
  if (v.internal && !agent) throw forbidden();
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.ticketMessage.create({ data: { ticketId: id, authorId: ctx.user.id, body: v.body, internal: v.internal } });
    const data: Prisma.TicketUpdateInput = {};
    if (agent && !own && !v.internal && !t.firstResponseAt) data.firstResponseAt = now;
    if (own && (t.status === "WAITING" || t.status === "RESOLVED")) { data.status = "IN_PROGRESS"; data.resolvedAt = null; }
    if (agent && !own && !v.internal && t.status === "OPEN") data.status = "IN_PROGRESS";
    if (Object.keys(data).length) await tx.ticket.update({ where: { id }, data });
    if (!v.internal) {
      const to = own ? (t.assignee ? [t.assignee.id] : await usersWithPermission("helpdesk.agent", undefined, tx)) : [t.requesterId];
      await notify({ userIds: to.filter((u) => u !== ctx.user.id), type: "helpdesk.reply", title: `${t.number}: new reply`, body: v.body.slice(0, 200), link: `/helpdesk/${id}` }, tx);
    }
  });
}

export async function setTicketStatus(ctx: AuthContext, id: string, to: TicketState) {
  const { ticket: t, agent, own } = await loadTicketFor(ctx, id);
  // Requesters may only close their ticket or confirm a resolution.
  if (!agent && !(own && (to === "CLOSED" || (to === "IN_PROGRESS" && t.status === "RESOLVED")))) throw forbidden();
  if (!canMoveTicket(t.status, to)) throw workflowError(`A ${t.status.toLowerCase().replace("_", " ")} ticket cannot move to ${to.toLowerCase().replace("_", " ")}.`);
  const now = new Date();
  await db.ticket.update({ where: { id }, data: { status: to, resolvedAt: to === "RESOLVED" ? now : to === "IN_PROGRESS" ? null : undefined, closedAt: to === "CLOSED" ? now : undefined } });
  if (to === "RESOLVED" && !own) await notify({ userIds: [t.requesterId], type: "helpdesk.resolved", title: `${t.number} resolved`, body: "Reply if the problem continues, or close the ticket and rate the help you received.", link: `/helpdesk/${id}` });
  await audit({ ...actor(ctx), action: "helpdesk.status", resourceType: "ticket", resourceId: id, summary: `${t.number}: ${t.status} → ${to}` });
}

export async function assignTicket(ctx: AuthContext, id: string, userId: string | null) {
  const { ticket: t, agent } = await loadTicketFor(ctx, id);
  if (!agent) throw forbidden();
  const target = userId || null;
  if (target && target !== ctx.user.id && !can(ctx, "helpdesk.manage")) throw forbidden("Only helpdesk managers assign tickets to others.");
  if (target && !(await usersWithPermission("helpdesk.agent")).includes(target)) throw invalid("Assign to a helpdesk agent.");
  await db.ticket.update({ where: { id }, data: { assigneeId: target } });
  if (target && target !== ctx.user.id) await notify({ userIds: [target], type: "helpdesk.assigned", title: `${t.number} assigned to you`, body: t.subject, link: `/helpdesk/${id}` });
  await audit({ ...actor(ctx), action: "helpdesk.assign", resourceType: "ticket", resourceId: id, summary: `${t.number} → ${target ?? "unassigned"}` });
}

export async function setPriority(ctx: AuthContext, id: string, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT") {
  const { ticket: t, agent } = await loadTicketFor(ctx, id);
  if (!agent) throw forbidden();
  const cfg = await getSetting("helpdesk");
  const cat = cfg.categories.find((c) => c.key === t.category);
  await db.ticket.update({ where: { id }, data: { priority, dueAt: cat ? slaDue(t.createdAt, cat.slaHours, priority) : t.dueAt } });
  await audit({ ...actor(ctx), action: "helpdesk.priority", resourceType: "ticket", resourceId: id, summary: `${t.number}: ${t.priority} → ${priority}` });
}

export async function rateTicket(ctx: AuthContext, id: string, rating: number) {
  const { ticket: t, own } = await loadTicketFor(ctx, id);
  if (!own) throw forbidden();
  if (!["RESOLVED", "CLOSED"].includes(t.status)) throw workflowError("Rate the ticket once it is resolved.");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw invalid("Rate from 1 to 5.");
  await db.ticket.update({ where: { id }, data: { satisfaction: rating, status: "CLOSED", closedAt: t.closedAt ?? new Date() } });
}

/** Operational figures for the helpdesk dashboard. */
export async function helpdeskStats() {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const [open, breached, resolved, rated] = await Promise.all([
    db.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] } } }),
    db.ticket.count({ where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING"] }, dueAt: { lt: now } } }),
    db.ticket.findMany({ where: { resolvedAt: { gte: since } }, select: { createdAt: true, resolvedAt: true, dueAt: true } }),
    db.ticket.aggregate({ where: { satisfaction: { not: null }, closedAt: { gte: since } }, _avg: { satisfaction: true }, _count: { satisfaction: true } }),
  ]);
  const onTime = resolved.filter((r) => r.resolvedAt! <= r.dueAt).length;
  return { open, breached, resolved30: resolved.length, slaPercent: resolved.length ? Math.round((onTime / resolved.length) * 1000) / 10 : null, satisfaction: rated._avg.satisfaction ? Math.round(rated._avg.satisfaction * 10) / 10 : null, ratings: rated._count.satisfaction };
}
