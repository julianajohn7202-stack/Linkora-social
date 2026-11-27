"use client";

import { useState } from "react";
import { VotePanel } from "./VotePanel";

export interface Proposal {
  id: string | number;
  title: string;
  description: string;
  proposer: string;
  status: "active" | "passed" | "rejected" | "pending" | "executed";
  votesFor: number;
  votesAgainst: number;
  /** The connected user's on-chain vote, when available. */
  userVote?: "for" | "against" | null;
  /** The connected user's voting power for this proposal. */
  votingPower?: number;
  endsAt?: string;
  createdAt?: string;
}

interface ProposalCardProps {
  proposal: Proposal;
  onVote?: (proposalId: string | number, direction: "for" | "against") => void;
  disabled?: boolean;
}

function formatAddress(address: string): string {
  return address.length > 16 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
}

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

/**
 * Returns an absolute deadline string that includes both the local date/time
 * and the UTC offset so the deadline is unambiguous across time zones.
 *
 * Example: "31 Dec 2025, 23:59 UTC+0" or "31 Dec 2025, 18:59 UTC-5"
 */
function formatAbsoluteDeadline(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";

  const datePart = d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timePart = d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });

  // Build a compact UTC-offset string, e.g. "UTC+5:30" or "UTC-8"
  const offsetMinutes = -d.getTimezoneOffset(); // getTimezoneOffset() is negated
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const minutes = absMinutes % 60;
  const tzLabel = minutes === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(minutes).padStart(2, "0")}`;

  return `${datePart}, ${timePart} ${tzLabel}`;
}

/**
 * Returns a human-readable relative countdown (e.g. "2 days left") or null
 * when the deadline has already passed.
 */
function relativeCountdown(dateStr: string, now: Date): string | null {
  const end = new Date(dateStr);
  if (Number.isNaN(end.getTime())) return null;

  const diffMs = end.getTime() - now.getTime();
  if (diffMs <= 0) return null;

  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s left`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m left`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h left`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d left`;
}

const STATUS_STYLES: Record<Proposal["status"], string> = {
  active:
    "bg-[var(--color-success-light)] text-[var(--color-success)] border border-[var(--color-success)]/30",
  passed:
    "bg-[var(--color-info-light)] text-[var(--color-info)] border border-[var(--color-info)]/30",
  rejected:
    "bg-[var(--color-error-light)] text-[var(--color-error)] border border-[var(--color-error)]/30",
  pending:
    "bg-[var(--color-warning-light)] text-[var(--color-warning)] border border-[var(--color-warning)]/30",
  executed:
    "bg-[var(--color-info-light)] text-[var(--color-info)] border border-[var(--color-info)]/30",
};

/**
 * ProposalCard — displays a governance proposal with voting controls.
 *
 * Uses CSS custom property tokens from globals.css / tokens.css so the card
 * responds correctly to both light and dark themes without any hardcoded colour
 * values.
 */
export function ProposalCard({ proposal, onVote, disabled = false }: ProposalCardProps) {
  const [localVote, setLocalVote] = useState<"for" | "against" | null>(null);
  const currentVote = localVote ?? proposal.userVote ?? null;

  // Derive whether the proposal has actually expired at render time so an
  // active-status proposal whose deadline has passed no longer shows a countdown.
  const now = new Date();
  const isExpired = proposal.endsAt ? new Date(proposal.endsAt).getTime() <= now.getTime() : false;
  const effectivelyActive = proposal.status === "active" && !isExpired;

  const totalVotes = proposal.votesFor + proposal.votesAgainst;
  const forPct = totalVotes > 0 ? Math.round((proposal.votesFor / totalVotes) * 100) : 0;
  const againstPct = totalVotes > 0 ? 100 - forPct : 0;

  const handleVote = (direction: "for" | "against") => {
    if (disabled || currentVote !== null) return;
    setLocalVote(direction);
    onVote?.(proposal.id, direction);
  };

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 md:p-5 transition-shadow hover:shadow-md">
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-[var(--foreground)] leading-snug truncate">
            {proposal.title}
          </h3>
          <p className="mt-0.5 text-xs text-[var(--text-muted)]">
            Proposed by{" "}
            <span className="font-medium text-[var(--foreground)]">
              {formatAddress(proposal.proposer)}
            </span>
            {proposal.createdAt && (
              <span className="ml-2 text-[var(--text-muted)]">· {formatDate(proposal.createdAt)}</span>
            )}
          </p>
        </div>

        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold capitalize ${STATUS_STYLES[proposal.status]}`}
        >
          {proposal.status}
        </span>
      </div>

      {/* Description */}
      <p className="mb-4 text-sm text-[var(--foreground)] leading-relaxed line-clamp-3">
        {proposal.description}
      </p>

      {/* Vote bar */}
      <div className="mb-4">
        <div className="mb-1 flex justify-between text-xs text-[var(--text-muted)]">
          <span>For · {forPct}%</span>
          <span>Against · {againstPct}%</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
          <div
            className="h-full rounded-full bg-[var(--color-success)] transition-all duration-500"
            style={{ width: `${forPct}%` }}
            role="progressbar"
            aria-valuenow={forPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${forPct}% votes for`}
          />
        </div>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{totalVotes} total votes</p>
        {proposal.votingPower !== undefined && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            Your voting power: {proposal.votingPower}
          </p>
        )}
      </div>

      {/* Actions */}
      {currentVote !== null ? (
        <p className="text-sm text-[var(--text-muted)]" role="status">
          You voted {currentVote}.
        </p>
      ) : effectivelyActive && (
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => handleVote("for")}
            disabled={disabled}
            className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              localVote === "for"
                ? "border-[var(--color-success)] bg-[var(--color-success-light)] text-[var(--color-success)]"
                : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-success)]/60 hover:text-[var(--color-success)]"
            }`}
            aria-pressed={false}
          >
            ✓ Vote For
          </button>
          <button
            type="button"
            onClick={() => handleVote("against")}
            disabled={disabled}
            className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              localVote === "against"
                ? "border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]"
                : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-error)]/60 hover:text-[var(--color-error)]"
            }`}
            aria-pressed={false}
          >
            ✗ Vote Against
          </button>
        </div>
      )}

      {/* Deadline row — absolute datetime + relative countdown or expired notice */}
      {proposal.endsAt && (
        <div className="mt-3 text-xs text-[var(--text-muted)]">
          {effectivelyActive ? (
            <>
              {/* Relative countdown only shown while there is time remaining */}
              {relativeCountdown(proposal.endsAt, now) && (
                <span className="mr-2 font-medium text-[var(--foreground)]">
                  {relativeCountdown(proposal.endsAt, now)}
                </span>
              )}
              <span>
                · Ends{" "}
                <time
                  dateTime={new Date(proposal.endsAt).toISOString()}
                  title={formatAbsoluteDeadline(proposal.endsAt)}
                >
                  {formatAbsoluteDeadline(proposal.endsAt)}
                </time>
              </span>
            </>
          ) : (
            <span>
              Ended{" "}
              <time
                dateTime={new Date(proposal.endsAt).toISOString()}
                title={formatAbsoluteDeadline(proposal.endsAt)}
              >
                {formatAbsoluteDeadline(proposal.endsAt)}
              </time>
            </span>
          )}
        </div>
      )}
    </article>
  );
}
