import { describe, expect, it } from "vitest";
import { canBorrow, canMoveTicket, checkDriveEligibility, daysLate, fineFor, meritScore, nextOffers, reaches, slaDue } from "@/lib/domain/campus";

const d = (s: string) => new Date(s);

describe("library", () => {
  it("charges per whole day late with an optional cap", () => {
    expect(daysLate(d("2026-10-10T18:00:00Z"), d("2026-10-10T23:00:00Z"))).toBe(0);
    expect(daysLate(d("2026-10-10T18:00:00Z"), d("2026-10-13T09:00:00Z"))).toBe(3);
    expect(fineFor(d("2026-10-10T00:00:00Z"), d("2026-10-15T00:00:00Z"), 200)).toBe(1000);
    expect(fineFor(d("2026-10-10T00:00:00Z"), d("2026-11-30T00:00:00Z"), 200, 5000)).toBe(5000);
  });
  it("blocks borrowing on overdue items, unpaid fines and limits", () => {
    expect(canBorrow({ openLoans: 1, maxLoans: 3, overdue: 0, unpaidFines: 0 })).toBeNull();
    expect(canBorrow({ openLoans: 3, maxLoans: 3, overdue: 0, unpaidFines: 0 })).toMatch(/maximum/);
    expect(canBorrow({ openLoans: 0, maxLoans: 3, overdue: 1, unpaidFines: 0 })).toMatch(/overdue/);
    expect(canBorrow({ openLoans: 0, maxLoans: 3, overdue: 0, unpaidFines: 500 })).toMatch(/fines/);
  });
});

describe("helpdesk", () => {
  it("scales SLA by priority and controls status moves", () => {
    const t = d("2026-10-01T10:00:00Z");
    expect(slaDue(t, 24, "NORMAL").toISOString()).toBe("2026-10-02T10:00:00.000Z");
    expect(slaDue(t, 24, "URGENT").toISOString()).toBe("2026-10-01T16:00:00.000Z");
    expect(canMoveTicket("OPEN", "RESOLVED")).toBe(true);
    expect(canMoveTicket("CLOSED", "OPEN")).toBe(false);
    expect(canMoveTicket("RESOLVED", "IN_PROGRESS")).toBe(true);
  });
});

describe("announcements", () => {
  const cs = { departmentId: "cs", programId: "bca" };
  it("reaches the right readers", () => {
    expect(reaches({ audience: "EVERYONE", departmentId: null, programId: null }, { userType: "GUARDIAN", studentLinks: [cs] })).toBe(true);
    expect(reaches({ audience: "STAFF", departmentId: null, programId: null }, { userType: "STUDENT", studentLinks: [cs] })).toBe(false);
    expect(reaches({ audience: "STUDENTS", departmentId: "cs", programId: null }, { userType: "STUDENT", studentLinks: [cs] })).toBe(true);
    expect(reaches({ audience: "STUDENTS", departmentId: "com", programId: null }, { userType: "STUDENT", studentLinks: [cs] })).toBe(false);
    expect(reaches({ audience: "GUARDIANS", departmentId: null, programId: "bca" }, { userType: "GUARDIAN", studentLinks: [cs] })).toBe(true);
  });
});

describe("admissions", () => {
  it("computes merit and fills free seats in merit order", () => {
    expect(meritScore(90, 70, { qualifying: 60, entrance: 40 })).toBe(82);
    expect(meritScore(90, null, { qualifying: 100, entrance: 0 })).toBe(90);
    const a = (id: string, m: number, t: string) => ({ id, meritScore: m, createdAt: d(t) });
    const list = [a("x", 80, "2026-05-02"), a("y", 92, "2026-05-03"), a("z", 80, "2026-05-01"), a("w", 60, "2026-05-01")];
    expect(nextOffers(list, 5, 2).map((x) => x.id)).toEqual(["y", "z", "x"]);
    expect(nextOffers(list, 2, 2)).toEqual([]);
  });
});

describe("placements", () => {
  it("checks drive eligibility", () => {
    const facts = { cgpa: 7.2, programCode: "BCA", activeBacklogs: 1, admissionYear: 2024, placedCount: 0 };
    expect(checkDriveEligibility({ minCgpa: 6.5, programCodes: ["BCA"], maxActiveBacklogs: 1, batchYears: [2024] }, facts, true).eligible).toBe(true);
    const r = checkDriveEligibility({ minCgpa: 7.5, maxActiveBacklogs: 0 }, { ...facts, placedCount: 1 }, true);
    expect(r.reasons).toHaveLength(3);
  });
});
