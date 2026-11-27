"use client";

import { useEffect, useRef, useState } from "react";
import { BlurhashImage } from "@/components/BlurhashImage";
import { MediaGallery } from "@/components/media/MediaGallery";

export interface Post {
  id: string | number;
  author: string;
  username?: string;
  content: string;
  tip_total?: string | number;
  like_count?: string | number;
  timestamp?: string | number;
  created_at?: string;
  /** URL of an attached image (single-image legacy field). */
  imageUrl?: string;
  /**
   * Blurhash string for the attached image.
   * Shown as a canvas placeholder while the image loads (no CLS).
   */
  blurhash?: string;
  /**
   * Multiple media attachments. When present, rendered via MediaGallery
   * instead of the single imageUrl field.
   */
  mediaUrls?: Array<{ url: string; blurhash?: string }>;
}

interface PostCardProps {
  post: Post;
  query?: string;
  onLike?: () => void;
  onTip?: () => void;
  isLiked?: boolean;
  isTipping?: boolean;
  tourAnchor?: boolean;
  disabled?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlightText(text: string, query = "") {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const parts = text.split(new RegExp(`(${escapeRegExp(trimmed)})`, "gi"));
  return parts.map((part, index) =>
    part.toLowerCase() === trimmed.toLowerCase() ? (
      <mark
        key={`${part}-${index}`}
        className="rounded bg-[color-mix(in_srgb,var(--color-warning)_35%,var(--background))] px-1 font-semibold text-foreground"
      >
        {part}
      </mark>
    ) : (
      part
    )
  );
}

export function getPostDate(post: Post): Date | null {
  const raw = post.created_at ?? post.timestamp;
  if (raw === undefined || raw === null || raw === "") return null;

  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
  }

  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getPostTipTotal(post: Post): number {
  const value = Number(post.tip_total ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function getPostLikeCount(post: Post): number {
  const value = Number(post.like_count ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatDate(post: Post): string {
  const date = getPostDate(post);
  return date ? date.toLocaleDateString() : "Unknown date";
}

export function formatAuthor(author: string): string {
  return author.length > 16 ? `${author.slice(0, 6)}...${author.slice(-4)}` : author;
}

/**
 * Keyboard-accessible action menu attached to a single post.
 *
 * Focus management:
 * - Opens on Enter / Space / ArrowDown on the trigger button.
 * - Arrow keys move between menu items (wrapping).
 * - Escape closes and returns focus to the trigger.
 * - Tab closes and lets focus continue naturally.
 * - Click outside closes the menu.
 */
function PostActionMenu({
  postId,
  onLike,
  onTip,
  isLiked,
  isTipping,
  disabled,
}: {
  postId: string | number;
  onLike?: () => void;
  onTip?: () => void;
  isLiked?: boolean;
  isTipping?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = `post-action-menu-${postId}`;

  // Focus the first menu item when the menu opens.
  useEffect(() => {
    if (open) {
      const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
      first?.focus();
    }
  }, [open]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        !triggerRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const handleMenuKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []
    );
    const focused = document.activeElement as HTMLElement;
    const index = items.indexOf(focused);

    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      // Let Tab move focus out naturally; close the menu first.
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(index + 1) % items.length]?.focus();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(index - 1 + items.length) % items.length]?.focus();
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label="Post actions"
        disabled={disabled}
        onKeyDown={handleTriggerKeyDown}
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-center rounded-md p-1.5 text-[var(--text-muted)] transition-colors hover:bg-gray-100 hover:text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800"
      >
        {/* Ellipsis icon */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path d="M6 10a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm4 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm4 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
        </svg>
      </button>

      {open && (
        <ul
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label="Post actions"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-lg border border-[var(--border)] bg-white py-1 shadow-lg dark:bg-gray-900"
        >
          {onLike && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                onClick={() => {
                  onLike();
                  close();
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--foreground)] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none dark:hover:bg-gray-800 dark:focus:bg-gray-800"
              >
                <span aria-hidden="true">{isLiked ? "❤️" : "🤍"}</span>
                {isLiked ? "Unlike" : "Like"}
              </button>
            </li>
          )}
          {onTip && (
            <li role="none">
              <button
                role="menuitem"
                type="button"
                disabled={isTipping}
                onClick={() => {
                  onTip();
                  close();
                }}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm text-[var(--foreground)] hover:bg-gray-100 focus:bg-gray-100 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-gray-800 dark:focus:bg-gray-800"
              >
                <span aria-hidden="true">💰</span>
                {isTipping ? "Sending tip…" : "Tip creator"}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function PostCard({
  post,
  query,
  onLike,
  onTip,
  isLiked,
  isTipping,
  tourAnchor,
  disabled = false,
}: PostCardProps) {
  const likeCount = getPostLikeCount(post);
  const [animateLikeCount, setAnimateLikeCount] = useState(false);
  const [previousLikeCount, setPreviousLikeCount] = useState(likeCount);

  useEffect(() => {
    if (likeCount === previousLikeCount) {
      return;
    }

    setAnimateLikeCount(true);
    setPreviousLikeCount(likeCount);

    const timeout = window.setTimeout(() => {
      setAnimateLikeCount(false);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [likeCount, previousLikeCount]);

  return (
    <article className="rounded-xl border border-border bg-background p-3 text-foreground shadow-lg transition-all duration-300 hover:border-[var(--color-primary)] md:p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-[var(--text-muted)]">
        <span
          className="font-medium hover:text-[var(--foreground)] transition-colors"
          title={post.author}
        >
          By {formatAuthor(post.author)}
        </span>
        <div className="flex items-center gap-2">
          <time className="text-xs text-[var(--text-muted)]">{formatDate(post)}</time>
          {/* Three-dot action menu — keyboard and pointer accessible */}
          <PostActionMenu
            postId={post.id}
            onLike={onLike}
            onTip={onTip}
            isLiked={isLiked}
            isTipping={isTipping}
            disabled={disabled}
          />
        </div>
      </div>

      <p className="whitespace-pre-wrap break-words leading-relaxed text-[var(--foreground)] mb-4 text-base">
        {highlightText(post.content, query)}
      </p>

      {/* Media attachments: gallery for multiple, single image for legacy field */}
      {post.mediaUrls && post.mediaUrls.length > 0 ? (
        <div className="mb-4">
          <MediaGallery items={post.mediaUrls} />
        </div>
      ) : post.imageUrl ? (
        <BlurhashImage
          src={post.imageUrl}
          alt="Post image"
          blurhash={post.blurhash}
          width={800}
          height={450}
          wrapperClassName="mb-4 rounded-lg overflow-hidden"
          className="rounded-lg"
        />
      ) : null}

      {/* Inline action bar — kept for quick pointer access; duplicates menu items */}
      <div
        className="flex items-center gap-6 border-t border-[var(--border)]/40 pt-3"
        data-tour={tourAnchor ? "post-actions" : undefined}
      >
        {/* Like Button */}
        <button
          onClick={onLike}
          disabled={disabled}
          className={`flex items-center gap-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            isLiked
              ? "text-[var(--accent-coral)]"
              : "text-[var(--text-muted)] hover:text-[var(--accent-coral)]"
          }`}
          aria-label={isLiked ? "Unlike post" : "Like post"}
          aria-pressed={isLiked}
        >
          <span
            className={`text-lg transition-transform duration-200 ${animateLikeCount ? "scale-110" : "scale-100"}`}
          >
            {isLiked ? "❤️" : "🤍"}
          </span>
          <span className={animateLikeCount ? "like-count-animate" : ""}>{likeCount}</span>
        </button>

        {/* Tip Button */}
        <button
          onClick={onTip}
          disabled={disabled || isTipping}
          className="flex items-center gap-2 text-sm font-medium text-[var(--text-muted)] hover:text-[var(--accent-teal)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          aria-label="Tip creator"
        >
          <span className="text-lg">💰</span>
          <span>Tips: {getPostTipTotal(post)}</span>
        </button>
      </div>
    </article>
  );
}

export function PostCardSkeleton() {
  return (
    <div className="animate-pulse space-y-4 rounded-xl border border-border bg-background p-3 text-foreground md:p-4 lg:p-5">
      <div className="flex justify-between">
        <div className="h-4 w-28 rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-20 rounded bg-[var(--color-surface-2)]" />
      </div>
      <div className="space-y-3">
        <div className="h-4 w-full rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-4/5 rounded bg-[var(--color-surface-2)]" />
        <div className="h-4 w-2/3 rounded bg-[var(--color-surface-2)]" />
      </div>
      <div className="border-t border-[var(--border)]/40 pt-3 flex gap-6">
        <div className="h-5 w-12 rounded bg-[var(--color-surface-2)]" />
        <div className="h-5 w-20 rounded bg-[var(--color-surface-2)]" />
      </div>
    </div>
  );
}
