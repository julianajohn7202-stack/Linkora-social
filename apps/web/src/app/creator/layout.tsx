"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

const NAV_ITEMS = [
  { href: "/creator/posts", label: "Posts" },
  { href: "/creator/earnings", label: "Earnings" },
  { href: "/creator/audience", label: "Audience" },
  { href: "/creator/tokens", label: "Tokens" },
] as const;

/**
 * Section titles keyed by route segment. Keeps <title> and the visible
 * heading in sync without duplicating strings across each page.
 */
const SECTION_TITLES: Record<string, string> = {
  "/creator/posts": "Post Performance",
  "/creator/earnings": "Earnings",
  "/creator/audience": "Audience Analytics",
  "/creator/tokens": "Creator Token",
};

export default function CreatorLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const pageTitle = SECTION_TITLES[pathname] ?? "Creator Dashboard";

  return (
    <>
      {/* Dynamic page title announced to screen readers on route change */}
      <title>{pageTitle} — Creator</title>

      <div className="min-h-screen bg-[var(--bg-primary,#fff)]">
        {/* Top navigation bar */}
        <nav
          aria-label="Creator sections"
          className="sticky top-0 z-10 border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900"
        >
          <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-0 scrollbar-none">
            {NAV_ITEMS.map(({ href, label }) => {
              const isCurrent = pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={isCurrent ? "page" : undefined}
                  className={[
                    "flex-shrink-0 rounded-none border-b-2 px-4 py-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500",
                    isCurrent
                      ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                      : "border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100",
                  ].join(" ")}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Page content */}
        <main id="creator-main">{children}</main>
      </div>
    </>
  );
}
