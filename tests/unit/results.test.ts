import { describe, expect, it } from "vitest";
import { aggregateComponents, bandFor, bandsSchema, cgpa, computeCourse, gpa, type GradingSpec } from "@/lib/domain/grading";
import { allocateSeats, invigilatorsNeeded } from "@/lib/domain/seating";
import { revaluationOutcome, valuationState, type ValuationPolicy } from "@/lib/domain/valuation";

const bands = [
  { grade: "O", minPercent: 90, gradePoint: 10, pass: true },
  { grade: "A+", minPercent: 80, gradePoint: 9, pass: true },
  { grade: "A", minPercent: 70, gradePoint: 8, pass: true },
  { grade: "B", minPercent: 50, gradePoint: 6, pass: true },
  { grade: "P", minPercent: 40, gradePoint: 4, pass: true },
  { grade: "RA", minPercent: 0, gradePoint: 0, pass: false },
];
const spec: GradingSpec = { bands, passPercent: 40, minExternalPercent: 40, minInternalPercent: 0, absentGrade: "AB", failGrade: "RA", withheldGrade: "WH", graceMaxPerCourse: 3, gpaDecimals: 2 };
const course = (internal: number | null, external: number | null, extra: Partial<Parameters<typeof computeCourse>[0]> = {}) =>
  ({ credits: 4, internalMax: 25, externalMax: 75, internal, external, externalAbsent: false, ...extra });

describe("grading", () => {
  it("grades by band and computes credit points", () => {
    const o = computeCourse(course(22, 60), spec);
    expect(o.percent).toBe(82);
    expect(o.grade).toBe("A+");
    expect(o.creditPoints).toBe(36);
    expect(bandFor(40, bands).grade).toBe("P");
  });
  it("fails on the external minimum even when the total passes", () => {
    const o = computeCourse(course(25, 28), spec); // 53% overall, external 28/75 < 40%
    expect(o.status).toBe("FAIL");
    expect(o.grade).toBe("RA");
  });
  it("applies grace only when it closes the gap within the limits", () => {
    const withGrace = computeCourse(course(10, 28), spec, 6); // needs 2 to reach 30 external
    expect(withGrace.status).toBe("PASS");
    expect(withGrace.graceMarks).toBe(2);
    expect(withGrace.externalMarks).toBe(28);
    expect(computeCourse(course(10, 25), spec, 6).status).toBe("FAIL"); // needs 5 > 3 per course
    expect(computeCourse(course(10, 28), spec, 1).status).toBe("FAIL"); // student budget exhausted
  });
  it("handles absent, incomplete, withheld and malpractice", () => {
    expect(computeCourse(course(20, null, { externalAbsent: true }), spec).grade).toBe("AB");
    expect(computeCourse(course(null, 50), spec).status).toBe("INCOMPLETE");
    expect(computeCourse(course(20, 50, { withheld: "Enquiry" }), spec).grade).toBe("WH");
    expect(computeCourse(course(20, 70, { malpractice: true }), spec).status).toBe("FAIL");
  });
  it("computes SGPA with failed credits in the denominator and CGPA on latest attempts", () => {
    const t = gpa([
      { courseId: "a", credits: 4, gradePoint: 10, status: "PASS" },
      { courseId: "b", credits: 4, gradePoint: 0, status: "FAIL" },
      { courseId: "c", credits: 2, gradePoint: 0, status: "WITHHELD" },
    ]);
    expect(t.gpa).toBe(5);
    expect(t.creditsEarned).toBe(4);
    const c = cgpa([
      { courseId: "a", credits: 4, gradePoint: 10, status: "PASS", attempt: 1 },
      { courseId: "b", credits: 4, gradePoint: 0, status: "FAIL", attempt: 1 },
      { courseId: "b", credits: 4, gradePoint: 6, status: "PASS", attempt: 2 },
    ]);
    expect(c.gpa).toBe(8);
  });
  it("validates band tables", () => {
    expect(bandsSchema.safeParse(bands).success).toBe(true);
    expect(bandsSchema.safeParse(bands.slice(0, 5)).success).toBe(false); // no 0% band
  });
  it("aggregates weighted components", () => {
    const a = aggregateComponents([
      { maxMarks: 50, weight: 10, marks: 40, status: "PRESENT" },
      { maxMarks: 50, weight: 10, marks: null, status: "ABSENT" },
      { maxMarks: 10, weight: 5, marks: 10, status: "PRESENT" },
    ]);
    expect(a.marks).toBe(13);
    expect(a.absent).toBe(1);
    expect(aggregateComponents([{ maxMarks: 10, weight: 5, marks: null, status: "PRESENT" }]).marks).toBeNull();
  });
});

const policy: ValuationPolicy = { doubleValuation: true, maxDifferencePercent: 15, method: "AVERAGE", revaluationMinChange: 2 };

describe("valuation", () => {
  it("waits for both valuations, then averages when they agree", () => {
    expect(valuationState([], 75, policy)).toEqual({ kind: "WAITING", next: 1 });
    expect(valuationState([{ round: 1, marks: 50 }], 75, policy)).toEqual({ kind: "WAITING", next: 2 });
    expect(valuationState([{ round: 1, marks: 50 }, { round: 2, marks: 53 }], 75, policy)).toMatchObject({ kind: "FINAL", marks: 51.5 });
    expect(valuationState([{ round: 1, marks: 50 }, { round: 2, marks: 53 }], 75, { ...policy, method: "HIGHER" })).toMatchObject({ marks: 53 });
    expect(valuationState([{ round: 1, marks: 50 }], 75, { ...policy, doubleValuation: false })).toMatchObject({ kind: "FINAL", marks: 50 });
  });
  it("requires a third valuation on a large difference and averages with the closer mark", () => {
    const rounds = [{ round: 1, marks: 60 }, { round: 2, marks: 30 }];
    expect(valuationState(rounds, 75, policy).kind).toBe("THIRD_NEEDED");
    expect(valuationState([...rounds, { round: 3, marks: 56 }], 75, policy)).toMatchObject({ kind: "FINAL", marks: 58 });
  });
  it("keeps the original result for small revaluation changes", () => {
    expect(revaluationOutcome(50, 51, policy)).toEqual({ finalMarks: 50, outcome: "UNCHANGED" });
    expect(revaluationOutcome(50, 55, policy)).toEqual({ finalMarks: 55, outcome: "INCREASED" });
    expect(revaluationOutcome(50, 44, policy).outcome).toBe("DECREASED");
  });
});

describe("seating", () => {
  it("interleaves papers and fills rooms in order", () => {
    const c = [...Array(4)].map((_, i) => ({ registrationId: `a${i}`, examinationId: "A", sortKey: `a${i}` })).concat([...Array(3)].map((_, i) => ({ registrationId: `b${i}`, examinationId: "B", sortKey: `b${i}` })));
    const plan = allocateSeats(c, [{ id: "R1", code: "R1", seats: 4 }, { id: "R2", code: "R2", seats: 10 }]);
    expect(plan.unseated).toEqual([]);
    expect(plan.assignments.slice(0, 4).map((a) => a.registrationId[0])).toEqual(["a", "b", "a", "b"]);
    expect(plan.assignments.filter((a) => a.roomId === "R1")).toHaveLength(4);
    expect(allocateSeats(c, [{ id: "R1", code: "R1", seats: 5 }]).unseated).toHaveLength(2);
    expect(invigilatorsNeeded(61)).toBe(3);
    expect(invigilatorsNeeded(0)).toBe(0);
  });
});
