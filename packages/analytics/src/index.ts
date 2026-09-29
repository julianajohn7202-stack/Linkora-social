/**
 * @linkora/analytics
 *
 * Shared analytics primitives — types and utilities used by the
 * analytics-oracle service and any other consumer that needs to produce or
 * interpret Linkora analytics reports.
 *
 * This package is a stub — implementation will be added in follow-up PRs.
 */

export interface AnalyticsReport {
  /** Stellar account address of the creator */
  creatorAddress: string;
  /** ISO-8601 date of the reporting period start */
  periodStart: string;
  /** ISO-8601 date of the reporting period end */
  periodEnd: string;
  /** Total number of posts published in the period */
  postCount: number;
  /** Total XLM received as tips in the period */
  tipsReceivedXlm: number;
  /** New followers gained in the period */
  newFollowers: number;
}

export type ReportStatus = "pending" | "signed" | "submitted" | "failed";

/**
 * Aggregate an array of raw event counts into an {@link AnalyticsReport}.
 * Returns `null` when the input array is empty.
 *
 * @param creatorAddress - Stellar account address
 * @param periodStart    - ISO-8601 period start
 * @param periodEnd      - ISO-8601 period end
 * @param _events        - Raw event data (to be defined)
 */
export function aggregateReport(
  creatorAddress: string,
  periodStart: string,
  periodEnd: string,
  _events: unknown[]
): AnalyticsReport | null {
  // TODO: implement aggregation logic
  void _events;
  return {
    creatorAddress,
    periodStart,
    periodEnd,
    postCount: 0,
    tipsReceivedXlm: 0,
    newFollowers: 0,
  };
}
