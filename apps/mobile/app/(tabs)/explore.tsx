import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";

import { PoolRow, PoolSearchResult } from "../../components/PoolRow";
import { ProfileRow, ProfileSearchResult } from "../../components/ProfileRow";
import { SearchBar } from "../../components/SearchBar";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { PoolCardSkeleton } from "../../components/skeletons/PoolCardSkeleton";
import { ProfileCardSkeleton } from "../../components/skeletons/ProfileCardSkeleton";
import { useTheme } from "../../theme/useTheme";

const DEBOUNCE_MS = 300;

// ─── Static sample data ───────────────────────────────────────────────────────

const PROFILES: ProfileSearchResult[] = [
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
];

const POOLS: PoolSearchResult[] = [
  {
    id: "creator-fund",
    name: "Creator Fund",
    description: "Shared treasury for emerging creators",
    token: "XLM",
    balance: "18,240 XLM",
    members: 128,
  },
  {
    id: "music-drops",
    name: "Music Drops",
    description: "Funding pool for independent releases",
    token: "NOVA",
    balance: "7,900 NOVA",
    members: 64,
  },
  {
    id: "design-guild",
    name: "Design Guild",
    description: "Collective pool for visual artists",
    token: "ATLAS",
    balance: "3,450 ATLAS",
    members: 42,
  },
];

// Sample hashtag data – in production these would come from the search API
interface HashtagResult {
  tag: string;
  postCount: number;
}

