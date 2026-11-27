import { useCallback, useEffect, useState } from "react";

export type SearchResult =
  | { kind: "profile"; address: string; display_name: string | null; bio: string | null }
  | { kind: "post"; id: string; author: string; content: string };

const DEBOUNCE_MS = 300;

export function useSearch(endpoint: string, contextKey: string) {
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [response, setResponse] = useState<{
    requestKey: string;
    results: SearchResult[];
    error: string | null;
  } | null>(null);

  const trimmed = query.trim();
  const requestKey = JSON.stringify([endpoint, contextKey, trimmed, attempt]);
  const current = response?.requestKey === requestKey ? response : null;

  useEffect(() => {
    if (!trimmed) {
      setResponse(null);
      return;
    }

    setResponse(null);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        if (!endpoint) throw new Error("Search is unavailable on this network.");
        const url = `${endpoint.replace(/\/$/, "")}/search?q=${encodeURIComponent(trimmed)}`;
        const result = await fetch(url, { signal: controller.signal });
        if (!result.ok) throw new Error(`Search failed with status ${result.status}`);
        const { results } = (await result.json()) as { results: SearchResult[] };
        if (!controller.signal.aborted) {
          setResponse({ requestKey, results, error: null });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResponse({
            requestKey,
            results: [],
            error: error instanceof Error ? error.message : "Search failed",
          });
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, requestKey, trimmed]);

  const refresh = useCallback(() => setAttempt((previous) => previous + 1), []);

  return {
    query,
    setQuery,
    results: trimmed ? current?.results ?? [] : [],
    loading: Boolean(trimmed && !current),
    error: current?.error ?? null,
    refresh,
  };
}
