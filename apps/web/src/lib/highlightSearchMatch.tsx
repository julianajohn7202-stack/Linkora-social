export function highlightSearchMatch(text: string, query: string) {
  const term = query.trim();
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .split(new RegExp(`(${escaped})`, "gi"))
    .map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}
