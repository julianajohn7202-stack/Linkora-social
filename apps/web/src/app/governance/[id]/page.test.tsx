import { render, screen } from "@testing-library/react";

const mockGovGetProposal = jest.fn();
const mockEffectiveQuorum = jest.fn();
const mockFetch = jest.fn();
const originalFetch = global.fetch;

jest.mock("next/navigation", () => ({
  useParams: () => ({ id: "1" }),
}));

jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: () => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    connected: true,
  }),
}));

jest.mock("@/components/VotePanel", () => ({
  VotePanel: () => require("react").createElement("button", null, "Vote For"),
}));

jest.mock("linkora-sdk", () => {
  const actual = jest.requireActual("linkora-sdk");
  return {
    ...actual,
    LinkoraClient: jest.fn(() => ({
      govGetProposal: mockGovGetProposal,
      effectiveQuorum: mockEffectiveQuorum,
    })),
    parseContractEvent: jest.fn(() => null),
  };
});

const originalContractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
process.env.NEXT_PUBLIC_CONTRACT_ID = "test-contract";
const ProposalPage = require("./page").default as typeof import("./page").default;
if (originalContractId === undefined) delete process.env.NEXT_PUBLIC_CONTRACT_ID;
else process.env.NEXT_PUBLIC_CONTRACT_ID = originalContractId;

describe("GovernanceProposalPage", () => {
  beforeEach(() => {
    mockGovGetProposal.mockResolvedValue({
      id: 1n,
      parameter: "FeeBps",
      proposer: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      status: "Active",
      new_value: 1000n,
      new_address: null,
      created_ledger: 42,
      votes_for: 3,
      votes_against: 1,
    });
    mockEffectiveQuorum.mockResolvedValue(10);
    mockFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ result: { events: [] } }),
    });
    global.fetch = mockFetch as typeof fetch;
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it("renders proposal details, quorum breakdown, and voting controls for an active proposal", async () => {
    render(<ProposalPage />);

    expect(await screen.findByRole("heading", { name: "Update FeeBps" })).toBeInTheDocument();
    expect(await screen.findByText("No votes have been recorded yet.")).toBeInTheDocument();
    expect(
      screen.getByText("This proposal requests changing the protocol's fee bps to 1000.")
    ).toBeInTheDocument();
    expect(screen.getByText("Proposer")).toBeInTheDocument();
    expect(screen.getAllByText("Quorum: 10")).toHaveLength(2);
    expect(screen.getByText("3 for · 1 against")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Vote history" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Vote For" })).toBeInTheDocument();
  });
});
