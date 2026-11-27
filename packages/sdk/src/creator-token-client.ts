import { Account, Address, Contract, nativeToScVal, scValToNative, TransactionBuilder } from "@stellar/stellar-base";
import { Api, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import type { LinkoraClient } from "./client.js";
import type { QueueSigner } from "./queue.js";

export class CreatorTokenClient {
  constructor(
    private readonly client: LinkoraClient,
    private readonly networkPassphrase: string,
  ) {}

  async getBalance(token: string, owner: string): Promise<string> {
    const transaction = new TransactionBuilder(new Account(owner, "0"), {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(token).call("balance", new Address(owner).toScVal()))
      .setTimeout(30)
      .build();
    const result = await this.client.rpcServer.simulateTransaction(transaction);
    if (!Api.isSimulationSuccess(result) || !result.result) {
      throw new Error("Could not read creator token balance.");
    }
    return String(scValToNative(result.result.retval));
  }

  async mint(
    token: string,
    owner: string,
    amount: string,
    decimals: number,
    signer: QueueSigner,
  ): Promise<void> {
    if (!/^\d+(?:\.\d+)?$/.test(amount) || !Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
      throw new Error("Invalid creator token amount or precision.");
    }
    const [whole, fraction = ""] = amount.split(".");
    if (fraction.length > decimals) throw new Error("Amount exceeds the token's decimal precision.");
    const units = BigInt(whole + fraction.padEnd(decimals, "0"));
    if (units <= 0n || units >= 2n ** 127n) throw new Error("Creator token amount is out of range.");

    const account = await this.client.rpcServer.getAccount(owner);
    // The factory grants the deployer mint authority on the deployed token.
    const transaction = new TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(token).call(
        "mint",
        new Address(owner).toScVal(),
        nativeToScVal(units, { type: "i128" }),
      ))
      .setTimeout(30)
      .build();
    const simulation = await this.client.rpcServer.simulateTransaction(transaction);
    if (!Api.isSimulationSuccess(simulation) || !simulation.result) {
      throw new Error("Could not prepare mint. Check that the connected wallet is the token admin.");
    }
    const prepared = assembleTransaction(transaction, simulation).build();
    await this.client.submitTransaction(prepared.toXDR(), signer);
  }
}
