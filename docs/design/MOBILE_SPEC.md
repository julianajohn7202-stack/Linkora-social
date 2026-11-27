# Linkora Mobile UI Specification

This document is the canonical reference for screen inventory, component usage, data sources, and accessibility requirements for the Linkora mobile app (`apps/mobile`). It covers the Expo / React Native implementation using Expo Router file-based navigation.

---

## Screen Inventory

| Screen                   | Route                          | Tab / Stack   | Status     |
| ------------------------ | ------------------------------ | ------------- | ---------- |
| Feed                     | `/(tabs)/feed`                 | Tab           | ✅ Live    |
| Explore (Search)         | `/(tabs)/explore`              | Tab           | ✅ Live    |
| Pools List               | `/(tabs)/pools`                | Tab           | ✅ Live    |
| Mini Apps                | `/(tabs)/mini-apps`            | Tab           | ✅ Live    |
| Profile (own)            | `/(tabs)/profile`              | Tab           | ✅ Live    |
| Connect Wallet           | `/connect`                     | Stack (modal) | ✅ Live    |
| Post Detail              | `/post/[id]`                   | Stack         | ✅ Live    |
| Profile Detail           | `/profile/[address]`           | Stack         | ✅ Live    |
| Followers List           | `/profile/followers`           | Stack         | ✅ Live    |
| Following List           | `/profile/following`           | Stack         | ✅ Live    |
| Edit Profile             | `/profile/edit`                | Stack         | ✅ Live    |
| Pool Detail              | `/pool/[id]`                   | Stack         | ✅ Live    |
| DM Conversation          | `/dm/[address]`                | Stack         | ✅ Live    |
| Mini App Viewer          | `/mini-app/[id]`               | Stack         | ✅ Live    |
| Mini App Create Post     | `/mini-app/create-post`        | Stack         | ✅ Live    |
| Settings                 | `/settings`                    | Stack         | ✅ Live    |
| Blocked Users            | `/settings/blocked`            | Stack         | ✅ Live    |
| **Notifications**        | `/notifications`               | Stack         | 🔧 Scaffolded |
| **Search** (deep-linked) | `/search`                      | Stack         | 🔧 Scaffolded |
| **Governance**           | `/governance`                  | Stack         | 🔧 Scaffolded |

---

## New Screens

### Notifications

**Route:** `/notifications`  
**Stack entry:** Pushed from any screen via deep link (`linkora://notifications`) or header bell icon.

#### Purpose

Aggregates all activity notifications for the authenticated user: new followers, likes on posts, tips received, pool deposits, governance proposal updates, and moderation actions.

#### Components Used

| Component            | Purpose                                                                 |
| -------------------- | ----------------------------------------------------------------------- |
| `FlatList`           | Virtualized list of notification items                                  |
| `NotificationItem`   | Row component: icon + title + timestamp + unread indicator (to be built)|
| `EmptyState`         | Shown when there are no notifications yet                               |
| `ErrorState`         | Shown when the notification feed fails to load                          |
| `ActivityIndicator`  | Initial load spinner                                                    |
| `RefreshControl`     | Pull-to-refresh                                                         |
| `TxToast`            | Confirms read/dismiss actions                                           |

#### Data Sources

| Data                    | Source                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Notification feed       | `services/indexer` REST API — `GET /notifications?address={addr}`  |
| Unread count badge      | WebSocket subscription via `LinkoraEventSubscriber` (SDK)          |
| Follow events           | `FollowEvent` from contract event stream                            |
| Tip events              | `TipEvent` from contract event stream                              |
| Governance events       | `GovProposalCreatedEvent`, `GovVoteEvent`, `GovProposalExecutedEvent` |
| Push delivery           | `notifications/registerForPushNotifications.ts` (Expo Push)        |

#### Accessibility Requirements

