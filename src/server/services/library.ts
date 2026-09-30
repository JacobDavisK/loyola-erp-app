import "server-only";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { canBorrow, fineFor } from "@/lib/domain/campus";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { audit } from "@/server/services/audit";
import { issueInvoice } from "@/server/services/finance-core";
import { notify } from "@/server/services/notifications";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";

/**
 * Library: catalogue (items and physical copies), circulation (issue, renew, return), holds and overdue fines.
 * Borrowers are students or employees, identified at the desk by their student or employee number.
 * Student fines are raised as invoices (fee head of category Fine) so they are paid like any other fee.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const need = (ctx: AuthContext, p: "library.circulate" | "library.manage") => {
  if (!can(ctx, p)) throw forbidden();
};

// ───────────────────────── Catalogue ─────────────────────────

export const itemSchema = z.object({
  title: z.string().trim().min(2).max(300),
  authors: z.string().trim().min(2).max(300),
  isbn: z.string().trim().regex(/^[0-9Xx-]{10,17}$/, "Enter a 10- or 13-digit ISBN").nullable().optional().or(z.literal("")),
  publisher: z.string().trim().max(160).nullable().optional(),
  year: z.number().int().min(1450).max(2200).nullable().optional(),
  edition: z.string().trim().max(40).nullable().optional(),
  subject: z.string().trim().max(120).nullable().optional(),
  callNo: z.string().trim().max(40).nullable().optional(),
});

export async function saveItem(ctx: AuthContext, id: string | null, raw: unknown) {
  need(ctx, "library.manage");
  const v = itemSchema.parse(raw);
  const data = { ...v, isbn: v.isbn ? v.isbn.replace(/-/g, "").toUpperCase() : null, publisher: v.publisher || null, year: v.year ?? null, edition: v.edition || null, subject: v.subject || null, callNo: v.callNo || null };
  const it = id ? await db.libraryItem.update({ where: { id }, data }) : await db.libraryItem.create({ data });
  await audit({ ...actor(ctx), action: id ? "library.item.update" : "library.item.create", resourceType: "libraryItem", resourceId: it.id, summary: it.title });
  return it;
}

export async function addCopies(ctx: AuthContext, itemId: string, raw: unknown) {
  need(ctx, "library.manage");
  const v = z.object({ count: z.number().int().min(1).max(100), location: z.string().trim().max(60).nullable().optional() }).parse(raw);
  if (!(await db.libraryItem.count({ where: { id: itemId } }))) throw notFound("Item");
  return db.$transaction(async (tx) => {
    const nos: string[] = [];
    for (let i = 0; i < v.count; i++) nos.push(await nextNumber(tx, "library.accession", { prefix: "ACC", padding: 6 }));
    await tx.libraryCopy.createMany({ data: nos.map((accessionNo) => ({ itemId, accessionNo, location: v.location || null })) });
    await audit({ ...actor(ctx), action: "library.copies.add", resourceType: "libraryItem", resourceId: itemId, summary: `${v.count} cop${v.count === 1 ? "y" : "ies"}: ${nos[0]}${nos.length > 1 ? `–${nos.at(-1)}` : ""}` }, tx);
    return nos;
  });
}

export async function setCopyStatus(ctx: AuthContext, copyId: string, status: "LOST" | "WITHDRAWN" | "AVAILABLE") {
  need(ctx, "library.manage");
  const c = await db.libraryCopy.findUnique({ where: { id: copyId } });
  if (!c) throw notFound("Copy");
  if (c.status === "ON_LOAN") throw workflowError("The copy is on loan. Receive it first (or record it lost when returning).");
  await db.libraryCopy.update({ where: { id: copyId }, data: { status } });
  await audit({ ...actor(ctx), action: "library.copy.status", resourceType: "libraryCopy", resourceId: copyId, summary: `${c.accessionNo}: ${c.status} → ${status}` });
}

/** Catalogue search for any signed-in user, with availability. */
export async function searchCatalogue(q: string, take = 40) {
  const words = q.trim().split(/\s+/).filter(Boolean).slice(0, 5);
  const where: Prisma.LibraryItemWhereInput = words.length
    ? { AND: words.map((w) => ({ OR: [{ title: { contains: w, mode: "insensitive" as const } }, { authors: { contains: w, mode: "insensitive" as const } }, { isbn: { contains: w.replace(/-/g, "") } }, { subject: { contains: w, mode: "insensitive" as const } }] })) }
    : {};
  const items = await db.libraryItem.findMany({ where, take, orderBy: { title: "asc" }, include: { copies: { select: { status: true } }, _count: { select: { holds: { where: { fulfilledAt: null, cancelledAt: null } } } } } });
  return items.map((i) => ({ ...i, total: i.copies.filter((c) => c.status !== "WITHDRAWN").length, available: i.copies.filter((c) => c.status === "AVAILABLE").length, holds: i._count.holds }));
}

