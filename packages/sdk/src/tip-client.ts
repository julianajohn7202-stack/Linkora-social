import { Address, Asset, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-base";
import type { LinkoraClient } from "./client.js";
import type { QueueSigner } from "./queue.js";

export interface TipRecord {
  id: number;
  tipper: string;
  post_id: bigint;
  amount: bigint;
  fee: bigint;
  created_at: Date;
  tx_hash: string;
}

export interface TipHistoryOptions {
  limit?: number;
  cursor?: string;
}

export interface TipHistoryPage {
  tips: TipRecord[];
  total: number;
  nextCursor: string | null;
}

export interface TipTotals {
  sentCount: number;
  sentAmount: bigint;
  sentFee: bigint;
  receivedCount: number;
  receivedAmount: bigint;
  receivedFee: bigint;
}

export interface CreatorReward {
  epoch: bigint;
  amount: bigint;
  claimed: boolean;
  token: string;
  isNative: boolean;
}

export class TipClient {
  constructor(
    private readonly client: LinkoraClient,
    private readonly contractId: string,
    private readonly networkPassphrase: string
  ) {}

  getReceivedTips(address: string, options?: TipHistoryOptions): Promise<TipHistoryPage> {
    return this.client.getTipsReceived(address, options);
  }

  getTipTotals(address: string): Promise<TipTotals> {
    return this.client.getTipTotals(address);
  }

  /** Read reward allocations visible to RPC, including the amounts retained after a claim. */
  async getRewards(address: string, signal?: AbortSignal): Promise<CreatorReward[]> {
    const server = this.client.rpcServer;
    const recipient = Address.fromString(address).toScVal();
    const contract = Address.fromString(this.contractId);
    const instance = await server.getContractData(
      contract,
      xdr.ScVal.scvLedgerKeyContractInstance()
    );
    const storage = instance.val.contractData().val().instance().storage() ?? [];
    const epochEntry = storage.find((entry) => scValToNative(entry.key()) === "RewardEpoch");
    const latestEpoch = epochEntry ? BigInt(scValToNative(epochEntry.val())) : 0n;
    const nativeToken = Asset.native().contractId(this.networkPassphrase);
    const rewards: CreatorReward[] = [];

    const read = async (keys: xdr.LedgerKey[]) => {
      const { entries } = await server.getLedgerEntries(...keys);
      return new Map(
        entries.map(({ key, val }) => [
          key.toXDR("base64"),
          scValToNative(val.contractData().val()),
        ])
      );
    };

    const ledgerKey = (name: string, epoch: bigint, forRecipient: boolean) => {
      const fields = [nativeToScVal(name, { type: "symbol" })];
      if (forRecipient) fields.push(recipient);
      fields.push(nativeToScVal(epoch, { type: "u64" }));
      return xdr.LedgerKey.contractData(
        new xdr.LedgerKeyContractData({
          contract: contract.toScAddress(),
          durability: xdr.ContractDataDurability.persistent(),
          key: xdr.ScVal.scvVec(fields),
        })
      );
    };

    for (let start = 1n; start <= latestEpoch; start += 20n) {
      if (signal?.aborted) throw new Error("Reward lookup cancelled.");
      const allocations = [];
      for (let epoch = start; epoch < start + 20n && epoch <= latestEpoch; epoch++) {
        allocations.push({ epoch, key: ledgerKey("RewardClaimable", epoch, true) });
      }
      const amounts = await read(allocations.map(({ key }) => key));
      const matching = allocations
        .filter(({ key }) => amounts.has(key.toXDR("base64")))
        .map(({ epoch, key }) => ({
          epoch,
          amount: BigInt(amounts.get(key.toXDR("base64"))),
          tokenKey: ledgerKey("RewardToken", epoch, false),
          claimedKey: ledgerKey("RewardClaimed", epoch, true),
        }));
      if (!matching.length) continue;

      const details = await read(
        matching.flatMap(({ tokenKey, claimedKey }) => [tokenKey, claimedKey])
      );
      for (const { epoch, amount, tokenKey, claimedKey } of matching) {
        const token = String(details.get(tokenKey.toXDR("base64")) ?? "");
        if (!token) throw new Error(`Reward token unavailable for epoch ${epoch}.`);
        rewards.push({
          epoch,
          amount,
          token,
          isNative: token === nativeToken,
          claimed: details.get(claimedKey.toXDR("base64")) === true,
        });
      }
    }
    return rewards;
  }

  async claimReward(address: string, epoch: bigint, signer: QueueSigner): Promise<string> {
    const recipient = Address.fromString(address).toScVal();
    const account = await this.client.rpcServer.getAccount(address);
    const transaction = await this.client.prepareTransaction(
      "claim_reward",
      account,
      recipient,
      nativeToScVal(epoch, { type: "u64" })
    );
    return this.client.submitTransaction(transaction, signer);
  }
}
