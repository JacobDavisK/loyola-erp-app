import { describe, expect, it } from "vitest";
import { aggregate, definitionSchema, matches, sortRows, validateDefinition, type FieldMeta } from "@/lib/domain/report";

const fields: FieldMeta[] = [
  { key: "program", label: "Programme", type: "string" },
  { key: "status", label: "Status", type: "enum", options: ["ACTIVE", "GRADUATED"] },
  { key: "semester", label: "Semester", type: "number" },
  { key: "total", label: "Total", type: "money" },
  { key: "dueDate", label: "Due date", type: "date" },
];

describe("report definitions", () => {
  it("validates fields, operators, grouping and sorting", () => {
    const ok = definitionSchema.parse({ dataset: "students", groupBy: ["program"], aggregates: [{ field: "x", fn: "count" }, { field: "total", fn: "sum" }], sort: { field: "count", dir: "desc" } });
    expect(validateDefinition(ok, fields)).toEqual([]);
    const bad = definitionSchema.parse({ dataset: "students", columns: ["nope"], filters: [{ field: "status", op: "contains", value: "A" }, { field: "status", op: "eq", value: "EXPELLED" }, { field: "semester", op: "gt", value: "3" }], groupBy: ["total"], aggregates: [{ field: "program", fn: "sum" }], sort: { field: "semester", dir: "asc" } });
    const errs = validateDefinition(bad, fields);
    expect(errs.join(" ")).toMatch(/Unknown field "nope"/);
    expect(errs.join(" ")).toMatch(/cannot be filtered with "contains"/);
    expect(errs.join(" ")).toMatch(/not a valid Status/);
    expect(errs.join(" ")).toMatch(/needs a number/);
    expect(errs.join(" ")).toMatch(/Cannot group by "Total"/);
    expect(errs.join(" ")).toMatch(/Cannot sum "Programme"/);
    expect(errs.join(" ")).toMatch(/Sort by one of/);
    expect(validateDefinition(definitionSchema.parse({ dataset: "x" }), fields)).toContain("Choose at least one column.");
  });

  it("filters, aggregates and sorts in memory", () => {
    expect(matches(5, "gt", 3)).toBe(true);
    expect(matches("Computer", "contains", "put")).toBe(true);
    expect(matches(null, "empty", null)).toBe(true);
    expect(matches(new Date("2026-10-10"), "lt", "2026-11-01")).toBe(true);
    expect(matches("BCA", "in", ["BCA", "BCOM"])).toBe(true);
    const rows = [{ program: "BCA", total: 100, semester: 1 }, { program: "BCA", total: 50.5, semester: 3 }, { program: "BCOM", total: 70, semester: 1 }];
    const g = aggregate(rows, ["program"], [{ field: "", fn: "count" }, { field: "total", fn: "sum" }, { field: "semester", fn: "max" }, { field: "total", fn: "avg" }]);
    expect(g).toEqual([{ program: "BCA", count: 2, sum_total: 150.5, max_semester: 3, avg_total: 75.25 }, { program: "BCOM", count: 1, sum_total: 70, max_semester: 1, avg_total: 70 }]);
    expect(sortRows(g, { field: "sum_total", dir: "asc" })[0].program).toBe("BCOM");
  });
});
