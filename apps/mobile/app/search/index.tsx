/**
 * apps/mobile/app/search/index.tsx
 *
 * Full search experience for Linkora mobile.
 *
 * Features:
 *  • Recent searches for the active search session, shown when input is empty
 *  • 300ms debounced search results while typing
 *  • Results grouped: Profiles, Posts, Hashtags
 *  • Tapping a result navigates to the correct screen
 *  • Clear button removes all recent searches
 */

import React, { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { SearchBar } from "../../components/SearchBar";
import { ProfileRow } from "../../components/ProfileRow";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { SearchResultSkeletonList } from "../../components/skeletons/SearchResultSkeleton";
import { useSearch } from "../../hooks/useSearch";
import { useNetworkContext } from "../../context/NetworkContext";
import { useWallet } from "../../hooks/useWallet";
import type { ProfileSearchResult } from "../../components/ProfileRow";
import { useTheme } from "../../theme/useTheme";

// ---------------------------------------------------------------------------
// Recent search item
// ---------------------------------------------------------------------------

function RecentSearchItem({
  term,
  onTap,
  onRemove,
}: {
  term: string;
  onTap: () => void;
  onRemove: () => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createRecentStyles(theme), [theme]);

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={styles.rowContent}
        onPress={onTap}
        accessibilityRole="button"
        accessibilityLabel={`Search for ${term}`}
      >
        <Text style={styles.clock}>🕐</Text>
        <Text style={styles.term} numberOfLines={1}>
          {term}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.removeBtn}
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${term} from recent searches`}
      >
        <Text style={styles.removeIcon}>✕</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hashtag row
// ---------------------------------------------------------------------------

function HashtagRow({
  hashtag,
  onPress,
}: {
  hashtag: { tag: string; postCount: number };
  onPress: (tag: string) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createHashtagStyles(theme), [theme]);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(hashtag.tag)}
      accessibilityRole="button"
      accessibilityLabel={`Search hashtag ${hashtag.tag}`}
      testID={`hashtag-result-${hashtag.tag}`}
    >
      <View style={styles.icon}>
        <Text style={styles.iconText}>#</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.title}>#{hashtag.tag}</Text>
        <Text style={styles.meta}>{hashtag.postCount} posts</Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Post search result row
// ---------------------------------------------------------------------------

function PostResultRow({
  post,
  onPress,
}: {
  post: { id: string; author: string; content: string };
  onPress: (id: number | string) => void;
}) {
  const { theme } = useTheme();
  const styles = useMemo(() => createPostRowStyles(theme), [theme]);

  return (
    <TouchableOpacity
      style={styles.row}
      onPress={() => onPress(post.id)}
      accessibilityRole="button"
      accessibilityLabel={`Post by ${post.author}`}
      testID={`post-result-${post.id}`}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{post.author.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.content}>
        <Text style={styles.username} numberOfLines={1}>
          {post.author}
        </Text>
        <Text style={styles.snippet} numberOfLines={2}>
          {post.content}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

function SectionHeader({ title, count }: { title: string; count: number }) {
  const { theme } = useTheme();
  const styles = useMemo(() => createSectionStyles(theme), [theme]);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function SearchScreen() {
  const { theme } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(theme), [theme]);

  const { network, rpcUrl } = useNetworkContext();
  const { address } = useWallet();
  const endpoint =
    network.id === "MAINNET"
      ? process.env.EXPO_PUBLIC_MAINNET_SEARCH_URL ?? ""
      : process.env.EXPO_PUBLIC_TESTNET_SEARCH_URL ?? "http://localhost:3002";
  const { query, setQuery, results, loading, error, refresh } = useSearch(
    endpoint,
    JSON.stringify([network.id, rpcUrl, address])
  );
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const addRecentSearch = (term: string) => {
    if (term) setRecentSearches((recent) => [term, ...recent.filter((item) => item !== term)].slice(0, 10));
  };
  const removeRecentSearch = (term: string) => {
    setRecentSearches((recent) => recent.filter((item) => item !== term));
  };

  const profiles = results.flatMap((result) =>
    result.kind === "profile"
      ? [{
          address: result.address,
          username: result.display_name || result.address,
          bio: result.bio ?? "",
          creatorToken: "",
        }]
      : []
  );
  const posts = results.filter((result) => result.kind === "post");
  const tagCounts = new Map<string, number>();
  for (const post of posts) {
    const tags = new Set(post.content.toLowerCase().match(/#[a-z0-9_]+/g));
    for (const tag of tags) tagCounts.set(tag.slice(1), (tagCounts.get(tag.slice(1)) ?? 0) + 1);
  }
  const hashtags = Array.from(tagCounts, ([tag, postCount]) => ({ tag, postCount }));
  const hasQuery = query.trim().length > 0;
  const hasResults = results.length > 0;

  // ── Navigation handlers ───────────────────────────────────────────────────

  const handleProfilePress = (profile: ProfileSearchResult) => {
    addRecentSearch(query.trim() || profile.username);
    router.push(
      `/profile/${encodeURIComponent(profile.address)}` as Parameters<typeof router.push>[0]
    );
  };

  const handlePostPress = (id: number | string) => {
    addRecentSearch(query.trim());
    router.push(`/post/${id}` as Parameters<typeof router.push>[0]);
  };

  const handleHashtagPress = (tag: string) => {
    addRecentSearch(`#${tag}`);
    setQuery(`#${tag}`);
  };

  const handleRecentTap = (term: string) => {
    setQuery(term);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search profiles, posts, hashtags"
      />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          !hasQuery && !hasResults && recentSearches.length === 0 && styles.centerContent,
        ]}
      >
        {loading ? (
          <SearchResultSkeletonList />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !hasQuery ? (
          // ── Empty query: show recent searches ───────────────────────────
          recentSearches.length > 0 ? (
            <View style={styles.recentSection}>
              <View style={styles.recentHeader}>
                <Text style={styles.recentTitle}>Recent Searches</Text>
                <TouchableOpacity
                  onPress={() => setRecentSearches([])}
                  accessibilityRole="button"
                  accessibilityLabel="Clear all recent searches"
                >
                  <Text style={styles.clearAllBtn}>Clear</Text>
                </TouchableOpacity>
              </View>
              {recentSearches.map((term) => (
                <RecentSearchItem
                  key={term}
                  term={term}
                  onTap={() => handleRecentTap(term)}
                  onRemove={() => removeRecentSearch(term)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="🔎"
              title="Search Linkora"
              subtitle="Find creators, posts, and hashtags."
            />
          )
        ) : !hasResults ? (
          <EmptyState
            icon="🧭"
            title="No matches"
            subtitle="Try another username, hashtag, or keyword."
            actionLabel="Clear search"
            onAction={() => setQuery("")}
          />
        ) : (
          // ── Results: grouped sections ────────────────────────────────────
          <>
            {profiles.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Profiles" count={profiles.length} />
                {profiles.map((profile) => (
                  <ProfileRow
                    key={profile.address}
                    profile={profile}
                    onPress={handleProfilePress}
                  />
                ))}
              </View>
            )}

            {posts.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Posts" count={posts.length} />
                {posts.map((post) => (
                  <PostResultRow key={post.id} post={post} onPress={handlePostPress} />
                ))}
              </View>
            )}

            {hashtags.length > 0 && (
              <View style={styles.section}>
                <SectionHeader title="Hashtags" count={hashtags.length} />
                {hashtags.map((ht) => (
                  <HashtagRow key={ht.tag} hashtag={ht} onPress={handleHashtagPress} />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function createStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.colors.surface.background,
    },
    content: {
      paddingBottom: 24,
    },
    centerContent: {
      flexGrow: 1,
      justifyContent: "center",
    },
    section: {
      marginTop: 8,
    },
    recentSection: {
      paddingHorizontal: 16,
      paddingTop: 8,
    },
    recentHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    recentTitle: {
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: "800",
    },
    clearAllBtn: {
      color: theme.colors.brand.primary,
      fontSize: 13,
      fontWeight: "700",
    },
  });
}

function createRecentStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.surface.border,
    },
    rowContent: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
    },
    clock: {
      fontSize: 14,
      marginRight: 12,
    },
    term: {
      flex: 1,
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: "500",
    },
    removeBtn: {
      padding: 8,
    },
    removeIcon: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      fontWeight: "600",
    },
  });
}

function createHashtagStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.surface.border,
    },
    icon: {
      width: 40,
      height: 40,
      borderRadius: 10,
      backgroundColor: theme.colors.brand.secondary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    iconText: {
      color: theme.colors.text.onBrand,
      fontSize: 20,
      fontWeight: "800",
    },
    content: {
      flex: 1,
    },
    title: {
      color: theme.colors.text.primary,
      fontSize: 15,
      fontWeight: "700",
    },
    meta: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      marginTop: 2,
    },
  });
}

function createPostRowStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.surface.border,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.colors.brand.primary,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 12,
    },
    avatarText: {
      color: theme.colors.text.onBrand,
      fontSize: 15,
      fontWeight: "800",
    },
    content: {
      flex: 1,
    },
    username: {
      color: theme.colors.text.primary,
      fontSize: 14,
      fontWeight: "700",
      marginBottom: 4,
    },
    snippet: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 6,
    },
    meta: {
      color: theme.colors.text.secondary,
      fontSize: 11,
    },
  });
}

function createSectionStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 4,
    },
    sectionTitle: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: "800",
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    sectionCount: {
      color: theme.colors.text.secondary,
      fontSize: 12,
      fontWeight: "600",
    },
  });
}
