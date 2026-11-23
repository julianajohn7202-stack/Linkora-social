/**
 * Linkora Mini App Host Bridge
 *
 * Exposes a typed SDK surface to mini apps running inside the host.
 * Each namespace is gated by a permission declared in the mini app manifest.
 */

export type MiniAppManifest = {
  permissions: string[];
};

/** Thrown when the user rejects a signing request. */
export class UserRejectedError extends Error {
  readonly code = "USER_REJECTED" as const;
  constructor() {
    super("User rejected the signing request");
    this.name = "UserRejectedError";
  }
}

export type BridgeOptions = {
  manifest: MiniAppManifest;

  // --- post ---
  /** Called by the host to present the post confirmation sheet. */
  onPostCreate: (content: string) => Promise<{ confirmed: boolean; content: string }>;
  /** Called after user confirms — submits the post to the contract. */
  submitPost: (content: string) => Promise<{ postId: number }>;

  // --- wallet ---
  /** Returns the currently connected Stellar address. */
  getAddress: () => string;
  /** Called by the host to present the signing confirmation sheet. */
  onSignTransaction: (xdr: string) => Promise<{ confirmed: boolean }>;
  /** Called after user approves — signs and returns the signed XDR. */
  signTransaction: (xdr: string) => Promise<{ signedXdr: string }>;
};

function requirePermission(manifest: MiniAppManifest, permission: string): void {
  if (!manifest.permissions.includes(permission)) {
    throw new Error(`Mini app does not have the '${permission}' permission`);
  }
}

export function createBridge(options: BridgeOptions) {
  const { manifest, onPostCreate, submitPost, getAddress, onSignTransaction, signTransaction } =
    options;

  return {
    post: {
      /**
       * Opens a native confirmation sheet pre-filled with `content`.
       * The user may edit the content before confirming.
       * @returns the new post ID on success, or null if the user cancelled.
       */
      async create(content: string): Promise<number | null> {
        requirePermission(manifest, "post.create");

        const { confirmed, content: finalContent } = await onPostCreate(content);
        if (!confirmed) return null;

        const { postId } = await submitPost(finalContent);
        return postId;
      },
    },

    wallet: {
      /** Returns the connected Stellar address. Requires no special permission. */
      getAddress(): string {
        return getAddress();
      },

      /**
       * Shows a native confirmation sheet for the given XDR transaction.
       * @returns the signed XDR string on approval.
       * @throws {UserRejectedError} if the user rejects.
       */
      async signTransaction(xdr: string): Promise<string> {
        requirePermission(manifest, "wallet.sign");

        const { confirmed } = await onSignTransaction(xdr);
        if (!confirmed) throw new UserRejectedError();

        const { signedXdr } = await signTransaction(xdr);
        return signedXdr;
      },
    },
  };
}

export type LinkoraSDK = ReturnType<typeof createBridge>;
import { assertPermission, BridgeError, BridgePermission } from "./permissions";
import { getWalletAddress, getItem, StorageKey } from "../utils/secureStorage";

type BridgeHandler = (payload?: unknown) => Promise<unknown> | unknown;

export interface MiniAppBridgeOptions {
  permissions: BridgePermission[];
  requestUserApproval?: (method: BridgePermission) => Promise<boolean> | boolean;
  handlers?: Partial<Record<BridgePermission, BridgeHandler>>;
}

const SUPPORTED_METHODS = new Set<string>([
  "wallet.getAddress",
  "wallet.sign",
  "wallet.signTransaction",
  "profile.get",
  "profile.update",
  "post.create",
]);

async function requireWalletAddress(): Promise<string> {
  const address = await getWalletAddress();
  if (!address) throw new BridgeError("MethodUnavailable", "No wallet is connected");
  return address;
}

const DEFAULT_HANDLERS: Partial<Record<BridgePermission, BridgeHandler>> = {
  "wallet.getAddress": requireWalletAddress,
  "profile.get": async () => {
    const address = await requireWalletAddress();
    const creatorToken = await getItem<string>(StorageKey.AuthToken).catch(() => null);
    return { address, username: null, creatorToken };
  },
};

const APPROVAL_REQUIRED = new Set<BridgePermission>([
  "wallet.sign",
  "wallet.signTransaction",
  "profile.update",
]);

export function createMiniAppBridge({
  permissions,
  requestUserApproval,
  handlers = {},
}: MiniAppBridgeOptions) {
  const methodHandlers = { ...DEFAULT_HANDLERS, ...handlers };

  return {
    async call(method: string, payload?: unknown) {
      if (!SUPPORTED_METHODS.has(method)) {
        throw new BridgeError("UnsupportedMethod", `Unsupported bridge method: ${method}`);
      }

      const permission =
        method === "profile.get" && permissions.includes("profile.get")
          ? "profile.get"
          : method === "profile.get"
            ? "profile.read"
            : method;
      assertPermission(permissions, permission);

      const handler = methodHandlers[method as BridgePermission];
      if (!handler) {
        throw new BridgeError("MethodUnavailable", `No handler registered for ${method}`);
      }

      if (APPROVAL_REQUIRED.has(method as BridgePermission)) {
        if (!requestUserApproval) {
          throw new BridgeError("MethodUnavailable", `Approval is unavailable for ${method}`);
        }
        if (!(await requestUserApproval(method as BridgePermission))) {
          throw new BridgeError("UserRejected", `User rejected ${method}`);
        }
      }

      return handler(payload);
    },
  };
}

export interface BridgeRequest {
  documentId: string;
  id: number;
  method: string;
  payload?: unknown;
}

type BridgeFailure = { code: BridgeError["code"]; message: string; requestId: number };
type BridgeResponse = (error: BridgeFailure | null, result?: unknown) => void;

export function createBridgeSession(call: (method: string, payload?: unknown) => Promise<unknown>) {
  const pending = new Map<string, BridgeResponse>();

  return {
    async dispatch(request: BridgeRequest, respond: BridgeResponse): Promise<void> {
      const key = JSON.stringify([request.documentId, request.id]);
      if (pending.has(key)) return;
      pending.set(key, respond);

      function finish(error: BridgeFailure | null, result?: unknown) {
        if (pending.get(key) !== respond) return;
        pending.delete(key);
        respond(error, result);
      }

      try {
        const result = await call(request.method, request.payload);
        finish(null, result);
      } catch (err) {
        const failure =
          err instanceof BridgeError
            ? err
            : new BridgeError("RequestFailed", `Host request failed: ${request.method}`);
        finish({ code: failure.code, message: failure.message, requestId: request.id });
      }
    },

    close(): void {
      const requests = [...pending];
      pending.clear();
      for (const [key, respond] of requests) {
        const [, requestId] = JSON.parse(key) as [string, number];
        respond({ code: "AppClosed", message: "The mini app closed", requestId });
      }
    },
  };
}
