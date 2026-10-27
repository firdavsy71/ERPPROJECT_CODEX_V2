"use client";
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
  return (
    <div className="chart">
      {data.length ? (
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#167963" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#167963" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={70} />
            <Tooltip />
            <Area
              dataKey="revenue"
              type="monotone"
              stroke="#167963"
              strokeWidth={2}
              fill="url(#revenue)"
            />
          </AreaChart>
        </ResponsiveContainer>
      ) : (
        <div className="empty">
          <strong>Your revenue story starts here</strong>
          <p>Shipped and invoiced orders will appear automatically.</p>
        </div>
      )}
    </div>
  );
}
