"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };

function Tip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-[var(--shadow-float)]">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular">{p.value}</span>
        </div>
      ))}
    </div>
  );
}

/** Single series → no legend box; the card title names it. */
export function GrowthChart({ data }: { data: { month: string; total: number; added: number }[] }) {
  return (
    <div className="h-64" role="img" aria-label={`Question bank size by month, from ${data[0]?.total} to ${data.at(-1)?.total}`}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="growth" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--viz-1)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--viz-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={false} />
          <YAxis tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip content={<Tip />} cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} />
          <Area type="monotone" dataKey="total" name="Questions in bank" stroke="var(--viz-1)" strokeWidth={2} fill="url(#growth)" activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function DistributionBars({ data, name }: { data: { label: string; value: number }[]; name: string }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="h-56" role="img" aria-label={`${name}: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 8, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={96} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Bar
            dataKey="value"
            name={name}
            fill="var(--viz-1)"
            radius={[0, 4, 4, 0]}
            maxBarSize={22}
            label={{ position: "right", fontSize: 11, fill: "var(--muted-foreground)", formatter: (v: unknown) => `${Math.round((Number(v) / total) * 100)}%` }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function WorkloadChart({ data }: { data: { name: string; completed: number; pending: number; overdue: number }[] }) {
  return (
    <div className="h-72" role="img" aria-label={data.map((d) => `${d.name}: ${d.completed} completed, ${d.pending} pending${d.overdue ? `, ${d.overdue} overdue` : ""}`).join("; ")}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" tick={axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={axis} tickLine={false} axisLine={false} width={110} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted-foreground)" }} iconType="circle" iconSize={8} />
          <Bar dataKey="completed" name="Completed" stackId="w" fill="var(--viz-1)" stroke="var(--card)" strokeWidth={2} maxBarSize={20} />
          <Bar dataKey="pending" name="Pending" stackId="w" fill="var(--viz-2)" stroke="var(--card)" strokeWidth={2} radius={[0, 4, 4, 0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const SEQ = ["var(--viz-seq-1)", "var(--viz-seq-2)", "var(--viz-seq-3)", "var(--viz-seq-4)", "var(--viz-seq-5)", "var(--viz-seq-6)"];

/** Sequential heatmap with the value printed in every cell (colour is never the only channel). */
export function CoverageHeatmap({ rows }: { rows: { course: string; units: number[] }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => r.units));
  return (
    <table className="w-full border-separate border-spacing-[3px] text-xs">
      <caption className="sr-only">Questions per unit for each course</caption>
      <thead>
        <tr>
          <th scope="col" className="text-left font-medium text-muted-foreground">Course</th>
          {[1, 2, 3, 4, 5].map((u) => <th key={u} scope="col" className="font-medium text-muted-foreground">Unit {u}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.course}>
            <th scope="row" className="pr-2 text-left font-mono font-medium">{r.course}</th>
            {r.units.map((n, i) => {
              const step = n === 0 ? -1 : Math.min(5, Math.floor((n / max) * 5.999));
              return (
                <td key={i} className={cn("h-8 rounded-md text-center font-semibold tabular", n === 0 ? "border border-dashed text-tone-danger" : step >= 3 ? "text-white" : "text-foreground")} style={{ background: step >= 0 ? SEQ[step] : undefined }} title={`${r.course} unit ${i + 1}: ${n} questions`}>
                  {n}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
