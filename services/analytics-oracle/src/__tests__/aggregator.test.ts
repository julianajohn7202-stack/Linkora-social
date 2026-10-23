import { computeCreatorMetrics } from "../../../../packages/analytics/src/aggregator.js";

const AGGREGATED_ROW = {
  total_posts: "12",
  total_tips_received: "50000000",
  unique_tippers: "8",
  total_followers: "34",
  follower_delta: "5",
  engagement_rate: "0.1250",
};

describe("computeCreatorMetrics", () => {
  const database = {
    query: jest.fn().mockResolvedValue({ rows: [AGGREGATED_ROW] }),
  };
  const now = new Date("2026-10-17T16:30:00.000Z");

  beforeEach(() => {
    database.query.mockClear();
    database.query.mockResolvedValue({ rows: [AGGREGATED_ROW] });
  });

  it("returns aggregated totals and converts database numeric strings", async () => {
    await expect(computeCreatorMetrics(database, "GCREATOR", "all", now)).resolves.toEqual({
      totalPosts: 12,
      totalTipsReceived: 50_000_000,
      uniqueTippers: 8,
      totalFollowers: 34,
      followerDelta: 5,
      engagementRate: 0.125,
    });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("AVG(engagement_rate)"), [
      "GCREATOR",
    ]);
  });

  it.each([
    ["day", "2026-10-17"],
    ["week", "2026-10-11"],
    ["month", "2026-09-18"],
  ] as const)("applies the %s snapshot period", async (period, startDate) => {
    await computeCreatorMetrics(database, "GCREATOR", period, now);
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("snapshot_date >= $2::date"),
      ["GCREATOR", startDate]
    );
  });

  it("uses all retained snapshots for the all period", async () => {
    await computeCreatorMetrics(database, "GCREATOR", "all", now);
    const [statement, values] = database.query.mock.calls[0];
    expect(statement).toContain("FROM creator_analytics");
    expect(statement).not.toContain("snapshot_date >=");
    expect(values).toEqual(["GCREATOR"]);
  });
});