- Each notification row must have `accessibilityRole="button"` if tappable, `accessibilityLabel` including sender name and action (e.g. `"alice followed you, 5 minutes ago"`).
- Unread indicator dot must expose state via `accessibilityLabel="Unread notification"`.
- The screen title must be announced when navigated to: `accessibilityLabel="Notifications"`.
- Pull-to-refresh must be keyboard-accessible on iOS (VoiceOver swipe gesture).
- Minimum tap target: 44 × 44 pt per Apple HIG / Android 48 dp.

---

### Search

**Route:** `/search` (deep-linked standalone screen) and `/(tabs)/explore` (tab version)  
**Stack entry:** Pushed via `linkora://search?q=<query>` deep link or search icon in header.

#### Purpose

Provides full-text search across creator profiles and community pools. The tab version (`/(tabs)/explore`) is the primary entry point; the standalone `/search` route supports deep-linked pre-populated queries.

#### Components Used

| Component           | Purpose                                                         |
| ------------------- | --------------------------------------------------------------- |
| `SearchBar`         | Controlled text input with debounce (300 ms)                   |
| `ProfileRow`        | Single profile result row with address, username, bio          |
| `PoolRow`           | Single pool result row with name, token, balance, member count |
| `ProfileCardSkeleton` | Loading placeholder for profile results                      |
| `PoolCardSkeleton`  | Loading placeholder for pool results                           |
| `EmptyState`        | "No results" and "Enter a query" states                        |
| `ErrorState`        | Search failure with retry                                      |
| `ScrollView`        | Result list container with `RefreshControl`                    |

#### Data Sources

| Data               | Source                                                                        |
| ------------------ | ----------------------------------------------------------------------------- |
| Profile search     | `services/indexer` REST API — `GET /profiles/search?q=<query>`               |
| Pool search        | `services/indexer` REST API — `GET /pools/search?q=<query>`                  |
| Profile data       | `LinkoraClient.getProfile(address)` (on tap for detail navigation)           |
| Pool data          | `LinkoraClient.getPool(poolId)` (on tap for detail navigation)               |

#### Accessibility Requirements

- `SearchBar` must have `accessibilityLabel="Search Linkora"` and `accessibilityHint="Search for creators and pools"`.
- Result counts must be announced after each search: `accessibilityLiveRegion="polite"` on the result summary text.
- Section headings ("Profiles", "Pools") must use `accessibilityRole="header"`.
- Each `ProfileRow` and `PoolRow` must have a meaningful `accessibilityLabel` (e.g. `"maya, Creator economy researcher"`).
- "Clear search" button must have `accessibilityRole="button"` and `accessibilityLabel="Clear search query"`.
- Minimum tap target: 44 × 44 pt.

---

### Governance

**Route:** `/governance`  
**Stack entry:** Pushed from the Profile screen settings panel, or via deep link `linkora://governance`.

#### Purpose

Allows users to view active and past governance proposals, cast votes (support / oppose), and inspect proposal details including current tally, quorum status, and execution state.

#### Components Used

| Component              | Purpose                                                                 |
| ---------------------- | ----------------------------------------------------------------------- |
| `FlatList`             | Virtualized list of proposals                                           |
| `ProposalCard`         | Summary card: title, parameter changed, status badge, vote counts (to be built) |
| `ProposalDetailSheet`  | Bottom sheet with full description, current tally, vote CTA (to be built) |
| `Badge`                | Status pill: `Active` / `Passed` / `Rejected` / `Vetoed` / `Executed`  |
| `EmptyState`           | Shown when no proposals exist yet                                       |
| `ErrorState`           | Shown on fetch failure                                                  |
| `ActivityIndicator`    | Initial load spinner                                                    |
| `RefreshControl`       | Pull-to-refresh                                                         |
| `TxToast`              | Confirms vote submission                                                |

#### Data Sources

| Data                     | Source                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------ |
| Proposal list            | `LinkoraClient.govGetProposal(proposalId)` — paginated by incrementing IDs          |
| Governance config        | `LinkoraClient.govGetConfig()` (quorum, voting period, time-lock)                   |
| Vote submission          | `LinkoraClient.prepareGovVoteTx(voter, proposalId, support)` → wallet sign + submit |
| Effective quorum         | `LinkoraClient.effectiveQuorum(proposalId)`                                          |
| Proposal events          | `GovProposalCreatedEvent`, `GovVoteEvent`, `GovProposalExecutedEvent` (SDK events)  |
| Wallet address           | `useWallet()` hook                                                                   |
| Transaction submission   | `useSubmitTx()` hook                                                                 |

