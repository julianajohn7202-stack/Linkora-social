"use client";

import type { CSSProperties } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

const shimmerBackground =
  "linear-gradient(90deg, var(--color-bg-secondary) 0%, var(--color-border) 50%, var(--color-bg-secondary) 100%)";

const staticBackground = "var(--color-bg-secondary)";

export function PostCardSkeleton() {
  const prefersReducedMotion = useReducedMotion();

  const animated: CSSProperties = prefersReducedMotion
    ? { background: staticBackground }
    : {
        background: shimmerBackground,
        backgroundSize: "200% 100%",
        animation: "shimmer 1.5s infinite",
      };

  return (
    <article style={styles.card} data-testid="post-card-skeleton">
      <div style={styles.header}>
        <div style={{ ...styles.avatarBase, ...animated }} />
        <div style={styles.meta}>
          <div style={{ ...styles.lineBase, ...animated, width: "40%" }} />
          <div
            style={{ ...styles.lineBase, ...animated, height: "10px", width: "25%", marginTop: "6px" }}
          />
        </div>
      </div>
      <div style={{ ...styles.lineBase, ...animated, width: "100%", marginTop: "var(--spacing-md)" }} />
      <div style={{ ...styles.lineBase, ...animated, width: "82%", marginTop: "var(--spacing-sm)" }} />
      <div style={styles.footer}>
        <div style={{ ...styles.chipBase, ...animated, width: "72px" }} />
        <div style={{ ...styles.chipBase, ...animated, width: "96px" }} />
      </div>
    </article>
  );
}

const styles: Record<string, CSSProperties> = {
  card: {
    background: "var(--color-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "12px",
    padding: "var(--spacing-lg)",
    marginBottom: "var(--spacing-md)",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "var(--spacing-sm)",
  },
  avatarBase: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  meta: {
    flex: 1,
  },
  lineBase: {
    height: "12px",
    borderRadius: "9999px",
  },
  footer: {
    display: "flex",
    gap: "var(--spacing-sm)",
    marginTop: "var(--spacing-md)",
  },
  chipBase: {
    height: "24px",
    borderRadius: "9999px",
  },
};
