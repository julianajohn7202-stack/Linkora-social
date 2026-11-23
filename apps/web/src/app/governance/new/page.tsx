"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWalletContext } from "@/components/WalletProvider";
import {
  GovernanceClient,
  LinkoraClient,
  MIN_PROPOSAL_TOKEN_BALANCE,
  GovParameter,
  type QueueSigner,
} from "linkora-sdk";
import { MarkdownPreview } from "@/components/governance/MarkdownPreview";

const RPC_URL = process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.NEXT_PUBLIC_CONTRACT_ID ?? "";
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ?? "Test SDF Network ; September 2015";

const ALLOW_LOCAL_HTTP =
  RPC_URL.startsWith("http://localhost:") || RPC_URL.startsWith("http://127.0.0.1:");

const client = new LinkoraClient({
  rpcUrl: RPC_URL,
  contractId: CONTRACT_ID,
  allowHttp: ALLOW_LOCAL_HTTP,
  networkPassphrase: NETWORK_PASSPHRASE,
});
const governance = new GovernanceClient(client);

const PARAMETERS = Object.values(GovParameter) as GovParameter[];
const TITLE_MAX_LENGTH = 120;

type Eligibility =
  | { status: "checking" }
  | { status: "disconnected" }
  | { status: "eligible"; balance: bigint }
  | { status: "ineligible"; balance: bigint }
  | { status: "error"; message: string };

type Tab = "write" | "preview";

