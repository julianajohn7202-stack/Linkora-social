import type { LinkoraClient } from "./client.js";
import type { QueueSigner, RunOptions } from "./queue.js";
import type { GovParameter } from "./generated/types.js";

/**
 * Minimum governance-token balance (in whole tokens) required to create a
 * proposal. The indexer's voting-power endpoint reports the wallet's token
 * balance, so the same value gates both creation and voting.
 */
export const MIN_PROPOSAL_TOKEN_BALANCE = 1n;

export interface GovernanceProposalDraft {
  parameter: GovParameter;
  newValue: number | bigint;
  newAddress?: string | null;
}

/**
 * Thin governance facade over {@link LinkoraClient}.
 *
 * Keeps proposal eligibility checks and the submit call in one place so the
 * `/governance/new` form cannot drift from the SDK's validation rules. Balance
 * lookups fail closed: a network error means the form stays hidden rather than
 * letting an ineligible wallet attempt a transaction.
 */
export class GovernanceClient {
  constructor(
    private readonly client: LinkoraClient,
    private readonly minimumBalance: bigint = MIN_PROPOSAL_TOKEN_BALANCE
  ) {}

  /** Fetch the wallet's governance-token balance (whole tokens). */
  async getTokenBalance(address: string): Promise<bigint> {
    return this.client.getVotingPower(address);
  }

  /** Whether `address` meets the minimum balance needed to open the form. */
  async canCreateProposal(address: string): Promise<boolean> {
    try {
      return (await this.getTokenBalance(address)) >= this.minimumBalance;
    } catch {
      return false;
    }
  }

  /**
   * Build, sign, and submit a governance proposal.
   *
   * @returns The ID assigned by the governance contract.
   */
  async createProposal(
    proposer: string,
    draft: GovernanceProposalDraft,
    signer: QueueSigner,
    opts?: RunOptions
  ): Promise<{ proposalId: bigint }> {
    return this.client.createProposal(
      proposer,
      draft.parameter,
      draft.newValue,
      draft.newAddress ?? null,
      signer,
      undefined,
      opts
    );
  }
}
