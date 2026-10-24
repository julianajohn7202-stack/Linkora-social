"use client";

import { useState } from "react";

interface VotePanelProps {
  proposalId: string | number;
  onVote?: (proposalId: string | number, direction: "for" | "against") => void;
  disabled?: boolean;
}

export function VotePanel({ proposalId, onVote, disabled = false }: VotePanelProps) {
  const [localVote, setLocalVote] = useState<"for" | "against" | null>(null);

  const handleVote = (direction: "for" | "against") => {
    if (disabled || localVote !== null) return;
    setLocalVote(direction);
    onVote?.(proposalId, direction);
  };

  return (
    <div className="flex gap-3" role="group" aria-label={`Vote on proposal ${proposalId}`}>
      <button
        type="button"
        onClick={() => handleVote("for")}
        disabled={disabled || localVote !== null}
        className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          localVote === "for"
            ? "border-[var(--color-success)] bg-[var(--color-success-light)] text-[var(--color-success)]"
            : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-success)]/60 hover:text-[var(--color-success)]"
        }`}
        aria-pressed={localVote === "for"}
      >
        Vote For
      </button>
      <button
        type="button"
        onClick={() => handleVote("against")}
        disabled={disabled || localVote !== null}
        className={`flex-1 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          localVote === "against"
            ? "border-[var(--color-error)] bg-[var(--color-error-light)] text-[var(--color-error)]"
            : "border-[var(--border)] text-[var(--foreground)] hover:border-[var(--color-error)]/60 hover:text-[var(--color-error)]"
        }`}
        aria-pressed={localVote === "against"}
      >
        Vote Against
      </button>
    </div>
  );
}