"use client";
import { useId } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
export function RevenueChart({
  data,
}: {
  data: { month: string; revenue: number }[];
}) {
  const gradientId = useId().replaceAll(":", "");
  return (
    <figure className="chart" aria-label="Monthly invoiced revenue chart">
      {data.length ? (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data} accessibilityLayer>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent, #C6F567)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--accent, #C6F567)" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="2 6" vertical={false} />
            <XAxis dataKey="month" tick={{fill:"var(--muted)", fontSize:11}} tickLine={false} axisLine={false} />
            <YAxis tick={{fill:"var(--muted)",fontSize:11}} tickLine={false} axisLine={false} width={70} />
            <Tooltip contentStyle={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,color:"var(--text)",fontVariantNumeric:"tabular-nums"}} />
            <Area
              dataKey="revenue"
              type="monotone"
              stroke="var(--chart-line, #436A17)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty">
          <strong>Your revenue story starts here</strong>
          <p>Shipped and invoiced orders will appear automatically.</p>
        </div>
      )}
      {data.length > 0 && <details className="chart-data"><summary>View monthly values</summary><table><caption>Invoiced revenue by month, in the currency shown above</caption><thead><tr><th scope="col">Month</th><th scope="col">Revenue</th></tr></thead><tbody>{data.map(item => <tr key={item.month}><th scope="row">{item.month}</th><td className="numeric">{item.revenue.toLocaleString(undefined,{maximumFractionDigits:2})}</td></tr>)}</tbody></table></details>}
    </figure>
  );
}
