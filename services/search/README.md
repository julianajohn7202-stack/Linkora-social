# Linkora Search

Full-text and tag-based search for Linkora posts, powered by PostgreSQL's
built-in FTS engine. The search endpoint is part of the indexer service
(`services/indexer`) and exposed at `GET /api/search/posts`.

---

## Full-Text Search approach

Search is implemented with native PostgreSQL full-text search rather than an
external engine (e.g. Elasticsearch). This keeps the operational footprint
minimal — no additional service to run or keep in sync — while covering the
query patterns Linkora needs.

### Schema

Migration `009_posts_fts.sql` adds a generated, stored `tsvector` column to the
`posts` table:

```sql
ALTER TABLE posts
  ADD COLUMN IF NOT EXISTS content_tsv tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS idx_posts_content_fts
  ON posts USING GIN (content_tsv);
```

`GENERATED ALWAYS … STORED` means PostgreSQL keeps `content_tsv` in sync with
`content` automatically on every insert or update — no application-side trigger
needed.

The `english` configuration applies stemming and stop-word removal so that
queries like "running" also match "run" and "runs".

### Tag index

Migration `014_post_tags.sql` adds a `TEXT[]` column and a separate GIN index
for hashtag search:

```sql
ALTER TABLE posts ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_posts_tags ON posts USING GIN (tags);
```

Tags are stored in lowercase. The application layer normalises the incoming
query term to lowercase before the `ANY(tags)` lookup.

---

## Quick start

The search API is served by the indexer process. Run the indexer locally to
try it out.

**Prerequisites:** Node ≥ 18, Docker + Compose v2, `pnpm`.

```bash
# 1. Copy the environment template and fill in your values
cd services/indexer
cp .env.example .env
# Minimum required:
#   DATABASE_URL=postgresql://linkora:linkora@localhost:5432/linkora
#   STELLAR_RPC_URL=https://soroban-testnet.stellar.org
#   CONTRACT_ID=<your contract address>

# 2. Start PostgreSQL
docker compose up -d postgres

# 3. Apply migrations (includes the FTS and tag migrations)
pnpm --filter @linkora/indexer migrate   # or: bash migrate.sh

# 4. Start the indexer in dev mode
pnpm --filter @linkora/indexer dev
# → Listening on http://localhost:3000

# 5. Run a search
curl "http://localhost:3000/api/search/posts?q=stellar+defi"
curl "http://localhost:3000/api/search/posts?tag=stellar"
```

---

## API reference

### `GET /api/search/posts`

Search posts by free-text query or hashtag.

#### Query parameters

| Parameter | Type    | Required | Default | Constraints  | Description                                                                                                                                                                                 |
| --------- | ------- | -------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `q`       | string  | *        | —       | min length 1 | Free-text search query. Terms are prefix-matched and ANDed together (`hello world` → posts containing both "hello" and "world"). Leading `#` triggers tag mode (equivalent to using `tag`). |
| `tag`     | string  | *        | —       | —            | Exact hashtag to filter by (case-insensitive). Do not include the `#` prefix.                                                                                                               |
| `limit`   | integer | no       | `20`    | 1 – 100      | Maximum posts to return.                                                                                                                                                                    |
| `offset`  | integer | no       | `0`     | ≥ 0          | Number of posts to skip; use for pagination.                                                                                                                                                |

\* At least one of `q` or `tag` must be provided. Supplying neither returns `400`.

#### Response — `200 OK`

```json
{
  "posts": [
    {
      "id": "42",
      "author": "GABC...XYZ",
      "content": "Stellar DeFi is live on Linkora!",
      "tags": ["stellar", "defi"],
      "deleted": false,
      "tip_total": "0",
      "like_count": "3",
      "created_ledger": 1718000000,
      "deleted_ledger": null
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0,
  "has_more": false
}
```

