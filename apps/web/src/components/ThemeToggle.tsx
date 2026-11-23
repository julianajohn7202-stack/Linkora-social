"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  // Track whether the user has interacted so the live region only fires on
  // actual changes, not on initial render.
  const interacted = useRef(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = theme === "dark";
  // The label that describes the *current* active theme, visible at all times.
  const currentLabel = isDark ? "Dark mode" : "Light mode";
  // The action label describes what clicking will do next.
  const actionLabel = isDark ? "Switch to light mode" : "Switch to dark mode";

  function handleClick() {
    interacted.current = true;
    toggleTheme();
  }

  return (
    <>
      {/*
       * A visually-hidden live region announces the new theme exactly once
       * after each toggle. It is separate from the button so the button's
       * own label does not trigger a second announcement.
       */}
      <span
        role="status"
        aria-live="polite"
        aria-atomic="true"
        style={toggleStyles.srOnly}
      >
        {mounted && interacted.current ? `${currentLabel} enabled` : ""}
      </span>

      <button
        onClick={handleClick}
        // Describes what will happen on click (not the current state) so
        // screen readers announce the action, while the live region handles
        // the state-change announcement — avoiding double-announcement.
        aria-label={mounted ? actionLabel : "Toggle theme"}
        aria-pressed={isDark}
        style={toggleStyles.button}
        data-theme-toggle
      >
        {isDark ? (
          <svg
            style={toggleStyles.icon}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        ) : (
          <svg
            style={toggleStyles.icon}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        )}
        {/*
         * Visible label shows the *current* theme so users can read it
         * without hovering. We suppress it from the accessibility tree
         * because aria-label on the button already carries the full
         * description; exposing it again would be redundant.
         */}
        <span style={toggleStyles.label} aria-hidden="true">
          {mounted ? currentLabel : "Theme"}
        </span>
      </button>
    </>
  );
}

const toggleStyles = {
  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "8px 12px",
    borderRadius: "10px",
    border: "1px solid var(--border, #334155)",
    background: "var(--bg-secondary, #1E293B)",
    color: "var(--text-primary, #F8FAFC)",
    fontSize: "0.875rem",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.2s ease-in-out",
  },
  icon: {
    width: "18px",
    height: "18px",
    color: "var(--accent-primary, #60A5FA)",
  },
  label: {
    fontSize: "0.85rem",
  },
  srOnly: {
    position: "absolute" as const,
    width: "1px",
    height: "1px",
    padding: 0,
    margin: "-1px",
    overflow: "hidden",
    clip: "rect(0,0,0,0)",
    whiteSpace: "nowrap" as const,
    border: 0,
  },
};
