import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseWalletContext = jest.fn();
jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: () => mockUseWalletContext(),
}));

const mockGetTokenBalance = jest.fn();
const mockCreateProposal = jest.fn();
jest.mock("linkora-sdk", () => ({
  MIN_PROPOSAL_TOKEN_BALANCE: 1n,
  GovParameter: { FeeBps: "FeeBps", Treasury: "Treasury" },
  LinkoraClient: jest.fn().mockImplementation(() => ({})),
  GovernanceClient: jest.fn().mockImplementation(() => ({
    getTokenBalance: (...args: unknown[]) => mockGetTokenBalance(...args),
    createProposal: (...args: unknown[]) => mockCreateProposal(...args),
  })),
}));

jest.mock("@/components/governance/MarkdownPreview", () => ({
  MarkdownPreview: ({ markdown }: { markdown: string }) => (
    <div data-testid="markdown-preview">{markdown}</div>
  ),
}));

import NewProposalPage from "../page";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("NewProposalPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGetTokenBalance.mockReset();
    mockCreateProposal.mockReset();
    mockUseWalletContext.mockReturnValue({ address: ADDRESS, connected: true });
    mockGetTokenBalance.mockResolvedValue(5n);
  });

  it("shows the form only after the token balance gate passes", async () => {
    render(<NewProposalPage />);

    expect(await screen.findByLabelText("Title")).toBeInTheDocument();
    expect(mockGetTokenBalance).toHaveBeenCalledWith(ADDRESS);
  });

  it("withholds the form when the wallet is below the minimum balance", async () => {
    mockGetTokenBalance.mockResolvedValue(0n);

    render(<NewProposalPage />);

    expect(await screen.findByTestId("ineligible-message")).toBeInTheDocument();
    expect(screen.queryByLabelText("Title")).not.toBeInTheDocument();
  });

  it("renders the markdown description in the preview tab", async () => {
    render(<NewProposalPage />);
    await screen.findByLabelText("Title");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lower fees" } });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "## Motivation\n\nThis **helps** creators." },
    });
    fireEvent.click(screen.getByRole("button", { name: "preview" }));

    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("## Motivation");
    expect(screen.getByRole("heading", { name: "Lower fees" })).toBeInTheDocument();
  });

  it("validates required fields before submitting", async () => {
    render(<NewProposalPage />);
    await screen.findByLabelText("Title");

    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));

    expect(await screen.findByText("A title is required.")).toBeInTheDocument();
    expect(screen.getByText("A description is required.")).toBeInTheDocument();
    expect(mockCreateProposal).not.toHaveBeenCalled();
  });

  it("submits the calldata through GovernanceClient and redirects", async () => {
    mockCreateProposal.mockResolvedValue({ proposalId: 7n });

    render(<NewProposalPage />);
    await screen.findByLabelText("Title");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Lower fees" } });
    fireEvent.change(screen.getByLabelText(/Description/), {
      target: { value: "Reduce the fee." },
    });
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));

    await waitFor(() =>
      expect(mockCreateProposal).toHaveBeenCalledWith(
        ADDRESS,
        { parameter: "FeeBps", newValue: 500n, newAddress: null },
        expect.objectContaining({ signTransaction: expect.any(Function) })
      )
    );
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/governance/7"));
  });
});
