# Linkora — System Architecture

This document describes the high-level component layout and data flows for
the Linkora SocialFi platform.

---

## Component overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Soroban Smart Contract  (packages/contracts)                   │
│  Profiles · Posts · Tips · Pools · Governance · Moderation      │
└───────────┬────────────────────────┬────────────────────────────┘
            │ contract calls (XDR)   │ events (Stellar RPC)
            ▼                        ▼
┌──────────────────────┐   ┌─────────────────────────────────────┐
│  SDK (packages/sdk)  │   │  Indexer (services/indexer)         │
│  LinkoraClient       │   │  PostgreSQL · full-text search API  │
│  TransactionQueue    │   └─────────────────────────────────────┘
└──────────┬───────────┘                   │  REST / WebSocket
           │                               ▼
           │              ┌────────────────────────────────────┐
           └─────────────►│  Web (apps/web) · Mobile (apps/mobile) │
                          │  Next.js 15 · Expo / React Native  │
                          └────────────────────────────────────┘
```

---

## Web application route tree

All routes live under `apps/web/src/app/` and follow the Next.js 15
App Router convention. Each entry below lists the file-system path,
the page component it renders, and a short description of its
responsibility.

### Core feed & discovery

| Route | Component file | Responsibility |
|---|---|---|
| `/feed` | `app/feed/page.tsx` | Main home feed. Renders the Explore and Following tabs, real-time WebSocket indicator, infinite-scroll pagination, and the tipping modal. Uses `FeedFilters`, `FeedInfiniteScroll`, and `FeedSkeleton` from `components/feed/`. |
| `/explore` | `app/explore/page.tsx` | Discover page. Surfaces trending posts, suggested creators, and tag-based exploration. |
| `/search` | `app/search/page.tsx` → `SearchPageClient.tsx` | Full-text post and profile search backed by the indexer `/api/search` endpoint. |
| `/posts/[id]` | `app/posts/[id]/page.tsx` | Single-post detail page with threaded replies and inline tipping. |

### Profiles

| Route | Component file | Responsibility |
|---|---|---|
| `/profile/[address]` | `app/profile/[address]/page.tsx` | Public profile page. Shows avatar, bio, creator token panel (`CreatorTokenPanel`), follower/following counts, and the author's post grid. |
| `/profile/[address]/followers` | `app/profile/[address]/followers/page.tsx` | Paginated list of accounts that follow this profile. |
| `/profile/[address]/following` | `app/profile/[address]/following/page.tsx` | Paginated list of accounts this profile follows. |
| `/profile/edit` | `app/profile/edit/page.tsx` | Authenticated form to update display name, bio, and avatar. Writes to the contract via `buildSignAndSubmit`. |

### Governance UI

The governance section surfaces on-chain protocol proposals and lets
token-holders cast votes or submit new parameter-change proposals.

| Route | Component file | Responsibility |
|---|---|---|
| `/governance` | `app/governance/page.tsx` | Proposal list page. Tabs for **Active**, **Passed**, **Executed**, and **History**. Paginated at 10 proposals per page. Reads `GovProposal` objects from the contract via `LinkoraClient`. Connected wallet holders can also submit a new proposal from an inline form on this page. |
| `/governance/new` | *(planned — inline form on `/governance` page)* | Separate creation page for new on-chain governance proposals. Will accept a `GovParameter` selector and a target value. Extracted from the inline form in `app/governance/page.tsx`. |
| `/governance/[id]` | *(planned)* | Detail view for a single proposal. Shows full description, current vote tallies, quorum progress bar, and a **Vote** action button for eligible token holders. |

**Key components:**

- `app/governance/page.tsx` — uses `LinkoraClient` (from `linkora-sdk`) to call `get_proposal`, `cast_vote`, and `create_proposal` contract functions.
- `GovParameter`, `GovProposal`, `GovStatus` — type re-exports from `packages/sdk/src/`.

### Creator dashboard

The creator section gives authors visibility into earnings, audience
growth, and their deployed creator token.

| Route | Component file | Responsibility |
|---|---|---|
| `/creator` | *(planned)* | Creator hub landing page. Entry point for earnings, audience, and token management. |
| `/creator/earnings` | *(planned)* | Displays cumulative tip income and pool distributions. Pulls data from the indexer analytics endpoints. |
| `/creator/audience` | *(planned)* | Follower growth chart, top followers by tip volume, and audience breakdown. Backed by the analytics-oracle service. |
| `/creator/tokens` | *(planned)* | Creator token management. Shows supply, holders, and provides a direct link to the token-launch wizard at `/onboarding/creator`. |
| `/onboarding/creator` | `app/onboarding/creator/page.tsx` → `CreatorTokenWizard.tsx` | Multi-step SEP-41 creator token deployment wizard (`StepTokenDetails` → `StepReviewFees` → `StepDeploy` → `StepSuccess`). |

**Key components:**

- `components/profile/CreatorTokenPanel.tsx` — inline panel shown on the public profile page with token price and holder count.
- `app/onboarding/creator/CreatorTokenWizard.tsx` — orchestrates the four deployment steps.

### Pools & DeFi

| Route | Component file | Responsibility |
|---|---|---|
| `/pools` | `app/pools/page.tsx` | Community pool list with deposit / withdrawal summaries and pool health badges. |
| `/pools/new` | `app/pools/new/page.tsx` | Pool creation form. Configures threshold, token, admins, and description before deploying via the contract. |
| `/pools/[id]` | `app/pools/[id]/page.tsx` | Pool detail page. Deposit and withdrawal tabs, admin list, transaction status banner, and on-chain analytics link. |
| `/pools/[id]/analytics` | `app/pools/[id]/analytics/page.tsx` | Historical deposit / withdrawal chart for a single pool. |

### Direct messages

| Route | Component file | Responsibility |
|---|---|---|
| `/dm` | `app/dm/page.tsx` | Conversation inbox. Lists all DM threads for the connected address, ordered by last activity. |
| `/dm/[address]` | `app/dm/[address]/page.tsx` | End-to-end encrypted message thread. Uses the `dm-relay` service and the ECDH key pair stored in `DmKeySection`. |

### Analytics

| Route | Component file | Responsibility |
|---|---|---|
| `/analytics` | `app/analytics/page.tsx` | Platform-wide analytics dashboard. Post volume, tip totals, active wallets, and top creators. Reads from the analytics-oracle service. |

### Settings & onboarding

| Route | Component file | Responsibility |
|---|---|---|
| `/settings` | `app/settings/page.tsx` | User settings page. Hosts `ProfileSection`, `WalletSection`, `NotificationsSection`, `DmKeySection`, `GovernanceSection`, `BlockListSection`, and `DangerZoneSection`. |
| `/onboarding` | `app/onboarding/page.tsx` | Onboarding entry point. Wrapped by `OnboardingGuard`; redirects to the `OnboardingWizard` flow for new users. |
| `/notifications` | `app/notifications/page.tsx` | Notification centre. Lists follow, tip, and governance events. Backed by `useNotifications` and the indexer's `sent_notifications` table. |
| `/dashboard` | `app/dashboard/page.tsx` | Creator / admin dashboard. Shows `DashboardHeader`, `LeftSidebar`, `DashboardPostGrid`, and `RightSidebar`. |

---

## Service layer

| Service | Directory | Description |
|---|---|---|
| Indexer | `services/indexer/` | Ingests Stellar contract events, writes to PostgreSQL, exposes a REST + WebSocket API. Migration numbering: `001`–`015` currently applied; `016`–`019` planned. |
| DM Relay | `services/dm-relay/` | Stores and forwards E2EE direct messages. Validates sender keys on arrival; recipients poll or subscribe via WebSocket. |
| Analytics Oracle | `services/analytics-oracle/` | Aggregates on-chain events into time-series metrics. Feeds the `/analytics` page and the `creator/earnings` and `creator/audience` routes. |

---

## Data flow summary

```
Browser / Mobile
  │
  ├─► Next.js API Routes (/api/*)    ← server-side proxies for indexer
  │
  ├─► Indexer REST / WS              ← off-chain post, profile, follow data
  │
  ├─► DM Relay WebSocket             ← encrypted message delivery
  │
  └─► Soroban RPC (via SDK)          ← on-chain writes (posts, tips, votes,
                                        pool actions, token deploys)
```
