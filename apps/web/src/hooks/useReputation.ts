"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { scoreToTier, type ReputationTier } from "../../../../packages/reputation/src/scorer";
import { MemoryCache } from "../lib/cache";

const REPUTATION_TTL_MS = 5 * 60_000;
const INDEXER_URL = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001";

export interface ReputationData {
  user_address: string;
  score: number;
  posts_count: number;
  tips_sent: number;
  tips_received: number;
  governance_votes: number;
  last_computed_at: string;
  updated_ledger: number;
}

interface UseReputationResult {
  reputation: ReputationData | null;
  tier: ReputationTier | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

function isReputationData(value: unknown): value is ReputationData {
  if (!value || typeof value !== "object") return false;
  const score = value as Partial<ReputationData>;
  const numericFields = [
    score.score,
    score.posts_count,
    score.tips_sent,
    score.tips_received,
    score.governance_votes,
    score.updated_ledger,
  ];
  return (
    typeof score.user_address === "string" &&
    numericFields.every((field) => typeof field === "number" && Number.isFinite(field)) &&
    typeof score.last_computed_at === "string"
  );
}

export function useReputation(address: string | null): UseReputationResult {
  const [reputation, setReputation] = useState<ReputationData | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(address));
  const [error, setError] = useState<string | null>(null);

  const cache = useRef(new MemoryCache<ReputationData | null>(100, REPUTATION_TTL_MS));
  const pending = useRef<AbortController | null>(null);

  const fetchReputation = useCallback(async (force = false) => {
    pending.current?.abort();
    setError(null);

    const cached = address && !force ? cache.current.get(address) : undefined;
    if (!address || cached !== undefined) {
      setReputation(cached ?? null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setIsLoading(true);
    try {
      const response = await fetch(
        `${INDEXER_URL}/api/profiles/${encodeURIComponent(address)}/reputation`,
        { signal: controller.signal }
      );
      let next: ReputationData | null = null;
      if (response.status !== 404 && response.status !== 204) {
        if (!response.ok) {
          throw new Error(`Unable to load reputation (${response.status})`);
        }
        const payload: unknown = await response.json();
        if (payload !== null && !isReputationData(payload)) {
          throw new Error("The reputation response has an invalid format");
        }
        next = payload;
      }
      if (controller.signal.aborted) return;
      cache.current.set(address, next);
      setReputation(next);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setReputation(null);
      setError(cause instanceof Error ? cause.message : "Unable to load reputation");
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    setReputation(null);
    void fetchReputation();
    return () => pending.current?.abort();
  }, [fetchReputation]);

  return {
    reputation,
    tier: reputation === null ? null : scoreToTier(reputation.score),
    isLoading,
    error,
    refetch: () => fetchReputation(true),
  };
}
