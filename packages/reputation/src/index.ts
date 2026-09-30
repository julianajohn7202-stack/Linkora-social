/**
 * @linkora/reputation
 *
 * Reputation scoring utilities for the Linkora social platform.
 * Computes on-chain reputation scores based on user activity metrics.
 */

export interface ReputationInput {
  /** Total number of posts created by the user. */
  postCount: number;
  /** Total number of likes received across all posts. */
  likesReceived: number;
  /** Total tip amount received (in stroops). */
  tipsReceived: number;
  /** Number of followers. */
  followerCount: number;
  /** Account age in days. */
  accountAgeDays: number;
}

export interface ReputationScore {
  /** Overall reputation score (0–100). */
  score: number;
  /** Reputation tier label. */
  tier: "newcomer" | "contributor" | "trusted" | "leader";
}

/**
 * Computes a reputation score from the given activity metrics.
 *
 * The score is a weighted sum normalised to 0–100.
 * Weights: posts (20%), likes (25%), tips (25%), followers (20%), age (10%).
 */
export function computeReputation(input: ReputationInput): ReputationScore {
  const postScore = Math.min(input.postCount / 50, 1) * 20;
  const likeScore = Math.min(input.likesReceived / 200, 1) * 25;
  const tipScore = Math.min(input.tipsReceived / 1_000_000, 1) * 25;
  const followerScore = Math.min(input.followerCount / 100, 1) * 20;
  const ageScore = Math.min(input.accountAgeDays / 365, 1) * 10;

  const score = Math.round(postScore + likeScore + tipScore + followerScore + ageScore);

  let tier: ReputationScore["tier"];
  if (score >= 75) tier = "leader";
  else if (score >= 50) tier = "trusted";
  else if (score >= 25) tier = "contributor";
  else tier = "newcomer";

  return { score, tier };
}
