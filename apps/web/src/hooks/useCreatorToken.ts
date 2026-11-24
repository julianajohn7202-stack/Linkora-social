"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LinkoraClient } from "../../../../packages/sdk/src/client";

const contractId = process.env.NEXT_PUBLIC_CONTRACT_ID || "CDUMMY";
const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || "https://soroban-testnet.stellar.org";

interface TransferEventDetail {
  tokenAddress: string;
  balance?: string | number;
  amount?: string | number;
  recipient?: string;
}

export interface CreatorTokenInfo {
  name: string;
  symbol: string;
  supply: string;
  price: string;
}

export interface CreatorTokenHolder {
  address: string;
  balance?: string;
}

export interface CreatorTokenTransfer {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
}

// These methods are optional until the SDK exposes creator token management.
type CreatorTokenClient = LinkoraClient & {
  getTokenInfo?(token: string): Promise<Omit<CreatorTokenInfo, "supply" | "price"> & {
    supply: string | bigint;
    price: string | bigint;
  }>;
  getTokenHolders?(token: string): Promise<CreatorTokenHolder[]>;
  getTokenTransfers?(token: string): Promise<CreatorTokenTransfer[]>;
  mintCreatorToken?(token: string, amount: string): Promise<void>;
};

export interface CreatorTokenState {
  token: string | null;
  balance: string | null;
  info: CreatorTokenInfo | null;
  holders: CreatorTokenHolder[];
  holderCount: number;
  transfers: CreatorTokenTransfer[];
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
  mint: (amount?: string) => Promise<void>;
}

/** Loads a wallet's linked creator token and listens for app-level token transfers. */
export function useCreatorToken(address: string | null): CreatorTokenState {
  const clientRef = useRef<CreatorTokenClient | null>(null);
  const requestRef = useRef(0);
  const [token, setToken] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [info, setInfo] = useState<CreatorTokenInfo | null>(null);
  const [holders, setHolders] = useState<CreatorTokenHolder[]>([]);
  const [holderCount, setHolderCount] = useState(0);
  const [transfers, setTransfers] = useState<CreatorTokenTransfer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  if (!clientRef.current) clientRef.current = new LinkoraClient({ contractId, rpcUrl });

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!address) {
      setToken(null);
      setBalance(null);
      setInfo(null);
      setHolders([]);
      setHolderCount(0);
      setTransfers([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const profile = await clientRef.current!.getProfile(address);
      if (requestId !== requestRef.current) return;
      const nextToken = profile?.creator_token || null;
      setToken(nextToken);

      if (!nextToken) {
        setInfo(null);
        setHolders([]);
        setHolderCount(0);
        setTransfers([]);
        return;
      }

      const client = clientRef.current!;
      const [tokenInfo, tokenHolders, tokenTransfers] = await Promise.all([
        client.getTokenInfo?.(nextToken),
        client.getTokenHolders?.(nextToken) ?? [],
        client.getTokenTransfers?.(nextToken) ?? [],
      ]);
      if (requestId !== requestRef.current) return;

      setInfo(tokenInfo ? {
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        supply: String(tokenInfo.supply),
        price: String(tokenInfo.price),
      } : null);
      const sortedHolders = tokenHolders
        .map((holder) => ({
          holder,
          balance: holder.balance == null ? null : BigInt(holder.balance),
        }))
        .sort((a, b) => {
          if (a.balance === b.balance) return 0;
          if (a.balance === null) return 1;
          if (b.balance === null) return -1;
          return a.balance > b.balance ? -1 : 1;
        })
        .map(({ holder }) => holder);
      setHolders(sortedHolders.slice(0, 10));
      setHolderCount(tokenHolders.length);
      setTransfers(tokenTransfers);
    } catch (cause) {
      if (requestId === requestRef.current) {
        setError(cause instanceof Error ? cause : new Error("Failed to load creator token."));
        setToken(null);
        setBalance(null);
        setInfo(null);
        setHolders([]);
        setHolderCount(0);
        setTransfers([]);
      }
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    setBalance(null);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const onTransfer = (event: Event) => {
      const detail = (event as CustomEvent<TransferEventDetail>).detail;
      if (!detail || detail.tokenAddress !== token) return;
      if (detail.balance !== undefined) {
        if (typeof detail.balance === "number" && !Number.isSafeInteger(detail.balance)) return;
        setBalance(String(detail.balance));
      } else if (detail.recipient === address && detail.amount !== undefined) {
        const amount = detail.amount;
        if (typeof amount === "number" && !Number.isSafeInteger(amount)) return;
        setBalance((current) => String(BigInt(current ?? "0") + BigInt(amount)));
      }
    };
    window.addEventListener("linkora:creator-token-transfer", onTransfer);
    return () => window.removeEventListener("linkora:creator-token-transfer", onTransfer);
  }, [address, token]);

  const mint = useCallback(
    async (amount?: string): Promise<void> => {
      if (!token) throw new Error("No creator token linked to this wallet.");
      const client = clientRef.current!;
      if (!client.mintCreatorToken) throw new Error("Creator token minting is not implemented yet.");
      if (!amount) throw new Error("Enter an amount to mint.");
      await client.mintCreatorToken(token, amount);
      await refresh();
    },
    [refresh, token],
  );

  return {
    token,
    balance,
    info,
    holders,
    holderCount,
    transfers,
    isLoading,
    error,
    refresh,
    mint,
  };
}
