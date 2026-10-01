import { renderHook, act } from "@testing-library/react";
import { useConfetti } from "../useConfetti";

// canvas-confetti exports a callable function as its default export.
// We need the mock to be callable AND have a `.default` property pointing to
// the same function, because our code does:
//   const { default: confetti } = await import("canvas-confetti");
const mockConfetti = jest.fn();

jest.mock("canvas-confetti", () => {
  const fn = jest.fn();
  // Make the module look like an ES-module default export in Jest's CJS
  // module system: the module IS the function, and `.default` also points to it.
  (fn as any).default = fn;
  return fn;
});

// Grab the module reference after the mock is installed.
beforeAll(async () => {
  const mod = await import("canvas-confetti");
  // Replace the local reference so assertions can use it.
  mockConfetti.mockImplementation((opts: unknown) => (mod as any).default(opts));
});

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  // Default: motion is allowed
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: jest.fn().mockReturnValue({ matches: false }),
  });
});

describe("useConfetti", () => {
  it("fires confetti on the first call", async () => {
    const { result } = renderHook(() => useConfetti());
    await act(async () => {
      await result.current.fireTipConfetti();
    });
    // The canvas-confetti module function should have been called once
    const mod = await import("canvas-confetti");
    expect((mod as any).default).toHaveBeenCalledTimes(1);
  });

  it("does not fire confetti a second time in the same session", async () => {
    const { result } = renderHook(() => useConfetti());
    await act(async () => {
      await result.current.fireTipConfetti();
      await result.current.fireTipConfetti();
    });
    const mod = await import("canvas-confetti");
    expect((mod as any).default).toHaveBeenCalledTimes(1);
  });

  it("does not fire if prefers-reduced-motion is set", async () => {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    });
    const { result } = renderHook(() => useConfetti());
    await act(async () => {
      await result.current.fireTipConfetti();
    });
    const mod = await import("canvas-confetti");
    expect((mod as any).default).not.toHaveBeenCalled();
  });

  it("sets the sessionStorage key after firing", async () => {
    const { result } = renderHook(() => useConfetti());
    await act(async () => {
      await result.current.fireTipConfetti();
    });
    expect(sessionStorage.getItem("linkora:confetti:tip_fired")).toBe("1");
  });

  it("does not fire if the sessionStorage key is already set", async () => {
    sessionStorage.setItem("linkora:confetti:tip_fired", "1");
    const { result } = renderHook(() => useConfetti());
    await act(async () => {
      await result.current.fireTipConfetti();
    });
    const mod = await import("canvas-confetti");
    expect((mod as any).default).not.toHaveBeenCalled();
  });
});
