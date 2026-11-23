import { useCallback, useEffect, useRef, useState } from "react";
import { Post } from "../components/PostCard";
import { initDatabase, getCachedPosts, evictStaleCache } from "../utils/db";
import { fetchAndCachePosts } from "../utils/sync";

const PAGE_SIZE = 10;

// Global event system for notifying feed updates (optimistic post creation/confirmations)
const feedUpdateListeners = new Set<() => void>();

export function notifyFeedUpdate(): void {
  feedUpdateListeners.forEach((listener) => listener());
}

export function subscribeToFeedUpdates(listener: () => void): () => void {
  feedUpdateListeners.add(listener);
  return () => {
    feedUpdateListeners.delete(listener);
  };
}

export function getFeedPostById(postId: string): Promise<Post | null> {
  // Return via DB import if needed, or query cache.
  // Note: Since this is now async, screens should fetch it asynchronously.
  return import("../utils/db").then((db) => db.getCachedPostById(postId));
}

export const getFeedPost = getFeedPostById;

export function markFeedPostDeleted(postId: string | number): void {
  // Mark post deleted in local cache
  import("../utils/db").then(async (db) => {
    await db.deleteCachedPost(String(postId));
    notifyFeedUpdate();
  });
}

export interface UseFeedReturn {
  posts: Post[];
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

export function useFeed(): UseFeedReturn {
  const [posts, setPosts] = useState<Post[]>([]);
  const [activity, setActivity] = useState<"refresh" | "page" | null>("refresh");
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const generation = useRef(0);
  const running = useRef(false);
  const mounted = useRef(false);
  const initialized = useRef(false);
  const cursor = useRef<number | null>(null);
  const visibleLimit = useRef(PAGE_SIZE);

  const syncWithNetwork = useCallback(async (refresh: boolean) => {
    if (refresh) generation.current++;
    if (running.current) {
      if (refresh) {
        setActivity("refresh");
        setError(null);
      }
      return;
    }

    running.current = true;
    const startingGeneration = generation.current;
    let completedGeneration: number;
    do {
      const requestGeneration = generation.current;
      completedGeneration = requestGeneration;
      const replace = refresh || requestGeneration !== startingGeneration;
      const isCurrent = () => mounted.current && generation.current === requestGeneration;
      setActivity(replace ? "refresh" : "page");
      setError(null);
      try {
        if (!initialized.current) {
          await initDatabase();
          const cached = await getCachedPosts(PAGE_SIZE, 0);
          if (!isCurrent()) continue;
          initialized.current = true;
          setPosts(cached);
        }

        const page = await fetchAndCachePosts(
          PAGE_SIZE,
          replace ? 0 : (cursor.current ?? 0),
          isCurrent
        );
        if (!isCurrent()) continue;
        if (replace) await evictStaleCache();

        const limit = replace ? PAGE_SIZE : visibleLimit.current + PAGE_SIZE;
        const cached = await getCachedPosts(limit, 0);
        if (!isCurrent()) continue;
        const nextCursor = page.length === PAGE_SIZE ? page[page.length - 1].timestamp : null;
        cursor.current = nextCursor;
        visibleLimit.current = limit;
        setPosts(cached);
        setHasMore(nextCursor !== null);
      } catch (err) {
        if (isCurrent()) {
          console.warn("Network sync failed, displaying cached data:", err);
          setError("Offline mode. Serving cached posts.");
        }
      }
    } while (mounted.current && completedGeneration !== generation.current);

    running.current = false;
    if (mounted.current) setActivity(null);
  }, []);

  useEffect(() => {
    mounted.current = true;
    void syncWithNetwork(true);
    return () => {
      mounted.current = false;
      generation.current++;
    };
  }, [syncWithNetwork]);

  useEffect(() => {
    let active = true;
    const unsubscribe = subscribeToFeedUpdates(async () => {
      if (!initialized.current || running.current) return;
      const currentGeneration = generation.current;
      const currentCursor = cursor.current;
      try {
        const cached = await getCachedPosts(visibleLimit.current, 0);
        if (
          active &&
          !running.current &&
          generation.current === currentGeneration &&
          cursor.current === currentCursor
        ) {
          setPosts(cached);
        }
      } catch (err) {
        console.warn("Failed to load posts from SQLite cache:", err);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const loadMore = useCallback(() => {
    if (!running.current && cursor.current !== null) void syncWithNetwork(false);
  }, [syncWithNetwork]);

  const refresh = useCallback(() => {
    void syncWithNetwork(true);
  }, [syncWithNetwork]);

  return {
    posts,
    loading: activity !== null,
    refreshing: activity === "refresh",
    loadingMore: activity === "page",
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
