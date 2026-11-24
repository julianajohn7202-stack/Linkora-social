"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { signTransaction } from "@stellar/freighter-api";
import {
  LinkoraClient,
  TipClient,
  NETWORK_PASSPHRASES,
  type CreatorReward,
  type TipHistoryPage,
} from "linkora-sdk";
import { EarningsEmptyState } from "@/components/dashboard/EarningsEmptyState";
import { useWallet } from "@/hooks/useWallet";
import { formatStroops } from "@/lib/analytics";

const pageSize = 20;
const indexerUrl = (process.env.NEXT_PUBLIC_INDEXER_URL || "http://localhost:3001").replace(
  /\/$/,
  ""
);
const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || NETWORK_PASSPHRASES.testnet;
const buttonClass =
  "rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium disabled:opacity-50";

function createTipClient() {
  const contractId =
    process.env.NEXT_PUBLIC_CONTRACT_ID ??
    "CDD6V66I7G2K2TCHWGLD4QIPZ4E47W4T3HLY3W7YJ4NGRRYUDRF6QYLR";
  const client = new LinkoraClient({
    contractId,
    networkPassphrase,
    rpcUrl: process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org",
    indexerUrl: indexerUrl.endsWith("/api") ? indexerUrl : `${indexerUrl}/api`,
  });
  return new TipClient(client, contractId, networkPassphrase);
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "Request failed.";
}

export default function CreatorEarningsPage() {
  const { address, connected } = useWallet();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8" data-testid="creator-earnings-page">
      <h1 className="text-2xl font-bold">Earnings</h1>
      {connected && address ? (
        <EarningsDashboard key={address} address={address} />
      ) : (
        <section
          className="rounded-xl border border-[var(--border)] p-8 text-center"
          data-testid="earnings-disconnected"
        >
          <p>Connect your wallet to view your earnings.</p>
          <Link href="/feed" className="mt-4 inline-block underline">
            Go to Feed
          </Link>
        </section>
      )}
    </main>
  );
}

