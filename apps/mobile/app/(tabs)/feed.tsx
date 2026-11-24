import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  View,
  Text,
  Pressable,
  AppState,
} from "react-native";
import { useRouter } from "expo-router";
import { PostCard, Post } from "../../components/PostCard";
import { PostCardSkeleton } from "../../components/skeletons/PostCardSkeleton";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useFeed } from "../../hooks/useFeed";
import { useTheme } from "../../theme/useTheme";
import { evictStaleCache } from "../../utils/db";

const SKELETON_COUNT = 4;

function SkeletonList() {
  return (
    <>
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <PostCardSkeleton key={i} />
      ))}
    </>
  );
}

/** Formats a Date as a short "HH:MM" time string. */
function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface ConnectivityBannerProps {
  lastRefreshed: Date | null;
  isOffline: boolean;
  onRetry: () => void;
  retrying: boolean;
}

/**
 * Compact banner that shows offline warning and last-refresh time together.
 * Remains visible only while offline; disappears when connectivity is restored.
 * Cached content underneath stays fully readable.
 */
function ConnectivityBanner({
  lastRefreshed,
  isOffline,
  onRetry,
  retrying,
}: ConnectivityBannerProps) {
  if (!isOffline) return null;

  const refreshLabel = lastRefreshed
    ? `Last updated ${formatTime(lastRefreshed)}`
    : "Not yet synced";

  return (
    <View
      style={bannerStyles.wrapper}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`Offline. ${refreshLabel}. Tap retry to reconnect.`}
    >
      <View style={bannerStyles.left}>
        <Text style={bannerStyles.icon} accessibilityElementsHidden>
          ⚠️
        </Text>
        <View>
          <Text style={bannerStyles.title}>You're offline</Text>
          <Text style={bannerStyles.subtitle}>{refreshLabel}</Text>
        </View>
      </View>
      <Pressable
        onPress={onRetry}
        disabled={retrying}
        style={({ pressed }) => [bannerStyles.retryBtn, pressed && bannerStyles.retryBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
        accessibilityState={{ disabled: retrying }}
      >
        <Text style={bannerStyles.retryText}>{retrying ? "Retrying…" : "Retry"}</Text>
      </Pressable>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  wrapper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#451a03",
    borderBottomWidth: 1,
    borderBottomColor: "#92400e",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  icon: {
    fontSize: 16,
    marginRight: 4,
  },
  title: {
    color: "#fef3c7",
    fontSize: 13,
    fontWeight: "600",
  },
  subtitle: {
    color: "#fde68a",
    fontSize: 11,
    marginTop: 1,
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: "#92400e",
    marginLeft: 8,
  },
  retryBtnPressed: {
    backgroundColor: "#78350f",
  },
  retryText: {
    color: "#fef3c7",
    fontSize: 12,
    fontWeight: "600",
  },
});

export default function FeedScreen() {
  const router = useRouter();
  const { theme } = useTheme();
  const { posts, loading, error, loadMore, refresh } = useFeed();

  /** Wall-clock time of the most recent successful network sync. */
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  /** True while the user-initiated retry is in-flight. */
  const [retrying, setRetrying] = useState(false);
  /** Whether the feed is currently in offline / cached-only mode. */
  const isOffline = error !== null;

  // Track whether the previous render had an error so we can stamp the refresh
  // time exactly when connectivity is restored.
  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevErrorRef.current !== null && error === null) {
      // Reconnected — record the refresh time.
      setLastRefreshed(new Date());
    }
    prevErrorRef.current = error;
  }, [error]);

  // Stamp time on first successful load too.
  useEffect(() => {
    if (!loading && error === null && posts.length > 0 && lastRefreshed === null) {
      setLastRefreshed(new Date());
    }
  }, [loading, error, posts.length, lastRefreshed]);

  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      await new Promise<void>((resolve) => {
        refresh();
        // Give the async sync a moment; useFeed will update error/loading.
        setTimeout(resolve, 300);
      });
    } finally {
      setRetrying(false);
    }
  }, [refresh]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") {
        // Sync new posts from the network.
        refresh();
        // Evict posts older than 7 days or beyond the 100-row cap (TTL eviction).
        evictStaleCache(86400 * 7, 100).catch((err) => console.warn("Cache eviction failed:", err));
      }
    });
    return () => {
      subscription.remove();
    };
  }, [refresh]);

  const isInitialLoad = loading && posts.length === 0;

  if (isInitialLoad) {
    return (
      <View style={styles.container}>
        <SkeletonList />
      </View>
    );
  }

  if (error && posts.length === 0) {
    return <ErrorState message="Could not load posts" onRetry={refresh} />;
  }

  return (
    <View style={styles.container}>
      <ConnectivityBanner
        isOffline={isOffline}
        lastRefreshed={lastRefreshed}
        onRetry={handleRetry}
        retrying={retrying}
      />
      <FlatList<Post>
        style={styles.list}
        contentContainerStyle={posts.length === 0 ? styles.emptyContainer : styles.listContent}
        data={posts}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <PostCard post={item} />}
        ListEmptyComponent={
          <EmptyState
            icon="📭"
            title="No posts yet"
            subtitle="Be the first to post on Linkora."
            actionLabel="Explore creators"
            onAction={() => router.push("/(tabs)/explore" as Parameters<typeof router.push>[0])}
          />
        }
        ListFooterComponent={
          loading && posts.length > 0 ? (
            <ActivityIndicator
              style={styles.footer}
              color={theme.colors.brand.primary}
              size="small"
            />
          ) : null
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={loading && posts.length > 0}
            onRefresh={refresh}
            tintColor={theme.colors.brand.primary}
            colors={[theme.colors.brand.primary]}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 8,
  },
  emptyContainer: {
    flex: 1,
  },
  footer: {
    paddingVertical: 16,
  },
});
