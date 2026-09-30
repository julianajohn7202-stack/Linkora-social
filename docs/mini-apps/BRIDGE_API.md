# Linkora Mini App Bridge API

The Bridge is the communication layer between a mini app (running in an isolated WebView) and the Linkora host application. All bridge calls are gated by permissions declared in the mini app manifest.

---

## Permissions Reference

Mini apps must declare every permission they require in the `permissions` array of their `linkora-manifest.json`. Undeclared permissions are rejected at call time with a `PermissionDenied` error — the host never prompts the user for a permission that was not declared in the manifest.

### Permission Table

| Permission               | Capability Granted                                                                   | User Consent Prompt                                            | Explicit Approval Required |
| ------------------------ | ------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------- |
| `wallet.getAddress`      | Read the connected Stellar account address                                           | None — silent read, no prompt shown                            | No                         |
| `wallet.sign`            | Sign arbitrary data with the connected wallet key                                    | "Allow **\<app name\>** to sign data with your wallet?"        | **Yes**                    |
| `wallet.signTransaction` | Sign and submit a Stellar/Soroban transaction XDR                                    | "Allow **\<app name\>** to sign and submit a transaction?"     | **Yes**                    |
| `profile.read`           | Read the authenticated user's public profile (address, username, creator token flag) | None — silent read, no prompt shown                            | No                         |
| `profile.update`         | Write changes to the authenticated user's profile                                    | "Allow **\<app name\>** to update your Linkora profile?"       | **Yes**                    |
| `post.create`            | Open a native post-creation sheet pre-filled with app-provided content               | Post confirmation sheet is shown; user may edit before posting | **Yes** (via sheet)        |

> **Note on `profile.read` vs `profile.get`:** Internally the bridge maps the `profile.get` method call to the `profile.read` permission check. Declare `profile.read` in your manifest; call `bridge.profile.get()` in your code.

---

## Permissions Requiring Explicit User Approval

The following permissions trigger a native approval sheet in the host app before the call is executed. The user must actively confirm or cancel each request; there is no way to suppress this prompt.

- `wallet.sign`
- `wallet.signTransaction`
- `profile.update`
- `post.create` — approval is embedded in the post confirmation sheet

If the user rejects the prompt, the bridge rejects the promise with a `BridgeError` whose `code` is `"UserRejected"`.

---

## Error Codes

| Code                | Meaning                                                               |
| ------------------- | --------------------------------------------------------------------- |
| `PermissionDenied`  | The method was called without the required permission in the manifest |
| `UserRejected`      | The user dismissed or cancelled the approval sheet                    |
| `MethodUnavailable` | No handler is registered for the requested method                     |

---

## Example Manifests

### Tip Jar — wallet signing only

A mini app that reads the user's address and signs a tipping transaction needs only the two wallet permissions.

```json
{
  "name": "Tip Jar",
  "version": "1.0.0",
  "description": "Tip any Linkora post with XLM using your connected wallet.",
  "entry": "index.html",
  "permissions": ["wallet.getAddress", "wallet.signTransaction"],
  "minSdkVersion": "1.0.0"
}
```

### Creator Token — profile + wallet

A mini app that displays the creator's profile and lets the user pay with a creator token.

```json
{
  "name": "Creator Token",
  "version": "1.0.0",
  "description": "View a creator token balance and tip with the creator token.",
  "entry": "index.html",
  "permissions": ["profile.read", "wallet.getAddress", "wallet.signTransaction"],
  "minSdkVersion": "1.0.0"
}
```

### Social Poster — post creation

A mini app that composes and submits posts on behalf of the user.

```json
{
  "name": "Social Poster",
  "version": "1.0.0",
  "description": "Compose and schedule Linkora posts from a third-party tool.",
  "entry": "index.html",
  "permissions": ["profile.read", "post.create"],
  "minSdkVersion": "1.0.0"
}
```

### Full Access — all permissions

A mini app that uses every available bridge capability.

```json
{
  "name": "Full Access App",
  "version": "1.0.0",
  "description": "Demonstrates every bridge permission.",
  "entry": "index.html",
  "permissions": [
    "wallet.getAddress",
    "wallet.sign",
    "wallet.signTransaction",
    "profile.read",
    "profile.update",
    "post.create"
  ],
  "minSdkVersion": "1.0.0"
}
```

---

## Bridge Call Flow

```
Mini app calls bridge.wallet.signTransaction(xdr)
         │
         ▼
Host checks: is "wallet.signTransaction" in manifest.permissions?
         │ No  → throw BridgeError("PermissionDenied")
         │ Yes ↓
         ▼
Host presents native approval sheet to user
         │ Rejected → throw BridgeError("UserRejected")
         │ Approved ↓
         ▼
Host signs XDR and returns { signedXdr }
         │
         ▼
Mini app receives signed XDR string
```

---

## TypeScript Types

The bridge permission type is exported from `apps/mobile/mini-apps/permissions.ts`:

```ts
export type BridgePermission =
  | "wallet.getAddress"
  | "wallet.sign"
  | "wallet.signTransaction"
  | "profile.get"
  | "profile.read"
  | "profile.update"
  | "post.create";

export type BridgeErrorCode = "PermissionDenied" | "UserRejected" | "MethodUnavailable";
```

---

## Related

- [Mini Apps Developer Guide](./DEVELOPER_GUIDE.md) — how to build and submit a mini app
- [Manifest Schema](./manifest.schema.json) — JSON Schema for `linkora-manifest.json`
