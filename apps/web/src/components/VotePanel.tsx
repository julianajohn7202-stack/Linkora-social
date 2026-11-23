"use client";

import { useState } from "react";
import { LinkoraClient, type QueueSigner } from "linkora-sdk";
import { useWalletContext } from "@/components/WalletProvider";
import { useTxToast } from "@/contexts/TxToastContext";

interface VotePanelProps {
  proposalId: string | number | bigint;
  onVote?: (
    proposalId: string | number | bigint,
    direction: "for" | "against"
  ) => void | Promise<void>;
  disabled?: boolean;
}

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const ALLOW_LOCAL_HTTP =
  RPC_URL.startsWith("http://localhost:") || RPC_URL.startsWith("http://127.0.0.1:");

function makeFreighterSigner(): QueueSigner {
  return {
    async signTransaction(xdr: string): Promise<string> {
      const { signTransaction } = await import("@stellar/freighter-api");
      return signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE });
    },
  };
}

export function VotePanel({ proposalId, onVote, disabled = false }: VotePanelProps) {
  const { address } = useWalletContext();
  const { notify } = useTxToast();
  const [localVote, setLocalVote] = useState<"for" | "against" | null>(null);
  const [isVoting, setIsVoting] = useState(false);
  const [pendingVote, setPendingVote] = useState<"for" | "against" | null>(null);

  const handleVote = async (direction: "for" | "against") => {
    if (disabled || isVoting || localVote !== null) return;

    setIsVoting(true);
    setPendingVote(direction);
    notify({ status: "pending" });
    try {
      if (!address) throw new Error("Connect your wallet before voting.");
      if (!CONTRACT_ID) throw new Error("Governance contract is not configured.");

      const client = new LinkoraClient({
        rpcUrl: RPC_URL,
        contractId: CONTRACT_ID,
        networkPassphrase: NETWORK_PASSPHRASE,
        allowHttp: ALLOW_LOCAL_HTTP,
      });
      const result = await client.vote(
        address,
        BigInt(proposalId),
        direction,
        makeFreighterSigner()
      );

      setLocalVote(direction);
      notify({ status: "confirmed", hash: result.txHash });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The vote transaction failed.";
      notify({ status: "failed", error: message });
      return;
    } finally {
      setIsVoting(false);
      setPendingVote(null);
    }

    try {
      await onVote?.(proposalId, direction);
    } catch (error) {
      console.error("Vote was confirmed, but the proposal could not be refreshed.", error);
    }
  };

  const buttonsDisabled = disabled || isVoting || localVote !== null;
  const votingLabel = (
    <span className="inline-flex items-center justify-center gap-2">
      <svg
        className="h-4 w-4 animate-spin"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      Voting…
    </span>
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-3" role="group" aria-label={`Vote on proposal ${proposalId}`}>
        <button
          type="button"
          onClick={() => void handleVote("for")}
          disabled={buttonsDisabled}
          className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            localVote === "for"
              ? "border-[var(--color-success)] bg-[var(--color-success-light)] text-[var(--color-success)]"
              : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-success)]/60 hover:text-[var(--color-success)]"
          }`}
          aria-pressed={localVote === "for"}
        >
          {pendingVote === "for" ? votingLabel : "Vote For"}
        </button>
        <button
          type="button"
          onClick={() => void handleVote("against")}
          disabled={buttonsDisabled}
          className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            localVote === "against"
              ? "border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]"
              : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-error)]/60 hover:text-[var(--color-error)]"
          }`}
          aria-pressed={localVote === "against"}
        >
          {pendingVote === "against" ? votingLabel : "Vote Against"}
        </button>
      </div>
      {localVote && (
        <p className="text-sm text-[var(--text-muted)]" role="status">
          You voted {localVote}.
        </p>
      )}
    </div>
  );
}
