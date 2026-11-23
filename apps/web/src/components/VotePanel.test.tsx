import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TxToast } from "./TxToast";
import { TxToastProvider } from "@/contexts/TxToastContext";

const mockVote = jest.fn();

jest.mock("@/components/WalletProvider", () => ({
  useWalletContext: () => ({
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }),
}));

jest.mock("linkora-sdk", () => ({
  LinkoraClient: jest.fn().mockImplementation(() => ({ vote: mockVote })),
}));

jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(async (xdr: string) => xdr),
}));

const originalContractId = process.env.NEXT_PUBLIC_CONTRACT_ID;
process.env.NEXT_PUBLIC_CONTRACT_ID = "test-contract";

const { VotePanel } = require("./VotePanel") as typeof import("./VotePanel");
if (originalContractId === undefined) delete process.env.NEXT_PUBLIC_CONTRACT_ID;
else process.env.NEXT_PUBLIC_CONTRACT_ID = originalContractId;

function renderVotePanel() {
  return render(
    <TxToastProvider>
      <VotePanel proposalId={7} />
      <TxToast />
    </TxToastProvider>
  );
}

describe("VotePanel", () => {
  beforeEach(() => {
    mockVote.mockReset();
  });

  it("submits a vote through the SDK and locks in the selected choice on success", async () => {
    mockVote.mockResolvedValue({ txHash: "confirmed-hash" });
    renderVotePanel();

    fireEvent.click(screen.getByRole("button", { name: "Vote For" }));

    expect(await screen.findByText("You voted for.")).toBeInTheDocument();
    expect(mockVote).toHaveBeenCalledWith(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      7n,
      "for",
      expect.objectContaining({ signTransaction: expect.any(Function) })
    );
    expect(screen.getByRole("button", { name: "Vote For" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Vote Against" })).toBeDisabled();
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Confirmed");
  });

  it("shows a spinner while pending and an error toast if the transaction fails", async () => {
    let rejectVote!: (error: Error) => void;
    mockVote.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectVote = reject;
      })
    );
    renderVotePanel();

    fireEvent.click(screen.getByRole("button", { name: "Vote Against" }));

    expect(screen.getByText("Voting…")).toBeInTheDocument();
    expect(document.querySelector("svg.animate-spin")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Vote For" })).toBeDisabled();

    rejectVote(new Error("Vote rejected"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Vote rejected"));
    expect(screen.getByRole("button", { name: "Vote Against" })).toBeEnabled();
    expect(screen.queryByText("You voted against.")).not.toBeInTheDocument();
  });
});
