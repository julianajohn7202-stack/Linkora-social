import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before the import of the component under test
// ---------------------------------------------------------------------------

const mockGetTipTotals = jest.fn();
const mockGetReceivedTips = jest.fn();
const mockGetRewards = jest.fn();

jest.mock("linkora-sdk", () => ({
  LinkoraClient: jest.fn(),
  TipClient: jest.fn(() => ({
    getTipTotals: mockGetTipTotals,
    getReceivedTips: mockGetReceivedTips,
    getRewards: mockGetRewards,
  })),
  NETWORK_PASSPHRASES: { testnet: "Test SDF Network ; September 2015" },
}));

jest.mock("@stellar/freighter-api", () => ({ signTransaction: jest.fn() }));

const mockUseWallet = jest.fn();
jest.mock("@/hooks/useWallet", () => ({
  useWallet: () => mockUseWallet(),
}));

jest.mock("next/link", () => {
  const MockLink = ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  );
  MockLink.displayName = "MockLink";
  return MockLink;
});

// Import page AFTER mocks are in place
import CreatorEarningsPage from "./page";

// ---------------------------------------------------------------------------
// Shared test data
// ---------------------------------------------------------------------------

const EMPTY_TIPS = { tips: [], total: 0, nextCursor: null };
const LOADED_TIPS = {
  total: 2,
  nextCursor: null,
  tips: [
    {
      id: 1,
      tipper: "GALICE",
      post_id: 10n,
      amount: 20_000_000n,
      fee: 0n,
      created_at: new Date("2026-09-01"),
    },
    {
      id: 2,
      tipper: "GBOB",
      post_id: 11n,
      amount: 30_000_000n,
      fee: 0n,
      created_at: new Date("2026-09-02"),
    },
  ],
};

function loadTipHistory() {
  mockGetTipTotals.mockResolvedValue({ receivedAmount: 50_000_000n });
  mockGetReceivedTips.mockResolvedValue(LOADED_TIPS);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function connectedWallet(address = "GTEST123") {
  mockUseWallet.mockReturnValue({ address, connected: true });
}

function disconnectedWallet() {
  mockUseWallet.mockReturnValue({ address: null, connected: false });
}

beforeEach(() => {
  mockGetTipTotals.mockReset();
  mockGetReceivedTips.mockReset();
  mockGetRewards.mockReset();
  mockGetTipTotals.mockResolvedValue({ receivedAmount: 0n });
  mockGetReceivedTips.mockResolvedValue(EMPTY_TIPS);
  mockGetRewards.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreatorEarningsPage", () => {
  describe("disconnected state", () => {
    it("shows the connect-wallet prompt when wallet is not connected", async () => {
      disconnectedWallet();
      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByTestId("earnings-disconnected")).toBeInTheDocument());
    });
  });

  describe("loading state", () => {
    it("shows a loading skeleton while data is fetching", () => {
      connectedWallet();
      // Never resolves during this test
      mockGetReceivedTips.mockReturnValue(new Promise(() => {}));
      render(<CreatorEarningsPage />);

      expect(screen.getByTestId("earnings-loading")).toBeInTheDocument();
    });
  });

  describe("empty state", () => {
    it("shows EarningsEmptyState when creator has no tips", async () => {
      connectedWallet();

      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByTestId("earnings-empty-state")).toBeInTheDocument());
    });

    it("displays 'No earnings yet' heading inside the empty state", async () => {
      connectedWallet();

      render(<CreatorEarningsPage />);

      await waitFor(() =>
        expect(screen.getByRole("heading", { name: /no earnings yet/i })).toBeInTheDocument()
      );
    });

    it("has a CTA linking to /feed", async () => {
      connectedWallet();

      render(<CreatorEarningsPage />);

      await waitFor(() =>
        expect(screen.getByRole("link", { name: /share your first post/i })).toHaveAttribute(
          "href",
          "/feed"
        )
      );
    });
  });

  describe("error state", () => {
    it("shows an error message when fetching fails", async () => {
      connectedWallet();
      mockGetReceivedTips.mockRejectedValue(new Error("Network failure"));

      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
      expect(screen.getByText(/network failure/i)).toBeInTheDocument();
    });

    it("shows a Retry button on error that re-triggers fetch", async () => {
      connectedWallet();
      mockGetReceivedTips
        .mockRejectedValueOnce(new Error("Oops"))
        .mockResolvedValueOnce(EMPTY_TIPS);

      render(<CreatorEarningsPage />);

      await waitFor(() =>
        expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument()
      );

      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: /retry/i }));

      // After retry, should show empty state (not error)
      await waitFor(() => expect(screen.getByTestId("earnings-empty-state")).toBeInTheDocument());
    });
  });

  describe("loaded state", () => {
    it("shows earnings dashboard when creator has tips", async () => {
      connectedWallet();
      loadTipHistory();

      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByTestId("earnings-dashboard")).toBeInTheDocument());
    });

    it("displays the total earnings summary card", async () => {
      connectedWallet();
      loadTipHistory();

      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByTestId("earnings-total")).toBeInTheDocument());
      expect(screen.getByText("50,000,000 base units")).toBeInTheDocument();
    });

    it("renders the tip history table", async () => {
      connectedWallet();
      loadTipHistory();

      render(<CreatorEarningsPage />);

      await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
      expect(screen.getByText("2026-09-01")).toBeInTheDocument();
      expect(screen.getByText("2026-09-02")).toBeInTheDocument();
    });

    it("links transactions to the sender and post", async () => {
      connectedWallet();
      loadTipHistory();
      render(<CreatorEarningsPage />);

      expect(await screen.findByRole("link", { name: "GALICE" })).toHaveAttribute(
        "href",
        "/profile/GALICE"
      );
      expect(screen.getByRole("link", { name: "#10" })).toHaveAttribute("href", "/posts/10");
    });
  });

  describe("page structure", () => {
    it("renders the page heading 'Earnings'", async () => {
      disconnectedWallet();
      render(<CreatorEarningsPage />);

      // The heading is always rendered, regardless of wallet state
      expect(screen.getByRole("heading", { name: /^earnings$/i })).toBeInTheDocument();
    });
  });
});
