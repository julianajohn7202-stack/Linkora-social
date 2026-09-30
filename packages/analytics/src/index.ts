/**
 * @linkora/analytics
 *
 * Analytics utilities for the Linkora social platform.
 * Provides engagement metric aggregation and time-series helpers.
 */

export interface EngagementMetrics {
  /** Total post views in the window. */
  views: number;
  /** Total likes in the window. */
  likes: number;
  /** Total tips amount in the window (in stroops). */
  tips: number;
  /** Total number of new followers in the window. */
  newFollowers: number;
}

export interface EngagementSummary {
  /** Engagement rate as a percentage (0–100). */
  engagementRate: number;
  /** Average tips per post. */
  avgTipsPerPost: number;
  /** Total interactions. */
  totalInteractions: number;
}

/**
 * Summarises engagement metrics for a given time window.
 *
 * @param metrics - Raw engagement metrics.
 * @param postCount - Number of posts in the time window.
 * @returns Aggregated engagement summary.
 */
export function summariseEngagement(
  metrics: EngagementMetrics,
  postCount: number
): EngagementSummary {
  const totalInteractions = metrics.likes + metrics.newFollowers;
  const engagementRate =
    metrics.views > 0
      ? Math.round((totalInteractions / metrics.views) * 100 * 100) / 100
      : 0;
  const avgTipsPerPost = postCount > 0 ? Math.round(metrics.tips / postCount) : 0;

  return { engagementRate, avgTipsPerPost, totalInteractions };
}
