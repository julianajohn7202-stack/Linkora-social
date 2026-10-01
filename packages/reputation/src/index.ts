/**
 * @linkora/reputation
 *
 * On-chain trust signals and off-chain score aggregation for the Linkora
 * social protocol. Computes reputation scores from follows, tips, governance
 * participation, and moderation outcomes.
 *
 * This package is a stub — full implementation is tracked in the project
 * roadmap.
 */

export interface ReputationScore {
  /** Stellar address of the account being scored. */
  address: string;
  /** Normalised score in [0, 1]. */
  score: number;
  /** ISO-8601 timestamp of the last computation. */
  computedAt: string;
}

export interface ReputationSignal {
  type:
    | "follow"
    | "tip_received"
    | "governance_vote"
    | "moderation_outcome"
    | "pool_participation";
  weight: number;
  ledger: number;
}

/**
 * Compute a normalised reputation score from a set of on-chain signals.
 *
 * @param address - Stellar address to score.
 * @param signals - List of weighted signals for this address.
 * @returns A {@link ReputationScore} with a value in [0, 1].
 */
export function computeScore(
  address: string,
  signals: ReputationSignal[]
): ReputationScore {
  if (signals.length === 0) {
    return { address, score: 0, computedAt: new Date().toISOString() };
  }

  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  const raw = signals.reduce((sum, s) => sum + s.weight, 0) / signals.length;
  // Normalise to [0, 1] using a simple logistic function.
  const score = Math.min(1, raw / Math.max(1, totalWeight));

  return { address, score, computedAt: new Date().toISOString() };
}
