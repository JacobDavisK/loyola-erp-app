"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Download, Loader2, Play, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aiReportAction, runReportAction, saveReportAction } from "@/features/insight/actions";
import { AGGS, opsFor, type Definition, type FieldMeta, type Op } from "@/lib/domain/report";
import { cn } from "@/lib/utils";

interface DatasetInfo { key: string; label: string; description: string; personal: boolean; fields: FieldMeta[] }
type Result = { columns: { key: string; label: string; type: string }[]; rows: Record<string, unknown>[]; matched: number; truncated: boolean; personal: boolean };
const field = "h-8 rounded-lg border bg-card px-2 text-[13px]";
const OP_LABEL: Record<Op, string> = { eq: "is", neq: "is not", contains: "contains", gt: ">", gte: "≥", lt: "<", lte: "≤", in: "is one of", empty: "is empty", notEmpty: "is not empty" };

const fmtCell = (v: unknown, type: string) => {
  if (v === null || v === undefined || v === "") return "—";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return v.slice(0, 10);
  if (type === "money" && typeof v === "number") return v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(v);
};

export function ReportBuilder({ datasets, initial, savedId, savedName, aiAvailable }: { datasets: DatasetInfo[]; initial?: Definition; savedId?: string; savedName?: string; aiAvailable: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [def, setDef] = useState<Definition>(initial ?? { dataset: datasets[0]?.key ?? "", columns: datasets[0]?.fields.slice(0, 4).map((f) => f.key) ?? [], filters: [], groupBy: [], aggregates: [], sort: null, limit: 500 });
  const [result, setResult] = useState<Result | null>(null);
  const [name, setName] = useState(savedName ?? "");
  const [shared, setShared] = useState(false);
  const [question, setQuestion] = useState("");
  const ds = datasets.find((d) => d.key === def.dataset);
  const fields = ds?.fields ?? [];
  const grouped = def.groupBy.length > 0;
  const set = (p: Partial<Definition>) => { setDef({ ...def, ...p }); setResult(null); };
  const fmeta = (k: string) => fields.find((f) => f.key === k);

  const run = (d = def) => start(async () => {
    const r = await runReportAction(d);
    if (!r.ok) { toast.error(r.error); return; }
    setResult(r.data as Result);
  });
  const outKeys = grouped ? [...def.groupBy, ...def.aggregates.map((a) => (a.fn === "count" ? "count" : `${a.fn}_${a.field}`))] : def.columns;

  return (
    <div className="space-y-4">
      {aiAvailable && (
        <form className="flex flex-wrap gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3" onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await aiReportAction(question);
            if (!r.ok) { toast.error(r.error); return; }
            const d = r.data as Definition;
            setDef(d);
            toast.success("Report drafted — review it, then run");
            run(d);
          });
        }}>
          <Sparkles className="mt-1.5 size-4 text-primary" aria-hidden />
          <Input aria-label="Describe the report" className="h-8 min-w-64 flex-1" placeholder="e.g. Outstanding fee balance by programme for overdue invoices" value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Button size="sm" disabled={pending || question.trim().length < 5}>Draft with AI</Button>
          <p className="w-full text-[11px] text-muted-foreground">Only your question and the field list are sent to the AI; it never sees records. The result is a report definition you can check before running.</p>
        </form>
      )}

      <div className="surface-card space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1"><Label htmlFor="rb-ds" className="text-xs">Dataset</Label>
            <select id="rb-ds" className={field} value={def.dataset} onChange={(e) => { const d = datasets.find((x) => x.key === e.target.value)!; set({ dataset: d.key, columns: d.fields.slice(0, 4).map((f) => f.key), filters: [], groupBy: [], aggregates: [], sort: null }); }}>
              {datasets.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <p className="max-w-md text-xs text-muted-foreground">{ds?.description}{ds?.personal ? " Contains personal data — exports are logged." : ""}</p>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant={grouped ? "outline" : "default"} onClick={() => set({ groupBy: [], aggregates: [] })}>List</Button>
            <Button size="sm" variant={grouped ? "default" : "outline"} onClick={() => set({ groupBy: [fields.find((f) => f.type === "string" || f.type === "enum")?.key ?? fields[0].key], aggregates: [{ field: fields[0].key, fn: "count" }], sort: null })}>Summary</Button>
          </div>
        </div>

        {!grouped ? (
          <fieldset>
            <legend className="mb-1.5 text-xs font-medium">Columns</legend>
            <div className="flex flex-wrap gap-1.5">
              {fields.map((f) => {
                const on = def.columns.includes(f.key);
                return <button key={f.key} type="button" aria-pressed={on} className={cn("rounded-md border px-2 py-1 text-xs", on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")} onClick={() => set({ columns: on ? def.columns.filter((c) => c !== f.key) : [...def.columns, f.key], sort: def.sort && on && def.sort.field === f.key ? null : def.sort })}>{f.label}</button>;
              })}
            </div>
          </fieldset>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium">Group by (up to 2)</legend>
              {[0, 1].map((i) => (
                <select key={i} aria-label={`Group by ${i + 1}`} className={`${field} mb-1.5 w-full`} value={def.groupBy[i] ?? ""} onChange={(e) => { const g = [...def.groupBy]; if (e.target.value) g[i] = e.target.value; else g.splice(i, 1); set({ groupBy: g.filter(Boolean), sort: null }); }}>
                  {i > 0 && <option value="">—</option>}
                  {fields.filter((f) => f.type !== "money").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                </select>
              ))}
            </fieldset>
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium">Measures</legend>
              {def.aggregates.map((a, i) => (
                <div key={i} className="mb-1.5 flex gap-1.5">
                  <select aria-label="Function" className={field} value={a.fn} onChange={(e) => set({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, fn: e.target.value as typeof a.fn } : x)), sort: null })}>{AGGS.map((f) => <option key={f} value={f}>{f}</option>)}</select>
                  {a.fn !== "count" && <select aria-label="Field" className={`${field} flex-1`} value={a.field} onChange={(e) => set({ aggregates: def.aggregates.map((x, j) => (j === i ? { ...x, field: e.target.value } : x)), sort: null })}>{fields.filter((f) => f.type === "number" || f.type === "money" || f.type === "date").map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>}
                  <Button size="icon-sm" variant="ghost" aria-label="Remove measure" onClick={() => set({ aggregates: def.aggregates.filter((_, j) => j !== i), sort: null })}><Trash2 /></Button>
                </div>
              ))}
              <Button size="xs" variant="outline" onClick={() => set({ aggregates: [...def.aggregates, { field: fields.find((f) => f.type === "money" || f.type === "number")?.key ?? fields[0].key, fn: fields.some((f) => f.type === "money" || f.type === "number") ? "sum" : "count" }] })}><Plus /> Measure</Button>
            </fieldset>
          </div>
        )}

        <fieldset>
          <legend className="mb-1.5 text-xs font-medium">Filters</legend>
          {def.filters.map((flt, i) => {
            const m = fmeta(flt.field);
            const ops = m ? opsFor(m.type) : [];
            const patch = (p: Partial<typeof flt>) => set({ filters: def.filters.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <div key={i} className="mb-1.5 flex flex-wrap gap-1.5">
                <select aria-label="Filter field" className={field} value={flt.field} onChange={(e) => { const nm = fmeta(e.target.value)!; patch({ field: nm.key, op: opsFor(nm.type)[0], value: null }); }}>{fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select>
                <select aria-label="Condition" className={field} value={flt.op} onChange={(e) => patch({ op: e.target.value as Op })}>{ops.map((o) => <option key={o} value={o}>{OP_LABEL[o]}</option>)}</select>
                {flt.op !== "empty" && flt.op !== "notEmpty" && (m?.type === "enum" && flt.op !== "in" ? (
                  <select aria-label="Value" className={field} value={String(flt.value ?? "")} onChange={(e) => patch({ value: e.target.value })}><option value="">—</option>{m.options?.map((o) => <option key={o} value={o}>{o.toLowerCase().replace(/_/g, " ")}</option>)}</select>
                ) : (
                  <Input aria-label="Value" className="h-8 w-48" type={m?.type === "date" ? "date" : m?.type === "number" || m?.type === "money" ? "number" : "text"} placeholder={flt.op === "in" ? "comma-separated" : ""}
                    value={Array.isArray(flt.value) ? flt.value.join(", ") : String(flt.value ?? "")}
                    onChange={(e) => patch({ value: flt.op === "in" ? e.target.value.split(",").map((x) => x.trim()).filter(Boolean) : m?.type === "number" || m?.type === "money" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value })} />
                ))}
                <Button size="icon-sm" variant="ghost" aria-label="Remove filter" onClick={() => set({ filters: def.filters.filter((_, j) => j !== i) })}><Trash2 /></Button>
              </div>
            );
          })}
          <Button size="xs" variant="outline" onClick={() => set({ filters: [...def.filters, { field: fields[0].key, op: opsFor(fields[0].type)[0], value: null }] })}><Plus /> Filter</Button>
        </fieldset>

        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label htmlFor="rb-sort" className="text-xs">Sort by</Label>
            <select id="rb-sort" className={field} value={def.sort?.field ?? ""} onChange={(e) => set({ sort: e.target.value ? { field: e.target.value, dir: def.sort?.dir ?? "desc" } : null })}>
              <option value="">—</option>
              {outKeys.map((k) => <option key={k} value={k}>{fmeta(k)?.label ?? k.replace("_", " of ")}</option>)}
            </select>
          </div>
          {def.sort && <select aria-label="Direction" className={field} value={def.sort.dir} onChange={(e) => set({ sort: { field: def.sort!.field, dir: e.target.value as "asc" | "desc" } })}><option value="desc">Descending</option><option value="asc">Ascending</option></select>}
          <div className="space-y-1"><Label htmlFor="rb-limit" className="text-xs">Rows</Label><Input id="rb-limit" type="number" min={1} max={5000} className="h-8 w-24" value={def.limit} onChange={(e) => set({ limit: Math.min(5000, Math.max(1, Number(e.target.value) || 1)) })} /></div>
          <Button size="sm" className="ml-auto" disabled={pending} onClick={() => run()}>{pending ? <Loader2 className="animate-spin" /> : <Play />} Run</Button>
        </div>
      </div>

      {result && (
        <div className="surface-card">
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5 text-sm">
            <span>{result.rows.length} row(s){grouped ? ` from ${result.matched} record(s)` : result.matched > result.rows.length ? ` of ${result.matched}` : ""}</span>
            {result.truncated && <span className="text-xs text-tone-warning">Only the first 20,000 records were read — add filters.</span>}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Input aria-label="Report name" className="h-8 w-56" placeholder="Name to save" value={name} onChange={(e) => setName(e.target.value)} />
              {!savedId && <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-[var(--primary)]" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share</label>}
              <Button size="sm" variant="outline" disabled={pending || name.trim().length < 3} onClick={() => start(async () => {
                const r = await saveReportAction(savedId ?? null, { name, shared, definition: def });
                if (!r.ok) { toast.error(r.error); return; }
                toast.success("Report saved");
                router.push(`/reports/builder?id=${(r.data as { id: string }).id}`);
              })}><Save /> Save</Button>
              <Button size="sm" variant="outline" onClick={async () => {
                const res = await fetch("/api/report-builder/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ definition: def, name: name || def.dataset }) });
                if (!res.ok) { toast.error((await res.json().catch(() => ({ error: "Export failed" }))).error); return; }
                const url = URL.createObjectURL(await res.blob());
                const a = Object.assign(document.createElement("a"), { href: url, download: `${(name || def.dataset).replace(/\s+/g, "-")}.csv` });
                a.click();
                URL.revokeObjectURL(url);
              }}><Download /> CSV</Button>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-xs text-muted-foreground">{result.columns.map((c) => <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium whitespace-nowrap", (c.type === "number" || c.type === "money") && "text-right")}>{c.label}</th>)}</tr></thead>
              <tbody className="divide-y">
                {result.rows.map((r, i) => <tr key={i}>{result.columns.map((c) => <td key={c.key} className={cn("px-3 py-1.5", (c.type === "number" || c.type === "money") && "text-right tabular")}>{fmtCell(r[c.key], c.type)}</td>)}</tr>)}
              </tbody>
            </table>
            {result.rows.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted-foreground">No records match.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
