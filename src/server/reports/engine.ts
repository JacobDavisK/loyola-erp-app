import "server-only";
import { aggKey, aggLabel, aggregate, definitionSchema, matches, sortRows, validateDefinition, type Definition, type FieldMeta, type Op, type Row } from "@/lib/domain/report";
import { type AuthContext, can } from "@/server/auth/current";
import { db } from "@/server/db";
import { forbidden, invalid } from "@/server/errors";
import { DATASETS, datasetByKey, readPath, type Dataset, type FieldDef } from "@/server/reports/datasets";

/** Most rows a report reads before grouping. Larger questions need filters. */
export const MAX_ROWS = 20_000;

export function datasetsFor(ctx: AuthContext) {
  return DATASETS.filter((d) => can(ctx, d.permission));
}

export const fieldMeta = (d: Dataset): FieldMeta[] => d.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, options: f.options, groupable: f.groupable }));

function nest(path: string[], leaf: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((acc, k) => ({ [k]: acc }), leaf) as Record<string, unknown>;
}

/** Nested Prisma select from a set of paths: ["student","program","code"] → { student: { select: { program: { select: { code: true } } } } }. */
function buildSelect(paths: string[][]) {
  const root: Record<string, unknown> = {};
  for (const p of paths) {
    let node = root;
    p.forEach((k, i) => {
      if (i === p.length - 1) node[k] = node[k] ?? true;
      else {
        const next = (node[k] && typeof node[k] === "object" ? node[k] : { select: {} }) as { select: Record<string, unknown> };
        node[k] = next;
        node = next.select;
      }
    });
  }
  return root;
}

function condition(f: FieldDef, op: Op, value: unknown): unknown {
  const dateOf = (v: unknown) => new Date(String(v));
  switch (op) {
    case "empty": return null;
    case "notEmpty": return { not: null };
    case "contains": return { contains: String(value), mode: "insensitive" };
    case "in": return { in: (value as unknown[]).map((v) => (f.type === "number" ? Number(v) : v)) };
    case "neq": return { not: f.type === "date" ? dateOf(value) : value };
    case "eq":
      if (f.type === "date") { const d = dateOf(value); return { gte: d, lt: new Date(d.getTime() + 86_400_000) }; }
      return f.type === "string" ? { equals: value } : value;
    default: return { [op]: f.type === "date" ? dateOf(value) : value };
  }
}

const toCell = (f: FieldDef, v: unknown): Row[string] => {
  if (v === null || v === undefined) return null;
  if (f.type === "money" || f.type === "number") return Number(v);
  if (v instanceof Date) return v;
  return typeof v === "boolean" ? v : String(v);
};

export interface ReportResult {
  columns: { key: string; label: string; type: string }[];
  rows: Row[];
  matched: number;
  truncated: boolean;
  personal: boolean;
}

/** Run a definition for the caller. Authorisation: the dataset permission plus its scope where-builder. */
export async function runReport(ctx: AuthContext, raw: unknown): Promise<ReportResult> {
  const def: Definition = definitionSchema.parse(raw);
  const ds = datasetByKey(def.dataset);
  if (!ds) throw invalid("Unknown dataset.");
  if (!can(ctx, ds.permission)) throw forbidden("You cannot report on this dataset.");
  const errors = validateDefinition(def, fieldMeta(ds));
  if (errors.length) throw invalid(errors.join(" "));
  const byKey = new Map(ds.fields.map((f) => [f.key, f]));
  const used = new Set([...def.columns, ...def.filters.map((f) => f.field), ...def.groupBy, ...def.aggregates.filter((a) => a.fn !== "count").map((a) => a.field), ...(def.sort && byKey.has(def.sort.field) ? [def.sort.field] : [])]);
  const paths: string[][] = [["id"]];
  for (const k of used) {
    const f = byKey.get(k);
    if (f?.path) paths.push(f.path);
    if (f?.compute) paths.push(...f.compute.deps);
  }
  const dbFilters = def.filters.filter((x) => byKey.get(x.field)?.path).map((x) => { const f = byKey.get(x.field)!; return nest(f.path!, condition(f, x.op, x.value)); });
  const memFilters = def.filters.filter((x) => byKey.get(x.field)?.compute);
  const where = { AND: [await ds.scope(ctx), ...dbFilters] };
  const delegate = (db as unknown as Record<string, { findMany(args: unknown): Promise<Record<string, unknown>[]> }>)[ds.model];
  const raws = await delegate.findMany({ where, select: buildSelect(paths), take: MAX_ROWS + 1 });
  const truncated = raws.length > MAX_ROWS;
  let rows: Row[] = raws.slice(0, MAX_ROWS).map((r) => {
    const out: Row = {};
    for (const k of used) {
      const f = byKey.get(k)!;
      out[k] = f.compute ? f.compute.fn(r) : toCell(f, readPath(r, f.path!));
    }
    return out;
  });
  rows = rows.filter((r) => memFilters.every((x) => matches(r[x.field], x.op, x.value)));
  const matched = rows.length;
  let columns: ReportResult["columns"];
  if (def.groupBy.length) {
    rows = aggregate(rows, def.groupBy, def.aggregates);
    const fields = fieldMeta(ds);
    columns = [...def.groupBy.map((g) => ({ key: g, label: byKey.get(g)!.label, type: byKey.get(g)!.type })), ...def.aggregates.map((a) => ({ key: aggKey(a), label: aggLabel(a, fields), type: a.fn === "count" ? "number" : byKey.get(a.field)!.type }))];
  } else {
    rows = rows.map((r) => Object.fromEntries(def.columns.map((c) => [c, r[c]])));
    columns = def.columns.map((c) => ({ key: c, label: byKey.get(c)!.label, type: byKey.get(c)!.type }));
  }
  rows = sortRows(rows, def.sort).slice(0, def.limit);
  return { columns, rows, matched, truncated, personal: ds.personal };
}
