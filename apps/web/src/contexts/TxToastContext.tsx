"use client";

/**
 * TxToastContext.tsx
 *
 * Global transaction toast system for on-chain feedback.
 *
 * Usage:
 *   const { notify } = useTxToast();
 *
 *   // 1. Show "pending" immediately on submission
 *   notify({ status: "pending" });
 *
 *   // 2. Update to "confirmed" with hash on success
 *   notify({ status: "confirmed", hash: result.hash });
 *
 *   // 3. Update to "failed" with message on error
 *   notify({ status: "failed", error: "Transaction rejected by wallet" });
 *
 * The TxToast UI component reads from this context and renders in the layout.
 */

import React, { createContext, useCallback, useContext, useState, type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TxToastStatus = "pending" | "confirmed" | "failed" | "idle";

export interface TxToastState {
  status: TxToastStatus;
  /** Transaction hash — populated on confirmed */
  hash?: string;
  /** Human-readable error message — populated on failed */
  error?: string;
}

export interface TxToastContextValue {
  toast: TxToastState;
  /**
   * Push a new toast state. Calling with `{ status: "pending" }` immediately
   * shows the pending banner. Subsequent calls update the same toast in place
   * so users always see a single coherent flow for one transaction.
   */
  notify: (next: TxToastState) => void;
  /** Dismiss the toast and reset to idle. */
  dismiss: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const IDLE: TxToastState = { status: "idle" };

const TxToastContext = createContext<TxToastContextValue>({
  toast: IDLE,
  notify: () => {},
  dismiss: () => {},
});

// ─── Provider ─────────────────────────────────────────────────────────────────

export function TxToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<TxToastState>(IDLE);

  const notify = useCallback((next: TxToastState) => {
    setToast(next);
  }, []);

  const dismiss = useCallback(() => {
    setToast(IDLE);
  }, []);

  return (
    <TxToastContext.Provider value={{ toast, notify, dismiss }}>{children}</TxToastContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * `useTxToast` — access the global tx toast from any component.
 *
 * Throws if used outside `TxToastProvider`.
 */
export function useTxToast(): TxToastContextValue {
  const ctx = useContext(TxToastContext);
  if (!ctx) {
    throw new Error("useTxToast must be used within a TxToastProvider");
  }
  return ctx;
}
