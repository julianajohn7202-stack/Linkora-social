"use client";

/**
 * TxToast.tsx
 *
 * Global transaction toast notification overlay.
 *
 * States:
 *   pending   — "Transaction pending…" with spinner
 *   confirmed — "Confirmed ✓" with hash link to Stellar Expert, auto-dismisses after 5 s
 *   failed    — "Failed" with error message, manual dismiss
 *
 * Accessibility:
 *   - Pending/confirmed: role="status" + aria-live="polite"   (non-urgent, doesn't steal focus)
 *   - Failed:            role="alert"  + aria-live="assertive" (urgent, screen readers announce immediately)
 *   - Spinner hidden from AT via aria-hidden
 *   - Close button has aria-label
 *
 * Place a single <TxToast /> instance in the root layout; it reads from TxToastContext.
 */

import React, { useEffect, useRef } from "react";
import { useTxToast } from "@/contexts/TxToastContext";

// Stellar Expert testnet base URL — swap to mainnet via env if needed
const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_EXPLORER_BASE ?? "https://stellar.expert/explorer/testnet/tx";

// Auto-dismiss delay for "confirmed" state
const CONFIRM_DISMISS_MS = 5_000;

// ─── Component ────────────────────────────────────────────────────────────────

export function TxToast() {
  const { toast, dismiss } = useTxToast();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss on confirmed after 5 s
  useEffect(() => {
    if (toast.status === "confirmed") {
      timerRef.current = setTimeout(dismiss, CONFIRM_DISMISS_MS);
    }
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [toast.status, dismiss]);

  if (toast.status === "idle") return null;

  return (
    <div
      style={styles.portal}
      // Keep portal above modals (z-index 200)
      data-testid="tx-toast-portal"
    >
      {toast.status === "pending" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{ ...styles.toast, ...styles.pending }}
          data-testid="tx-toast"
        >
          <Spinner />
          <span style={styles.message}>Transaction pending…</span>
        </div>
      )}

      {toast.status === "confirmed" && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          style={{ ...styles.toast, ...styles.confirmed }}
          data-testid="tx-toast"
        >
          <span aria-hidden="true" style={styles.icon}>
            ✓
          </span>
          <span style={styles.message}>
            Confirmed{" "}
            {toast.hash && (
              <>
                ·{" "}
                <a
                  href={`${EXPLORER_BASE}/${toast.hash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.hashLink}
                  aria-label={`View transaction ${toast.hash.slice(0, 8)}… on Stellar Expert`}
                >
                  {toast.hash.slice(0, 8)}…{toast.hash.slice(-6)} ↗
                </a>
              </>
            )}
          </span>
          <button
            onClick={dismiss}
            style={styles.closeBtn}
            aria-label="Dismiss transaction notification"
          >
            ✕
          </button>
        </div>
      )}

      {toast.status === "failed" && (
        <div
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          style={{ ...styles.toast, ...styles.failed }}
          data-testid="tx-toast"
        >
          <span aria-hidden="true" style={styles.icon}>
            ✕
          </span>
          <span style={styles.message}>
            <strong>Transaction failed</strong>
            {toast.error && (
              <>
                {" — "}
                <span style={styles.errorDetail}>{toast.error}</span>
              </>
            )}
          </span>
          <button onClick={dismiss} style={styles.closeBtn} aria-label="Dismiss transaction error">
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ animation: "tx-toast-spin 0.9s linear infinite", flexShrink: 0 }}
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
// Inline styles keep the component self-contained and theme-independent.
// Colors map to the existing CSS custom properties defined in globals.css.

import type { CSSProperties } from "react";

const styles: Record<string, CSSProperties> = {
  portal: {
    position: "fixed",
    bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
    right: "1.5rem",
    zIndex: 200,
    display: "flex",
    flexDirection: "column",
    gap: "0.5rem",
    maxWidth: "min(28rem, calc(100vw - 2rem))",
    pointerEvents: "none", // portal itself is pass-through
  },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
    padding: "0.65rem 0.9rem",
    borderRadius: "0.75rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    border: "1px solid",
    boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
    pointerEvents: "auto", // individual toasts are interactive
    // Slide in from right
    animation: "tx-toast-slide-in 180ms ease",
  },
  pending: {
    background: "var(--color-info-light, #dbeafe)",
    borderColor: "var(--color-info, #3b82f6)",
    color: "#1e40af",
  },
  confirmed: {
    background: "var(--color-success-light, #d1fae5)",
    borderColor: "var(--color-success, #10b981)",
    color: "#065f46",
  },
  failed: {
    background: "var(--color-error-light, #fee2e2)",
    borderColor: "var(--color-error, #ef4444)",
    color: "#991b1b",
  },
  icon: {
    fontWeight: 700,
    fontSize: "0.9rem",
    flexShrink: 0,
  },
  message: {
    flex: 1,
    lineHeight: 1.4,
  },
  errorDetail: {
    fontWeight: 400,
    opacity: 0.9,
  },
  hashLink: {
    fontFamily: "var(--font-mono, monospace)",
    fontWeight: 600,
    color: "inherit",
    textDecoration: "underline",
    textUnderlineOffset: "2px",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: "0.8rem",
    opacity: 0.6,
    padding: "0 0.2rem",
    color: "inherit",
    flexShrink: 0,
    lineHeight: 1,
    // Ensure min touch target
    minWidth: "1.5rem",
    minHeight: "1.5rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
};
