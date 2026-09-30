import "server-only";
import { z } from "zod";
import { BRAND } from "@/lib/brand";
import { meritScore, nextOffers } from "@/lib/domain/campus";
import { type AuthContext, can } from "@/server/auth/current";
import { db, type Tx } from "@/server/db";
import { env } from "@/server/env";
import { conflict, forbidden, invalid, notFound, workflowError } from "@/server/errors";
import { randomToken, safeEqual, sha256 } from "@/server/security/crypto";
import { assertRate } from "@/server/security/rate-limit";
import { audit } from "@/server/services/audit";
import { nextNumber } from "@/server/services/sequence";
import { getSetting } from "@/server/services/settings";
import { insertStudent } from "@/server/services/students";

/**
 * Admissions: cycles with a seat matrix per programme, a public online application (rate-limited, no account
 * needed; the applicant gets a private status link), verification with merit scoring, merit-ordered offers
 * that lapse if not accepted, and enrolment that creates the student record through the SIS.
 */

const actor = (ctx: AuthContext) => ({ actorId: ctx.user.id, actorName: ctx.user.name });
const needManage = (ctx: AuthContext) => {
  if (!can(ctx, "admission.manage")) throw forbidden();
};

/** Applicants have no account: they are told by e-mail (outbox driver) and on their private status page. */
async function mailApplicant(tx: Tx | typeof db, to: string, subject: string, text: string) {
  if (env.EMAIL_DRIVER !== "outbox") return;
  await tx.emailOutbox.create({ data: { to, subject: `${BRAND.mailTag} ${subject}`, text } });
}

const statusLink = (number: string, token: string) => `${env.APP_URL}/apply/status?n=${encodeURIComponent(number)}&t=${encodeURIComponent(token)}`;

// ───────────────────────── Cycles & seats ─────────────────────────

export const cycleSchema = z.object({
  name: z.string().trim().min(3).max(160),
  academicYearId: z.string().min(1),
  opensAt: z.coerce.date(),
  closesAt: z.coerce.date(),
  isPublic: z.boolean().default(false),
}).refine((v) => v.closesAt > v.opensAt, { path: ["closesAt"], message: "Closing must be after opening" });

export async function saveCycle(ctx: AuthContext, id: string | null, raw: unknown) {
  needManage(ctx);
  const v = cycleSchema.parse(raw);
  const c = id ? await db.admissionCycle.update({ where: { id }, data: v }) : await db.admissionCycle.create({ data: v });
  await audit({ ...actor(ctx), action: id ? "admission.cycle.update" : "admission.cycle.create", resourceType: "admissionCycle", resourceId: c.id, summary: `${c.name}${c.isPublic ? " (public)" : ""}` });
  return c;
}

export async function setSeats(ctx: AuthContext, cycleId: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ programId: z.string().min(1), batchId: z.string().min(1), seats: z.number().int().min(0).max(10_000), offerValidDays: z.number().int().min(1).max(90).default(7) }).parse(raw);
  const batch = await db.batch.findFirst({ where: { id: v.batchId, programId: v.programId, deletedAt: null } });
  if (!batch) throw invalid("Choose a batch of the programme.");
  const s = await db.admissionSeat.upsert({ where: { cycleId_programId: { cycleId, programId: v.programId } }, create: { cycleId, ...v }, update: { batchId: v.batchId, seats: v.seats, offerValidDays: v.offerValidDays } });
  await audit({ ...actor(ctx), action: "admission.seats", resourceType: "admissionCycle", resourceId: cycleId, summary: `${batch.code}: ${v.seats} seat(s)` });
  return s;
}

// ───────────────────────── Public application ─────────────────────────

export const applicationSchema = z.object({
  cycleId: z.string().min(1),
  programId: z.string().min(1),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  phone: z.string().trim().regex(/^[+0-9 ()-]{7,20}$/, "Enter a valid phone number"),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  gender: z.enum(["FEMALE", "MALE", "OTHER", "UNDISCLOSED"]).nullable().optional().or(z.literal("")),
  category: z.string().trim().max(40).nullable().optional(),
  qualifyingExam: z.string().trim().min(2).max(120),
  qualifyingPercent: z.number().min(0).max(100),
  declaration: z.literal(true, { message: "Confirm that the information is correct" }),
});

/** Open cycles and programmes with seats, for the public form. */
export async function openCycles(now = new Date()) {
  return db.admissionCycle.findMany({ where: { isPublic: true, opensAt: { lte: now }, closesAt: { gt: now } }, include: { seats: { where: { seats: { gt: 0 } }, include: { program: { select: { id: true, code: true, name: true } } } } }, orderBy: { closesAt: "asc" } });
}

