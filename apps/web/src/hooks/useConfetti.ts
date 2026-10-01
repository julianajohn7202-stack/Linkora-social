"use client";

import { useCallback } from "react";

const SESSION_KEY = "linkora:confetti:tip_fired";

/**
 * Returns a `fireTipConfetti` function that:
 *  - Fires a canvas-confetti burst celebrating the first tip received.
 *  - Only fires once per browser session (tracked via sessionStorage).
 *  - Silently no-ops when `prefers-reduced-motion: reduce` is set.
 *
 * canvas-confetti is imported dynamically so it is never bundled into the
 * initial JS payload.
 */
export function useConfetti() {
  const fireTipConfetti = useCallback(async () => {
    // Respect the user's motion preference.
    if (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    // Only fire once per session.
    if (typeof sessionStorage !== "undefined") {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
    }

    // Dynamically import to keep the initial bundle lean.
    const { default: confetti } = await import("canvas-confetti");

    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 },
      colors: ["#7c3aed", "#a78bfa", "#fbbf24", "#34d399", "#f472b6"],
    });
  }, []);

  return { fireTipConfetti };
}
