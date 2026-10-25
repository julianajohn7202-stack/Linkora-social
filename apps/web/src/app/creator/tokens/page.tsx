'use client';

import { useMemo, useState } from 'react';
import { useCreatorToken } from '@/hooks/useCreatorToken';

function formatAmount(value: bigint | undefined, decimals = 18): string {
  if (value === undefined) return '—';
  const base = BigInt(10) ** BigInt(decimals);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(decimals, '0').slice(0, 4);
  return `${whole.toString()}.${fraction}`;
}

function shortenAddress(address: string): string {
  if (!address) return '—';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export default function CreatorTokensPage() {
  const {
    token,
    holders,
    transfers,
    isLoading,
    error,
    mint,
    isMinting,
    mintError,
  } = useCreatorToken();

  const [mintAmount, setMintAmount] = useState('');

  const topHolders = useMemo(() => holders.slice(0, 10), [holders]);

  const handleMint = async () => {
    if (!mintAmount) return;
    try {
      await mint(mintAmount);
      setMintAmount('');
    } catch {
      // error surfaced via mintError
    }
  };

  if (isLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-gray-500">Loading token data…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-sm text-red-600">Failed to load token: {error.message}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {token?.name ?? 'Creator Token'}{' '}
            {token?.symbol ? (
              <span className="text-base font-normal text-gray-500">({token.symbol})</span>
            ) : null}
          </h1>
          <p className="mt-1 text-sm text-gray-500">Manage your creator token supply and holders.</p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Supply</p>
          <p className="mt-1 text-lg font-medium">{formatAmount(token?.totalSupply)}</p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Price</p>
          <p className="mt-1 text-lg font-medium">
            {token?.price !== undefined ? `${token.price} ETH` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Holders</p>
          <p className="mt-1 text-lg font-medium">{holders.length}</p>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-medium">Mint New Tokens</h2>
        <p className="mt-1 text-sm text-gray-500">
          Mint additional tokens to your creator supply. This will open a transaction for confirmation.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            type="text"
            inputMode="decimal"
            value={mintAmount}
            onChange={(e) => setMintAmount(e.target.value)}
            placeholder="Amount to mint"
            className="w-48 rounded-md border border-gray-300 px-3 py-2 text-sm"
            disabled={isMinting}
          />
          <button
            type="button"
            onClick={handleMint}
            disabled={isMinting || !mintAmount}
            className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {isMinting ? 'Minting…' : 'Mint Tokens'}
          </button>
        </div>
        {mintError ? <p className="mt-2 text-sm text-red-600">{mintError.message}</p> : null}
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-medium">Top 10 Holders</h2>
        {topHolders.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No holders yet.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2">#</th>
                <th className="py-2">Address</th>
                <th className="py-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {topHolders.map((holder, index) => (
                <tr key={holder.address} className="border-b border-gray-100">
                  <td className="py-2">{index + 1}</td>
                  <td className="py-2 font-mono">{shortenAddress(holder.address)}</td>
                  <td className="py-2 text-right">{formatAmount(holder.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 p-4">
        <h2 className="text-lg font-medium">Transfer History</h2>
        {transfers.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No transfers yet.</p>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                <th className="py-2">From</th>
                <th className="py-2">To</th>
                <th className="py-2 text-right">Amount</th>
                <th className="py-2 text-right">Tx</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => (
                <tr key={transfer.hash} className="border-b border-gray-100">
                  <td className="py-2 font-mono">{shortenAddress(transfer.from)}</td>
                  <td className="py-2 font-mono">{shortenAddress(transfer.to)}</td>
                  <td className="py-2 text-right">{formatAmount(transfer.amount)}</td>
                  <td className="py-2 text-right font-mono">
                    {transfer.hash ? shortenAddress(transfer.hash) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
