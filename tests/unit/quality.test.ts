import { describe, expect, it } from "vitest";
import { checkExpense, cycleProgress, normaliseDoi, parseOutline, utilisation } from "@/lib/domain/quality";

describe("grant budgets", () => {
  it("computes utilisation per head and guards overspending", () => {
    const u = utilisation([{ head: "EQUIPMENT", amount: 500000_00 }, { head: "TRAVEL", amount: 50000_00 }], [{ head: "EQUIPMENT", amount: 200000_00 }, { head: "EQUIPMENT", amount: -10000_00 }]);
    const eq = u.heads.find((h) => h.head === "EQUIPMENT")!;
    expect(eq).toMatchObject({ spent: 190000_00, remaining: 310000_00, percent: 38 });
    expect(u.sanctioned).toBe(550000_00);
    expect(checkExpense(eq, 310000_00)).toBeNull();
    expect(checkExpense(eq, 310000_01)).toMatch(/Only 310000.00 remains/);
    expect(checkExpense(eq, -200000_00)).toMatch(/below zero/);
    expect(checkExpense(undefined, 100)).toMatch(/Nothing was sanctioned/);
    expect(checkExpense(eq, 0)).toMatch(/zero/);
  });
});

describe("publications", () => {
  it("normalises DOIs", () => {
    expect(normaliseDoi("https://doi.org/10.1109/TKDE.2020.12345")).toBe("10.1109/tkde.2020.12345");
    expect(normaliseDoi("doi: 10.1000/XYZ")).toBe("10.1000/xyz");
    expect(normaliseDoi("not a doi")).toBeNull();
    expect(normaliseDoi("")).toBeNull();
  });
});

describe("accreditation", () => {
  it("parses a metric outline with parents", () => {
    const { lines, errors } = parseOutline("# NAAC\n3 | Research | N | 110\n3.3 | Research publications | N\n3.3.1 | Papers per teacher | Q | 10 | publications.perFaculty | papers\nbad code! | x\n3.3.1 | dup");
    expect(errors).toHaveLength(2);
    expect(lines.map((l) => [l.code, l.parentCode, l.kind])).toEqual([["3", null, "QUALITATIVE"], ["3.3", "3", "QUALITATIVE"], ["3.3.1", "3.3", "QUANTITATIVE"]]);
    expect(lines[2]).toMatchObject({ weight: 10, source: "publications.perFaculty", unit: "papers" });
  });
  it("weights progress", () => {
    const p = cycleProgress([{ weight: 10, status: "APPROVED" }, { weight: 10, status: "SUBMITTED" }, { weight: 20, status: "NOT_STARTED" }, { weight: 0, status: "DRAFT" }]);
    expect(p.percent).toBe(36.6);
    expect(p).toMatchObject({ approved: 1, submitted: 1, draft: 1, notStarted: 1, total: 4 });
  });
});
