"use client";

import { useEffect, useState } from "react";

export interface StatCardData {
  id: string;
  label: string;
  value: string | number | null;
  delta?: string;
  deltaPositive?: boolean;
  icon: string;
}

interface CreatorDashboardProps {
  /** Supply null values to trigger per-card skeleton states. */
  stats: StatCardData[];
  greeting?: string;
  username?: string;
}

/**
 * CreatorDashboard — top-level stats overview for a creator.
 *
 * All colours use CSS custom property tokens so the component is fully
 * dark-mode aware. Each card has an independent loading state: when a card's
 * `value` is `null` it renders its own skeleton instead of the whole grid
 * going blank (satisfying Issue #172 as well as #171).
 */
export function CreatorDashboard({ stats, greeting, username }: CreatorDashboardProps) {
  return (
    <section aria-label="Creator dashboard stats" className="w-full">
      {/* Greeting */}
      {(greeting || username) && (
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            {greeting ?? "Welcome back"}{username ? `, ${username}` : ""}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Here's what's happening with your content today.
          </p>
        </div>
      )}

      {/* Stat cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, index) => (
          <StatCard key={stat.id} stat={stat} animationDelay={index * 75} />
        ))}
      </div>
    </section>
  );
}

/** Individual stat card — shows its own skeleton when value is null. */
function StatCard({ stat, animationDelay }: { stat: StatCardData; animationDelay: number }) {
  const isLoading = stat.value === null;

  // Animate in when data arrives
  const [visible, setVisible] = useState(isLoading);
  useEffect(() => {
    if (!isLoading) {
      const timer = setTimeout(() => setVisible(true), animationDelay);
      return () => clearTimeout(timer);
    }
    // While loading, keep visible=false so we can fade-in on arrival
    setVisible(false);
  }, [isLoading, animationDelay]);

  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 md:p-5 transition-all duration-300 ${
        !isLoading
          ? visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-2"
          : ""
      }`}
      style={
        !isLoading && !visible
          ? { transitionDelay: `${animationDelay}ms` }
          : { transitionDelay: `${animationDelay}ms` }
      }
    >
      {isLoading ? (
        <StatCardSkeleton />
      ) : (
        <StatCardContent stat={stat} />
      )}
    </div>
  );
}

function StatCardContent({ stat }: { stat: StatCardData }) {
  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-2xl" aria-hidden="true">{stat.icon}</span>
        {stat.delta !== undefined && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              stat.deltaPositive
                ? "bg-[var(--color-success-light)] text-[var(--color-success)]"
                : "bg-[var(--color-error-light)] text-[var(--color-error)]"
            }`}
          >
            {stat.deltaPositive ? "▲" : "▼"} {stat.delta}
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-[var(--foreground)]">{stat.value}</p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{stat.label}</p>
    </>
  );
}

/**
 * StatCardSkeleton — matches the exact dimensions of StatCardContent to prevent
 * Cumulative Layout Shift (CLS) when real data arrives.
 */
export function StatCardSkeleton() {
  return (
    <div
      className="animate-pulse"
      aria-label="Loading stat"
      aria-busy="true"
    >
      {/* Icon + delta row: height ~32px */}
      <div className="mb-3 flex items-center justify-between">
        <div className="h-8 w-8 rounded-lg bg-[var(--bg-tertiary)]" />
        <div className="h-5 w-14 rounded-full bg-[var(--bg-tertiary)]" />
      </div>
      {/* Value: h-8 matches text-2xl font-bold */}
      <div className="h-8 w-24 rounded-md bg-[var(--bg-tertiary)]" />
      {/* Label: h-5 matches text-sm */}
      <div className="mt-1 h-5 w-32 rounded-md bg-[var(--bg-tertiary)]" />
    </div>
  );
}
