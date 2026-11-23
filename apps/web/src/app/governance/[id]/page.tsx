"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { nativeToScVal } from "@stellar/stellar-sdk";
import { GovStatus, LinkoraClient, parseContractEvent } from "linkora-sdk";
import type { GovProposal, LinkoraEvent } from "linkora-sdk";
import { useWalletContext } from "@/components/WalletProvider";
import { VotePanel } from "@/components/VotePanel";
import { ProposalStatus } from "@/components/governance/ProposalStatus";
import { QuorumBar } from "@/components/governance/QuorumBar";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";
const PAGE_SIZE = 10;

const client = new LinkoraClient({
  rpcUrl: RPC_URL,
  contractId: CONTRACT_ID,
  networkPassphrase: NETWORK_PASSPHRASE,
  allowHttp: RPC_URL.startsWith("http://localhost:") || RPC_URL.startsWith("http://127.0.0.1:"),
});

interface VoteHistoryEntry {
  voter: string;
  support: boolean;
  ledger?: number;
  txHash?: string;
  id: string;
}

interface RpcEvent {
  pagingToken?: string;
  ledger?: number;
  txHash?: string;
  topics?: string[];
  topic?: string[];
  data?: string;
  value?: string;
}

interface VoteHistoryResult {
  entries: VoteHistoryEntry[];
  nextCursor: string | null;
}