#### Accessibility Requirements

- Each `ProposalCard` must have `accessibilityRole="button"` if tappable, with `accessibilityLabel` including the proposal title and current status (e.g. `"Reduce fee to 100 bps, Active, 47% support"`).
- Status badge must include status text in the accessible label — do not rely on color alone to convey state.
- Vote buttons ("Support" / "Oppose") must have `accessibilityRole="button"` and `accessibilityHint="Double tap to cast your vote"`.
- Vote tallies must be conveyed as text (e.g. `"312 in support, 88 opposed"`) not only as a progress bar.
- After a vote is cast, focus must return to the proposal card and an announcement made: `accessibilityLiveRegion="assertive"` on the toast.
- Minimum tap target: 44 × 44 pt.

---

## Existing Tab Screens (Updated)

### Feed

**Route:** `/(tabs)/feed`  
**Components:** `PostCard`, `PostCardSkeleton`, `EmptyState`, `ErrorState`, `FlatList`, `RefreshControl`  
**Data sources:** `useFeed()` hook → SQLite local cache (`utils/db`) + `LinkoraClient` RPC sync  
**Accessibility:** Posts use `accessibilityRole="article"`. Like and tip buttons have `accessibilityLabel` with post content preview.

### Pools

**Route:** `/(tabs)/pools`  
**Components:** `PoolCard`, `PoolCardSkeleton`, `EmptyState`, `ScrollView`  
**Data sources:** `usePools()` hook → `LinkoraClient.getPool()`  
**Accessibility:** Each pool card has `accessibilityRole="button"` with label including pool name and balance.

### Mini Apps

**Route:** `/(tabs)/mini-apps`  
**Components:** `MiniAppIcon`, `FlatList` or grid  
**Data sources:** Local manifest registry (installed apps), `MiniAppManifest` schema  
**Accessibility:** Each app icon has `accessibilityRole="button"` and `accessibilityLabel` with app name and description.

### Profile (own)

**Route:** `/(tabs)/profile`  
**Components:** `ProfileHeader`, `EmptyState`, `ErrorState`  
**Data sources:** `useWallet()`, `useProfile(address)`, `useNetwork()`  
**Accessibility:** Address text is marked `accessibilityRole="text"` with `accessibilityLabel="Wallet address"`. Disconnect button has `accessibilityRole="button"`.

---

## Offline Behavior and Data Freshness

The root navigator displays **No internet connection** when NetInfo reports a disconnection. When the banner clears, remote services can still be unavailable or behind the chain. Cached posts, notifications, and DM history reflect the last successful sync. Reopen or refresh individual screens as described below.

