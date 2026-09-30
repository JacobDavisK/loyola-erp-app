/**
 * Campus-services rules (pure): library fines and loan limits, helpdesk SLA, announcement audiences,
 * admission merit and offers, and placement eligibility.
 */
import { z } from "zod";

const DAY = 86_400_000;

// ───────────────────────── Library ─────────────────────────

/** Whole days late (a return on the due day is on time), counted in UTC days. */
export function daysLate(dueAt: Date, returnedAt: Date): number {
  const d = Math.floor(Date.UTC(returnedAt.getUTCFullYear(), returnedAt.getUTCMonth(), returnedAt.getUTCDate()) / DAY) - Math.floor(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth(), dueAt.getUTCDate()) / DAY);
  return Math.max(0, d);
}

/** Overdue fine in minor units, optionally capped. */
export function fineFor(dueAt: Date, returnedAt: Date, perDayMinor: number, capMinor = 0): number {
  const f = daysLate(dueAt, returnedAt) * perDayMinor;
  return capMinor > 0 ? Math.min(f, capMinor) : f;
}

export function canBorrow(input: { openLoans: number; maxLoans: number; overdue: number; unpaidFines: number }): string | null {
  if (input.overdue > 0) return "The borrower has overdue items. Return them first.";
  if (input.unpaidFines > 0) return "The borrower has unpaid library fines.";
  if (input.openLoans >= input.maxLoans) return `The borrower already has ${input.openLoans} item(s), the maximum.`;
  return null;
}

// ───────────────────────── Helpdesk ─────────────────────────

export const categorySchema = z.object({ key: z.string().regex(/^[a-z0-9_-]{2,30}$/), label: z.string().min(2).max(80), slaHours: z.number().int().min(1).max(720), queuePermission: z.enum(["helpdesk.agent"]).default("helpdesk.agent") });
export const PRIORITY_FACTOR = { LOW: 2, NORMAL: 1, HIGH: 0.5, URGENT: 0.25 } as const;

export function slaDue(createdAt: Date, slaHours: number, priority: keyof typeof PRIORITY_FACTOR): Date {
  return new Date(createdAt.getTime() + Math.max(1, Math.round(slaHours * PRIORITY_FACTOR[priority])) * 3_600_000);
}

export type TicketState = "OPEN" | "IN_PROGRESS" | "WAITING" | "RESOLVED" | "CLOSED";
const TICKET_MOVES: Record<TicketState, TicketState[]> = {
  OPEN: ["IN_PROGRESS", "WAITING", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["WAITING", "RESOLVED", "CLOSED"],
  WAITING: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED", "IN_PROGRESS"],
  CLOSED: [],
};
export const canMoveTicket = (from: TicketState, to: TicketState) => TICKET_MOVES[from].includes(to);

// ───────────────────────── Announcements ─────────────────────────

export type Audience = "EVERYONE" | "STAFF" | "STUDENTS" | "GUARDIANS";

/** Whether an announcement reaches a reader. Students and guardians are narrowed by department/programme. */
export function reaches(a: { audience: Audience; departmentId: string | null; programId: string | null }, reader: { userType: "STAFF" | "STUDENT" | "GUARDIAN"; studentLinks: { departmentId: string; programId: string }[] }): boolean {
  const kindOk = a.audience === "EVERYONE" || (a.audience === "STAFF" && reader.userType === "STAFF") || (a.audience === "STUDENTS" && reader.userType === "STUDENT") || (a.audience === "GUARDIANS" && reader.userType === "GUARDIAN");
  if (!kindOk) return false;
  if (reader.userType === "STAFF" || (!a.departmentId && !a.programId)) return true;
  return reader.studentLinks.some((l) => (!a.departmentId || l.departmentId === a.departmentId) && (!a.programId || l.programId === a.programId));
}

// ───────────────────────── Admissions ─────────────────────────

export interface MeritWeights { qualifying: number; entrance: number }

/** Weighted merit score out of 100: qualifying % and entrance score (already out of 100). Missing entrance counts 0. */
export function meritScore(qualifyingPercent: number, entranceScore: number | null, w: MeritWeights): number {
  const total = w.qualifying + w.entrance;
  if (total <= 0) return 0;
  return Math.round(((qualifyingPercent * w.qualifying + (entranceScore ?? 0) * w.entrance) / total) * 100) / 100;
}

/**
 * Next offers for a programme: rank verified applicants by merit (ties: earlier application first) and fill
 * the seats left after accepted/enrolled applicants and still-valid offers.
 */
export function nextOffers<T extends { id: string; meritScore: number | null; createdAt: Date }>(verified: T[], seats: number, taken: number): T[] {
  const free = Math.max(0, seats - taken);
  return [...verified].sort((a, b) => (b.meritScore ?? 0) - (a.meritScore ?? 0) || a.createdAt.getTime() - b.createdAt.getTime()).slice(0, free);
}

// ───────────────────────── Placements ─────────────────────────

export const driveEligibilitySchema = z.object({
  minCgpa: z.number().min(0).max(10).optional(),
  programCodes: z.array(z.string()).optional(),
  maxActiveBacklogs: z.number().int().min(0).optional(),
  batchYears: z.array(z.number().int()).optional(),
});
export type DriveEligibility = z.infer<typeof driveEligibilitySchema>;
export interface PlacementFacts { cgpa: number | null; programCode: string; activeBacklogs: number; admissionYear: number; placedCount: number }

export function checkDriveEligibility(e: DriveEligibility, f: PlacementFacts, oneOfferPolicy: boolean): { eligible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (e.minCgpa !== undefined && (f.cgpa ?? 0) < e.minCgpa) reasons.push(`CGPA ${f.cgpa ?? "—"} is below ${e.minCgpa}`);
  if (e.programCodes?.length && !e.programCodes.includes(f.programCode)) reasons.push("Programme not eligible");
  if (e.maxActiveBacklogs !== undefined && f.activeBacklogs > e.maxActiveBacklogs) reasons.push(`${f.activeBacklogs} active backlog(s)`);
  if (e.batchYears?.length && !e.batchYears.includes(f.admissionYear)) reasons.push("Batch not eligible");
  if (oneOfferPolicy && f.placedCount > 0) reasons.push("Already placed (one-offer policy)");
  return { eligible: reasons.length === 0, reasons };
}