function parameterLabel(parameter: string): string {
  return parameter.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

function proposalValue(proposal: GovProposal): string {
  if (proposal.parameter === "Treasury") {
    return proposal.new_address ?? "No replacement treasury address recorded";
  }
  return proposal.new_value.toString();
}

function eventToVote(event: LinkoraEvent | null): VoteHistoryEntry | null {
  if (!event || event.type !== "gov_vote") return null;
  return {
    voter: event.voter,
    support: event.support,
    ledger: event.meta.ledger,
    txHash: event.meta.txHash,
    id: event.meta.id ?? `${event.meta.ledger ?? "unknown"}-${event.voter}`,
  };
}

async function fetchVoteHistory(proposalId: bigint, cursor?: string): Promise<VoteHistoryResult> {
  if (!CONTRACT_ID) throw new Error("Governance contract is not configured.");

  const topicEvent = nativeToScVal("GovVoteEvent", { type: "symbol" }).toXDR("base64");
  const topicProposal = nativeToScVal(proposalId, { type: "u64" }).toXDR("base64");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getEvents",
      params: {
        startLedger: 0,
        filters: [
          {
            type: "contract",
            contractIds: [CONTRACT_ID],
            topics: [[topicEvent, topicProposal, "*"]],
          },
        ],
        pagination: {
          limit: PAGE_SIZE + 1,
          ...(cursor ? { cursor } : {}),
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Could not load vote history (HTTP ${response.status}).`);
  }

  const json = (await response.json()) as {
    result?: { events?: RpcEvent[] };
    error?: { message?: string };
  };
  if (json.error) {
    throw new Error(json.error.message ?? "Soroban RPC could not load vote history.");
  }

  const votes = (json.result?.events ?? [])
    .map((raw) => ({ entry: eventToVote(parseContractEvent(raw)), cursor: raw.pagingToken }))
    .filter(
      (vote): vote is { entry: VoteHistoryEntry; cursor: string | undefined } => vote.entry !== null
    );
  const hasMore = votes.length > PAGE_SIZE;
  const page = votes.slice(0, PAGE_SIZE);
  const entries = page.map(({ entry }) => entry);
  const nextCursor = hasMore ? (page[page.length - 1]?.cursor ?? null) : null;

  return { entries, nextCursor };
}

export default function GovernanceProposalPage() {
  const params = useParams<{ id: string }>();
  const proposalId = params?.id ?? "";
  const { address, connected } = useWalletContext();
  const [proposal, setProposal] = useState<GovProposal | null>(null);
  const [quorum, setQuorum] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voteHistory, setVoteHistory] = useState<VoteHistoryEntry[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const loadProposal = useCallback(async () => {
    if (!/^[1-9]\d*$/.test(proposalId)) {
      setError("This proposal ID is invalid.");
      setLoading(false);
      return;
    }
    if (!CONTRACT_ID) {
      setError("Governance contract is not configured.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const id = BigInt(proposalId);
      const [nextProposal, nextQuorum] = await Promise.all([
        client.govGetProposal(id),
        client.effectiveQuorum(id),
      ]);
      setProposal(nextProposal);
      setQuorum(nextQuorum);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this proposal.");
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  const loadHistory = useCallback(
    async (cursor?: string, append = false) => {
      if (!/^[1-9]\d*$/.test(proposalId)) return;
      setHistoryLoading(true);
      setHistoryError(null);
      try {
        const result = await fetchVoteHistory(BigInt(proposalId), cursor);
        setVoteHistory((previous) =>
          append
            ? [
                ...previous,
                ...result.entries.filter(
                  (entry) => !previous.some((existing) => existing.id === entry.id)
                ),
              ]
            : result.entries
        );
        setHistoryCursor(result.nextCursor);
      } catch (cause) {
        setHistoryError(cause instanceof Error ? cause.message : "Could not load vote history.");
      } finally {
        setHistoryLoading(false);
      }
    },
    [proposalId]
  );

  useEffect(() => {
    void loadProposal();
    void loadHistory();
  }, [loadProposal, loadHistory]);

  const handleVoteComplete = async () => {
    await loadProposal();
    await loadHistory();
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12" role="status">
        Loading proposal…
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-12">
        <p
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-400"
          role="alert"
        >
          {error ?? "Proposal not found."}
        </p>
        <Link className="mt-4 inline-block text-sm text-[var(--color-primary)]" href="/governance">
          Back to governance
        </Link>
      </section>
    );
  }

  const label = parameterLabel(proposal.parameter);
  const value = proposalValue(proposal);
  const description =
    proposal.parameter === "Treasury"
      ? `This proposal requests changing the protocol treasury to ${value}.`
      : `This proposal requests changing the protocol's ${label} to ${value}.`;

  return (
    <article className="mx-auto max-w-4xl space-y-8 px-4 py-8">
      <header className="space-y-4">
        <Link href="/governance" className="text-sm text-[var(--color-primary)] hover:underline">
          ← All proposals
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm text-[var(--text-muted)]">
              Governance proposal #{proposal.id.toString()}
            </p>
            <h1 className="mt-1 text-3xl font-bold text-[var(--foreground)]">
              Update {proposal.parameter}
            </h1>
          </div>
          <ProposalStatus status={proposal.status} />
        </div>
      </header>

      <section
        className="space-y-5 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
        aria-labelledby="proposal-details-heading"
      >
        <h2
          id="proposal-details-heading"
          className="text-xl font-semibold text-[var(--foreground)]"
        >
          Proposal details
        </h2>
        <p className="leading-relaxed text-[var(--foreground)]">{description}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Proposer</p>
            <code className="mt-1 block break-all text-sm text-[var(--foreground)]">
              {proposal.proposer}
            </code>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Proposed value
            </p>
            <p className="mt-1 break-all font-medium text-[var(--foreground)]">{value}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Created at ledger
            </p>
            <p className="mt-1 text-sm text-[var(--foreground)]">{proposal.created_ledger}</p>
          </div>
        </div>
      </section>

      <section
        className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
        aria-labelledby="proposal-votes-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="proposal-votes-heading"
            className="text-xl font-semibold text-[var(--foreground)]"
          >
            Vote breakdown
          </h2>
          <span className="text-sm text-[var(--text-muted)]">
            Quorum: {quorum.toLocaleString()}
          </span>
        </div>
        <QuorumBar
          votesFor={proposal.votes_for}
          votesAgainst={proposal.votes_against}
          quorum={quorum}
        />
        <p className="text-sm text-[var(--text-muted)]">
          {proposal.votes_for.toLocaleString()} for · {proposal.votes_against.toLocaleString()}{" "}
          against
        </p>
      </section>

      {proposal.status === GovStatus.Active && (
        <section
          className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
          aria-labelledby="cast-vote-heading"
        >
          <h2 id="cast-vote-heading" className="text-xl font-semibold text-[var(--foreground)]">
            Cast your vote
          </h2>
          {connected && address ? (
            <VotePanel proposalId={proposal.id} onVote={handleVoteComplete} />
          ) : (
            <p className="text-sm text-[var(--text-muted)]">
              Connect your wallet to vote on this proposal.
            </p>
          )}
        </section>
      )}

      <section
        className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--background)] p-6"
        aria-labelledby="vote-history-heading"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="vote-history-heading" className="text-xl font-semibold text-[var(--foreground)]">
            Vote history
          </h2>
          {historyLoading && <span className="text-sm text-[var(--text-muted)]">Loading…</span>}
        </div>
        {historyError && (
          <p className="text-sm text-red-400" role="alert">
            {historyError}
          </p>
        )}
        {!historyLoading && voteHistory.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No votes have been recorded yet.</p>
        ) : (
          <ol className="divide-y divide-[var(--border)]">
            {voteHistory.map((vote) => (
              <li
                key={vote.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium text-[var(--foreground)]">
                    {vote.support ? "Voted for" : "Voted against"}
                  </p>
                  <code className="break-all text-xs text-[var(--text-muted)]">{vote.voter}</code>
                </div>
                <div className="text-right text-xs text-[var(--text-muted)]">
                  {vote.ledger !== undefined && <p>Ledger {vote.ledger}</p>}
                  {vote.txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${vote.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--color-primary)] hover:underline"
                    >
                      View transaction
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
        {historyCursor && (
          <button
            type="button"
            onClick={() => void loadHistory(historyCursor, true)}
            disabled={historyLoading}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--foreground)] disabled:opacity-50"
          >
            Load more votes
          </button>
        )}
      </section>
    </article>
  );
}
