"use client";

import { useEffect } from "react";
import type { SearchSuggestion } from "@/hooks/useSearchSuggestions";
import { highlightSearchMatch } from "@/lib/highlightSearchMatch";
import Link from "next/link";
import { Post, PostCard, PostCardSkeleton } from "./PostCard";
import { Profile, ProfileCard } from "./ProfileCard";

type ResultTab = "posts" | "profiles";

interface SearchResultsProps {
  tab: ResultTab;
  query: string;
  posts?: Post[];
  profiles?: Profile[];
  loading?: boolean;
  error?: string | null;
}

/**
 * SearchResults — renders search hits for posts or profiles.
 *
 * All colours use CSS custom property tokens (var(--foreground), etc.) so the
 * component responds correctly to both light and dark themes without any
 * hardcoded colour values.
 */
export function SearchResults({
  tab,
  query,
  posts = [],
  profiles = [],
  loading = false,
  error = null,
}: SearchResultsProps) {
  const hasQuery = query.trim().length > 0;
  const hasPostResults = posts.length > 0;
  const hasProfileResults = profiles.length > 0;

  if (!hasQuery) {
    return null;
  }

  if (error) {
    return (
      <div
        className="rounded-xl border border-[var(--color-error)]/50 bg-[var(--color-error-light)]/20 px-5 py-4 text-sm text-[var(--color-error)]"
        role="alert"
      >
        {error}
      </div>
    );
  }

  if (tab === "posts") {
    return (
      <div className="space-y-4" aria-live="polite" aria-label="Post search results">
        {loading && Array.from({ length: 5 }, (_, i) => <PostCardSkeleton key={i} />)}

        {!loading &&
          hasPostResults &&
          posts.map((post) => (
            <div key={post.id}>
              <PostCard post={post} query={query} />
              <Link href={`/posts/${post.id}`} className="sr-only">
                View post by {post.username ?? post.author}
              </Link>
            </div>
          ))}

        {!loading && !hasPostResults && <EmptyState query={query} kind="posts" />}
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-live="polite" aria-label="Profile search results">
      {loading && <ProfileListSkeleton />}

      {!loading &&
        hasProfileResults &&
        profiles.map((profile) => (
          <div key={profile.address}>
            <ProfileCard profile={profile} query={query} />
            <Link href={`/profile/${profile.address}`} className="sr-only">
              View profile {profile.username ?? profile.address}
            </Link>
          </div>
        ))}

      {!loading && !hasProfileResults && <EmptyState query={query} kind="profiles" />}
    </div>
  );
}

function EmptyState({ query, kind }: { query: string; kind: "posts" | "profiles" }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] px-6 py-12 text-center">
      <p className="text-sm text-[var(--text-muted)]">
        No {kind} found for &ldquo;{query}&rdquo;.
      </p>
    </div>
  );
}

/** Profile list skeleton — matches approximate ProfileCard dimensions to avoid CLS. */
function ProfileListSkeleton() {
  return (
    <div className="space-y-3 animate-pulse" aria-busy="true" aria-label="Loading profiles">
      {Array.from({ length: 4 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4"
        >
          {/* Avatar */}
          <div className="h-12 w-12 shrink-0 rounded-full bg-[var(--bg-tertiary)]" />
          {/* Text lines */}
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-3 w-1/2 rounded bg-[var(--bg-tertiary)]" />
            <div className="h-3 w-1/4 rounded bg-[var(--bg-tertiary)]" />
          </div>
          {/* Follow button placeholder */}
          <div className="h-9 w-24 shrink-0 rounded-lg bg-[var(--bg-tertiary)]" />
        </div>
      ))}
    </div>
  );
}

const groupLabels = {
  profile: "Profiles",
  post: "Posts",
  hashtag: "Hashtags",
  recent: "Recent searches",
} as const;

export function SearchResultOptions({
  id,
  query,
  results,
  selectedIndex,
  onSelect,
}: {
  id: string;
  query: string;
  results: SearchSuggestion[];
  selectedIndex: number;
  onSelect: (result: SearchSuggestion) => void;
}) {
  useEffect(() => {
    if (selectedIndex >= 0) {
      document.getElementById(`${id}-${selectedIndex}`)?.scrollIntoView?.({ block: "nearest" });
    }
  }, [id, selectedIndex]);

  return Object.entries(groupLabels).map(([type, label]) => {
    const entries = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.type === type);
    if (!entries.length) return null;
    return (
      <div key={type} role="group" aria-label={label}>
        <div
          aria-hidden="true"
          className="px-4 pt-2 text-xs font-semibold text-[var(--text-muted)]"
        >
          {label}
        </div>
        {entries.map(({ result, index }) => (
          <div
            key={result.value}
            id={`${id}-${index}`}
            role="option"
            aria-selected={selectedIndex === index}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(result)}
            className="cursor-pointer px-4 py-2 hover:bg-[var(--muted)] aria-selected:bg-[var(--muted)]"
          >
            <div className="truncate">
              {highlightSearchMatch(result.displayName || result.value, query)}
            </div>
            {result.subtitle && result.subtitle !== result.displayName && (
              <div className="truncate text-xs text-[var(--text-muted)]">
                {highlightSearchMatch(result.subtitle, query)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  });
}
