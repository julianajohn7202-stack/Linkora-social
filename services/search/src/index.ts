/**
 * @linkora/search
 *
 * Full-text and semantic search over profiles, posts, and communities for the
 * Linkora social protocol. Backed by PostgreSQL full-text search with optional
 * vector-embedding extension for semantic queries.
 *
 * This service is a stub — full implementation is tracked in the project
 * roadmap.
 */

export type SearchEntityType = "profile" | "post" | "community" | "pool";

export interface SearchQuery {
  /** Free-text search term. */
  q: string;
  /** Restrict results to a specific entity type. */
  entityType?: SearchEntityType;
  /** Maximum number of results to return (default: 20). */
  limit?: number;
  /** Offset for pagination (default: 0). */
  offset?: number;
}

export interface SearchResult {
  entityType: SearchEntityType;
  /** Unique identifier (address for profiles, ledger+index for posts, etc.). */
  id: string;
  /** Human-readable label (display name, post snippet, etc.). */
  label: string;
  /** Relevance score in [0, 1]. */
  relevance: number;
}

export interface SearchResponse {
  query: SearchQuery;
  results: SearchResult[];
  total: number;
  durationMs: number;
}

/**
 * Stub search handler — returns an empty result set.
 *
 * Replace with a real implementation that queries PostgreSQL full-text search
 * or a vector-embedding engine.
 *
 * @param query - The search query parameters.
 * @returns A {@link SearchResponse} with matching results.
 */
export async function search(query: SearchQuery): Promise<SearchResponse> {
  const start = Date.now();
  // Stub: real implementation would query the database and rank results.
  console.log(`[search] query=${JSON.stringify(query)}`);
  return {
    query,
    results: [],
    total: 0,
    durationMs: Date.now() - start,
  };
}
