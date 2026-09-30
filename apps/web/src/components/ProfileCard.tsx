"use client";

import { useState } from "react";

export interface Profile {
  address: string;
  username?: string;
  followerCount?: number;
  follower_count?: number;
  isFollowing?: boolean;
}

interface ProfileCardProps {
  profile: Profile;
  /** When provided, matching terms in the display name are highlighted. */
  query?: string;
}

function formatAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query = ""): React.ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-yellow-300 px-0.5 text-black font-semibold"
        // Keep highlight semantically neutral for screen readers — the
        // surrounding accessible name already conveys the full text.
        aria-hidden={undefined}
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function ProfileCard({ profile, query }: ProfileCardProps) {
  const [following, setFollowing] = useState(!!profile.isFollowing);
  const followers = profile.followerCount ?? profile.follower_count ?? 0;
  const displayName = profile.username || formatAddress(profile.address);

  return (
    <article className="flex flex-col sm:flex-row items-start sm:items-center gap-3 md:gap-4 rounded-lg border border-[var(--border)] bg-[var(--muted)] p-3 md:p-5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-900/50 text-lg font-bold text-violet-200">
        {displayName.slice(0, 1).toUpperCase()}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate font-semibold text-[var(--foreground)]">
          {highlightText(displayName, query)}
        </h2>
        <p className="truncate text-sm text-[var(--text-muted)]" title={profile.address}>
          {formatAddress(profile.address)}
        </p>
        <p className="text-sm text-[var(--text-muted)]">{followers} followers</p>
      </div>

      <button
        type="button"
        onClick={() => setFollowing((value) => !value)}
        className={`w-full sm:w-auto shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
          following
            ? "border border-[var(--border)] text-[var(--foreground)] hover:border-red-500/60 hover:text-red-300"
            : "bg-violet-600 text-white hover:bg-violet-500"
        }`}
        aria-label={following ? `Unfollow ${displayName}` : `Follow ${displayName}`}
      >
        {following ? "Following" : "Follow"}
      </button>
    </article>
  );
}