| Field      | Type    | Description                                                            |
| ---------- | ------- | ---------------------------------------------------------------------- |
| `posts`    | array   | Matching posts, ordered by relevance then recency (see Ranking below). |
| `total`    | integer | Total matching posts (before pagination).                              |
| `limit`    | integer | The `limit` value in effect for this request.                          |
| `offset`   | integer | The `offset` value in effect for this request.                         |
| `has_more` | boolean | `true` when `offset + posts.length < total`.                           |

Each post object:

| Field            | Type            | Description                                                       |
| ---------------- | --------------- | ----------------------------------------------------------------- |
| `id`             | string          | Numeric post ID serialised as a string (safe for large integers). |
| `author`         | string          | Stellar address of the post author.                               |
| `content`        | string \| null  | Post body text.                                                   |
| `tags`           | string[]        | Lowercase hashtags extracted from the post at index time.         |
| `deleted`        | boolean         | `true` if the post has been soft-deleted on-chain.                |
| `tip_total`      | string          | Cumulative tips in stroops, serialised as a string.               |
| `like_count`     | string          | Total likes, serialised as a string.                              |
| `created_ledger` | integer         | Unix timestamp (seconds) of the post creation ledger.             |
| `deleted_ledger` | integer \| null | Unix timestamp of the deletion ledger, or `null`.                 |

#### Error responses

| Status | `error.code`       | When                                                                                   |
| ------ | ------------------ | -------------------------------------------------------------------------------------- |
| `400`  | `VALIDATION_ERROR` | Neither `q` nor `tag` supplied; `q` is empty; `limit` out of range; `offset` negative. |
| `500`  | `INTERNAL_ERROR`   | Unexpected database error.                                                             |

Error body shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "q or tag is required",
    "requestId": "abc-123"
  }
}
```

#### Pagination example

```bash
# Page 1
curl "http://localhost:3000/api/search/posts?q=linkora&limit=10&offset=0"

# Page 2
curl "http://localhost:3000/api/search/posts?q=linkora&limit=10&offset=10"
```

---

## Ranking

Results are ordered differently depending on the search mode.

### Free-text search (`q`)

Results are ordered by `ts_rank DESC, created_at DESC`.

`ts_rank` is PostgreSQL's built-in ranking function. It scores each row by how
often the query terms appear in the `tsvector`, weighted by term position
(title-weight terms score higher than body-weight terms). Equal-rank posts are
broken by recency so newer content surfaces first.

The query terms are prefix-matched: every word in `q` becomes `word:*` in the
underlying `tsquery`, so partial terms work (e.g. `"defi"` matches `"DeFi"`,
`"defiance"`, etc.).

```
ORDER BY ts_rank(content_tsv, to_tsquery('english', $tsQuery)) DESC,
         created_at DESC
```

### Tag search (`tag` or `q` starting with `#`)

Tag lookups are exact matches against the `tags[]` array using `= ANY(tags)`.
Results are ordered by `created_at DESC` (newest first). `ts_rank` is not
computed because term frequency is not meaningful for tag equality checks.

### Post score (feed use-case)

The `post_scores` materialized view provides a composite score used by the
personalised feed — it is separate from the search ranking. Its formula is:

```
score = 100
      + (like_count × 5)
      + (tip_total / 1 000 000)   -- normalised from stroops to XLM scale
      - hours_since_creation       -- 1 point of recency decay per hour
```

The view is refreshed every 5 minutes by `ScoreRefreshService`
(`src/score-refresh.ts`). Search results do not currently incorporate this
score; they rely solely on `ts_rank` + recency. Blending `ts_rank` with the
engagement score is a planned improvement.

### Tuning notes

- The English text-search configuration performs stemming and drops common stop
  words. If Linkora expands to non-English content, additional
  `to_tsvector('<lang>', …)` columns and matching `to_tsquery('<lang>', …)`
  calls will be needed.
- Special characters in the raw query string are stripped before building the
  `tsquery` (replaced with spaces), so punctuation-heavy input degrades
  gracefully rather than throwing a PostgreSQL syntax error.
- GIN indexes are not updated synchronously with every write by default;
  PostgreSQL batches pending GIN inserts. For fresh posts to appear in search
  results immediately, this is fine — GIN inserts are typically flushed within
  the same transaction.