const HASHTAGS: HashtagResult[] = [
  { tag: "#StellarFi", postCount: 1240 },
  { tag: "#Soroban", postCount: 892 },
  { tag: "#CreatorEconomy", postCount: 654 },
  { tag: "#DeFi", postCount: 503 },
  { tag: "#NFT", postCount: 318 },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type TabKey = "all" | "posts" | "profiles" | "hashtags";

interface TabConfig {
  key: TabKey;
  label: string;
}

const TABS: TabConfig[] = [
  { key: "all", label: "All" },
  { key: "posts", label: "Posts" },
  { key: "profiles", label: "Profiles" },
  { key: "hashtags", label: "Hashtags" },
];

interface SearchResults {
  profiles: ProfileSearchResult[];
  pools: PoolSearchResult[];
  hashtags: HashtagResult[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function matchesQuery(value: string | undefined | null, query: string): boolean {
  if (!value) return false;
  return value.toLowerCase().includes(query);
}

async function searchCatalog(query: string): Promise<SearchResults> {
  const normalized = query.trim().toLowerCase();

  if (!normalized) {
    return { profiles: [], pools: [], hashtags: [] };
  }

  return {
    profiles: PROFILES.filter((profile) =>
      [profile.username, profile.bio, profile.creatorToken, profile.address].some((value) =>
        matchesQuery(value, normalized)
      )
    ),
    pools: POOLS.filter((pool) =>
      [pool.id, pool.name, pool.description, pool.token].some((value) =>
        matchesQuery(value, normalized)
      )
    ),
    hashtags: HASHTAGS.filter((h) => matchesQuery(h.tag, normalized)),
  };
}

// ─── TabBar ───────────────────────────────────────────────────────────────────

interface TabBarProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  counts: Record<TabKey, number>;
  theme: ReturnType<typeof useTheme>["theme"];
}

function TabBar({ activeTab, onTabChange, counts, theme }: TabBarProps) {
  // Animated indicator
  const indicatorAnim = useRef(new Animated.Value(0)).current;
  const tabWidths = useRef<Record<string, number>>({}).current;
  const tabOffsets = useRef<Record<string, number>>({}).current;

  const activeIndex = TABS.findIndex((t) => t.key === activeTab);

  // Animate underline indicator when tab changes
  useEffect(() => {
    const offset = tabOffsets[activeTab] ?? 0;
    const width = tabWidths[activeTab] ?? 0;
    Animated.spring(indicatorAnim, {
      toValue: offset + width / 2,
      useNativeDriver: true,
      tension: 300,
      friction: 30,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const styles = useMemo(() => createTabBarStyles(theme), [theme]);

  return (
    <View style={styles.container} accessibilityRole="tablist">
      {TABS.map((tab, index) => {
        const isActive = tab.key === activeTab;
        const count = counts[tab.key];

        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${tab.label} tab, ${count} results`}
            onLayout={(e) => {
              tabWidths[tab.key] = e.nativeEvent.layout.width;
              tabOffsets[tab.key] = e.nativeEvent.layout.x;
              // Initialise the indicator position on the first render
              if (tab.key === activeTab) {
                indicatorAnim.setValue(
                  e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2
                );
              }
            }}
            onPress={() => onTabChange(tab.key)}
            style={[styles.tab, isActive && styles.activeTab]}
          >
            <View style={styles.tabContent}>
              <Text style={[styles.tabLabel, isActive && styles.activeTabLabel]}>
                {tab.label}
              </Text>
              {count > 0 && (
                <View
                  style={[styles.countBadge, isActive && styles.activeCountBadge]}
                >
                  <Text
                    style={[styles.countText, isActive && styles.activeCountText]}
                  >
                    {count}
                  </Text>
                </View>
              )}
            </View>
          </Pressable>
        );
      })}

      {/* Animated underline indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            transform: [
              {
                translateX: Animated.subtract(
                  indicatorAnim,
                  new Animated.Value(20) // half the indicator width
                ),
              },
            ],
          },
        ]}
      />
    </View>
  );
}

function createTabBarStyles(theme: ReturnType<typeof useTheme>["theme"]) {
  return StyleSheet.create({
    container: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.surface.border,
      backgroundColor: theme.colors.surface.background,
      position: "relative",
    },
    tab: {
      flex: 1,
      paddingVertical: 12,
      alignItems: "center",
    },
    activeTab: {},
    tabContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    tabLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: theme.colors.text.secondary,
    },
    activeTabLabel: {
      color: theme.colors.brand.primary,
      fontWeight: "700",
    },
    countBadge: {
      minWidth: 18,
      height: 18,
      paddingHorizontal: 5,
      borderRadius: 9,
      backgroundColor: theme.colors.surface.surface2,
      alignItems: "center",
      justifyContent: "center",
    },
    activeCountBadge: {
      backgroundColor: theme.colors.brand.primaryLight ?? theme.colors.brand.primary + "22",
    },
    countText: {
      fontSize: 10,
      fontWeight: "700",
      color: theme.colors.text.secondary,
    },
    activeCountText: {
      color: theme.colors.brand.primary,
    },
    indicator: {
      position: "absolute",
      bottom: 0,
      width: 40,
      height: 2,
      borderRadius: 1,
      backgroundColor: theme.colors.brand.primary,
    },
  });
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const { theme } = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({
    profiles: [],
    pools: [],
    hashtags: [],
  });
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs for section scroll
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Record<string, number>>({}).current;

  // Debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Run search
  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      setLoading(true);
      setError(null);

      try {
        const nextResults = await searchCatalog(debouncedQuery);
        if (!cancelled) {
          setResults(nextResults);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Search failed");
          setResults({ profiles: [], pools: [], hashtags: [] });
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setSearchNonce((n) => n + 1);
    setRefreshing(false);
  }, []);

  // Tab counts
  const tabCounts = useMemo<Record<TabKey, number>>(
    () => ({
      all: results.profiles.length + results.pools.length + results.hashtags.length,
      posts: results.pools.length, // pools map to "posts" type in this context
      profiles: results.profiles.length,
      hashtags: results.hashtags.length,
    }),
    [results]
  );

  // Scroll to section when tab changes
  const handleTabChange = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab);
      if (tab === "all") {
        scrollViewRef.current?.scrollTo({ y: 0, animated: true });
        return;
      }
      const sectionKey =
        tab === "posts" ? "pools" : tab === "profiles" ? "profiles" : "hashtags";
      const offset = sectionOffsets[sectionKey];
      if (offset !== undefined) {
        scrollViewRef.current?.scrollTo({ y: offset, animated: true });
      }
    },
    [sectionOffsets]
  );

  const hasQuery = debouncedQuery.trim().length > 0;
  const hasResults =
    results.profiles.length > 0 ||
    results.pools.length > 0 ||
    results.hashtags.length > 0;

  // Determine which sections to show based on active tab
  const showProfiles = activeTab === "all" || activeTab === "profiles";
  const showPosts = activeTab === "all" || activeTab === "posts";
  const showHashtags = activeTab === "all" || activeTab === "hashtags";

  const filteredProfiles = showProfiles ? results.profiles : [];
  const filteredPools = showPosts ? results.pools : [];
  const filteredHashtags = showHashtags ? results.hashtags : [];

  const filteredHasResults =
    filteredProfiles.length > 0 ||
    filteredPools.length > 0 ||
    filteredHashtags.length > 0;

  return (
    <View style={styles.container}>
      <SearchBar value={query} onChangeText={setQuery} />

      {/* Tab bar — only visible while searching */}
      {hasQuery && !loading && !error && (
        <TabBar
          activeTab={activeTab}
          onTabChange={handleTabChange}
          counts={tabCounts}
          theme={theme}
        />
      )}

      <ScrollView
        ref={scrollViewRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[
          styles.content,
          !filteredHasResults && styles.centerContent,
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brand.primary}
            colors={[theme.colors.brand.primary]}
          />
        }
      >
        {loading ? (
          <View style={styles.loadingStack}>
            <ProfileCardSkeleton />
            <PoolCardSkeleton />
            <View style={styles.center}>
              <ActivityIndicator color={theme.colors.brand.primary} />
              <Text style={styles.muted}>Searching…</Text>
            </View>
          </View>
        ) : error ? (
          <ErrorState
            message={error}
            onRetry={() => setSearchNonce((n) => n + 1)}
          />
        ) : !hasQuery ? (
          <EmptyState
            icon="🔎"
            title="Search Linkora"
            subtitle="Find creators and community pools."
          />
        ) : !filteredHasResults ? (
          <EmptyState
            icon="🧭"
            title="No matches"
            subtitle="Try another username, token, or pool name."
            actionLabel="Clear search"
            onAction={() => {
              setQuery("");
              setSearchNonce((n) => n + 1);
            }}
          />
        ) : (
          <>
            {/* Profiles section */}
            {filteredProfiles.length > 0 ? (
              <View
                style={styles.section}
                onLayout={(e) => {
                  sectionOffsets["profiles"] = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionTitle}>
                  Profiles{" "}
                  <Text style={styles.sectionCount}>
                    ({filteredProfiles.length})
                  </Text>
                </Text>
                {filteredProfiles.map((profile) => (
                  <ProfileRow
                    key={profile.address}
                    profile={profile}
                    onPress={(item) =>
                      router.push(
                        `/profile/${encodeURIComponent(
                          item.address
                        )}` as Parameters<typeof router.push>[0]
                      )
                    }
                  />
                ))}
              </View>
            ) : null}

            {/* Pools / Posts section */}
            {filteredPools.length > 0 ? (
              <View
                style={styles.section}
                onLayout={(e) => {
                  sectionOffsets["pools"] = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionTitle}>
                  Pools{" "}
                  <Text style={styles.sectionCount}>
                    ({filteredPools.length})
                  </Text>
                </Text>
                {filteredPools.map((pool) => (
                  <PoolRow
                    key={pool.id}
                    pool={pool}
                    onPress={(item) =>
                      router.push(
                        `/pool/${encodeURIComponent(item.id)}` as Parameters<
                          typeof router.push
                        >[0]
                      )
                    }
                  />
                ))}
              </View>
            ) : null}

            {/* Hashtags section */}
            {filteredHashtags.length > 0 ? (
              <View
                style={styles.section}
                onLayout={(e) => {
                  sectionOffsets["hashtags"] = e.nativeEvent.layout.y;
                }}
              >
                <Text style={styles.sectionTitle}>
                  Hashtags{" "}
                  <Text style={styles.sectionCount}>
                    ({filteredHashtags.length})
                  </Text>
                </Text>
                {filteredHashtags.map((item) => (
                  <Pressable
                    key={item.tag}
                    style={styles.hashtagRow}
                    accessibilityRole="button"
                    accessibilityLabel={`Hashtag ${item.tag}, ${item.postCount} posts`}
                    onPress={() => setQuery(item.tag.replace("#", ""))}
                  >
                    <Text style={styles.hashtagText}>{item.tag}</Text>
                    <Text style={styles.hashtagCount}>
                      {item.postCount} posts
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

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
    center: {
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
    },
    loadingStack: {
      gap: 16,
      padding: 16,
    },
    muted: {
      color: theme.colors.text.secondary,
      fontSize: 13,
      marginTop: 10,
    },
    section: {
      marginTop: 12,
    },
    sectionTitle: {
      color: theme.colors.text.primary,
      fontSize: 13,
      fontWeight: "800",
      marginHorizontal: 16,
      marginBottom: 4,
      textTransform: "uppercase",
    },
    sectionCount: {
      color: theme.colors.text.secondary,
      fontWeight: "600",
      textTransform: "none",
    },
    hashtagRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.surface.border,
    },
    hashtagText: {
      fontSize: 15,
      fontWeight: "700",
      color: theme.colors.brand.primary,
    },
    hashtagCount: {
      fontSize: 12,
      color: theme.colors.text.secondary,
    },
  });
}
