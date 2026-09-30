"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useNotifications, Notification } from "@/hooks/useNotifications";
import { useWalletContext } from "@/components/WalletProvider";

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function buildMessage(notification: Notification): React.ReactNode {
  const actor = truncateAddress(notification.actor);
  const { type, postId, proposalId, parameter, amountXlm, excerpt } = notification;

  const actorLink = (
    <Link
      href={`/profile/${notification.actor}`}
      className="font-medium text-violet-400 hover:underline"
    >
      @{actor}
    </Link>
  );

  const postRef = (
    <Link
      href={postId !== undefined ? `/posts/${postId}` : "#"}
      className="font-medium text-violet-400 hover:underline"
    >
      {excerpt ? `"${excerpt}"` : postId !== undefined ? `post #${postId}` : "a post"}
    </Link>
  );

  switch (type) {
    case "follow":
      return <>{actorLink} started following you</>;
    case "mention":
      return <>{actorLink} mentioned you</>;
    case "like":
      return (
        <>
          {actorLink} liked your post — {postRef}
        </>
      );
    case "tip":
      return (
        <>
          {actorLink} tipped {amountXlm ?? "?"} XLM on {postRef}
        </>
      );
    case "governance":
      return (
        <>
          {actorLink}{" "}
          {parameter ? `executed proposal for ${parameter}` : "created a new governance proposal"} —{" "}
          <Link href="/governance" className="font-medium text-violet-400 hover:underline">
            view proposal #{proposalId}
          </Link>
        </>
      );
    default:
      return "Unknown notification";
  }
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: Notification;
  onOpen: () => void;
}) {
  const ts = new Date(notification.timestamp).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <li
      data-testid="notification-item"
      data-type={notification.type}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      className={`flex cursor-pointer items-start gap-4 rounded-xl border px-5 py-4 transition-colors ${
        notification.read
          ? "border-[var(--border)] bg-[var(--muted)]/40"
          : "border-violet-700/50 bg-violet-900/20"
      }`}
    >
      <span
        className={`mt-1 flex h-2.5 w-2.5 flex-shrink-0 rounded-full ${
          notification.read ? "bg-transparent" : "bg-violet-500"
        }`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[var(--foreground)]">{buildMessage(notification)}</p>
        <time className="text-xs text-[var(--text-muted)]" dateTime={notification.timestamp}>
          {ts}
        </time>
      </div>
    </li>
  );
}

interface DateGroup {
  label: string;
  items: Notification[];
}

function groupByDate(notifications: Notification[]): DateGroup[] {
  const groups = new Map<string, Notification[]>();
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;

  for (const n of notifications) {
    const t = new Date(n.timestamp).getTime();
    let label: string;
    if (t >= todayStart) {
      label = "Today";
    } else if (t >= yesterdayStart) {
      label = "Yesterday";
    } else {
      label = new Date(n.timestamp).toLocaleDateString(undefined, {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
    }
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(n);
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

const FILTERS = [
  { value: "all", label: "All" },
  { value: "follows", label: "Follows" },
  { value: "tips", label: "Tips" },
  { value: "mentions", label: "Mentions" },
  { value: "governance", label: "Governance" },
] as const;

type NotificationFilter = (typeof FILTERS)[number]["value"];

function matchesFilter(notification: Notification, filter: NotificationFilter): boolean {
  switch (filter) {
    case "follows":
      return notification.type === "follow";
    case "tips":
      return notification.type === "tip";
    case "mentions":
      return notification.type === "mention";
    case "governance":
      return notification.type === "governance";
    default:
      return true;
  }
}

export default function NotificationsPage() {
  const { address, connected } = useWalletContext();
  const { notifications, hasMore, markAllRead, markRead, loadMore } = useNotifications();
  const [markAllReadClicked, setMarkAllReadClicked] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");

  useEffect(() => {
    const syncFilterFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get("type");
      setFilter(FILTERS.some(({ value }) => value === requested) ? requested as NotificationFilter : "all");
    };
    syncFilterFromUrl();
    window.addEventListener("popstate", syncFilterFromUrl);
    return () => window.removeEventListener("popstate", syncFilterFromUrl);
  }, []);

  if (!connected || !address) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-[var(--text-muted)]">Connect your wallet to see notifications.</p>
      </div>
    );
  }

  const filteredNotifications = notifications.filter((notification) => matchesFilter(notification, filter));
  const groups = groupByDate(filteredNotifications);

  const selectFilter = (nextFilter: NotificationFilter) => {
    const url = new URL(window.location.href);
    url.searchParams.set("type", nextFilter);
    window.history.replaceState(window.history.state, "", url.toString());
    setFilter(nextFilter);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">Notifications</h1>
        {notifications.length > 0 && !markAllReadClicked && (
          <button
            onClick={() => {
              markAllRead();
              setMarkAllReadClicked(true);
            }}
            className="text-sm font-medium text-violet-400 hover:text-violet-300 transition-colors"
            data-testid="mark-all-read"
          >
            Mark all read
          </button>
        )}
      </div>

      <div className="mb-5 flex gap-2 overflow-x-auto" role="group" aria-label="Filter notifications">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => selectFilter(value)}
            className={`shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
              filter === value
                ? "border-violet-500 bg-violet-600 text-white"
                : "border-[var(--border)] text-[var(--text-muted)] hover:border-violet-500/60 hover:text-violet-400"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {filteredNotifications.length === 0 ? (
        <div
          className="rounded-xl border border-[var(--border)] bg-[var(--muted)]/40 px-6 py-12 text-center"
          data-testid="empty-state"
        >
          <p className="text-[var(--text-muted)]">
            {notifications.length === 0
              ? "No activity yet. Share your profile to get followers."
              : `No ${FILTERS.find(({ value }) => value === filter)?.label.toLowerCase()} notifications.`}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-6" data-testid="notifications-list">
            {groups.map(({ label, items }) => (
              <section key={label}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  {label}
                </h2>
                <ul className="flex flex-col gap-3">
                  {items.map((n) => (
                    <NotificationRow key={n.id} notification={n} onOpen={() => markRead(n.id)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {hasMore && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={loadMore}
                className="rounded-lg border border-[var(--border)] px-5 py-2 text-sm font-medium text-[var(--text-muted)] hover:border-violet-500/60 hover:text-violet-400 transition-colors"
                data-testid="load-more"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
