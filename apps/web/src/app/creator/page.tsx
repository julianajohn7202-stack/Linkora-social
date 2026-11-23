"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@/hooks/useWallet";
import { CreatorDashboard, type StatCardData } from "@/components/CreatorDashboard";
import {
  fetchCreatorDashboardSummary,
  type CreatorDashboardSummary,
  type CreatorDateRange,
} from "@/lib/analytics";

const RANGE_OPTIONS: { value: CreatorDateRange; label: string }[] = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All time" },
];

type PageState =
  | { status: "loading" }
  | { status: "disconnected" }
  | { status: "error"; message: string }
  | { status: "loaded"; summary: CreatorDashboardSummary };

function buildStats(summary: CreatorDashboardSummary | null): StatCardData[] {
  return [
    {
      id: "tips",
      label: "Tips received",
      value: summary ? `${summary.tipsReceived} XLM` : null,
      icon: "💸",
    },
    {
      id: "posts",
      label: "Posts",
      value: summary ? summary.postCount : null,
      icon: "✍️",
    },
    {
      id: "followers",
      label: "Followers",
      value: summary ? summary.followerCount : null,
      icon: "👥",
    },
    {
      id: "rewards",
      label: "Pending rewards",
      value: summary ? `${summary.pendingRewards} XLM` : null,
      icon: "🎁",
    },
  ];
}

export default function CreatorPage() {
  const { address, connected } = useWallet();
  const [range, setRange] = useState<CreatorDateRange>("7d");
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  const loadStats = useCallback(async () => {
    if (!connected || !address) {
      setState({ status: "disconnected" });
      return;
    }

    setState({ status: "loading" });
    try {
      const summary = await fetchCreatorDashboardSummary(address, range);
      setState({ status: "loaded", summary });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to load dashboard stats",
      });
    }
  }, [address, connected, range]);

  useEffect(() => {
    void loadStats();
  }, [loadStats, reloadKey]);

  const summary = state.status === "loaded" ? state.summary : null;

  return (
    <main className="min-h-screen bg-[var(--bg-primary)]">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--foreground)]">Creator Dashboard</h1>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Your live performance, straight from the analytics oracle.
            </p>
          </div>

          <div
            className="flex overflow-hidden rounded-xl border border-[var(--border)]"
            role="group"
            aria-label="Date range"
          >
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
                aria-pressed={range === option.value}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  range === option.value
                    ? "bg-violet-600 text-white"
                    : "bg-[var(--background)] text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </header>

        {state.status === "disconnected" && (
          <div
            className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center"
            data-testid="creator-disconnected"
          >
            <p className="mb-4 text-[var(--text-muted)]">
              Connect your wallet to see your creator analytics.
            </p>
            <Link
              href="/feed"
              className="inline-block rounded-full bg-violet-600 px-6 py-2 font-semibold text-white transition-opacity hover:opacity-90"
            >
              Go to Feed
            </Link>
          </div>
        )}

        {state.status === "error" && (
          <div
            className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400"
            role="alert"
            data-testid="creator-error"
          >
            <span>{state.message}</span>
            <button
              type="button"
              onClick={() => setReloadKey((key) => key + 1)}
              className="ml-3 underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        )}

        {state.status !== "disconnected" && (
          <CreatorDashboard
            stats={buildStats(summary)}
            greeting="Welcome back"
            username={address ? `${address.slice(0, 6)}…${address.slice(-4)}` : undefined}
          />
        )}
      </div>
    </main>
  );
}
