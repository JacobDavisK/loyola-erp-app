/**
 * Report builder rules (pure): the definition schema, validation against a dataset's field catalogue,
 * in-memory filtering for computed fields, grouping with aggregates, sorting and CSV-ready projection.
 * Datasets and their authorisation live in src/server/reports; the AI never sees data, only this schema.
 */
import { z } from "zod";

export type FieldType = "string" | "number" | "money" | "date" | "enum" | "boolean";
export interface FieldMeta { key: string; label: string; type: FieldType; options?: string[]; groupable?: boolean }

export const OPS = ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "in", "empty", "notEmpty"] as const;
export type Op = (typeof OPS)[number];
export const AGGS = ["count", "sum", "avg", "min", "max"] as const;
export type Agg = (typeof AGGS)[number];

export const definitionSchema = z.object({
  dataset: z.string().min(1).max(40),
  columns: z.array(z.string().max(40)).max(20).default([]),
  filters: z.array(z.object({ field: z.string().max(40), op: z.enum(OPS), value: z.union([z.string().max(200), z.number(), z.boolean(), z.array(z.string().max(100)).max(50), z.null()]).optional() })).max(15).default([]),
  groupBy: z.array(z.string().max(40)).max(2).default([]),
  aggregates: z.array(z.object({ field: z.string().max(40), fn: z.enum(AGGS) })).max(8).default([]),
  sort: z.object({ field: z.string().max(40), dir: z.enum(["asc", "desc"]) }).nullable().optional(),
  limit: z.number().int().min(1).max(5000).default(500),
});
export type Definition = z.infer<typeof definitionSchema>;

const OPS_BY_TYPE: Record<FieldType, Op[]> = {
  string: ["eq", "neq", "contains", "in", "empty", "notEmpty"],
  enum: ["eq", "neq", "in", "empty", "notEmpty"],
  number: ["eq", "neq", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  money: ["eq", "neq", "gt", "gte", "lt", "lte"],
  date: ["eq", "gt", "gte", "lt", "lte", "empty", "notEmpty"],
  boolean: ["eq"],
};
export const opsFor = (t: FieldType) => OPS_BY_TYPE[t];

/** Structural validation against the dataset's fields; returns human-readable problems. */
export function validateDefinition(def: Definition, fields: FieldMeta[]): string[] {
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const errors: string[] = [];
  const known = (k: string, where: string) => {
    if (!byKey.has(k)) errors.push(`Unknown field "${k}" in ${where}.`);
    return byKey.get(k);
  };
  def.columns.forEach((c) => known(c, "columns"));
  for (const f of def.filters) {
    const m = known(f.field, "filters");
    if (!m) continue;
    if (!OPS_BY_TYPE[m.type].includes(f.op)) errors.push(`"${m.label}" cannot be filtered with "${f.op}".`);
    if (m.type === "enum" && m.options && (f.op === "eq" || f.op === "neq") && typeof f.value === "string" && !m.options.includes(f.value)) errors.push(`"${f.value}" is not a valid ${m.label}.`);
    if (["gt", "gte", "lt", "lte"].includes(f.op) && m.type !== "date" && typeof f.value !== "number") errors.push(`"${m.label}" needs a number.`);
    if (m.type === "date" && f.value !== null && f.value !== undefined && typeof f.value === "string" && Number.isNaN(Date.parse(f.value))) errors.push(`"${m.label}" needs a date (YYYY-MM-DD).`);
  }
  for (const g of def.groupBy) {
    const m = known(g, "group by");
    if (m && (m.type === "money" || m.groupable === false)) errors.push(`Cannot group by "${m.label}".`);
  }
  for (const a of def.aggregates) {
    if (a.fn === "count") continue;
    const m = known(a.field, "aggregates");
    if (m && !["number", "money"].includes(m.type) && !(m.type === "date" && (a.fn === "min" || a.fn === "max"))) errors.push(`Cannot ${a.fn} "${m.label}".`);
  }
  if (def.groupBy.length && !def.aggregates.length) errors.push("Grouped reports need at least one aggregate (e.g. count).");
  if (!def.groupBy.length && !def.columns.length) errors.push("Choose at least one column.");
  if (def.sort) {
    const outKeys = def.groupBy.length ? [...def.groupBy, ...def.aggregates.map(aggKey)] : def.columns;
    if (!outKeys.includes(def.sort.field)) errors.push("Sort by one of the report's columns.");
  }
  return errors;
}

export const aggKey = (a: { field: string; fn: Agg }) => (a.fn === "count" ? "count" : `${a.fn}_${a.field}`);
export const aggLabel = (a: { field: string; fn: Agg }, fields: FieldMeta[]) => (a.fn === "count" ? "Count" : `${a.fn[0].toUpperCase()}${a.fn.slice(1)} of ${fields.find((f) => f.key === a.field)?.label ?? a.field}`);

export type Row = Record<string, string | number | boolean | Date | null>;

const cmp = (a: unknown, b: unknown) => {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true });
};

/** Apply one filter in memory (used for computed fields that the database cannot filter). */
export function matches(v: unknown, op: Op, value: unknown): boolean {
  const empty = v === null || v === undefined || v === "";
  switch (op) {
    case "empty": return empty;
    case "notEmpty": return !empty;
    case "eq": return v instanceof Date ? cmp(v, new Date(String(value))) === 0 : v === value || String(v) === String(value);
    case "neq": return !matches(v, "eq", value);
    case "contains": return typeof v === "string" && typeof value === "string" && v.toLowerCase().includes(value.toLowerCase());
    case "in": return Array.isArray(value) && value.map(String).includes(String(v));
    default: {
      if (empty) return false;
      const b = v instanceof Date ? new Date(String(value)) : value;
      const c = cmp(v, b);
      return op === "gt" ? c > 0 : op === "gte" ? c >= 0 : op === "lt" ? c < 0 : c <= 0;
    }
  }
}

/** Group rows and compute aggregates. Money/number values must already be plain numbers. */
export function aggregate(rows: Row[], groupBy: string[], aggs: { field: string; fn: Agg }[]): Row[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const k = JSON.stringify(groupBy.map((g) => (r[g] instanceof Date ? (r[g] as Date).toISOString().slice(0, 10) : r[g] ?? null)));
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return [...groups.entries()].map(([k, list]) => {
    const keyVals = JSON.parse(k) as (string | number | null)[];
    const out: Row = Object.fromEntries(groupBy.map((g, i) => [g, keyVals[i]]));
    for (const a of aggs) {
      const vals = list.map((r) => r[a.field]).filter((v) => v !== null && v !== undefined) as (number | Date)[];
      const nums = vals.filter((v): v is number => typeof v === "number");
      out[aggKey(a)] =
        a.fn === "count" ? list.length
          : a.fn === "sum" ? Math.round(nums.reduce((x, y) => x + y, 0) * 100) / 100
            : a.fn === "avg" ? (nums.length ? Math.round((nums.reduce((x, y) => x + y, 0) / nums.length) * 100) / 100 : null)
              : vals.length ? vals.reduce((x, y) => ((a.fn === "min" ? cmp(x, y) <= 0 : cmp(x, y) >= 0) ? x : y)) : null;
    }
    return out;
  });
}

export function sortRows(rows: Row[], sort: { field: string; dir: "asc" | "desc" } | null | undefined): Row[] {
  if (!sort) return rows;
  const d = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => cmp(a[sort.field], b[sort.field]) * d);
}
