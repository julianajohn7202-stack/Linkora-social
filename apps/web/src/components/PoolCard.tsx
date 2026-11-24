"use client";

import React, { useState } from "react";

interface PoolCardProps {
  poolId: string;
  token: string;
  balance: bigint | number | string;
  adminCount: number;
  threshold: number;
}

/**
 * Abbreviates a numeric string to a human-readable form with a suffix.
 * e.g. 1_234_567.89 → "1.23M"
 */
function abbreviateAmount(value: number): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return (value / 1_000_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "B";
  }
  if (Math.abs(value) >= 1_000_000) {
    return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "M";
  }
  if (Math.abs(value) >= 1_000) {
    return (value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 2 }) + "K";
  }
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 });
}

export default function PoolCard({ poolId, token, balance, adminCount, threshold }: PoolCardProps) {
  const numericBalance = Number(balance) / 1e7;

  const fullBalance = numericBalance.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
  });

  const shortBalance = abbreviateAmount(numericBalance);
  const isAbbreviated = shortBalance !== fullBalance;

  // Controls whether the full value tooltip/popover is visible for keyboard/SR users.
  const [showFull, setShowFull] = useState(false);

  return (
    <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-5 hover:border-neutral-500 transition-colors cursor-pointer shadow-md min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-bold text-white break-all" title={poolId}>
            {poolId}
          </h3>
          {/*
           * Token symbol: break-all allows long symbols to wrap rather than
           * overflow the card at 320 px.
           */}
          <span className="text-sm text-neutral-400 font-mono break-all">{token}</span>
        </div>
        {/* M-of-N threshold badge */}
        <span
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-indigo-500/20 border border-indigo-500/40 text-indigo-300 text-xs font-semibold whitespace-nowrap flex-shrink-0"
          title={`Requires ${threshold} of ${adminCount} admin signatures`}
        >
          {threshold} of {adminCount} admins
        </span>
      </div>

      {/*
       * Balance row: wraps when the viewport is narrow so amount + symbol
       * never overflow the card.  The abbreviated value is shown by default;
       * the full value is available via a visually-hidden button for keyboard
       * and screen-reader users, and surfaced in a tooltip on hover/focus.
       */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-neutral-400 border-t border-neutral-700 pt-4">
        <span>Balance</span>
        <span className="relative font-semibold text-white min-w-0 flex items-center gap-1.5">
          {/*
           * Abbreviated value visible to sighted users at any width.
           * aria-hidden so screen readers read the full value instead.
           */}
          <span aria-hidden="true" className="break-all">
            {shortBalance}{" "}
            <span className="text-neutral-400 font-normal break-all">{token}</span>
          </span>

          {/*
           * Screen-reader text always exposes the full, unabbreviated value
           * regardless of abbreviation state.
           */}
          <span className="sr-only">
            {fullBalance} {token}
          </span>

          {/*
           * Keyboard-accessible expand button: only rendered when the value
           * has actually been abbreviated to avoid a no-op button.
           */}
          {isAbbreviated && (
            <button
              type="button"
              aria-label={`Show full balance: ${fullBalance} ${token}`}
              aria-expanded={showFull}
              onClick={() => setShowFull((v) => !v)}
              className="text-neutral-500 hover:text-neutral-200 focus:outline-none focus:ring-1 focus:ring-indigo-400 rounded text-xs leading-none px-1 py-0.5 border border-neutral-600 hover:border-neutral-400 transition-colors"
            >
              {showFull ? "▲" : "…"}
            </button>
          )}

          {/* Expanded full-value panel */}
          {isAbbreviated && showFull && (
            <span
              role="tooltip"
              className="absolute bottom-full right-0 mb-1.5 z-10 whitespace-nowrap rounded-lg bg-neutral-700 border border-neutral-600 px-3 py-1.5 text-xs text-white shadow-lg"
            >
              {fullBalance} {token}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