function makeFreighterSigner(): QueueSigner {
  return {
    async signTransaction(xdr: string): Promise<string> {
      const { signTransaction } = await import("@stellar/freighter-api");
      return signTransaction(xdr, { networkPassphrase: NETWORK_PASSPHRASE });
    },
  };
}

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function NewProposalPage() {
  const router = useRouter();
  const { address, connected } = useWalletContext();

  const [eligibility, setEligibility] = useState<Eligibility>({ status: "checking" });
  const [tab, setTab] = useState<Tab>("write");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [parameter, setParameter] = useState<GovParameter>(GovParameter.FeeBps);
  const [newValue, setNewValue] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const checkEligibility = useCallback(async () => {
    if (!connected || !address) {
      setEligibility({ status: "disconnected" });
      return;
    }

    setEligibility({ status: "checking" });
    try {
      const balance = await governance.getTokenBalance(address);
      setEligibility({
        status: balance >= MIN_PROPOSAL_TOKEN_BALANCE ? "eligible" : "ineligible",
        balance,
      });
    } catch (err) {
      setEligibility({
        status: "error",
        message: err instanceof Error ? err.message : "Could not check your token balance.",
      });
    }
  }, [address, connected]);

  useEffect(() => {
    void checkEligibility();
  }, [checkEligibility]);

  const titleError =
    attempted && title.trim().length === 0
      ? "A title is required."
      : title.length > TITLE_MAX_LENGTH
        ? `Title must be ${TITLE_MAX_LENGTH} characters or fewer.`
        : null;
  const descriptionError =
    attempted && description.trim().length === 0 ? "A description is required." : null;
  const newValueError =
    attempted && !/^\d+$/.test(newValue.trim()) ? "Enter a non-negative whole number." : null;
  const newAddressError =
    attempted && newAddress.trim() !== "" && !/^G[A-Z2-7]{55}$/.test(newAddress.trim())
      ? "Enter a valid Stellar public key, or leave the field blank."
      : null;

  const canSubmit = useMemo(
    () =>
      eligibility.status === "eligible" &&
      !submitting &&
      title.trim().length > 0 &&
      title.length <= TITLE_MAX_LENGTH &&
      description.trim().length > 0 &&
      /^\d+$/.test(newValue.trim()) &&
      (newAddress.trim() === "" || /^G[A-Z2-7]{55}$/.test(newAddress.trim())),
    [eligibility.status, submitting, title, description, newValue, newAddress]
  );

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    setSubmitError(null);

    if (!address || eligibility.status !== "eligible" || !canSubmit) return;

    setSubmitting(true);
    try {
      const { proposalId } = await governance.createProposal(
        address,
        {
          parameter,
          newValue: BigInt(newValue.trim()),
          newAddress: newAddress.trim() === "" ? null : newAddress.trim(),
        },
        makeFreighterSigner()
      );
      router.push(`/governance/${proposalId.toString()}`);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create the proposal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <nav className="mb-6 text-sm text-[var(--text-muted)]">
        <Link href="/governance" className="hover:text-[var(--foreground)] hover:underline">
          ← Back to governance
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-[var(--foreground)]">Create a proposal</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          Describe the change, preview the markdown, then submit it on chain for a vote.
        </p>
      </header>

      {eligibility.status === "checking" && (
        <div
          className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--muted)] p-8"
          aria-busy="true"
          aria-label="Checking proposal eligibility"
          data-testid="eligibility-skeleton"
        />
      )}

      {eligibility.status === "disconnected" && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--muted)] p-8 text-center">
          <p className="text-[var(--text-muted)]">
            Connect your wallet to check your governance-token balance and create a proposal.
          </p>
        </div>
      )}

      {eligibility.status === "ineligible" && (
        <div
          className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-8 text-center"
          data-testid="ineligible-message"
        >
          <p className="font-semibold text-amber-300">Not enough governance tokens</p>
          <p className="mt-2 text-sm text-[var(--text-muted)]">
            Creating a proposal requires at least {MIN_PROPOSAL_TOKEN_BALANCE.toString()} token.
            Your balance is {eligibility.balance.toString()}.
          </p>
        </div>
      )}

      {eligibility.status === "error" && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-8 text-center">
          <p className="text-sm text-red-400">{eligibility.message}</p>
          <button
            type="button"
            onClick={() => void checkEligibility()}
            className="mt-4 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {eligibility.status === "eligible" && (
        <form onSubmit={handleSubmit} className="space-y-6" noValidate>
          <div className="flex rounded-xl border border-[var(--border)] p-1">
            {(["write", "preview"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                aria-pressed={tab === value}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
                  tab === value
                    ? "bg-violet-600 text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--foreground)]"
                }`}
              >
                {value}
              </button>
            ))}
          </div>

          {tab === "preview" ? (
            <section
              aria-label="Proposal preview"
              className="rounded-xl border border-[var(--border)] p-5"
            >
              <h2 className="mb-3 text-xl font-bold text-[var(--foreground)]">
                {title.trim() || "Untitled proposal"}
              </h2>
              {description.trim() ? (
                <MarkdownPreview markdown={description} />
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  Nothing to preview yet — add a description.
                </p>
              )}
            </section>
          ) : (
            <div className="space-y-5">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="proposal-title" className="text-sm font-medium">
                    Title
                  </label>
                  <span
                    className={`text-xs ${
                      title.length > TITLE_MAX_LENGTH ? "text-red-400" : "text-[var(--text-muted)]"
                    }`}
                  >
                    {title.length}/{TITLE_MAX_LENGTH}
                  </span>
                </div>
                <input
                  id="proposal-title"
                  value={title}
                  maxLength={TITLE_MAX_LENGTH}
                  onChange={(event) => setTitle(event.target.value)}
                  aria-invalid={titleError !== null}
                  aria-describedby={titleError ? "proposal-title-error" : undefined}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  placeholder="Reduce the protocol fee to 1%"
                />
                {titleError && (
                  <p id="proposal-title-error" role="alert" className="mt-1 text-sm text-red-400">
                    {titleError}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor="proposal-description" className="mb-1 block text-sm font-medium">
                  Description <span className="text-[var(--text-muted)]">(markdown)</span>
                </label>
                <textarea
                  id="proposal-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={8}
                  aria-invalid={descriptionError !== null}
                  aria-describedby={descriptionError ? "proposal-description-error" : undefined}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 font-mono text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  placeholder={"## Motivation\n\nExplain **why** this change matters."}
                />
                {descriptionError && (
                  <p
                    id="proposal-description-error"
                    role="alert"
                    className="mt-1 text-sm text-red-400"
                  >
                    {descriptionError}
                  </p>
                )}
              </div>

              <fieldset className="space-y-4 rounded-xl border border-[var(--border)] p-4">
                <legend className="px-1 text-sm font-semibold">Calldata</legend>

                <div>
                  <label htmlFor="proposal-parameter" className="mb-1 block text-sm font-medium">
                    Parameter
                  </label>
                  <select
                    id="proposal-parameter"
                    value={parameter}
                    onChange={(event) => setParameter(event.target.value as GovParameter)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                  >
                    {PARAMETERS.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="proposal-value" className="mb-1 block text-sm font-medium">
                    New value
                  </label>
                  <input
                    id="proposal-value"
                    inputMode="numeric"
                    value={newValue}
                    onChange={(event) => setNewValue(event.target.value)}
                    aria-invalid={newValueError !== null}
                    aria-describedby={newValueError ? "proposal-value-error" : undefined}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="1000"
                  />
                  {newValueError && (
                    <p id="proposal-value-error" role="alert" className="mt-1 text-sm text-red-400">
                      {newValueError}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="proposal-address" className="mb-1 block text-sm font-medium">
                    New address <span className="text-[var(--text-muted)]">(optional)</span>
                  </label>
                  <input
                    id="proposal-address"
                    value={newAddress}
                    onChange={(event) => setNewAddress(event.target.value)}
                    aria-invalid={newAddressError !== null}
                    aria-describedby={newAddressError ? "proposal-address-error" : undefined}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--muted)] px-3 py-2 font-mono text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                    placeholder="G… (only for address-valued parameters)"
                  />
                  {newAddressError && (
                    <p
                      id="proposal-address-error"
                      role="alert"
                      className="mt-1 text-sm text-red-400"
                    >
                      {newAddressError}
                    </p>
                  )}
                </div>
              </fieldset>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-[var(--text-muted)]">
              Proposing as {address ? shorten(address) : "—"} · balance{" "}
              {eligibility.balance.toString()}
            </p>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-violet-600 px-5 py-2 font-semibold text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit proposal"}
            </button>
          </div>

          {submitError && (
            <p role="alert" className="text-sm text-red-400">
              {submitError}
            </p>
          )}
        </form>
      )}
    </main>
  );
}
