'use client';

import { useMemo, useState } from 'react';

type Range = '7d' | '30d' | 'all';

interface GrowthPoint {
  label: string;
  followers: number;
}

interface LocationEntry {
  region: string;
  followers: number;
}

interface HeatCell {
  day: number;
  hour: number;
  value: number;
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

const GROWTH_DATA: Record<Range, GrowthPoint[]> = {
  '7d': [
    { label: 'Mon', followers: 1200 },
    { label: 'Tue', followers: 1240 },
    { label: 'Wed', followers: 1290 },
    { label: 'Thu', followers: 1310 },
    { label: 'Fri', followers: 1380 },
    { label: 'Sat', followers: 1425 },
    { label: 'Sun', followers: 1490 },
  ],
  '30d': [
    { label: 'W1', followers: 980 },
    { label: 'W2', followers: 1120 },
    { label: 'W3', followers: 1290 },
    { label: 'W4', followers: 1490 },
  ],
  all: [
    { label: 'Jan', followers: 120 },
    { label: 'Feb', followers: 260 },
    { label: 'Mar', followers: 410 },
    { label: 'Apr', followers: 620 },
    { label: 'May', followers: 880 },
    { label: 'Jun', followers: 1490 },
  ],
};

const TOP_LOCATIONS: LocationEntry[] = [
  { region: 'United States', followers: 512 },
  { region: 'United Kingdom', followers: 287 },
  { region: 'Germany', followers: 194 },
  { region: 'Canada', followers: 143 },
  { region: 'Australia', followers: 98 },
];

const HEATMAP: HeatCell[] = DAYS.flatMap((_, day) =>
  HOURS.map((hour) => ({
    day,
    hour,
    value: Math.round(
      (Math.sin((hour / 24) * Math.PI * 2 - Math.PI / 2) + 1) * 50 +
        ((day * 7 + hour * 3) % 20),
    ),
  })),
);

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function GrowthChart({ data }: { data: GrowthPoint[] }) {
  const width = 560;
  const height = 200;
  const padding = 24;
  const max = Math.max(...data.map((d) => d.followers));
  const min = Math.min(...data.map((d) => d.followers));
  const span = Math.max(max - min, 1);

  const points = data.map((d, i) => {
    const x =
      padding +
      (i / Math.max(data.length - 1, 1)) * (width - padding * 2);
    const y =
      height -
      padding -
      ((d.followers - min) / span) * (height - padding * 2);
    return { x, y, ...d };
  });

  const line = points.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `${padding},${height - padding} ${line} ${width - padding},${height - padding}`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      role="img"
      aria-label="Follower growth chart"
    >
      <polygon points={area} fill="rgba(99, 102, 241, 0.15)" />
      <polyline
        points={line}
        fill="none"
        stroke="rgb(99, 102, 241)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r={3} fill="rgb(99, 102, 241)" />
          <text
            x={p.x}
            y={height - 6}
            textAnchor="middle"
            className="fill-gray-500"
            fontSize={10}
          >
            {p.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

function heatColor(value: number): string {
  const intensity = Math.min(Math.max(value / 100, 0), 1);
  return `rgba(99, 102, 241, ${0.1 + intensity * 0.8})`;
}

export default function CreatorAudiencePage() {
  const [range, setRange] = useState<Range>('7d');

  const growth = GROWTH_DATA[range];
  const totalFollowers = growth[growth.length - 1]?.followers ?? 0;
  const following = 312;
  const ratio = following > 0 ? totalFollowers / following : 0;

  const maxLocation = useMemo(
    () => Math.max(...TOP_LOCATIONS.map((l) => l.followers), 1),
    [],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Audience Analytics
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Understand who follows you and when they engage.
          </p>
        </div>
        <div
          className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
          role="group"
          aria-label="Growth range selector"
        >
          {(['7d', '30d', 'all'] as Range[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setRange(option)}
              aria-pressed={range === option}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                range === option
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
              }`}
            >
              {option === 'all' ? 'All-time' : option.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Follower Growth
        </h2>
        <GrowthChart data={growth} />
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Top Locations
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            Aggregated and anonymised by region.
          </p>
          <ul className="space-y-3">
            {TOP_LOCATIONS.map((loc) => (
              <li key={loc.region}>
                <div className="flex items-center justify-between text-sm text-gray-700 dark:text-gray-300">
                  <span>{loc.region}</span>
                  <span className="font-medium">{formatNumber(loc.followers)}</span>
                </div>
                <div className="mt-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${(loc.followers / maxLocation) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Follower-to-Following Ratio
          </h2>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold text-indigo-600 dark:text-indigo-400">
              {ratio.toFixed(2)}
            </span>
            <span className="text-sm text-gray-500 dark:text-gray-400">: 1</span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Followers</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100">
                {formatNumber(totalFollowers)}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500 dark:text-gray-400">Following</dt>
              <dd className="font-semibold text-gray-900 dark:text-gray-100">
                {formatNumber(following)}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
          Peak Engagement Hours
        </h2>
        <div className="overflow-x-auto">
          <div className="inline-block min-w-full">
            <div className="flex">
              <div className="w-10" />
              {HOURS.map((hour) => (
                <div
                  key={hour}
                  className="w-5 text-center text-[10px] text-gray-400"
                >
                  {hour % 3 === 0 ? hour : ''}
                </div>
              ))}
            </div>
            {DAYS.map((day, dayIndex) => (
              <div key={day} className="flex items-center">
                <div className="w-10 text-xs text-gray-500 dark:text-gray-400">
                  {day}
                </div>
                {HOURS.map((hour) => {
                  const cell = HEATMAP.find(
                    (c) => c.day === dayIndex && c.hour === hour,
                  );
                  return (
                    <div
                      key={hour}
                      className="w-5 h-5 m-px rounded-sm"
                      style={{ backgroundColor: heatColor(cell?.value ?? 0) }}
                      title={`${day} ${hour}:00 — ${cell?.value ?? 0} engagements`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Low</span>
          <div className="h-2 w-24 rounded-full bg-gradient-to-r from-indigo-100 to-indigo-600" />
          <span>High</span>
        </div>
      </section>
    </main>
  );
}