function EarningsDashboard({ address }: { address: string }) {
  const client = useMemo(createTipClient, []);
  const [totalTips, setTotalTips] = useState<bigint | null>(null);
  const [rewards, setRewards] = useState<CreatorReward[] | null>(null);
  const [tipPage, setTipPage] = useState<TipHistoryPage | null>(null);
  const [cursors, setCursors] = useState(["0"]);
  const [reload, setReload] = useState(0);
  const [rewardReload, setRewardReload] = useState(0);
  const [tipError, setTipError] = useState("");
  const [rewardError, setRewardError] = useState("");
  const [pageError, setPageError] = useState("");
  const [action, setAction] = useState<"claim" | "export" | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const actionInProgress = useRef(false);
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    let cancelled = false;
    setTipError("");
    client.getTipTotals(address).then(
      (totals) => {
        if (!cancelled) setTotalTips(totals.receivedAmount);
      },
      (error: unknown) => {
        if (!cancelled) setTipError(message(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [address, client, reload]);

  useEffect(() => {
    let cancelled = false;
    setTipPage(null);
    setPageError("");
    client.getReceivedTips(address, { limit: pageSize, cursor }).then(
      (page) => {
        if (!cancelled) setTipPage(page);
      },
      (error: unknown) => {
        if (!cancelled) setPageError(message(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [address, client, cursor, reload]);

  useEffect(() => {
    const controller = new AbortController();
    setRewardError("");
    client.getRewards(address, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setRewards(data);
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setRewardError(message(error));
      }
    );
    return () => controller.abort();
  }, [address, client, rewardReload]);

  const pending = rewards?.filter((reward) => !reward.claimed);
  const nextReward = pending?.[0];

  async function runAction(kind: "claim" | "export", perform: () => Promise<void>) {
    if (actionInProgress.current) return;
    actionInProgress.current = true;
    setAction(kind);
    setActionError("");
    setNotice("");
    try {
      await perform();
    } catch (error) {
      setActionError(message(error));
    } finally {
      actionInProgress.current = false;
      setAction(null);
    }
  }

  function claimReward() {
    if (!nextReward) return;
    void runAction("claim", async () => {
      try {
        await client.claimReward(address, nextReward.epoch, {
          signTransaction: (xdr) => signTransaction(xdr, { networkPassphrase, address }),
        });
        setRewards(
          (current) =>
            current?.map((reward) =>
              reward.epoch === nextReward.epoch ? { ...reward, claimed: true } : reward
            ) ?? null
        );
        setNotice(`Reward for epoch ${nextReward.epoch} claimed.`);
      } finally {
        setRewardReload((value) => value + 1);
      }
    });
  }

  function exportCsv() {
    void runAction("export", async () => {
      const rows = [["sender", "net_amount_base_units", "post_id", "date_utc"]];
      let next: string | null = "0";
      let total = Infinity;
      while (next !== null && rows.length - 1 < total) {
        const page = await client.getReceivedTips(address, { limit: 100, cursor: next });
        if (total === Infinity) total = page.total;
        for (const tip of page.tips.slice(0, total - rows.length + 1)) {
          rows.push([
            tip.tipper,
            String(tip.amount - tip.fee),
            String(tip.post_id),
            tip.created_at.toISOString(),
          ]);
        }
        next = page.nextCursor;
      }
      const escape = (value: string) => {
        const safeValue = /^[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
        return `"${safeValue.replaceAll('"', '""')}"`;
      };
      const csv = rows.map((row) => row.map(escape).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "creator-tip-history.csv";
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    });
  }

  const noEarnings = totalTips === 0n && rewards?.length === 0 && tipPage?.total === 0;

  return (
    <div className="space-y-6" data-testid="earnings-dashboard">
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total tips" testId="earnings-total">
          {totalTips === null ? "—" : `${totalTips.toLocaleString()} base units`}
        </SummaryCard>
        <SummaryCard label="Total rewards">
          <RewardTotals rewards={rewards?.filter((reward) => reward.claimed)} />
        </SummaryCard>
        <SummaryCard label="Pending claims">
          <RewardTotals rewards={pending} />
        </SummaryCard>
      </div>
      {tipError && (
        <p role="alert">
          Tips total unavailable. {tipError}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setReload((value) => value + 1)}
          >
            Retry
          </button>
        </p>
      )}
      {rewardError && (
        <p role="alert">
          Rewards unavailable. {rewardError}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setRewardReload((value) => value + 1)}
          >
            Retry rewards
          </button>
        </p>
      )}
      {nextReward && (
        <button
          type="button"
          className={buttonClass}
          disabled={action !== null}
          onClick={claimReward}
        >
          {action === "claim" ? "Claiming…" : `Claim pending reward (epoch ${nextReward.epoch})`}
        </button>
      )}
      {notice && <p role="status">{notice}</p>}
      {actionError && <p role="alert">{actionError}</p>}
      {noEarnings && <EarningsEmptyState />}

      <section
        aria-labelledby="tip-history"
        className="space-y-4 rounded-xl border border-[var(--border)] p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="tip-history" className="text-lg font-semibold">
            Tip history
          </h2>
          <button
            type="button"
            className={buttonClass}
            disabled={action !== null || !tipPage?.total}
            onClick={exportCsv}
            data-testid="export-earnings-csv"
          >
            {action === "export" ? "Exporting…" : "Export CSV"}
          </button>
        </div>
        {pageError ? (
          <p role="alert">
            {pageError}{" "}
            <button
              type="button"
              className="underline"
              onClick={() => setReload((value) => value + 1)}
            >
              Retry history
            </button>
          </p>
        ) : !tipPage ? (
          <p role="status" data-testid="earnings-loading">
            Loading tips…
          </p>
        ) : tipPage.tips.length === 0 ? (
          <p>No tips on this page.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  {["Sender", "Amount after fees (base units)", "Post", "Date (UTC)"].map(
                    (label) => (
                      <th scope="col" key={label} className="px-3 py-2">
                        {label}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {tipPage.tips.map((tip) => (
                  <tr key={tip.id} className="border-b border-[var(--border)]">
                    <td className="px-3 py-2">
                      <Link
                        className="break-all underline"
                        href={`/profile/${encodeURIComponent(tip.tipper)}`}
                      >
                        {tip.tipper}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{(tip.amount - tip.fee).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Link className="underline" href={`/posts/${tip.post_id}`}>
                        #{String(tip.post_id)}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <time dateTime={tip.created_at.toISOString()}>
                        {tip.created_at.toISOString().slice(0, 10)}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-[var(--text-muted)]">
          The tip index provides amounts in base units without token identifiers.
        </p>
        {(cursors.length > 1 || tipPage?.nextCursor != null) && (
          <nav aria-label="Tip history pagination" className="flex items-center justify-between">
            <button
              type="button"
              className={buttonClass}
              disabled={cursors.length === 1}
              onClick={() => {
                setTipPage(null);
                setCursors(cursors.slice(0, -1));
              }}
            >
              Previous
            </button>
            <span aria-live="polite">Page {cursors.length}</span>
            <button
              type="button"
              className={buttonClass}
              disabled={tipPage?.nextCursor == null}
              onClick={() => {
                if (tipPage?.nextCursor != null) {
                  setCursors([...cursors, tipPage.nextCursor]);
                  setTipPage(null);
                }
              }}
            >
              Next
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}

function SummaryCard({
  label,
  testId,
  children,
}: {
  label: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] p-4" data-testid={testId}>
      <h2 className="text-sm text-[var(--text-muted)]">{label}</h2>
      <div className="mt-1 break-words text-lg font-semibold">{children}</div>
    </section>
  );
}

function RewardTotals({ rewards }: { rewards?: CreatorReward[] }) {
  if (!rewards) return "—";
  if (!rewards.length) return "0";
  const totals = new Map<string, bigint>();
  for (const reward of rewards) {
    const key = reward.isNative ? "XLM" : reward.token;
    totals.set(key, (totals.get(key) ?? 0n) + reward.amount);
  }
  return (
    <ul>
      {Array.from(totals, ([token, amount]) => (
        <li key={token}>
          {token === "XLM"
            ? `${formatStroops(String(amount))} XLM`
            : `${amount.toLocaleString()} base units · ${token}`}
        </li>
      ))}
    </ul>
  );
}
