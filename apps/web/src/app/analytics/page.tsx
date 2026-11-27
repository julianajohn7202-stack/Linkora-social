"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useWallet } from "@/hooks/useWallet";
import { EmptyStateIllustration } from "@/components/ui/EmptyStateIllustration";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  fetchPosts,
  fetchAttestation,
  computeAnalytics,
  generateCSV,
  ledgerToDate,
  type AnalyticsAttestation,
  type IndexerPost,
  type AnalyticsData,
} from "@/lib/analytics";

const DATE_PRESETS = [7, 30, 90];
const DEFAULT_DAYS = 30;
const DAY_MS = 86_400_000;

type DateWindow = { start: string; end: string };
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; posts: IndexerPost[]; attestation: AnalyticsAttestation | null };

function isDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function presetWindow(days: number, end: string): DateWindow {
  const start = new Date(Date.parse(end) - (days - 1) * DAY_MS).toISOString().slice(0, 10);
  return { start, end };
}

function saveWindow({ start, end }: DateWindow) {
  const url = new URL(window.location.href);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  window.history.replaceState(null, "", url);
}

export default function AnalyticsPage() {
  return (
    <Suspense
      fallback={
        <p className="p-8" role="status">
          Loading creator analytics…
        </p>
      }
    >
      <AnalyticsReport />
    </Suspense>
  );
}

