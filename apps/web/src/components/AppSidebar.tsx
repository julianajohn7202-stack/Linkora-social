"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect, useRef, useCallback } from "react";
import { CreatePostModal } from "@/components/modals/CreatePostModal";

const sidebarLinks = [
  {
    href: "/pools",
    label: "Pools",
    tourId: "pools",
    description: "Community reward pools",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 18.75a60.07 60.07 0 0 1 15.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 0 1 3 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375M3.75 16.5h16.5"
      />
    ),
  },
  {
    href: "/explore",
    label: "Mini Apps",
    tourId: "mini-apps",
    description: "Discover integrations",
    icon: (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
      />
    ),
  },
] as const;

/** All keyboard-focusable element types inside a container. */
const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab/Shift+Tab focus inside `containerRef` while `enabled` is true.
 * Moves initial focus to the first focusable child on activation.
 */
function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled || !containerRef.current) return;

    const el = containerRef.current;
    const getFocusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));

    // Move initial focus into the panel
    const focusable = getFocusable();
    if (focusable.length > 0) focusable[0].focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const nodes = getFocusable();
      if (nodes.length === 0) {
        e.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [enabled, containerRef]);
}

export function AppSidebar() {
  const pathname = usePathname();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  /** Button that opened the overlay — focus returns here on close. */
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  /** The overlay panel — used by the focus trap. */
  const overlayPanelRef = useRef<HTMLDivElement | null>(null);
  /** Scroll position captured when the overlay opens. */
  const savedScrollRef = useRef<number>(0);

  useFocusTrap(overlayPanelRef, isMobileOpen);

  /** Open the mobile overlay and lock background scroll. */
  const openMobile = useCallback((trigger: HTMLButtonElement) => {
    triggerRef.current = trigger;
    savedScrollRef.current = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    setIsMobileOpen(true);
  }, []);

  /**
   * Close the mobile overlay.
   * @param restoreScroll - Pass `false` on route changes so the new page
   *   starts at the top instead of jumping to the previous position.
   */
  const closeMobile = useCallback((restoreScroll = true) => {
    document.body.style.overflow = "";
    document.body.style.touchAction = "";
    if (restoreScroll) {
      // scrollTo with "instant" avoids a visible scroll animation
      window.scrollTo({ top: savedScrollRef.current, behavior: "instant" as ScrollBehavior });
    }
    setIsMobileOpen(false);
    // Return focus to the trigger that opened the overlay
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  // Dismiss on route change (new page starts at top — don't restore scroll)
  useEffect(() => {
    if (isMobileOpen) closeMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Escape key closes the overlay
  useEffect(() => {
    if (!isMobileOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeMobile(true);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMobileOpen, closeMobile]);

  // Release overflow lock if the component unmounts while open
  useEffect(() => {
    return () => {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    };
  }, []);

  /** Shared nav links rendered in both desktop sidebar and mobile panel. */
  const navContent = (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-500 transition-colors shadow-md"
      >
        Create Post
      </button>

      <p className="px-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Discover
      </p>

      <nav className="space-y-1">
        {sidebarLinks.map((link) => {
          const isActive =
            pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              data-tour={link.tourId}
              className={`flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                isActive
                  ? "bg-violet-600/15 text-violet-300"
                  : "text-[var(--foreground)] hover:bg-[var(--bg-tertiary)]"
              }`}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="mt-0.5 h-5 w-5 shrink-0"
                aria-hidden="true"
              >
                {link.icon}
              </svg>
              <span>
                <span className="block text-sm font-semibold">{link.label}</span>
                <span className="block text-xs text-[var(--text-muted)]">
                  {link.description}
                </span>
              </span>
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* ── Desktop sidebar (lg+) — unchanged behaviour ── */}
      <aside
        className="hidden w-56 shrink-0 lg:block"
        aria-label="App sidebar"
        data-tour="sidebar"
      >
        <div className="sticky top-24 space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--muted)]/60 p-3">
          {navContent}
        </div>
      </aside>

      {/* ── Mobile trigger (below lg) ── */}
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={isMobileOpen}
        aria-controls="mobile-sidebar-panel"
        onClick={(e) => openMobile(e.currentTarget)}
        className="fixed bottom-5 left-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-white shadow-lg lg:hidden"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
          className="h-6 w-6"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        </svg>
      </button>

      {/* ── Mobile overlay ── */}
      {isMobileOpen && (
        <>
          {/* Backdrop — click outside to close */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            aria-hidden="true"
            onClick={() => closeMobile(true)}
          />

          {/* Panel */}
          <div
            id="mobile-sidebar-panel"
            ref={overlayPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto bg-[var(--bg-secondary,#1e293b)] p-4 shadow-2xl lg:hidden"
          >
            {/* Header row with close button */}
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-[var(--foreground)]">
                Menu
              </span>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => closeMobile(true)}
                className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div className="space-y-3">{navContent}</div>
          </div>
        </>
      )}

      <CreatePostModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