| Screen | What opens offline | Refresh, writes, and retry |
| --- | --- | --- |
| Feed (`/(tabs)/feed`) | Previously loaded posts from the SQLite `cached_posts` table, including locally saved pending posts. An empty cache has no feed content to show. | Pull-to-refresh, retry, and pagination attempt indexer/IPFS sync. A failed sync leaves existing cached rows available. Likes and tips require their normal online submission flow. |
| Post Detail (`/post/[id]`) | A post already present in SQLite, including cached counts and text. An uncached ID shows “Post not found.” Copying a post link is local. | Opening the route reads SQLite. Refresh Feed online and reopen the post for updated cached data. Deleting a published post requires online submission. |
| New Post (`/post/new`) | With a connected wallet, the composer can save a submitted post to SQLite as a pending row and return to Feed. | A local success toast confirms the save. Chain submission and indexer confirmation require connectivity. The sync helper requires wallet/RPC options that the current composer and Feed call sites omit, so automatic publish or retry on reconnect is currently unavailable through those paths. |
| Explore (`/(tabs)/explore`) | The bundled profile and pool catalog is searchable offline. | Changing the query or pulling to refresh reruns the local filter. Catalog entries are fixtures. Open linked detail screens under their own availability rules. |
| Search (`/search`) | The shared search hook can serve an exact trimmed query from its in-memory cache for two minutes in the same app process. | A cache miss needs the search endpoint. The route expects recent-search and retry APIs that the shared hook currently lacks. Persisted recent searches and the route's retry control are unverified. |
| Pools List (`/(tabs)/pools`) | `usePools` loads bundled mock pools. | Retry reloads the same fixtures. |
| Pool Detail (`/pool/[id]`) | `usePool` loads bundled mock details for supported IDs. | Retry reloads fixtures. Real deposits and withdrawals require online transaction submission. |
| Pool Detail (`/pools/[id]`) | The screen renders a mock pool record and any updates held in the in-memory `poolStore`. | Live balance events require the configured WebSocket. Reopen the screen to retry the connection. |
| Pool Admins (`/pool/[id]/admins`) | The mock pool record exposes admins and proposals in memory. | Admin actions update the mock store for the current app process. Restarting clears those changes. |
| Profile (own) (`/(tabs)/profile`) | Local wallet and network metadata and the mock profile returned by `useProfile` are available when an address is present. | Retry repeats wallet and profile lookups. Live follower and following data require the indexer. |
| Profile Detail (`/profile/[address]`) | The mock profile and author posts already loaded from the SQLite feed cache can display. | Pull-to-refresh retries profile/social lookups and feed sync. Follow and unfollow require online submission. |
| Followers and Following (`/profile/followers`, `/profile/following`) | Lists are fetched from the indexer and held in screen memory. A fresh open offline may show a load error. | Retry, pull-to-refresh, and pagination request remote data. Retry after reconnecting. |
| Edit Profile (`/profile/edit`) | Form fields can be edited while the screen is open. | Saving requires an online wallet transaction. Retry the save after reconnecting. The form has no persisted draft or write queue. |
| Connect Wallet (`/connect`) | The screen can show locally restored wallet metadata. Disconnect clears the stored address locally. | New wallet access and live account checks depend on the wallet provider and RPC. Retry connection when service returns. |
| DM Conversation (`/dm/[address]`) | With a wallet and existing local keys, the thread can display SQLite messages. DM keys are held in SecureStore. The current screen uses the mock `DmService`. | Sends create SQLite outbox rows before attempting delivery. A rejected send is stored as failed. Reconnect reconciles incoming messages from the configured conversation source and reloads the thread. Failed sends have no automatic replay. |
| Mini Apps (`/(tabs)/mini-apps`) | Installed manifests load from SecureStore, with bundled defaults for a new install. | Uninstall updates the local registry offline. The registry contains metadata and entry URLs. |
| Mini App Viewer (`/mini-app/[id]`) | The native wrapper and installed manifest can open locally. | The WebView loads a remote entry URL. Use reload after reconnecting if the entry fails to load. |
| Mini App Create Post (`/mini-app/create-post`) | The form can collect text and resolve the running mini app's bridge request with a simulated post ID. | The result is scoped to the in-memory bridge. The screen performs no chain submission or persisted queue write. |
| Settings (`/settings`) | Network selection and custom RPC settings are stored on-device. | Save, reset, and switch settings locally. Using the selected RPC still requires a connection. |
| Blocked Users (`/settings/blocked`) | The screen can open, but the list requires the indexer and has no persistent offline copy. | Retry the fetch after reconnecting. Blocking and unblocking require online submission. |
| Notifications (`/notifications`) | The hook loads the SQLite notification list and unread count before attempting remote sync. | Reopen to retry the background fetch. Mark all read updates SQLite first and then attempts the remote update, with no queued retry. The route currently lacks a refresh control and the hook has no per-item mark-read handler. |
| Governance (`/governance`, `/governance/[id]`) | The governance screens render bundled proposal fixtures. | Retry reloads mock proposals. The vote hook simulates submission, so displayed votes do not verify writes to the chain. |
| Creator Dashboard (`/creator/dashboard`) | Previously loaded analytics may remain in screen memory during a failed refresh. | Opening without loaded metrics, pulling to refresh, and retrying require the indexer. Analytics are not persisted for offline reopening. |

