"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { validateSearchQuery } from "@/lib/validate";
import type { SearchSuggestion } from "@/hooks/useSearchSuggestions";
import { useRecentSearches } from "@/hooks/useRecentSearches";
import { useSearchNavigation } from "@/hooks/useSearchNavigation";
import { SearchResultOptions } from "./SearchResults";

interface SearchBarProps {
  onSearch: (query: string) => void;
  placeholder?: string;
  initialValue?: string;
  className?: string;
  inputClassName?: string;
  buttonLabel?: string;
  /** Optional ref forwarded to the underlying <input> for programmatic focus (e.g. keyboard shortcut). */
  inputRef?: React.Ref<HTMLInputElement>;
}

export default function SearchBar({
  onSearch,
  placeholder = "Search posts...",
  initialValue = "",
  className = "w-full max-w-md",
  inputClassName = "",
  buttonLabel = "Search",
  inputRef: forwardedInputRef,
}: SearchBarProps) {
  const [query, setQuery] = useState(initialValue);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { recentSearches, addRecentSearch, clearRecentSearches, removeRecentSearch } =
    useRecentSearches();

  const setInputRef = useCallback(
    (input: HTMLInputElement | null) => {
      inputRef.current = input;
      if (typeof forwardedInputRef === "function") forwardedInputRef(input);
      else if (forwardedInputRef) forwardedInputRef.current = input;
    },
    [forwardedInputRef]
  );

  useEffect(() => setQuery(initialValue), [initialValue]);

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  }, []);

  const submit = (value: string) => {
    if (!validateSearchQuery(value).valid) return;
    setQuery(value);
    addRecentSearch(value);
    onSearch(value);
    setOpen(false);
  };

  const select = (result: SearchSuggestion) => {
    if (result.type === "profile" || result.type === "post") {
      addRecentSearch(query.trim());
      setOpen(false);
      router.push(
        `/${result.type === "profile" ? "profile" : "posts"}/${encodeURIComponent(result.value)}`
      );
    } else {
      submit(result.value);
    }
  };

  const { results, loading, selectedIndex, onKeyDown } = useSearchNavigation(
    query,
    open,
    recentSearches,
    select,
    () => setOpen(false)
  );
  const showDropdown = open && (loading || results.length > 0);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    submit((inputRef.current?.value ?? query).trim());
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <form onSubmit={handleSubmit} role="search">
        <div className="relative">
          <input
            ref={setInputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setOpen(true);
              setQuery(e.target.value);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            aria-autocomplete="list"
            role="combobox"
            aria-expanded={showDropdown}
            aria-controls={showDropdown ? listId : undefined}
            aria-activedescendant={
              showDropdown && selectedIndex >= 0 ? `${listId}-${selectedIndex}` : undefined
            }
            className={`w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 md:px-4 py-2 pr-20 md:pr-24 text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-violet-500 ${inputClassName}`}
          />
          <button
            type="submit"
            className="absolute right-1.5 md:right-2 top-1/2 -translate-y-1/2 rounded bg-violet-600 px-2 md:px-3 py-1 text-xs md:text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50 transition-colors"
            aria-label={buttonLabel}
          >
            {buttonLabel}
          </button>
        </div>
      </form>

      {showDropdown && (
        <div className="absolute z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-lg">
          {loading && (
            <p role="status" className="px-4 py-2">
              Loading suggestions...
            </p>
          )}
          <div id={listId} role="listbox" aria-label="Search results" aria-busy={loading}>
            <SearchResultOptions
              id={listId}
              query={query}
              results={results}
              selectedIndex={selectedIndex}
              onSelect={select}
            />
          </div>
          {!query.trim() && recentSearches.length > 0 && (
            <details className="border-t border-[var(--border)] px-4 py-2 text-sm">
              <summary className="cursor-pointer">Manage recent searches</summary>
              {recentSearches.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="block py-1"
                  onClick={() => removeRecentSearch(value)}
                >
                  Remove {value}
                </button>
              ))}
              <button type="button" className="py-1" onClick={clearRecentSearches}>
                Clear recent
              </button>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
