/**
 * @linkora/search
 *
 * Full-text and on-chain entity search service for the Linkora SocialFi
 * platform.  Exposes a REST API backed by PostgreSQL full-text search and
 * (optionally) a vector embedding store.
 *
 * This file is a stub — implementation will be added in follow-up PRs.
 */

export type SearchEntityKind = "profile" | "post" | "community" | "miniapp";

export interface SearchQuery {
  /** Raw query string provided by the user */
  q: string;
  /** Restrict results to a specific entity kind */
  kind?: SearchEntityKind;
  /** Maximum number of results to return (1–100) */
  limit?: number;
  /** Zero-based page offset */
  offset?: number;
}

export interface SearchResult<T = unknown> {
  kind: SearchEntityKind;
  /** Relevance score in the range [0, 1] */
  score: number;
  entity: T;
}

export interface SearchResponse<T = unknown> {
  query: string;
  total: number;
  results: Array<SearchResult<T>>;
}

export interface SearchService {
  search<T = unknown>(query: SearchQuery): Promise<SearchResponse<T>>;
}

/**
 * No-op implementation used during development and tests.
 */
export class NoopSearchService implements SearchService {
  async search<T = unknown>(query: SearchQuery): Promise<SearchResponse<T>> {
    // TODO: implement full-text search against PostgreSQL
    return {
      query: query.q,
      total: 0,
      results: [],
    };
  }
}