### Reconnect Verification

1. On a connected device, load Feed and note a post ID and its visible counts. Open Notifications and an existing DM thread with local keys. Record which rows are already present before disconnecting.
2. Disable Wi-Fi and mobile data. Confirm the offline banner appears. Reopen the cached post and a known uncached ID. Confirm the cached post opens and the uncached ID shows the fallback. Pull to refresh Feed and confirm already displayed posts remain available after the request fails.
3. Reopen a cached DM thread and the Mini Apps list. Confirm local messages and manifests are available. Try an indexer-backed list and a remote mini app entry to exercise their offline failure paths.
4. With the wallet still connected, submit a regular post and confirm the pending item is visible in Feed. Treat the toast as confirmation of the local write. For any failed DM send, confirm the failed row remains visible.
5. Restore connectivity and confirm the banner clears. Pull to refresh Feed, reopen the post, retry the indexer-backed list, reload the WebView, and reopen Notifications. Compare results with known updates from the connected service. Allow time for the indexer to catch up before comparing chain-backed counts.
6. Keep the DM thread open across reconnect. With a shared relay source, send a message from a second client while the device is offline, then confirm it appears once after reconnect. With the bundled mock, verify reconciliation using a message seeded in the mock source. Check that a failed outbox entry is not automatically resent.
7. Check the locally saved Feed post separately from refreshed remote rows. On the current call sites, it can remain pending after reconnect. When testing a build with configured post sync, verify that the confirmed chain ID replaces the local entry once the indexer returns it.

---

## Navigation Structure

```
Root Stack (_layout.tsx)
├── (tabs)                    ← Bottom tab navigator (no header)
│   ├── feed                  Feed
│   ├── explore               Search / Explore
│   ├── pools                 Pools list
│   ├── mini-apps             Mini apps grid
│   └── profile               Own profile
├── connect                   Wallet connection (modal)
├── post/[id]                 Post detail
├── profile/[address]         Public profile detail
├── pool/[id]                 Pool detail
├── pools/[id]                Pool detail (alias)
├── dm/[address]              DM conversation
├── mini-app/[id]             Mini app WebView
├── mini-app/create-post      Post composition (from mini app)
├── settings                  App settings
├── settings/blocked          Blocked users list
├── notifications             ← New: notification feed
├── search                    ← New: standalone search
└── governance                ← New: governance proposals
```

---

## Global Accessibility Notes

- All interactive elements must meet WCAG 2.1 AA contrast ratio (4.5:1 for text, 3:1 for UI components) using design tokens from `docs/design/tokens.css`.
- Dark background `#0f172a` with primary text `#f8fafc` (contrast ratio ≈ 15:1 — passes AAA).
- Brand accent `#6366f1` on dark background — verify contrast for any text rendered in this color against its actual background.
- Touch targets must be at minimum 44 × 44 pt (iOS HIG) / 48 × 48 dp (Material Design).
- All `Image` components must include `accessibilityLabel` describing the image content.
- Use `accessibilityLiveRegion="polite"` for non-critical async updates (search results, follow counts). Use `"assertive"` only for errors and transaction confirmations.

## Physical-device verification

Run this walkthrough on one iPhone and one Android phone. Use Testnet, a
dedicated Stellar test account, and an indexer reachable from both phones over
HTTPS. Install a wallet that handles WalletConnect pairing URIs and supports
`stellar:testnet` and `stellar_signXDR`. Use a native development build to
exercise the app's registered `linkora` scheme and push capabilities.

