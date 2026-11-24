import { act, renderHook, waitFor } from "@testing-library/react";
import { useCreatorToken } from "../useCreatorToken";

const mockFetch = jest.fn();
const mockBalance = jest.fn();
const mockMint = jest.fn();

jest.mock("../../../../../packages/sdk/src/client", () => ({ LinkoraClient: jest.fn() }));
jest.mock("../../../../../packages/sdk/src/tip-client", () => ({
  CreatorTokenClient: jest.fn().mockImplementation(() => ({
    getBalance: mockBalance,
    mint: mockMint,
  })),
}));
jest.mock("@stellar/freighter-api", () => ({ signTransaction: jest.fn() }));

describe("useCreatorToken", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ token: "CTOKEN", info: { name: "Creator", symbol: "CRT", decimals: 7 } }),
    });
    mockBalance.mockResolvedValue("0");
    mockMint.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("skips the indexer for a disconnected wallet", () => {
    const { result } = renderHook(() => useCreatorToken(null));
    expect(result.current.token).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports indexer failures as an Error", async () => {
    mockFetch.mockRejectedValue(new Error("Indexer unavailable"));
    const { result } = renderHook(() => useCreatorToken("GUSER"));
    await waitFor(() => expect(result.current.error?.message).toBe("Indexer unavailable"));
  });

  it("mints through the SDK using the indexed token precision", async () => {
    const { result } = renderHook(() => useCreatorToken("GUSER"));
    await waitFor(() => expect(result.current.token).toBe("CTOKEN"));
    await act(() => result.current.mint("1.25"));
    expect(mockMint).toHaveBeenCalledWith("CTOKEN", "GUSER", "1.25", 7, {
      signTransaction: expect.any(Function),
    });
  });

  it("reads a fresh balance after a matching transfer", async () => {
    const { result } = renderHook(() => useCreatorToken("GUSER"));
    await waitFor(() => expect(result.current.balance).toBe("0"));
    mockBalance.mockResolvedValue("3");
    act(() => {
      window.dispatchEvent(new CustomEvent("linkora:creator-token-transfer", {
        detail: { tokenAddress: "CTOKEN" },
      }));
    });
    await waitFor(() => expect(result.current.balance).toBe("3"));
  });
});
