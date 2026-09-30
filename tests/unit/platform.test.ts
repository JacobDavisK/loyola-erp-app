import { describe, expect, it } from "vitest";
import { departmentsForScope, unitAncestors, unitWithDescendants, type OrgMap } from "@/lib/domain/org-scope";
import { SELF_SCOPED_ROLES, SYSTEM_ROLES } from "@/lib/domain/permissions";
import { describeCondition, evaluateCondition, nextApplicableStep, parseSteps, stepOutcome, type WorkflowStep } from "@/lib/domain/workflow-engine";
import { formatSequence } from "@/server/services/sequence";

const org: OrgMap = {
  units: [
    { id: "FSCI", parentId: null, campusId: "MAIN" },
    { id: "SOC", parentId: "FSCI", campusId: "MAIN" },
    { id: "SPS", parentId: "FSCI", campusId: "MAIN" },
    { id: "FCM", parentId: null, campusId: "CITY" },
  ],
  departments: [
    { id: "CS", academicUnitId: "SOC", campusId: "MAIN" },
    { id: "MAT", academicUnitId: "SPS", campusId: "MAIN" },
    { id: "PHY", academicUnitId: "SPS", campusId: null },
    { id: "COM", academicUnitId: "FCM", campusId: "CITY" },
    { id: "LAW", academicUnitId: null, campusId: null },
  ],
};

describe("organisation scope", () => {
  it("expands a faculty grant to every department in its schools", () => {
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: "FSCI", campusId: null }, null).sort()).toEqual(["CS", "MAT", "PHY"]);
  });
  it("limits a school grant to its own departments", () => {
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: "SPS", campusId: null }, null).sort()).toEqual(["MAT", "PHY"]);
  });
  it("covers departments on a campus, including those inheriting the campus from their unit", () => {
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: null, campusId: "MAIN" }, null).sort()).toEqual(["CS", "MAT", "PHY"]);
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: null, campusId: "CITY" }, null)).toEqual(["COM"]);
  });
  it("falls back to the holder's department when a grant has no scope", () => {
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: null, campusId: null }, "LAW")).toEqual(["LAW"]);
    expect(departmentsForScope(org, { departmentId: null, academicUnitId: null, campusId: null }, null)).toEqual([]);
  });
  it("walks unit trees without looping on bad data", () => {
    const cyclic: OrgMap = { departments: [], units: [{ id: "A", parentId: "B", campusId: null }, { id: "B", parentId: "A", campusId: null }] };
    expect([...unitWithDescendants(cyclic, "A")].sort()).toEqual(["A", "B"]);
    expect(unitAncestors(org, "SOC")).toEqual(["FSCI"]);
  });
});

describe("role catalogue", () => {
  it("self-service roles carry no institutional permissions", () => {
    expect(SELF_SCOPED_ROLES).toEqual(expect.arrayContaining(["STUDENT", "GUARDIAN"]));
    for (const key of SELF_SCOPED_ROLES) {
      const perms = SYSTEM_ROLES[key as keyof typeof SYSTEM_ROLES].permissions;
      expect(perms.every((p) => ["self.portal", "enrollment.self", "revaluation.request", "credential.request", "scholarship.apply"].includes(p))).toBe(true);
    }
  });
  it("IT administration never includes academic or examination content", () => {
    const perms = SYSTEM_ROLES.IT_ADMIN.permissions;
    expect(perms.some((p) => p.startsWith("paper.") || p.startsWith("question.") || p.startsWith("student."))).toBe(false);
  });
});

const steps: WorkflowStep[] = parseSteps([
  { key: "hod", name: "HoD", approvers: [{ type: "role", role: "HOD" }], condition: { field: "departmentScoped", op: "eq", value: true } },
  { key: "dean", name: "Dean", approvers: [{ type: "role", role: "DEAN" }], condition: { field: "days", op: "gt", value: 3 } },
  { key: "reg", name: "Registrar", approvers: [{ type: "role", role: "REGISTRAR", scope: "global" }], mode: "ALL" },
]);

describe("workflow definitions", () => {
  it("applies defaults and rejects malformed definitions", () => {
    expect(steps[0].mode).toBe("ANY");
    expect(steps[0].allowReturn).toBe(true);
    expect(() => parseSteps([])).toThrow();
    expect(() => parseSteps([{ key: "a", name: "A", approvers: [] }])).toThrow();
    expect(() => parseSteps([{ key: "dup", name: "One", approvers: [{ type: "user", userId: "u" }] }, { key: "dup", name: "Two", approvers: [{ type: "user", userId: "u" }] }])).toThrow(/unique/);
  });

  it("evaluates conditions, including nested and numeric-string values", () => {
    expect(evaluateCondition({ field: "days", op: "gt", value: 3 }, { days: "5" })).toBe(true);
    expect(evaluateCondition({ field: "days", op: "gt", value: 3 }, { days: "x" })).toBe(false);
    expect(evaluateCondition({ field: "a.b", op: "in", value: ["x", "y"] }, { a: { b: "y" } })).toBe(true);
    expect(evaluateCondition({ all: [{ field: "a", op: "exists" }, { any: [{ field: "n", op: "lte", value: 1 }, { field: "n", op: "gte", value: 9 }] }] }, { a: 1, n: 10 })).toBe(true);
    expect(evaluateCondition({ field: "a", op: "exists" }, { a: "" })).toBe(false);
    expect(evaluateCondition(undefined, {})).toBe(true);
  });

  it("skips steps whose condition does not hold", () => {
    expect(nextApplicableStep(steps, 0, { departmentScoped: true, days: 1 })).toBe(0);
    expect(nextApplicableStep(steps, 1, { departmentScoped: true, days: 1 })).toBe(2);
    expect(nextApplicableStep(steps, 0, { departmentScoped: false, days: 10 })).toBe(1);
    expect(nextApplicableStep(steps, 3, {})).toBeNull();
  });

  it("decides ANY and ALL steps correctly", () => {
    expect(stepOutcome("ANY", ["PENDING", "APPROVED"])).toBe("approved");
    expect(stepOutcome("ALL", ["PENDING", "APPROVED"])).toBe("pending");
    expect(stepOutcome("ALL", ["APPROVED", "APPROVED", "CANCELLED"])).toBe("approved");
    expect(stepOutcome("ALL", ["APPROVED", "REJECTED"])).toBe("rejected");
    expect(stepOutcome("ANY", ["RETURNED", "PENDING"])).toBe("returned");
    expect(stepOutcome("ANY", [])).toBe("pending");
  });

  it("describes conditions for administrators", () => {
    expect(describeCondition({ field: "days", op: "gt", value: 3 })).toBe("days > 3");
    expect(describeCondition(undefined)).toBe("Always");
  });
});

describe("sequences", () => {
  it("formats prefixes with year tokens and padding", () => {
    expect(formatSequence("INV/{YYYY}/", 42, 5, new Date("2026-09-26"))).toBe("INV/2026/00042");
    expect(formatSequence("{YY}BCA", 7, 3, new Date("2026-09-26"))).toBe("26BCA007");
  });
});
