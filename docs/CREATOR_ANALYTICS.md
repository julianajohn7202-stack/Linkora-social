# Creator analytics metric definitions

## Creator Analytics page

The [web analytics producer](../apps/web/src/lib/analytics.ts) uses the author's post rows from the [indexer post route](../services/indexer/src/api/routes/posts.ts) and the latest cached attestation from the [analytics oracle](../services/analytics-oracle/src/index.ts). The [Creator Analytics page](../apps/web/src/app/analytics/page.tsx) consumes these values for its cards, charts, ranking and CSV export.

For post-based metrics, the 7-, 30- and 90-day controls select posts whose `created_ledger` is at least the newest fetched value minus `days × 17,280`. Both the cutoff and newest value are included. The helper treats the field as a ledger sequence at five seconds per ledger and buckets it under an estimated UTC date using its fixed genesis timestamp. The [PostgreSQL post listing](../services/indexer/src/postgres-db.ts) currently returns Unix seconds in this field, so the control and chart dates can diverge from calendar dates. The web fetcher also sends an offset while the route accepts a cursor. Totals describe the rows actually fetched.

| Metric               | Producer and aggregation                                                                                                                                                      | Consumer                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Posts                | `computeAnalytics` counts fetched post rows within the cutoff. It applies no additional deleted-row filter.                                                                   | Posts card and daily post counts in CSV        |
| Likes                | `computeAnalytics` sums the included posts' current `like_count`, with missing values treated as zero.                                                                        | Likes card, Engagement Over Time chart and CSV |
| Daily tip earnings   | `computeAnalytics` sums the included posts' current `tip_total` in stroops, with missing values treated as zero. Both daily likes and tips are grouped by post creation date. | Tip Earnings chart and CSV                     |
| Follower growth      | `computeAnalytics` accumulates included post counts by creation date. The series currently measures cumulative posts.                                                         | Follower Growth chart and CSV                  |
| Top performing posts | `computeAnalytics` sorts included posts by `like_count + tip_total` in descending order and keeps ten.                                                                        | Top Performing Posts table and CSV             |
| Total tips           | `fetchAttestation` reads report `totalTips`. The card divides the stroop amount by 10,000,000 to display XLM.                                                                 | Total Tips card                                |
| Followers            | `fetchAttestation` reads report `followerDelta`, the net change within the attested window.                                                                                   | Followers card                                 |
| Unique tippers       | `fetchAttestation` reads report `uniqueTippers`, the distinct tipping addresses within the attested window.                                                                   | Unique Tippers card and Top Tippers caption    |

The latest attestation has its own inclusive ledger bounds, displayed beside the oracle badge. The [oracle query](../services/analytics-oracle/src/db.ts) counts distinct posts created within those bounds and sums tip amounts and counts distinct tippers on those posts with tips inside the same bounds. Follower delta subtracts unfollows from follows in that ledger range. A missing attestation produces zeroes on the three report-backed cards and hides the badge. With no fetched posts the page shows an empty state and disables export. Days with no included posts have no chart point or CSV row.

The [Audience Analytics page](../apps/web/src/app/creator/audience/page.tsx) uses local fixtures for growth, following, region counts and the activity heatmap. Its follower total is the last growth value for the selected range, and its ratio divides that total by the fixed following count. The range changes the growth fixture. Geography and activity use fixed data, with no event-time filter.

## Creator metrics API

The [oracle metrics query](../services/analytics-oracle/src/db.ts) produces the response for `GET /metrics/creators/:address`, consumed by [SDK AnalyticsClient.getCreatorMetrics](../packages/sdk/src/analytics.ts). For `1d`, `7d`, `30d` and `90d`, the [route](../services/analytics-oracle/src/index.ts) subtracts the requested number of 24-hour days from request time. The SQL uses an inclusive lower bound on creation time. The response reports request time as `windowEnd` and the SQL currently applies only the lower bound. Follow timestamps are stored in integer seconds, so their cutoff is rounded down to a whole second.

| Field           | Producer rule in `fetchCreatorMetrics`                                                                      | Consumer                           |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `totalTips`     | Sum indexed tip amounts for the creator's posts, filtered by tip creation time, in stroops.                 | SDK `totalTips` decimal string     |
| `postCount`     | Count creator post rows by post creation time.                                                              | SDK `postCount` decimal string     |
| `followerDelta` | Count indexed follows to the creator by follow creation time. This API field currently counts follows only. | SDK `followerDelta` decimal string |
| `uniqueTippers` | Count distinct tipping addresses on the creator's posts by tip creation time.                               | SDK `uniqueTippers` number         |

An address with no matching rows receives zeroes for all four fields.

### Date-window verification fixture

For a `7d` request at **2026-11-23 12:00:00 UTC**, the cutoff is **2026-11-16 12:00:00 UTC**. All rows below belong to the queried creator. The two included tips target the older post.

| Indexed event            | UTC creation time | Included               |
| ------------------------ | ----------------- | ---------------------- |
| Older post               | Nov 16, 11:59:59  | No                     |
| Tip of 10 stroops from A | Nov 16, 11:59:59  | No                     |
| Tip of 20 stroops from A | Nov 16, 12:00:00  | Yes, exactly at cutoff |
| Tip of 30 stroops from A | Nov 17, 09:00:00  | Yes                    |
| New post                 | Nov 20, 09:00:00  | Yes                    |
| Follow                   | Nov 23, 12:00:00  | Yes                    |

For these inputs, expect `totalTips: "50"`, `postCount: "1"`, `followerDelta: "1"` and `uniqueTippers: 1`. A future-dated row would also pass the current SQL lower-bound filter.
