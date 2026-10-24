export type CreatorMetricsPeriod = "day" | "week" | "month" | "all";

export interface CreatorMetrics {
  totalPosts: number;
  totalTipsReceived: number;
  uniqueTippers: number;
  totalFollowers: number;
  followerDelta: number;
  engagementRate: number;
}

interface CreatorMetricsRow {
  total_posts: number | string | null;
  total_tips_received: number | string | null;
  unique_tippers: number | string | null;
  total_followers: number | string | null;
  follower_delta: number | string | null;
  engagement_rate: number | string | null;
}

export interface AnalyticsQueryClient {
  query(
    statement: string,
    values: unknown[]
  ): Promise<{ rows: CreatorMetricsRow[] }>;
}

const PERIOD_DAYS: Record<Exclude<CreatorMetricsPeriod, "all">, number> = {
  day: 0,
  week: 6,
  month: 29,
};

function startDateForPeriod(period: Exclude<CreatorMetricsPeriod, "all">, now: Date): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - PERIOD_DAYS[period]);
  return start.toISOString().slice(0, 10);
}

function numeric(value: number | string | null): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function computeCreatorMetrics(
  database: AnalyticsQueryClient,
  creatorAddress: string,
  period: CreatorMetricsPeriod,
  now: Date = new Date()
): Promise<CreatorMetrics> {
  const dateFilter = period === "all" ? "" : " AND snapshot_date >= $2::date";
  const statement = `
    SELECT
      COALESCE(SUM(total_posts), 0) AS total_posts,
      COALESCE(SUM(total_tips_received), 0) AS total_tips_received,
      COALESCE(SUM(unique_tippers), 0) AS unique_tippers,
      COALESCE(SUM(follower_delta), 0) AS follower_delta,
      COALESCE(AVG(engagement_rate), 0) AS engagement_rate,
      COALESCE((
        SELECT total_followers
        FROM creator_analytics
        WHERE creator_address = $1${dateFilter}
        ORDER BY snapshot_date DESC
        LIMIT 1
      ), 0) AS total_followers
    FROM creator_analytics
    WHERE creator_address = $1${dateFilter}
  `;
  const values = period === "all" ? [creatorAddress] : [creatorAddress, startDateForPeriod(period, now)];
  const result = await database.query(statement, values);
  const row = result.rows[0];

  return {
    totalPosts: numeric(row?.total_posts ?? 0),
    totalTipsReceived: numeric(row?.total_tips_received ?? 0),
    uniqueTippers: numeric(row?.unique_tippers ?? 0),
    totalFollowers: numeric(row?.total_followers ?? 0),
    followerDelta: numeric(row?.follower_delta ?? 0),
    engagementRate: numeric(row?.engagement_rate ?? 0),
  };
}