export async function submitApplication(raw: unknown, ip: string) {
  assertRate(`apply:ip:${ip}`, 5, 3_600_000);
  const v = applicationSchema.parse(raw);
  assertRate(`apply:email:${v.email}`, 3, 86_400_000);
  const now = new Date();
  const cycle = await db.admissionCycle.findFirst({ where: { id: v.cycleId, isPublic: true, opensAt: { lte: now }, closesAt: { gt: now } }, include: { seats: { where: { programId: v.programId, seats: { gt: 0 } } } } });
  if (!cycle || !cycle.seats.length) throw invalid("Applications for this programme are not open.");
  const dob = new Date(`${v.dateOfBirth}T00:00:00Z`);
  const age = (now.getTime() - dob.getTime()) / (365.25 * 86_400_000);
  if (age < 14 || age > 80) throw invalid("Check the date of birth.");
  if (await db.admissionApplication.count({ where: { cycleId: v.cycleId, programId: v.programId, email: v.email, status: { notIn: ["WITHDRAWN", "REJECTED"] } } })) throw conflict("An application with this e-mail already exists for this programme. Use the status link sent to you.");
  const token = randomToken(24);
  const { applicationPrefix } = await getSetting("admissions");
  return db.$transaction(async (tx) => {
    const number = await nextNumber(tx, "admission.application", { prefix: applicationPrefix, padding: 6 });
    const a = await tx.admissionApplication.create({
      data: {
        number, cycleId: v.cycleId, programId: v.programId, firstName: v.firstName, lastName: v.lastName, email: v.email, phone: v.phone, dateOfBirth: dob, gender: (v.gender || null) as "FEMALE" | "MALE" | "OTHER" | "UNDISCLOSED" | null,
        category: v.category || null, qualifyingExam: v.qualifyingExam, qualifyingPercent: v.qualifyingPercent, accessTokenHash: sha256(token), submittedIp: ip,
      },
    });
    await mailApplicant(tx, v.email, `Application ${number} received`, `Dear ${v.firstName},\n\nWe have received your application ${number}. Track its status and respond to any offer here (keep this link private):\n${statusLink(number, token)}\n`);
    await audit({ actorId: null, actorName: `Applicant ${v.email}`, action: "admission.apply", resourceType: "admissionApplication", resourceId: a.id, summary: `${number} ${v.firstName} ${v.lastName}` }, tx);
    return { number, token, id: a.id };
  });
}

/** The applicant's own view, authenticated by the number + secret token pair (constant-time compare). */
export async function applicationByToken(number: string, token: string) {
  assertRate(`apply:status:${number}`, 30, 600_000);
  const a = await db.admissionApplication.findUnique({ where: { number: String(number ?? "") }, include: { program: { select: { name: true } }, cycle: { select: { name: true } } } });
  if (!a || !token || !safeEqual(a.accessTokenHash, sha256(String(token)))) throw notFound("Application");
  return a;
}

export async function respondToOffer(number: string, token: string, accept: boolean) {
  const a = await applicationByToken(number, token);
  if (a.status !== "OFFERED") throw workflowError("There is no open offer on this application.");
  if (a.offerExpiresAt && a.offerExpiresAt < new Date()) throw workflowError("The offer has lapsed.");
  await db.admissionApplication.update({ where: { id: a.id }, data: { status: accept ? "ACCEPTED" : "DECLINED" } });
  await audit({ actorId: null, actorName: `Applicant ${a.email}`, action: accept ? "admission.offer.accept" : "admission.offer.decline", resourceType: "admissionApplication", resourceId: a.id, summary: a.number });
}

// ───────────────────────── Office processing ─────────────────────────