function AnalyticsReport() {
  const { address, connected } = useWallet();
  const params = useSearchParams();
  const start = params.get("start");
  const end = params.get("end");
  const hasValidWindow = isDate(start) && isDate(end) && start <= end;
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (!connected || !address) return;
    let active = true;
    setState({ status: "loading" });

    Promise.all([fetchPosts(address), fetchAttestation(address)])
      .then(([posts, attestation]) => {
        if (active) setState({ status: "loaded", posts, attestation });
      })
      .catch((err: unknown) => {
        if (active) {
          setState({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to load analytics",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [address, connected, attempt]);

  // Keep the existing report's latest-post anchor and ledger-based chart dates.
  const latestLedger =
    state.status === "loaded"
      ? state.posts.reduce((latest, post) => Math.max(latest, post.created_ledger), 0)
      : 0;
  const latestDate = latestLedger
    ? ledgerToDate(latestLedger).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const dateWindow = hasValidWindow ? { start, end } : presetWindow(DEFAULT_DAYS, latestDate);
  const selectedDays = (Date.parse(dateWindow.end) - Date.parse(dateWindow.start)) / DAY_MS + 1;

  useEffect(() => {
    if (connected && state.status === "loaded" && !hasValidWindow) {
      saveWindow(presetWindow(DEFAULT_DAYS, latestDate));
    }
  }, [connected, state.status, hasValidWindow, latestDate]);

  const data =
    state.status === "loaded" && state.posts.length
      ? computeAnalytics(state.posts, state.attestation, dateWindow)
      : null;

  const handleExport = useCallback(() => {
    if (!data) return;
    setExporting(true);
    try {
      const csv = generateCSV(data);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `analytics-${address?.slice(0, 8)}-${dateWindow.start}-to-${dateWindow.end}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }, [data, address, dateWindow.start, dateWindow.end]);

  if (!connected || !address) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <div className="max-w-6xl mx-auto p-4 md:p-8">
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-3">
              Creator Analytics
            </h1>
            <p className="text-[var(--text-muted)]">
              Connect your wallet to view your analytics dashboard.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text-primary)]">Creator Analytics</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Performance metrics for your content
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Date range selector */}
            <div className="flex rounded-xl border border-[var(--bg-tertiary)] overflow-hidden">
              {DATE_PRESETS.map((d) => (
                <button
                  key={d}
                  onClick={() => saveWindow(presetWindow(d, latestDate))}
                  disabled={state.status !== "loaded"}
                  aria-pressed={selectedDays === d}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    selectedDays === d
                      ? "bg-[var(--accent-coral)] text-white"
                      : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            {/* Export */}
            <button
              onClick={handleExport}
              disabled={!data || exporting}
              className="px-4 py-2 text-sm font-medium rounded-xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors disabled:opacity-50"
            >
              {exporting ? "Exporting..." : "Export CSV"}
            </button>
          </div>
        </div>

        <DateRangeLabel start={dateWindow.start} end={dateWindow.end} />

        {state.status === "loading" && (
          <div className="space-y-6" aria-label="Loading creator analytics" aria-busy="true">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {summaryCardLabels.map((label, index) => (
                <SummaryCardSkeleton key={label} label={label} animationDelay={index * 80} />
              ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="h-[350px] animate-pulse rounded-2xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)]"
                />
              ))}
            </div>
          </div>
        )}

        {state.status === "error" && (
          <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-12 text-center">
            <p className="text-[var(--error)] mb-4">{state.message}</p>
            <button
              onClick={() => setAttempt((prev) => prev + 1)}
              className="px-6 py-2 rounded-xl bg-[var(--accent-coral)] text-white font-medium hover:opacity-90 transition-opacity"
            >
              Retry
            </button>
          </div>
        )}

        {state.status === "loaded" && !data?.summary.totalPosts && (
          <EmptyStateIllustration
            variant="creator"
            title="No analytics data yet"
            description="Create posts and grow your audience to start seeing your engagement metrics and earnings here."
          />
        )}

        {data && data.summary.totalPosts > 0 && <Dashboard data={data} />}
      </div>
    </div>
  );
}

function Dashboard({ data }: { data: AnalyticsData }) {
  const { summary, engagementOverTime, followerGrowth, tipEarnings, topPosts, attestation } = data;

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <SummaryCard label="Total Tips" value={`${summary.totalTipsXlm} XLM`} animationDelay={0} />
        <SummaryCard label="Posts" value={String(summary.totalPosts)} animationDelay={80} />
        <SummaryCard label="Likes" value={String(summary.totalLikes)} animationDelay={160} />
        <SummaryCard label="Followers" value={String(summary.followerCount)} animationDelay={240} />
        <SummaryCard
          label="Unique Tippers"
          value={String(summary.uniqueTippers)}
          animationDelay={320}
        />
      </div>

      {/* Attestation badge */}
      {attestation && (
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] bg-[var(--bg-secondary)] px-4 py-2 rounded-xl border border-[var(--bg-tertiary)]">
          <span>✅ Verified by oracle</span>
          <span className="text-[var(--bg-tertiary)]">|</span>
          <span>
            Ledgers {attestation.report.windowStart}–{attestation.report.windowEnd}
          </span>
          <span className="text-[var(--bg-tertiary)]">|</span>
          <a
            href={`https://stellar.expert/explorer/testnet/tx/${attestation.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent-teal)] hover:underline"
          >
            On-chain ↗
          </a>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Engagement over time */}
        <ChartCard title="Engagement Over Time" subtitle="Likes per day">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={engagementOverTime}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickFormatter={formatChartDate}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 12, fill: "var(--text-muted)" }} width={36} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                }}
                labelFormatter={(label) => `Date: ${label} (UTC)`}
              />
              <Line
                type="monotone"
                dataKey="likes"
                stroke="#FF6B5B"
                strokeWidth={2}
                dot={false}
                name="Likes"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Follower growth */}
        <ChartCard title="Follower Growth" subtitle="Cumulative over time">
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={followerGrowth}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickFormatter={formatChartDate}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 12, fill: "var(--text-muted)" }} width={36} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                }}
                labelFormatter={(label) => `Date: ${label} (UTC)`}
              />
              <Line
                type="monotone"
                dataKey="followers"
                stroke="#4ECDC4"
                strokeWidth={2}
                dot={false}
                name="Followers"
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Tip earnings */}
        <ChartCard title="Tip Earnings" subtitle="Tips per day (stroops)">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={tipEarnings}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "var(--text-muted)" }}
                tickFormatter={formatChartDate}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 12, fill: "var(--text-muted)" }} width={36} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                  color: "var(--text-primary)",
                }}
                labelFormatter={(label) => `Date: ${label} (UTC)`}
              />
              <Bar dataKey="earnings" fill="#7c3aed" radius={[4, 4, 0, 0]} name="Tips" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top posts */}
        <ChartCard title="Top Performing Posts" subtitle="Ranked by likes + tips">
          {topPosts.length === 0 ? (
            <p className="text-[var(--text-muted)] text-sm p-4">No posts yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--bg-tertiary)]">
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">#</th>
                    <th className="text-left py-2 px-3 text-[var(--text-muted)] font-medium">
                      Post
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Likes
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Tips
                    </th>
                    <th className="text-right py-2 px-3 text-[var(--text-muted)] font-medium">
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {topPosts.map((post, i) => (
                    <tr
                      key={post.id}
                      className="border-b border-[var(--bg-tertiary)] hover:bg-[var(--bg-secondary)] transition-colors"
                    >
                      <td className="py-2 px-3 text-[var(--text-muted)]">{i + 1}</td>
                      <td className="py-2 px-3 text-[var(--text-primary)] font-mono">
                        <a
                          href={`/posts/${post.id}`}
                          className="hover:text-[var(--accent-teal)] transition-colors"
                        >
                          #{post.id}
                        </a>
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                        {post.likes}
                      </td>
                      <td className="py-2 px-3 text-right text-[var(--text-primary)]">
                        {post.tips}
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-[var(--accent-coral)]">
                        {post.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Top tippers */}
      <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Top Tippers</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          {summary.uniqueTippers > 0
            ? `${summary.uniqueTippers} unique tippers in the selected period`
            : "No tippers yet"}
        </p>
        <div className="bg-[var(--bg-tertiary)] rounded-xl p-6 text-center">
          <p className="text-[var(--text-muted)] text-sm">
            Individual tipper details are available through the on-chain explorer. View your
            attestation transaction for verified tip data.
          </p>
          {attestation && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${attestation.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-3 px-4 py-2 text-sm font-medium rounded-xl border border-[var(--bg-tertiary)] text-[var(--accent-teal)] hover:bg-[var(--bg-tertiary)] transition-colors"
            >
              View on Stellar Expert ↗
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const summaryCardLabels = ["Total Tips", "Posts", "Likes", "Followers", "Unique Tippers"];

function SummaryCardSkeleton({ label, animationDelay }: { label: string; animationDelay: number }) {
  return (
    <div
      role="status"
      aria-label={`Loading ${label}`}
      className="creator-stat-card min-h-[84px] rounded-2xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] p-4"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <div className="mb-2 h-3 w-2/3 animate-pulse rounded bg-[var(--bg-tertiary)]" />
      <div className="h-6 w-4/5 animate-pulse rounded bg-[var(--bg-tertiary)]" />
    </div>
  );
}

function SummaryCard({
  label,
  value,
  animationDelay,
}: {
  label: string;
  value: string;
  animationDelay: number;
}) {
  return (
    <div
      className="creator-stat-card min-h-[84px] rounded-2xl border border-[var(--bg-tertiary)] bg-[var(--bg-secondary)] p-4"
      style={{ animationDelay: `${animationDelay}ms` }}
    >
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className="text-xl font-bold text-[var(--text-primary)] truncate">{value}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-[var(--bg-secondary)] rounded-2xl border border-[var(--bg-tertiary)] p-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-1">{title}</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date range label — shown below the range selector so the interval is always
// visible without hovering. Dates are UTC (matching ledgerToDate in analytics.ts).
// ---------------------------------------------------------------------------

function formatRangeDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function DateRangeLabel({ start, end }: { start: string; end: string }) {
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T00:00:00Z");
  return (
    <p
      className="text-xs text-[var(--text-muted)]"
      aria-label={`Showing data from ${formatRangeDate(startDate)} to ${formatRangeDate(endDate)} UTC`}
      data-testid="date-range-label"
    >
      {formatRangeDate(startDate)} – {formatRangeDate(endDate)}{" "}
      <span className="text-[var(--text-muted)] opacity-60">(UTC)</span>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Chart tick formatter — produces "1 Jun" style labels that stay legible on
// narrow screens without truncating or overlapping.
// ---------------------------------------------------------------------------

function formatChartDate(isoDate: string): string {
  try {
    const d = new Date(isoDate + "T00:00:00Z");
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  } catch {
    return isoDate;
  }
}
