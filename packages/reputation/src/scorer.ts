export interface ReputationSignals {
  followerCount: number;
  /** Total tips received, in stroops (10,000,000 stroops = 1 XLM). */
  tipTotalStroops: bigint;
  totalLikes: number;
  postCount: number;
  govVoteCount: number;
  credentialVerified: boolean;
}

export type ReputationSignal = keyof ReputationSignals;
export type ScoreWeights = Partial<Record<ReputationSignal, number>>;
export type ReputationTier = "unranked" | "bronze" | "silver" | "gold" | "diamond";

export const DEFAULT_SCORE_WEIGHTS: Readonly<Record<ReputationSignal, number>> = {
  followerCount: 0.3,
  tipTotalStroops: 0.25,
  totalLikes: 0.2,
  postCount: 0.1,
  govVoteCount: 0.1,
  credentialVerified: 0.05,
};

const SIGNAL_CAPS = {
  followerCount: 100_000,
  tipTotalStroops: 10_000n * 10_000_000n,
  totalLikes: 50_000,
  postCount: 500,
  govVoteCount: 100,
} as const;

const SCORE_MAX = 10_000;

function normalizeNumber(value: number, cap: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, cap) / cap;
}

function normalizeBigInt(value: bigint, cap: bigint): number {
  if (value <= 0n) return 0;
  return Number(value >= cap ? cap : value) / Number(cap);
}

/** Computes a clamped 0–10,000 score from normalized reputation signals. */
export function computeScore(
  signals: ReputationSignals,
  customWeights: ScoreWeights = {}
): number {
  const weights = { ...DEFAULT_SCORE_WEIGHTS, ...customWeights };
  const entries = Object.entries(weights) as [ReputationSignal, number][];

  for (const [signal, weight] of entries) {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`Weight for ${signal} must be a finite non-negative number`);
    }
  }

  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (totalWeight === 0) return 0;

  const normalized: Record<ReputationSignal, number> = {
    followerCount: normalizeNumber(signals.followerCount, SIGNAL_CAPS.followerCount),
    tipTotalStroops: normalizeBigInt(signals.tipTotalStroops, SIGNAL_CAPS.tipTotalStroops),
    totalLikes: normalizeNumber(signals.totalLikes, SIGNAL_CAPS.totalLikes),
    postCount: normalizeNumber(signals.postCount, SIGNAL_CAPS.postCount),
    govVoteCount: normalizeNumber(signals.govVoteCount, SIGNAL_CAPS.govVoteCount),
    credentialVerified: signals.credentialVerified ? 1 : 0,
  };

  const weightedTotal = entries.reduce(
    (sum, [signal, weight]) => sum + normalized[signal] * weight,
    0
  );
  return Math.max(0, Math.min(SCORE_MAX, Math.round((weightedTotal / totalWeight) * SCORE_MAX)));
}

/** Maps a 0–10,000 score to the documented reputation tier thresholds. */
export function scoreToTier(score: number): ReputationTier {
  const boundedScore = Number.isFinite(score) ? Math.max(0, Math.min(SCORE_MAX, score)) : 0;
  if (boundedScore >= 8_500) return "diamond";
  if (boundedScore >= 6_000) return "gold";
  if (boundedScore >= 3_000) return "silver";
  if (boundedScore >= 1_000) return "bronze";
  return "unranked";
}
