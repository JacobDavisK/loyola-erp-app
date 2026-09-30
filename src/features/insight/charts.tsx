"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "var(--muted-foreground)" };
const tooltipStyle = { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };
const compact = (v: number) => (Math.abs(v) >= 10_000_000 ? `${(v / 10_000_000).toFixed(1)}Cr` : Math.abs(v) >= 100_000 ? `${(v / 100_000).toFixed(1)}L` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

/** Simple labelled bar chart. Every chart carries a text alternative summarising its data. */
export function Bars({ data, x, y, label, money, currency = "INR", horizontal = false }: { data: Record<string, string | number>[]; x: string; y: string; label: string; money?: boolean; currency?: string; horizontal?: boolean }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const fmt = money ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format : (v: number) => String(v);
  const summary = data.map((d) => `${d[x]}: ${fmt(Number(d[y]))}`).join(", ");
  return (
    <div className={horizontal ? "h-72" : "h-60"} role="img" aria-label={`${label}. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke="var(--border)" />
          {horizontal ? (
            <>
              <XAxis type="number" tickFormatter={compact} tick={axis} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey={x} tick={axis} tickLine={false} axisLine={false} width={90} />
            </>
          ) : (
            <>
              <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={compact} tick={axis} tickLine={false} axisLine={false} width={44} />
            </>
          )}
          <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tooltipStyle} />
          <Bar dataKey={y} name={label} fill="var(--primary)" radius={horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Trend({ data, x, y, label, money, currency = "INR", percent }: { data: Record<string, string | number>[]; x: string; y: string; label: string; money?: boolean; currency?: string; percent?: boolean }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const fmt = money ? new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format : percent ? (v: number) => `${v}%` : (v: number) => String(v);
  const summary = data.map((d) => `${d[x]}: ${fmt(Number(d[y]))}`).join(", ");
  return (
    <div className="h-60" role="img" aria-label={`${label}. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey={x} tick={axis} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={percent ? (v: number) => `${v}%` : compact} tick={axis} tickLine={false} axisLine={false} width={44} domain={percent ? [0, 100] : ["auto", "auto"]} />
          <Tooltip formatter={(v) => fmt(Number(v))} contentStyle={tooltipStyle} />
          <Line type="monotone" dataKey={y} name={label} stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
