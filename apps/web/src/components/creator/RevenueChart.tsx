"use client";

import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface RevenuePoint {
  /** Calendar date (YYYY-MM-DD) in UTC. */
  date: string;
  tips: number;
  rewards: number;
}

const periods = ["Daily", "Weekly", "Monthly"] as const;
type Period = (typeof periods)[number];
const amount = new Intl.NumberFormat("en", { maximumFractionDigits: 7 });

function periodStart(value: string, period: Period) {
  const date = new Date(value);
  if (period === "Monthly") date.setUTCDate(1);
  if (period === "Weekly") date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

export function RevenueChart({ data }: { data: readonly RevenuePoint[] }) {
  const [period, setPeriod] = useState<Period>("Daily");
  const rows = useMemo(() => {
    const buckets = new Map<string, RevenuePoint>();
    for (const point of data) {
      const date = periodStart(point.date, period);
      const bucket = buckets.get(date) ?? { date, tips: 0, rewards: 0 };
      bucket.tips += point.tips;
      bucket.rewards += point.rewards;
      buckets.set(date, bucket);
    }
    return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [data, period]);

  const dateLabel = (date: string) =>
    period === "Weekly" ? `Week of ${date}` : period === "Monthly" ? date.slice(0, 7) : date;

  return (
    <section aria-label="Creator revenue">
      <h2 className="text-lg font-semibold">Revenue over time</h2>
      <div role="group" aria-label="Revenue granularity" className="my-3 flex gap-2">
        {periods.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={period === option}
            className="rounded border border-[var(--border)] px-3 py-1 aria-pressed:bg-[var(--muted)]"
            onClick={() => setPeriod(option)}
          >
            {option}
          </button>
        ))}
      </div>
      {rows.length ? (
        <div className="h-72 min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={rows} aria-label={`${period} tips and rewards in XLM`}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(date: string) =>
                  period === "Monthly" ? date.slice(0, 7) : date.slice(5)
                }
              />
              <YAxis label={{ value: "XLM", angle: -90, position: "insideLeft" }} />
              <Tooltip
                labelFormatter={(date) => dateLabel(String(date))}
                formatter={(value) => `${amount.format(Number(value))} XLM`}
                contentStyle={{ background: "var(--card)", color: "var(--foreground)" }}
                itemStyle={{ color: "var(--foreground)" }}
              />
              <Legend />
              <Area
                type="monotone"
                dataKey="tips"
                name="Tips"
                stroke="#8b5cf6"
                fill="#8b5cf6"
                fillOpacity={0.25}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="rewards"
                name="Rewards"
                stroke="#0d9488"
                fill="#0d9488"
                fillOpacity={0.25}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p>No revenue for this period.</p>
      )}
      <table className="sr-only">
        <caption>{period} revenue in XLM</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Tips (XLM)</th>
            <th scope="col">Rewards (XLM)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.date}>
              <th scope="row">{dateLabel(row.date)}</th>
              <td>{amount.format(row.tips)}</td>
              <td>{amount.format(row.rewards)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

export default RevenueChart;
