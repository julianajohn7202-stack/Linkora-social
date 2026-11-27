import { useState, useCallback, useRef, useEffect } from "react";

export interface SearchSuggestion {
  type: "profile" | "hashtag" | "recent" | "post";
  value: string;
  displayName?: string;
  avatar?: string;
  subtitle?: string;
}

interface UseSearchSuggestionsOptions {
  debounceMs?: number;
  minQueryLength?: number;
  maxSuggestions?: number;
  leadingEdge?: boolean;
  includePosts?: boolean;
}

const INDEXER_API_URL = process.env.NEXT_PUBLIC_INDEXER_API_URL ?? "";

export function useSearchSuggestions({
  debounceMs = 300,
  minQueryLength = 2,
  maxSuggestions = 5,
  leadingEdge = true,
  includePosts = false,
}: UseSearchSuggestionsOptions = {}) {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);
  const [loading, setLoading] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestQueryRef = useRef<string>("");
  const lastExecutedQueryRef = useRef<string>("");
  const isPendingDebounceRef = useRef<boolean>(false);

  const executeFetch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();

      if (!trimmed || trimmed.length < minQueryLength) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      // Cancel previous in-flight request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;
      latestQueryRef.current = trimmed;
      lastExecutedQueryRef.current = trimmed;
      setLoading(true);

      try {
        const params = `q=${encodeURIComponent(trimmed)}&limit=${maxSuggestions}`;
        const read = async (path: string) => {
          const response = await fetch(`${INDEXER_API_URL}${path}?${params}`, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error("Failed to fetch suggestions");
          return response.json();
        };
        const [profilesData, postsData] = await Promise.all([
          read("/api/profiles/search"),
          includePosts ? read("/api/search").catch(() => []) : [],
        ]);
        const profiles = Array.isArray(profilesData) ? profilesData : profilesData.profiles || [];
        const posts = Array.isArray(postsData) ? postsData : postsData.posts || [];

        const newSuggestions: SearchSuggestion[] = [
          ...profiles
            .slice(0, maxSuggestions)
            .map((profile: { address: string; username?: string; display_name?: string }) => ({
              type: "profile" as const,
              value: profile.address,
              displayName: profile.display_name || profile.username || profile.address,
              avatar: undefined,
              ...(includePosts ? { subtitle: profile.username } : {}),
            })),
        ];

        newSuggestions.push(
          ...posts
            .slice(0, maxSuggestions)
            .map((post: { id: string | number; content: string }) => ({
              type: "post" as const,
              value: String(post.id),
              displayName: post.content,
            }))
        );

        // Add hashtag suggestion if query starts with #
        if (trimmed.startsWith("#")) {
          newSuggestions.unshift({
            type: "hashtag" as const,
            value: trimmed,
            displayName: trimmed,
          });
        }

        // Only update if this request matches the absolute latest query and controller
        if (abortControllerRef.current === controller && latestQueryRef.current === trimmed) {
          setSuggestions(newSuggestions);
        }
      } catch (error: unknown) {
        if (error instanceof Error && error.name !== "AbortError") {
          console.error("Failed to fetch suggestions:", error);
          if (abortControllerRef.current === controller && latestQueryRef.current === trimmed) {
            setSuggestions([]);
          }
        }
      } finally {
        if (abortControllerRef.current === controller && latestQueryRef.current === trimmed) {
          setLoading(false);
        }
      }
    },
    [minQueryLength, maxSuggestions, includePosts]
  );

  const debouncedFetch = useCallback(
    (query: string) => {
      const trimmed = query.trim();
      latestQueryRef.current = trimmed;

      if (!trimmed || trimmed.length < minQueryLength) {
        if (debounceTimerRef.current) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        setSuggestions([]);
        setLoading(false);
        return;
      }

      setLoading(true);

      // Leading edge debounce: fire immediately on first keystroke, then throttle subsequent bursts
      const shouldFireLeading =
        leadingEdge && !debounceTimerRef.current && lastExecutedQueryRef.current !== trimmed;

      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }

      if (shouldFireLeading) {
        executeFetch(trimmed);
      }

      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (latestQueryRef.current === trimmed && lastExecutedQueryRef.current !== trimmed) {
          executeFetch(trimmed);
        }
      }, debounceMs);
    },
    [debounceMs, executeFetch, leadingEdge, minQueryLength]
  );

  const clearSuggestions = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    latestQueryRef.current = "";
    lastExecutedQueryRef.current = "";
    setSuggestions([]);
    setLoading(false);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  return {
    suggestions,
    loading,
    fetchSuggestions: debouncedFetch,
    clearSuggestions,
  };
}