// ───────────────────────── Borrowers ─────────────────────────

export type Borrower = { kind: "student"; id: string; name: string; number: string; userId: string | null; active: boolean } | { kind: "employee"; id: string; name: string; number: string; userId: string | null; active: boolean };

export async function findBorrower(code: string): Promise<Borrower> {
  const c = String(code ?? "").trim().toUpperCase();
  if (!c) throw invalid("Enter a student or employee number.");
  const s = await db.student.findFirst({ where: { studentNo: c, deletedAt: null } });
  if (s) return { kind: "student", id: s.id, name: `${s.firstName} ${s.lastName}`, number: s.studentNo, userId: s.userId, active: s.status === "ACTIVE" };
  const e = await db.employee.findFirst({ where: { employeeNo: c, deletedAt: null } });
  if (e) return { kind: "employee", id: e.id, name: `${e.firstName} ${e.lastName}`, number: e.employeeNo, userId: e.userId, active: ["ACTIVE", "ON_LEAVE"].includes(e.status) };
  throw notFound("Borrower");
}

const borrowerWhere = (b: Borrower) => (b.kind === "student" ? { studentId: b.id } : { employeeId: b.id });

/** Open loans, overdue count and unpaid (invoiced, not yet paid) fines of a borrower. */
export async function borrowerStatus(b: Borrower) {
  const now = new Date();
  const [loans, fined] = await Promise.all([
    db.libraryLoan.findMany({ where: { ...borrowerWhere(b), returnedAt: null }, include: { copy: { include: { item: { select: { title: true } } } } }, orderBy: { dueAt: "asc" } }),
    db.libraryLoan.findMany({ where: { ...borrowerWhere(b), fineInvoiceId: { not: null } }, select: { fineInvoiceId: true } }),
  ]);
  const unpaid = fined.length ? await db.invoice.aggregate({ where: { id: { in: fined.map((f) => f.fineInvoiceId!) }, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, _sum: { total: true, amountPaid: true } }) : null;
  return { loans, overdue: loans.filter((l) => l.dueAt < now).length, unpaidFines: unpaid ? toMinor(unpaid._sum.total) - toMinor(unpaid._sum.amountPaid) : 0 };
}

// ───────────────────────── Circulation ─────────────────────────

export async function issueCopy(ctx: AuthContext, raw: unknown) {
  need(ctx, "library.circulate");
  const v = z.object({ accessionNo: z.string().trim().min(2).max(30), borrower: z.string().trim().min(2).max(30) }).parse(raw);
  const [copy, b, cfg] = await Promise.all([db.libraryCopy.findUnique({ where: { accessionNo: v.accessionNo.toUpperCase() }, include: { item: true } }), findBorrower(v.borrower), getSetting("library")]);
  if (!copy) throw notFound("Copy");
  if (copy.status !== "AVAILABLE") throw workflowError(`${copy.accessionNo} is ${copy.status.toLowerCase().replace("_", " ")}.`);
  if (!b.active) throw workflowError(`${b.name} is not an active ${b.kind}.`);
  const st = await borrowerStatus(b);
  const block = canBorrow({ openLoans: st.loans.length, maxLoans: b.kind === "student" ? cfg.maxLoansStudent : cfg.maxLoansStaff, overdue: st.overdue, unpaidFines: st.unpaidFines });
  if (block) throw workflowError(block);
  // Holds are served first-come: a copy goes to the first person waiting.
  const firstHold = await db.libraryHold.findFirst({ where: { itemId: copy.itemId, fulfilledAt: null, cancelledAt: null }, orderBy: { createdAt: "asc" } });
  const holdIsTheirs = firstHold && (b.kind === "student" ? firstHold.studentId === b.id : firstHold.employeeId === b.id);
  if (firstHold && !holdIsTheirs) throw workflowError("This title is on hold for another reader.");
  const days = b.kind === "student" ? cfg.loanDaysStudent : cfg.loanDaysStaff;
  const due = new Date(Date.now() + days * 86_400_000);
  due.setUTCHours(18, 30, 0, 0);
  return db.$transaction(async (tx) => {
    const updated = await tx.libraryCopy.updateMany({ where: { id: copy.id, status: "AVAILABLE" }, data: { status: "ON_LOAN" } });
    if (!updated.count) throw conflict("The copy was just issued at another desk.");
    const loan = await tx.libraryLoan.create({ data: { copyId: copy.id, ...borrowerWhere(b), dueAt: due, issuedById: ctx.user.id } });
    if (firstHold) await tx.libraryHold.update({ where: { id: firstHold.id }, data: { fulfilledAt: new Date() } });
    await audit({ ...actor(ctx), action: "library.issue", resourceType: "libraryLoan", resourceId: loan.id, summary: `${copy.accessionNo} "${copy.item.title}" → ${b.number} ${b.name}, due ${due.toISOString().slice(0, 10)}` }, tx);
    return loan;
  });
}

async function fineHead(tx: Tx) {
  return tx.feeHead.findFirst({ where: { category: "FINE", isActive: true, OR: [{ code: "LIBFINE" }, { name: { contains: "library", mode: "insensitive" } }] } }) ?? tx.feeHead.findFirst({ where: { category: "FINE", isActive: true } });
}

/** Receive a copy. Overdue fines are computed; a student's fine is raised as an invoice when configured. */
export async function returnCopy(ctx: AuthContext, raw: unknown) {
  need(ctx, "library.circulate");
  const v = z.object({ accessionNo: z.string().trim().min(2).max(30), lost: z.boolean().default(false), waive: z.boolean().default(false), waiveReason: z.string().trim().max(300).nullable().optional() }).parse(raw);
  const copy = await db.libraryCopy.findUnique({ where: { accessionNo: v.accessionNo.toUpperCase() }, include: { item: true } });
  if (!copy) throw notFound("Copy");
  const loan = await db.libraryLoan.findFirst({ where: { copyId: copy.id, returnedAt: null }, include: { student: { select: { id: true, userId: true, studentNo: true } } } });
  if (!loan) throw workflowError(`${copy.accessionNo} is not on loan.`);
  if (v.waive && (!can(ctx, "library.manage") || (v.waiveReason ?? "").length < 5)) throw forbidden("Only the librarian can waive a fine, with a reason.");
  const cfg = await getSetting("library");
  const now = new Date();
  const fine = v.waive ? 0 : fineFor(loan.dueAt, now, Math.round(cfg.finePerDay * 100), Math.round(cfg.fineCap * 100));
  return db.$transaction(async (tx) => {
    let invoiceId: string | null = null;
    if (fine > 0 && loan.studentId && cfg.invoiceStudentFines) {
      const head = await fineHead(tx);
      if (head) {
        const inv = await issueInvoice(tx, { studentId: loan.studentId, dueDate: new Date(now.getTime() + 14 * 86_400_000), lines: [{ feeHeadId: head.id, description: `Library fine: ${copy.item.title} (${copy.accessionNo}), returned late`, amount: fine }], sourceType: "libraryLoan", sourceId: loan.id }, { id: ctx.user.id, name: ctx.user.name });
        invoiceId = inv.id;
      }
    }
    await tx.libraryLoan.update({ where: { id: loan.id }, data: { returnedAt: now, returnedToId: ctx.user.id, fineAmount: fromMinor(fine), fineInvoiceId: invoiceId } });
    await tx.libraryCopy.update({ where: { id: copy.id }, data: { status: v.lost ? "LOST" : "AVAILABLE" } });
    await audit({ ...actor(ctx), action: "library.return", resourceType: "libraryLoan", resourceId: loan.id, summary: `${copy.accessionNo} returned${v.lost ? " (lost)" : ""}${fine ? `, fine ${(fine / 100).toFixed(2)}${invoiceId ? " invoiced" : ""}` : ""}${v.waive ? `, fine waived: ${v.waiveReason}` : ""}` }, tx);
    // Tell the next reader waiting for this title.
    if (!v.lost) {
      const hold = await tx.libraryHold.findFirst({ where: { itemId: copy.itemId, fulfilledAt: null, cancelledAt: null }, orderBy: { createdAt: "asc" }, include: { student: { select: { userId: true } }, employee: { select: { userId: true } } } });
      const uid = hold?.student?.userId ?? hold?.employee?.userId;
      if (uid) await notify({ userIds: [uid], type: "library.hold", title: `"${copy.item.title}" is ready for you at the library`, link: "/library/my" }, tx);
    }
    return { fine, invoiceId };
  });
}

export async function renewLoan(ctx: AuthContext, loanId: string) {
  const loan = await db.libraryLoan.findUnique({ where: { id: loanId }, include: { copy: { include: { item: true } }, student: { select: { userId: true } }, employee: { select: { userId: true } } } });
  if (!loan || loan.returnedAt) throw notFound("Loan");
  const own = (loan.student?.userId ?? loan.employee?.userId) === ctx.user.id;
  if (!own && !can(ctx, "library.circulate")) throw notFound("Loan");
  const cfg = await getSetting("library");
  if (loan.renewals >= cfg.maxRenewals) throw workflowError(`Already renewed ${loan.renewals} time(s), the maximum.`);
  if (loan.dueAt < new Date()) throw workflowError("Overdue items cannot be renewed; return them at the desk.");
  if (await db.libraryHold.count({ where: { itemId: loan.copy.itemId, fulfilledAt: null, cancelledAt: null } })) throw workflowError("Another reader is waiting for this title.");
  const days = loan.studentId ? cfg.loanDaysStudent : cfg.loanDaysStaff;
  const due = new Date(loan.dueAt.getTime() + days * 86_400_000);
  await db.libraryLoan.update({ where: { id: loanId }, data: { dueAt: due, renewals: { increment: 1 } } });
  await audit({ ...actor(ctx), action: "library.renew", resourceType: "libraryLoan", resourceId: loanId, summary: `${loan.copy.accessionNo} renewed to ${due.toISOString().slice(0, 10)}` });
  return due;
}

/** A reader asks to be next for a title with no copy on the shelf. */
export async function placeHold(ctx: AuthContext, itemId: string) {
  const who = ctx.subject.studentId ? { studentId: ctx.subject.studentId } : ctx.subject.employeeId ? { employeeId: ctx.subject.employeeId } : null;
  if (!who) throw forbidden("Only students and staff can place holds.");
  const item = await db.libraryItem.findUnique({ where: { id: itemId }, include: { copies: { select: { status: true } } } });
  if (!item) throw notFound("Item");
  if (item.copies.some((c) => c.status === "AVAILABLE")) throw workflowError("A copy is on the shelf; borrow it at the desk.");
  if (!item.copies.some((c) => c.status === "ON_LOAN")) throw workflowError("The library has no copy of this title in circulation.");
  if (await db.libraryHold.count({ where: { itemId, ...who, fulfilledAt: null, cancelledAt: null } })) throw conflict("You already have a hold on this title.");
  const h = await db.libraryHold.create({ data: { itemId, ...who } });
  await audit({ ...actor(ctx), action: "library.hold", resourceType: "libraryItem", resourceId: itemId, summary: item.title });
  return h;
}

export async function cancelHold(ctx: AuthContext, holdId: string) {
  const h = await db.libraryHold.findUnique({ where: { id: holdId } });
  const own = h && ((h.studentId && h.studentId === ctx.subject.studentId) || (h.employeeId && h.employeeId === ctx.subject.employeeId));
  if (!h || (!own && !can(ctx, "library.circulate"))) throw notFound("Hold");
  await db.libraryHold.update({ where: { id: holdId }, data: { cancelledAt: new Date() } });
}

/** Remind borrowers the day before items are due and when they are overdue (worker job). */
export async function sendLibraryReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 86_400_000);
  const loans = await db.libraryLoan.findMany({ where: { returnedAt: null, dueAt: { lte: soon } }, include: { copy: { include: { item: { select: { title: true } } } }, student: { select: { userId: true } }, employee: { select: { userId: true } } } });
  let sent = 0;
  for (const l of loans) {
    const uid = l.student?.userId ?? l.employee?.userId;
    if (!uid) continue;
    const overdue = l.dueAt < now;
    await notify({ userIds: [uid], type: "library.due", title: overdue ? `Overdue: "${l.copy.item.title}"` : `Due tomorrow: "${l.copy.item.title}"`, body: overdue ? "Fines accrue daily until the item is returned." : undefined, link: "/library/my", email: overdue });
    sent++;
  }
  return sent;
}
