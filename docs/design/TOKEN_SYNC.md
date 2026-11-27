# Design Token Synchronization

This document describes how design tokens flow from the single source of truth
into every consumer platform and what to do when a token value needs to change.

---

## Token sources and consumers

All token definitions originate in two files and are consumed by three
platforms:

| File                      | Format                                  | Consumers                    |
| ------------------------- | --------------------------------------- | ---------------------------- |
| `docs/design/tokens.json` | W3C Design Tokens Community Group JSON  | Build scripts, documentation |
| `docs/design/tokens.css`  | CSS custom properties                   | Web app (`apps/web`)         |
| _(generated)_             | React Native / Expo `StyleSheet` values | Mobile app (`apps/mobile`)   |

### Dependency map

```
docs/design/tokens.json          ← single source of truth
        │
        ├── docs/design/tokens.css
        │       └── apps/web/src/app/globals.css  (imports token values)
        │
        └── apps/mobile/src/theme/tokens.ts       (mirrors token values)
```

`tokens.json` is the authoritative file. `tokens.css` and the mobile theme file
must stay in sync with it. Never edit a consumer file without first updating
`tokens.json`.

---

## How to make a semantic token change

The example below changes `--color-primary` from `#7C3AED` (purple) to
`#6366F1` (indigo) to illustrate which files are affected.

### Step 1 — Update `tokens.json`

```json
// docs/design/tokens.json  (before)
"primary": {
  "$value": "#7C3AED",
  "$type": "color"
}

// docs/design/tokens.json  (after)
"primary": {
  "$value": "#6366F1",
  "$type": "color"
}
```

### Step 2 — Update `tokens.css`

```css
/* docs/design/tokens.css  (before) */
--color-primary: #7c3aed;

/* docs/design/tokens.css  (after) */
--color-primary: #6366f1;
```

### Step 3 — Update the web global stylesheet

```css
/* apps/web/src/app/globals.css  (before) */
--color-primary: #7c3aed;

/* apps/web/src/app/globals.css  (after) */
--color-primary: #6366f1;
```

### Step 4 — Update the mobile theme file

```ts
// apps/mobile/src/theme/tokens.ts  (before)
export const colorPrimary = "#7C3AED";

// apps/mobile/src/theme/tokens.ts  (after)
export const colorPrimary = "#6366F1";
```

### Files expected to change for this example

| File                              | Change                       |
| --------------------------------- | ---------------------------- |
| `docs/design/tokens.json`         | `color.brand.primary.$value` |
| `docs/design/tokens.css`          | `--color-primary`            |
| `apps/web/src/app/globals.css`    | `--color-primary`            |
| `apps/mobile/src/theme/tokens.ts` | `colorPrimary`               |

A PR that changes a token value should touch all four files. Reviewers should
reject any token PR that updates fewer than the full set.

---

## Verification

After updating the token, verify rendering in both light and dark mode on both
clients.

### Web — light and dark

1. Start the web dev server: `cd apps/web && pnpm dev`
2. Open `http://localhost:3000` in a browser.
3. **Light mode** — confirm the primary action elements (buttons, links, active
   nav items) render in the new colour without contrast degradation.
4. **Dark mode** — set `data-theme="dark"` on `<html>` (browser DevTools or the
   in-app toggle) and repeat the check. Dark mode overrides only surface and
   text tokens; brand tokens like `--color-primary` apply unchanged, so verify
   the new value still meets WCAG AA (4.5:1) contrast against
   `--color-bg: #0D0D12`.

```bash
# Quick contrast check in the browser console (light mode)
# Expected: ratio >= 4.5
getComputedStyle(document.documentElement).getPropertyValue('--color-primary');
```

### Mobile — light and dark

1. Start the Expo dev server: `cd apps/mobile && pnpm start`
2. Open the app in the Expo Go client or a simulator.
3. **Light mode** — navigate to any screen that renders a primary button or
   active tab indicator and confirm the new colour.
4. **Dark mode** — toggle the device appearance to dark and repeat. The mobile
   theme applies `colorPrimary` directly; confirm it is visible against the dark
   surface (`#0F172A`).

---

## Keeping consumers in sync

Design and development can diverge when token definitions are updated
independently. To prevent this:

- Treat `tokens.json` as the gating file. No consumer update is valid without a
  corresponding change there.
- In Figma, map each token to its matching variable. When a Figma variable
  changes, open an issue to propagate the change to all files listed above.
- If a token is added (not just changed), add it to all four files and document
  it in the [Design tokens table in README.md](./README.md#design-tokens).
- If a token is removed, grep the codebase for its CSS variable name and mobile
  constant before deleting it:

  ```bash
  grep -r "color-primary" apps/ --include="*.css" --include="*.ts" --include="*.tsx"
  ```

---

_Last updated by issue #556 — design token synchronization documentation._
