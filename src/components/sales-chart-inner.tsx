import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { shortDate, usd } from "@/lib/format";

export function SalesChartInner({ data }: { data: { date: string; labor: number; parts: number }[] }) {
  const rows = data.map((point) => ({ ...point, label: shortDate(point.date) }));
  return (
    <div className="chart-box">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--color-line)" />
          <XAxis dataKey="label" tick={{ fill: "var(--color-muted)", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis
            tick={{ fill: "var(--color-muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={48}
            tickFormatter={(value: number) => (value >= 1000 ? `${Math.round(value / 1000)}k` : String(value))}
          />
          <Tooltip
            cursor={{ fill: "var(--color-primary-soft)" }}
            contentStyle={{
              background: "var(--color-surface-2)",
              border: "1px solid var(--color-line)",
              borderRadius: 8,
              color: "var(--color-ink)",
              fontSize: 13,
            }}
            formatter={(value, name) => [usd(Number(value ?? 0)), name === "labor" ? "Labor" : "Parts"]}
          />
          <Bar dataKey="labor" stackId="sales" fill="var(--color-primary)" name="labor" />
          <Bar dataKey="parts" stackId="sales" fill="var(--color-accent)" name="parts" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
