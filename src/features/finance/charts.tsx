"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Daily collections. Days without collections show as gaps, not zero bars, so the scale stays honest. */
export function CollectionsChart({ data, currency }: { data: { day: string; amount: number }[]; currency: string }) {
  if (!data.length) return <p className="text-sm text-muted-foreground">No collections in the last 30 days.</p>;
  const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <div className="h-64" role="img" aria-label={`Daily collections over the last 30 days, total ${fmt.format(data.reduce((a, d) => a + d.amount, 0))}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(5)} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} />
          <YAxis tickFormatter={(v: number) => (v >= 100000 ? `${Math.round(v / 1000)}k` : String(v))} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
          <Tooltip formatter={(v) => fmt.format(Number(v))} labelFormatter={(d) => String(d)} contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
          <Bar dataKey="amount" name="Collected" fill="var(--primary)" radius={[3, 3, 0, 0]} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
