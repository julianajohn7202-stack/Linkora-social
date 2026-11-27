"use client";

import React from "react";

export type WalletSignSheetProps = {
  xdr: string;
  onApprove: () => void;
  onReject: () => void;
  /** Display name of the mini-app requesting the signature. */
  appName?: string;
  /** Icon URL for the mini-app (optional; falls back to a placeholder). */
  appIconUrl?: string;
  /** Human-readable network label, e.g. "Stellar Mainnet" or "Testnet". */
  network?: string;
  /**
   * Short description of the action being signed, e.g.
   * "Send 5 XLM to tip-jar escrow".
   */
  actionSummary?: string;
};

/**
 * Bottom sheet that exposes mini-app identity, network context and the
 * specific action being signed before the user commits to approving or
 * rejecting the request.
 *
 * Reading order: app identity → network → action summary → XDR detail →
 * Reject / Approve controls. This keeps context in front of the decision.
 *
 * Long identity labels wrap without clipping the action buttons because
 * the layout uses flex-column for the header section and flex-row only
 * for the two equal-width action buttons.
 */
export function WalletSignSheet({
  xdr,
  onApprove,
  onReject,
  appName = "Unknown app",
  appIconUrl,
  network = "Stellar Mainnet",
  actionSummary,
}: WalletSignSheetProps) {
  return (
    <div style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="wss-title">
      <div style={styles.sheet}>
        {/* ── 1. App identity ──────────────────────────────────────── */}
        <div style={styles.identityRow}>
          {appIconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={appIconUrl}
              alt=""
              aria-hidden="true"
              style={styles.appIcon}
            />
          ) : (
            <div style={styles.appIconPlaceholder} aria-hidden="true">
              🧩
            </div>
          )}
          <div style={styles.identityText}>
            <p style={styles.requestingLabel}>Requesting your signature</p>
            {/* id="wss-title" so the dialog is labelled with the app name */}
            <p id="wss-title" style={styles.appName}>
              {appName}
            </p>
          </div>
        </div>

        {/* ── 2. Network ───────────────────────────────────────────── */}
        <div style={styles.metaRow}>
          <span style={styles.metaLabel}>Network</span>
          <span style={styles.metaValue}>{network}</span>
        </div>

        {/* ── 3. Action summary ────────────────────────────────────── */}
        {actionSummary ? (
          <div style={styles.metaRow}>
            <span style={styles.metaLabel}>Action</span>
            <span style={styles.metaValue}>{actionSummary}</span>
          </div>
        ) : null}

        {/* ── 4. XDR detail (collapsible for long payloads) ────────── */}
        <details style={styles.xdrDetails}>
          <summary style={styles.xdrSummary}>Transaction payload (XDR)</summary>
          <pre style={styles.xdr} aria-label="Transaction XDR">
            {xdr}
          </pre>
        </details>

        {/* ── 5. Approve / Reject ──────────────────────────────────── */}
        <div style={styles.actions}>
          <button
            onClick={onReject}
            style={styles.rejectButton}
            aria-label={`Reject signature request from ${appName}`}
          >
            Reject
          </button>
          <button
            onClick={onApprove}
            style={styles.approveButton}
            aria-label={`Approve signature request from ${appName}`}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 1000,
  },
  sheet: {
    width: "100%",
    background: "var(--color-bg)",
    borderRadius: "16px 16px 0 0",
    padding: "var(--spacing-lg)",
    display: "flex",
    flexDirection: "column",
    gap: "var(--spacing-md)",
  },
  /* Identity row: icon + stacked text; text wraps, buttons below are unaffected */
  identityRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "var(--spacing-md)",
  },
  appIcon: {
    width: "48px",
    height: "48px",
    borderRadius: "10px",
    flexShrink: 0,
    objectFit: "cover",
  },
  appIconPlaceholder: {
    width: "48px",
    height: "48px",
    borderRadius: "10px",
    flexShrink: 0,
    background: "var(--color-border)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "1.5rem",
  },
  identityText: {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    minWidth: 0, // allows text to wrap correctly inside flex
  },
  requestingLabel: {
    margin: 0,
    fontSize: "0.75rem",
    color: "var(--color-text-secondary)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  },
  appName: {
    margin: 0,
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--color-text-primary)",
    wordBreak: "break-word", // long app names wrap instead of overflowing
  },
  /* Metadata rows: label + value side-by-side, value wraps on narrow screens */
  metaRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "var(--spacing-md)",
    padding: "var(--spacing-sm) var(--spacing-md)",
    background: "var(--color-surface-1, rgba(0,0,0,0.04))",
    borderRadius: "8px",
  },
  metaLabel: {
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    flexShrink: 0,
  },
  metaValue: {
    fontSize: "0.9rem",
    color: "var(--color-text-primary)",
    textAlign: "right" as const,
    wordBreak: "break-word",
  },
  /* XDR collapsible */
  xdrDetails: {
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    overflow: "hidden",
  },
  xdrSummary: {
    padding: "var(--spacing-sm) var(--spacing-md)",
    fontSize: "0.8rem",
    fontWeight: 600,
    color: "var(--color-text-secondary)",
    cursor: "pointer",
    userSelect: "none" as const,
    listStyle: "none",
  },
  xdr: {
    background: "var(--color-border)",
    padding: "var(--spacing-md)",
    fontSize: "0.75rem",
    fontFamily: "monospace",
    overflowX: "auto",
    whiteSpace: "pre-wrap",
    wordBreak: "break-all",
    maxHeight: "160px",
    overflowY: "auto",
    margin: 0,
  },
  /* Action buttons */
  actions: {
    display: "flex",
    gap: "var(--spacing-md)",
  },
  rejectButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    border: "1px solid var(--color-border)",
    background: "transparent",
    fontSize: "1rem",
    cursor: "pointer",
    color: "var(--color-text-primary)",
  },
  approveButton: {
    flex: 1,
    padding: "var(--spacing-md)",
    borderRadius: "8px",
    background: "var(--color-primary)",
    color: "white",
    fontWeight: 600,
    fontSize: "1rem",
    cursor: "pointer",
    border: "none",
  },
};
