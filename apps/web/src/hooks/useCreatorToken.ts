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
  balance: string;
}

export interface CreatorTokenTransfer {
  from: string;
  to: string;
  amount: string;
  timestamp: string;
}

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
  mint: (amount: string) => Promise<void>;
}

/** Loads a wallet's linked creator token and listens for app-level token transfers. */
export function useCreatorToken(address: string | null): CreatorTokenState {
  const clientRef = useRef<LinkoraClient | null>(null);
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

      const [tokenInfo, tokenHolders, tokenTransfers] = await Promise.all([
        clientRef.current!.getTokenInfo(nextToken),
        clientRef.current!.getTokenHolders(nextToken),
        clientRef.current!.getTokenTransfers(nextToken),
      ]);
      if (requestId !== requestRef.current) return;

      setInfo({
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        supply: String(tokenInfo.supply),
        price: String(tokenInfo.price),
      });
      const sortedHolders = [...tokenHolders].sort(
        (a, b) => Number(b.balance) - Number(a.balance),
      );
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
        setBalance(String(detail.balance));
      } else if (detail.recipient === address && detail.amount !== undefined) {
        setBalance((current) => String(Number(current ?? 0) + Number(detail.amount)));
      }
    };
    window.addEventListener("linkora:creator-token-transfer", onTransfer);
    return () => window.removeEventListener("linkora:creator-token-transfer", onTransfer);
  }, [address, token]);

  const mint = useCallback(
    async (amount: string): Promise<void> => {
      if (!token) throw new Error("No creator token linked to this wallet.");
      await clientRef.current!.mintCreatorToken(token, amount);
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