export async function verifyApplication(ctx: AuthContext, id: string, raw: unknown) {
  needManage(ctx);
  const v = z.object({ decision: z.enum(["verify", "reject"]), entranceScore: z.number().min(0).max(100).nullable().optional(), remarks: z.string().trim().max(500).nullable().optional() }).parse(raw);
  const a = await db.admissionApplication.findUnique({ where: { id } });
  if (!a) throw notFound("Application");
  if (a.status !== "SUBMITTED" && a.status !== "VERIFIED") throw workflowError(`The application is ${a.status.toLowerCase()}.`);
  if (v.decision === "reject" && (v.remarks ?? "").length < 5) throw invalid("Give the reason for rejection.");
  const w = await getSetting("admissions");
  const entrance = v.entranceScore ?? a.entranceScore;
  await db.$transaction(async (tx) => {
    await tx.admissionApplication.update({
      where: { id },
      data: v.decision === "verify"
        ? { status: "VERIFIED", entranceScore: entrance, meritScore: meritScore(a.qualifyingPercent, entrance, { qualifying: w.weightQualifying, entrance: w.weightEntrance }), remarks: v.remarks || null }
        : { status: "REJECTED", remarks: v.remarks },
    });
    if (v.decision === "reject") await mailApplicant(tx, a.email, `Application ${a.number}`, `Dear ${a.firstName},\n\nWe are unable to take your application ${a.number} forward: ${v.remarks}\n`);
    await audit({ ...actor(ctx), action: `admission.${v.decision}`, resourceType: "admissionApplication", resourceId: id, summary: `${a.number}${v.remarks ? `: ${v.remarks}` : ""}` }, tx);
  });
}

/** Lapse offers past their validity (worker job and before each offer round). */
export async function expireOffers(now = new Date()) {
  const r = await db.admissionApplication.updateMany({ where: { status: "OFFERED", offerExpiresAt: { lt: now } }, data: { status: "DECLINED", remarks: "Offer lapsed without acceptance" } });
  return r.count;
}

/** One offer round for a programme: fill free seats from the verified merit list. */
export async function makeOffers(ctx: AuthContext, cycleId: string, programId: string) {
  needManage(ctx);
  await expireOffers();
  const seat = await db.admissionSeat.findUnique({ where: { cycleId_programId: { cycleId, programId } } });
  if (!seat) throw notFound("Seat matrix");
  const now = new Date();
  const [taken, verified] = await Promise.all([
    db.admissionApplication.count({ where: { cycleId, programId, OR: [{ status: { in: ["ACCEPTED", "ENROLLED"] } }, { status: "OFFERED", offerExpiresAt: { gte: now } }] } }),
    db.admissionApplication.findMany({ where: { cycleId, programId, status: "VERIFIED" }, select: { id: true, meritScore: true, createdAt: true, email: true, firstName: true, number: true } }),
  ]);
  const offers = nextOffers(verified, seat.seats, taken);
  const expires = new Date(now.getTime() + seat.offerValidDays * 86_400_000);
  await db.$transaction(async (tx) => {
    for (const o of offers) {
      await tx.admissionApplication.update({ where: { id: o.id }, data: { status: "OFFERED", offerExpiresAt: expires } });
      await mailApplicant(tx, o.email, `Offer of admission — ${o.number}`, `Dear ${o.firstName},\n\nWe are pleased to offer you admission. Accept or decline using your status link before ${expires.toISOString().slice(0, 10)}; the offer lapses after that.\n`);
    }
    await audit({ ...actor(ctx), action: "admission.offers", resourceType: "admissionCycle", resourceId: cycleId, summary: `${offers.length} offer(s); ${taken} seat(s) already taken of ${seat.seats}` }, tx);
  });
  return { offered: offers.length, free: Math.max(0, seat.seats - taken) };
}

/** Create the student record for an accepted applicant, in the batch set in the seat matrix. */
export async function enrolApplicant(ctx: AuthContext, id: string) {
  needManage(ctx);
  if (!can(ctx, "student.create")) throw forbidden();
  const a = await db.admissionApplication.findUnique({ where: { id }, include: { cycle: true } });
  if (!a) throw notFound("Application");
  if (a.status !== "ACCEPTED") throw workflowError("Only applicants who accepted an offer can be enrolled.");
  const seat = await db.admissionSeat.findUniqueOrThrow({ where: { cycleId_programId: { cycleId: a.cycleId, programId: a.programId } } });
  return db.$transaction(async (tx) => {
    const s = await insertStudent(tx, { id: ctx.user.id, name: ctx.user.name }, {
      firstName: a.firstName, lastName: a.lastName, email: a.email, phone: a.phone, dateOfBirth: a.dateOfBirth, gender: a.gender, nationality: null, category: a.category, bloodGroup: null,
      programId: a.programId, batchId: seat.batchId, section: null, specialization: null, currentSemester: 1, admissionNo: null, registrationNo: null, admittedOn: new Date(), address: null,
      emergencyName: null, emergencyRelation: null, emergencyPhone: null,
    });
    await tx.admissionApplication.update({ where: { id }, data: { status: "ENROLLED", studentId: s.id } });
    await audit({ ...actor(ctx), action: "admission.enrol", resourceType: "admissionApplication", resourceId: id, summary: `${a.number} → ${s.studentNo}` }, tx);
    return s;
  });
}
