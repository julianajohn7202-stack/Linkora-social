import { render, screen, waitFor } from "@testing-library/react";

jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: () => ({ address: null, connected: false }),
}));

jest.mock("linkora-sdk", () => {
  const actual = jest.requireActual("linkora-sdk");
  return {
    ...actual,
    LinkoraClient: jest.fn().mockImplementation(() => ({
      govGetProposal: jest.fn(async (id: bigint) => {
        if (id !== 1n) throw new Error("Proposal not found");
        return {
          id: 1n,
          parameter: actual.GovParameter.FeeBps,
          proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          status: actual.GovStatus.Active,
          new_value: 1000n,
          created_ledger: 42,
          votes_for: 3,
          votes_against: 1,
        };
      }),
      effectiveQuorum: jest.fn().mockResolvedValue(10),
    })),
  };
});

const originalContractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
process.env.NEXT_PUBLIC_CONTRACT_ID = "test-contract";
const GovernancePage = require("./page").default;
if (originalContractId === undefined) delete process.env.NEXT_PUBLIC_CONTRACT_ID;
else process.env.NEXT_PUBLIC_CONTRACT_ID = originalContractId;

describe("GovernancePage snapshots", () => {
  it("renders the proposal list from mocked proposal data", async () => {
    const { container } = render(<GovernancePage />);
    const title = await screen.findByRole("heading", { name: "Proposal #1: Update FeeBps" });
    await waitFor(() => expect(container.querySelector(".shadow-sm")).not.toBeNull());

    const proposalCard = title.closest(".shadow-sm");
    expect(proposalCard?.textContent?.replace(/\s+/g, " ").trim()).toMatchInlineSnapshot(
      `"Proposal #1: Update FeeBps Proposer: GAAAAA…AAAA Active New Value 1000 Effective Quorum 10 For: 3 Against: 1"`
    );
  });
});
