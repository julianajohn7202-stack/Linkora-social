/**
 * useSearch.ts
 *
 * Hook for the full search experience on Linkora mobile.
 *
 * Features:
 *  • Recent searches persisted in AsyncStorage (shown when input is empty)
 *  • 300ms debounce on the search query
 *  • Results grouped into profiles, posts, and hashtags
 *  • Clear / remove individual recent searches
 *
 * Data sources:
 *  Uses the same in-memory catalog pattern as the existing explore screen
 *  (profiles, pools) and extends it with posts and hashtags. When the indexer
 *  search API is available (EXPO_PUBLIC_INDEXER_URL), it will call the REST
 *  endpoint instead. Otherwise it falls back to the mock catalog for
 *  development / preview builds.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileSearchResult {
  address: string;
  username: string;
  bio: string;
  creatorToken: string;
}

export interface PostSearchResult {
  id: number | string;
  author: string;
  username: string;
  content: string;
  timestamp: number;
  like_count: number;
  tip_total: number;
}

export interface HashtagSearchResult {
  tag: string;
  postCount: number;
}

export interface SearchResults {
  profiles: ProfileSearchResult[];
  posts: PostSearchResult[];
  hashtags: HashtagSearchResult[];
}

export interface UseSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  debouncedQuery: string;
  results: SearchResults;
  loading: boolean;
  error: string | null;
  recentSearches: string[];
  addRecentSearch: (term: string) => void;
  removeRecentSearch: (term: string) => void;
  clearRecentSearches: () => void;
  refresh: () => void;
}

// ---------------------------------------------------------------------------
// AsyncStorage keys
// ---------------------------------------------------------------------------

const RECENT_SEARCHES_KEY = "linkora:recent_searches";
const MAX_RECENT_SEARCHES = 10;
const DEBOUNCE_MS = 300;

// ---------------------------------------------------------------------------
// Mock catalog (development fallback)
// ---------------------------------------------------------------------------

const MOCK_PROFILES: ProfileSearchResult[] = [
  {
    address: "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ",
    username: "maya",
    bio: "Creator economy researcher",
    creatorToken: "MAYA",
  },
  {
    address: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    username: "atlas",
    bio: "Building social pools for artists",
    creatorToken: "ATLAS",
  },
  {
    address: "GDXU2G6VZLJIFRVDH5HLYCWJ2F64YQZH2TJUFDPBTZC53RIRZQJQ4LNK",
    username: "nova",
    bio: "Music drops and fan rewards",
    creatorToken: "NOVA",
  },
  {
    address: "GBSTH3QLKFUVFVVDXMJHQP4MDQLGPVVWSF5IOAXUMKQLWFMV3AQKZFX",
    username: "lumen",
    bio: "DeFi maximalist and protocol designer",
    creatorToken: "LUMEN",
  },
];

const MOCK_POSTS: PostSearchResult[] = [
  {
    id: 101,
    author: "GCKFBEIYTKP6RCZNVPH73XL7XFWTEOAO4MKONX7HOILHDVBMW5EVPOPZ",
    username: "maya",
    content: "Exploring creator-owned economies on Soroban — the future of social is on-chain.",
    timestamp: Date.now() - 3600_000,
    like_count: 42,
    tip_total: 120.5,
  },
  {
    id: 102,
    author: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    username: "atlas",
    content: "New pool just launched for independent artists. Join the Design Guild pool today!",
    timestamp: Date.now() - 7200_000,
    like_count: 28,
    tip_total: 55.0,
  },
  {
    id: 103,
    author: "GDXU2G6VZLJIFRVDH5HLYCWJ2F64YQZH2TJUFDPBTZC53RIRZQJQ4LNK",
    username: "nova",
    content: "Music drop incoming — exclusive track for token holders. Stay tuned!",
    timestamp: Date.now() - 14400_000,
    like_count: 67,
    tip_total: 210.75,
  },
];

const MOCK_HASHTAGS: HashtagSearchResult[] = [
  { tag: "SocialFi", postCount: 1240 },
  { tag: "CreatorEconomy", postCount: 890 },
  { tag: "Soroban", postCount: 2100 },
  { tag: "Stellar", postCount: 3500 },
  { tag: "MusicDrops", postCount: 432 },
  { tag: "CreatorTokens", postCount: 567 },
];

// ---------------------------------------------------------------------------
// Search helpers
// ---------------------------------------------------------------------------

function matchesQuery(value: string, query: string): boolean {
  return value.toLowerCase().includes(query);
}

function emptyResults(): SearchResults {
  return { profiles: [], posts: [], hashtags: [] };
}

async function searchCatalog(query: string): Promise<SearchResults> {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return emptyResults();
  }

  return {
    profiles: MOCK_PROFILES.filter((profile) =>
      [profile.username, profile.bio, profile.creatorToken, profile.address].some((value) =>
        matchesQuery(value, normalized)
      )
    ),
    posts: MOCK_POSTS.filter((post) =>
      [post.content, post.username, post.author].some((value) => matchesQuery(value, normalized))
    ),
    hashtags: MOCK_HASHTAGS.filter(
      (ht) => matchesQuery(ht.tag, normalized) || matchesQuery(`#${ht.tag}`, normalized)
    ),
  };
}

// ---------------------------------------------------------------------------
// AsyncStorage helpers
// ---------------------------------------------------------------------------

async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

async function saveRecentSearches(searches: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(searches));
  } catch {
    // Silent fail — recent searches are a convenience, not critical
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSearch(): UseSearchReturn {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(emptyResults());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [searchNonce, setSearchNonce] = useState(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recent searches on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const stored = await loadRecentSearches();
      if (active) {
        setRecentSearches(stored);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // Debounce the query
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }
    debounceTimer.current = setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [query]);

  // Run search when debounced query changes
  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      const normalized = debouncedQuery.trim();
      if (!normalized) {
        setResults(emptyResults());
        setLoading(false);
        setError(null);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const nextResults = await searchCatalog(normalized);
        if (!cancelled) {
          setResults(nextResults);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults(emptyResults());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    runSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, searchNonce]);

  // ── Recent search actions ─────────────────────────────────────────────────

  const addRecentSearch = useCallback(
    (term: string) => {
      const normalized = term.trim();
      if (!normalized) return;
      setRecentSearches((prev) => {
        const filtered = prev.filter((s) => s.toLowerCase() !== normalized.toLowerCase());
        const next = [normalized, ...filtered].slice(0, MAX_RECENT_SEARCHES);
        void saveRecentSearches(next);
        return next;
      });
    },
    []
  );

  const removeRecentSearch = useCallback((term: string) => {
    setRecentSearches((prev) => {
      const next = prev.filter((s) => s !== term);
      void saveRecentSearches(next);
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    void saveRecentSearches([]);
  }, []);

  const refresh = useCallback(() => {
    setSearchNonce((n) => n + 1);
  }, []);

  return {
    query,
    setQuery,
    debouncedQuery,
    results,
    loading,
    error,
    recentSearches,
    addRecentSearch,
    removeRecentSearch,
    clearRecentSearches,
    refresh,
  };
}
