import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockFetchSummary = jest.fn();
jest.mock("@/lib/analytics", () => ({
  fetchCreatorDashboardSummary: (...args: unknown[]) => mockFetchSummary(...args),
}));

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

import CreatorPage from "../page";

const ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

describe("CreatorPage", () => {
  beforeEach(() => {
    mockFetchSummary.mockReset();
    mockUseWallet.mockReturnValue({ address: ADDRESS, connected: true });
  });

  it("shows skeletons while loading, then renders all four stat cards", async () => {
    let resolveSummary: (value: unknown) => void = () => {};
    mockFetchSummary.mockReturnValue(
      new Promise((resolve) => {
        resolveSummary = resolve;
      })
    );

    render(<CreatorPage />);

    expect(screen.getAllByLabelText("Loading stat")).toHaveLength(4);
    expect(mockFetchSummary).toHaveBeenCalledWith(ADDRESS, "7d");

    resolveSummary({
      tipsReceived: "1,250",
      postCount: 12,
      followerCount: 340,
      pendingRewards: "75",
    });

    expect(await screen.findByText("1,250 XLM")).toBeInTheDocument();
    expect(screen.getByText("Posts")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("340")).toBeInTheDocument();
    expect(screen.getByText("75 XLM")).toBeInTheDocument();
  });

  it("refetches with the selected date range", async () => {
    mockFetchSummary.mockResolvedValue({
      tipsReceived: "10",
      postCount: 1,
      followerCount: 2,
      pendingRewards: "0",
    });

    render(<CreatorPage />);
    await screen.findByText("10 XLM");

    fireEvent.click(screen.getByRole("button", { name: "All time" }));

    await waitFor(() => expect(mockFetchSummary).toHaveBeenLastCalledWith(ADDRESS, "all"));
  });

  it("asks disconnected visitors to connect instead of fetching", () => {
    mockUseWallet.mockReturnValue({ address: null, connected: false });

    render(<CreatorPage />);

    expect(screen.getByTestId("creator-disconnected")).toBeInTheDocument();
    expect(mockFetchSummary).not.toHaveBeenCalled();
  });

  it("renders a retryable error when the oracle request fails", async () => {
    mockFetchSummary.mockRejectedValueOnce(new Error("oracle down"));

    render(<CreatorPage />);

    expect(await screen.findByTestId("creator-error")).toHaveTextContent("oracle down");
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
