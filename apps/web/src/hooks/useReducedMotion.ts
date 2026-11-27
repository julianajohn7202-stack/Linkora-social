"use client";

import { useEffect, useState } from "react";

/**
 * Returns true when the user has requested reduced motion via the
 * `prefers-reduced-motion: reduce` media query. Falls back to false on the
 * server (SSR) where `window` is unavailable.
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReducedMotion(mq.matches);

    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return prefersReducedMotion;
}
