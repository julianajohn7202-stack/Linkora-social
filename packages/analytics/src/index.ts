/**
 * @linkora/analytics
 *
 * Creator engagement metrics, on-chain activity aggregation, and reporting
 * primitives for the Linkora social protocol.
 *
 * This package is a stub — full implementation is tracked in the project
 * roadmap.
 */

export interface EngagementMetrics {
  /** Stellar address of the creator. */
  address: string;
  /** Total number of followers. */
  followerCount: number;
  /** Total tips received (in stroops). */
  tipsReceivedStroops: bigint;
  /** Total posts published. */
  postCount: number;
  /** Computed engagement rate in [0, 1]. */
  engagementRate: number;
  /** ISO-8601 window start timestamp. */
  windowStart: string;
  /** ISO-8601 window end timestamp. */
  windowEnd: string;
}

export interface ActivitySnapshot {
  ledger: number;
  eventType: string;
  actor: string;
  timestamp: string;
}

/**
 * Aggregate a list of activity snapshots into engagement metrics for a
 * given creator address.
 *
 * @param address  - Stellar address of the creator.
 * @param snapshots - On-chain activity snapshots within the window.
 * @param windowStart - ISO-8601 start of the reporting window.
 * @param windowEnd   - ISO-8601 end of the reporting window.
 * @returns Aggregated {@link EngagementMetrics}.
 */
export function aggregateEngagement(
  address: string,
  snapshots: ActivitySnapshot[],
  windowStart: string,
  windowEnd: string
): EngagementMetrics {
  const posts = snapshots.filter((s) => s.eventType === "post_created" && s.actor === address);
  const follows = snapshots.filter((s) => s.eventType === "follow" && s.actor !== address);
  const tips = snapshots.filter((s) => s.eventType === "tip" && s.actor !== address);

  const followerCount = follows.length;
  const postCount = posts.length;
  const tipsReceivedStroops = BigInt(tips.length) * BigInt(10_000_000); // stub: 1 XLM each
  const engagementRate =
    followerCount > 0 ? Math.min(1, (postCount + tips.length) / followerCount) : 0;

  return {
    address,
    followerCount,
    tipsReceivedStroops,
    postCount,
    engagementRate,
    windowStart,
    windowEnd,
  };
}