| Device | Prerequisites |
| --- | --- |
| iPhone | macOS with Xcode, a trusted connected iPhone with Developer Mode enabled, and a signing team and provisioning profile for the installed build. Push delivery also requires a push-capable profile and APNs credentials. |
| Android | Android SDK and adb, a connected phone with USB debugging enabled, and the host authorized on the device. Use Android 13 or newer to check the runtime notification prompt. Push delivery also requires FCM configured for the build. |

For push-token verification, use an Expo project configured for push and both
platforms' credentials. The current [app config](../../apps/mobile/app.json)
supplies the app identifiers and scheme. The
[token registration implementation](../../apps/mobile/notifications/registerForPushNotifications.ts)
logs token acquisition errors, including missing project setup.

### Install and configure the build

From the repository root, install the workspace dependencies with
`pnpm install --frozen-lockfile`. In your local verification checkout, replace
the `env` and `projectId` declarations in
[`createWalletConnectAdapter`](../../apps/mobile/context/WalletContext.tsx)
with the following declaration for the device build. Expo inlines public
variables referenced directly through `process.env`, and the checked-in adapter
looks up the project ID indirectly. Keep this temporary edit local and record
it with your device results. [Expo environment variables](https://docs.expo.dev/guides/environment-variables/#how-to-read-from-environment-variables)

```ts
const projectId = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID;
```

In the shell that starts Expo, replace both placeholders with your Testnet
configuration. Use the indexer's device-reachable URL because `localhost`
on a phone refers to the phone.

```bash
export EXPO_PUBLIC_INDEXER_URL='https://YOUR-TEST-INDEXER.example'
export EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID='YOUR_TEST_WALLETCONNECT_PROJECT_ID'

# iPhone, from macOS. Select the attached phone.
pnpm --filter @linkora/mobile ios --device

# Android, from a host with the Android SDK. Select the attached phone.
pnpm --filter @linkora/mobile android --device
```

The commands build and install the app and start Metro. For a later session,
start Metro with `pnpm --filter @linkora/mobile dev` using the same environment
and open the installed app. Use a device that can reach Metro from the chosen
host connection. Confirm the app opens to its tabs and select Testnet in
Settings.

### Verify wallet handoff and permissions

1. Open [Connect Wallet](../../apps/mobile/app/connect.tsx), select
   **Connect WalletConnect**, and approve pairing in the installed wallet.
   Return to Linkora manually if the wallet leaves it in the background.
   Expect the shortened Testnet address and WalletConnect provider to appear.
   Disconnect and repeat with pairing rejected. Expect an error and no
   connected address.
2. Start with notification permission undecided and approve wallet pairing.
   Expect the OS permission prompt where the platform allows it. Grant
   permission. On Android, verify the app creates its default notification
   channel. With push credentials configured, expect an Expo token and a
   `POST /api/notifications/register` request with the test address and device
   platform.
3. Repeat with a fresh permission state or revoke access in system settings
   and reconnect. When permission is denied, expect the wallet to remain
   connected and no new push token registration. If delivery is in scope,
   send a test notification using the configured test backend and check that
   tapping it opens the expected screen via the
   [notification handler](../../apps/mobile/notifications/notificationHandler.ts).

### Verify deep links

Replace `TEST_POST_ID` with a known post ID in the test data and open
`linkora://post/TEST_POST_ID` on each phone. On iOS, tap a link from Notes or
another app. On Android, dispatch it from the connected host using
`adb shell am start -a android.intent.action.VIEW -d 'linkora://post/TEST_POST_ID' social.linkora.app`.
Try once with Linkora closed and once with it already running. Expect both
opens to land on the matching post screen. Use the same procedure with
`linkora://profile/TEST_STELLAR_ADDRESS` and a valid Stellar public key. A
malformed address should be rejected by the
[deep-link parser](../../apps/mobile/utils/deepLinks.ts).

Run the HTTPS variant `https://linkora.social/post/TEST_POST_ID` only with a
build and domain association configured for the device. The app declares an
iOS associated domain and needs a matching website association for the signing
team and bundle ID. Android HTTPS app links are unconfigured in the current
app config. Record the OS version, wallet app, permission outcome, and
cold/warm link results for each device.
