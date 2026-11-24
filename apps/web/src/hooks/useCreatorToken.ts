"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LinkoraClient } from "../../../../packages/sdk/src/client";
import { CreatorTokenClient } from "../../../../packages/sdk/src/tip-client";

const indexerUrl = (process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3001").replace(/\/$/, "");
const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY";
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";
const networkPassphrase = process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

export interface CreatorTokenInfo {
  name: string;
  symbol: string;
  decimals: number;
  supply?: string;
  price?: string;
}

export interface CreatorTokenHolder {
  address: string;
  balance: string;
}

export interface CreatorTokenTransfer {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
}

interface IndexedCreatorToken {
  token: string;
  info: CreatorTokenInfo;
  holders?: CreatorTokenHolder[];
  transfers?: CreatorTokenTransfer[];
}

export interface CreatorTokenState {
  token: string | null;
  balance: string | null;
  info: CreatorTokenInfo | null;
  holders: CreatorTokenHolder[];
  holderCount: number;
  transfers: CreatorTokenTransfer[];
  isLoading: boolean;
  isMinting: boolean;
  error: Error | null;
  mintError: Error | null;
  refresh: () => Promise<void>;
  mint: (amount: string) => Promise<void>;
}

export function useCreatorToken(address: string | null): CreatorTokenState {
  const client = useMemo(() => new CreatorTokenClient(
    new LinkoraClient({ contractId, rpcUrl, networkPassphrase }),
    networkPassphrase,
  ), []);
  const pending = useRef<AbortController | null>(null);
  const activeWallet = useRef<{ address: string } | null>(null);
  const minting = useRef(false);
  const [data, setData] = useState<{ address: string; value: IndexedCreatorToken } | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(address));
  const [isMinting, setIsMinting] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [balanceError, setBalanceError] = useState<Error | null>(null);
  const [mintError, setMintError] = useState<Error | null>(null);
  const indexed = data && data.address === address ? data.value : null;
  const token = indexed?.token ?? null;

  const refresh = useCallback(async () => {
    pending.current?.abort();
    setLoadError(null);
    if (!address) {
      setData(null);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setIsLoading(true);
    try {
      const response = await fetch(`${indexerUrl}/api/profiles/${encodeURIComponent(address)}/creator-token`, {
        signal: controller.signal,
      });
      if (response.status === 404) {
        if (!controller.signal.aborted) setData(null);
        return;
      }
      if (!response.ok) throw new Error(`Failed to load creator token (${response.status}).`);
      const value: IndexedCreatorToken = await response.json();
      if (!controller.signal.aborted) setData({ address, value });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setLoadError(cause instanceof Error ? cause : new Error("Failed to load creator token."));
      }
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    activeWallet.current = address ? { address } : null;
    setMintError(null);
    void refresh();
    return () => {
      activeWallet.current = null;
      pending.current?.abort();
    };
  }, [address, refresh]);

  useEffect(() => {
    setBalance(null);
    setBalanceError(null);
    if (!address || !token) return;
    let generation = 0;

    async function pollBalance() {
      const request = ++generation;
      try {
        const next = await client.getBalance(token!, address!);
        if (generation === request) {
          setBalance(next);
          setBalanceError(null);
        }
      } catch (cause) {
        if (generation === request) {
          setBalanceError(cause instanceof Error ? cause : new Error("Failed to read creator token balance."));
        }
      }
    }

    function onTransfer(event: Event) {
      const detail = (event as CustomEvent<{ tokenAddress: string }>).detail;
      if (detail?.tokenAddress === token) void pollBalance();
    }

    void pollBalance();
    const timer = window.setInterval(pollBalance, 30_000);
    window.addEventListener("linkora:creator-token-transfer", onTransfer);
    return () => {
      generation += 1;
      window.clearInterval(timer);
      window.removeEventListener("linkora:creator-token-transfer", onTransfer);
    };
  }, [address, client, token]);

  const mint = useCallback(async (amount: string) => {
    if (minting.current) return;
    const wallet = activeWallet.current;
    try {
      if (!wallet || !token || !indexed) throw new Error("No creator token linked to this wallet.");
      minting.current = true;
      setIsMinting(true);
      setMintError(null);
      const { signTransaction } = await import("@stellar/freighter-api");
      await client.mint(token, wallet.address, amount, indexed.info.decimals, {
        signTransaction: (xdr) => signTransaction(xdr, { networkPassphrase, accountToSign: wallet.address }),
      });
      if (activeWallet.current === wallet) {
        window.dispatchEvent(new CustomEvent("linkora:creator-token-transfer", { detail: { tokenAddress: token } }));
        await refresh();
      }
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Failed to mint creator token.");
      if (activeWallet.current === wallet) setMintError(error);
      throw error;
    } finally {
      minting.current = false;
      setIsMinting(false);
    }
  }, [client, indexed, refresh, token]);

  const holders = indexed?.holders ?? [];
  return {
    token,
    balance: token ? balance : null,
    info: indexed?.info ?? null,
    holders: holders.slice(0, 10),
    holderCount: holders.length,
    transfers: indexed?.transfers ?? [],
    isLoading,
    isMinting,
    error: loadError ?? balanceError,
    mintError,
    refresh,
    mint,
  };
}
