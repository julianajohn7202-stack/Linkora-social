import { useEffect, useState, type KeyboardEvent } from "react";
import { useSearchSuggestions, type SearchSuggestion } from "./useSearchSuggestions";

const groupOrder = ["profile", "post", "hashtag", "recent"] as const;

export function useSearch(
  query: string,
  open: boolean,
  recentSearches: string[],
  onSelect: (result: SearchSuggestion) => void,
  onClose: () => void
) {
  const { suggestions, loading, fetchSuggestions, clearSuggestions } = useSearchSuggestions({
    includePosts: true,
  });
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    setActiveIndex(-1);
    if (open && query.trim()) fetchSuggestions(query);
    else clearSuggestions();
  }, [query, open, fetchSuggestions, clearSuggestions]);

  const results: SearchSuggestion[] = query.trim()
    ? loading
      ? []
      : groupOrder.flatMap((type) => suggestions.filter((result) => result.type === type))
    : recentSearches.map((value) => ({ type: "recent", value }));
  const selectedIndex = open && results[activeIndex] ? activeIndex : -1;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setActiveIndex(-1);
      onClose();
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const start = selectedIndex === -1 && step < 0 ? 0 : selectedIndex;
      setActiveIndex((start + step + results.length) % results.length);
    }
    if (event.key === "Enter" && selectedIndex >= 0) {
      event.preventDefault();
      onSelect(results[selectedIndex]);
    }
  }

  return { results, loading, selectedIndex, onKeyDown };
}
