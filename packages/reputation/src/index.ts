/**
 * @linkora/reputation
 *
 * Reputation scoring and on-chain attestation utilities for the Linkora
 * SocialFi platform.
 *
 * This package is a stub — implementation will be added in follow-up PRs.
 */

export interface ReputationScore {
  /** Stellar account address */
  address: string;
  /** Numeric score in the range [0, 100] */
  score: number;
  /** Unix timestamp (seconds) when the score was last computed */
  updatedAt: number;
}

export interface ReputationConfig {
  /** Minimum post count required to receive a non-zero score */
  minPosts: number;
  /** Weight applied to the follow-ratio component */
  followWeight: number;
  /** Weight applied to the tip-received component */
  tipWeight: number;
}

/**
 * Compute a reputation score for a given address.
 * Returns `null` when insufficient data is available.
 *
 * @param address - Stellar account address
 * @param _config - Scoring configuration
 */
export function computeReputation(
  address: string,
  _config: ReputationConfig
): ReputationScore | null {
  // TODO: implement scoring logic
  void address;
  return null;
}
