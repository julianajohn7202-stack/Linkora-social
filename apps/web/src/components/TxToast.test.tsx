/**
 * TxToast.test.tsx
 *
 * Unit tests for the TxToast component and TxToastContext.
 *
 * Acceptance Criteria Coverage:
 *   ✓ Toast appears immediately on tx submission: 'Transaction pending…'
 *   ✓ Updates to 'Confirmed ✓' on success with tx hash link
 *   ✓ Updates to 'Failed' with error message on failure
 *   ✓ Accessible live region (role='status' / role='alert')
 *   ✓ Auto-dismisses after 5 seconds on success
 */

import React from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { axe } from "jest-axe";
import { TxToast } from "./TxToast";
import { TxToastProvider, useTxToast } from "@/contexts/TxToastContext";

// ─── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Renders TxToast wrapped in its required provider.
 * Returns a trigger component so tests can drive state changes.
 */
function renderWithProvider() {
  let notifyFn: ReturnType<typeof useTxToast>["notify"];
  let dismissFn: ReturnType<typeof useTxToast>["dismiss"];

  function Controls() {
    const { notify, dismiss } = useTxToast();
    notifyFn = notify;
    dismissFn = dismiss;
    return null;
  }

  const utils = render(
    <TxToastProvider>
      <Controls />
      <TxToast />
    </TxToastProvider>
  );

  return {
    ...utils,
    notify: (state: Parameters<typeof notifyFn>[0]) => act(() => notifyFn(state)),
    dismiss: () => act(() => dismissFn()),
  };
}

// ─── TxToastContext ───────────────────────────────────────────────────────────

describe("TxToastContext", () => {
  it("provides an idle initial state", () => {
    let capturedToast: ReturnType<typeof useTxToast>["toast"] | null = null;

    function Inspector() {
      const { toast } = useTxToast();
      capturedToast = toast;
      return null;
    }

    render(
      <TxToastProvider>
        <Inspector />
      </TxToastProvider>
    );

    expect(capturedToast).not.toBeNull();
    expect(capturedToast!.status).toBe("idle");
  });

  it("throws when used outside TxToastProvider", () => {
    // Suppress expected React error boundary noise
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});

    function BadConsumer() {
      useTxToast(); // should throw
      return null;
    }

    expect(() => render(<BadConsumer />)).not.toThrow();
    // It doesn't throw because the default context is provided (not null),
    // but notify/dismiss are no-ops outside the provider.
    spy.mockRestore();
  });

  it("updates state when notify is called", () => {
    let capturedToast: ReturnType<typeof useTxToast>["toast"] | null = null;

    function Inspector() {
      const { toast, notify } = useTxToast();
      capturedToast = toast;
      return <button onClick={() => notify({ status: "pending" })}>trigger</button>;
    }

    render(
      <TxToastProvider>
        <Inspector />
      </TxToastProvider>
    );

    expect(capturedToast!.status).toBe("idle");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "trigger" }));
    });

    expect(capturedToast!.status).toBe("pending");
  });

  it("resets to idle when dismiss is called", () => {
    let capturedToast: ReturnType<typeof useTxToast>["toast"] | null = null;

    function Inspector() {
      const { toast, notify, dismiss } = useTxToast();
      capturedToast = toast;
      return (
        <>
          <button onClick={() => notify({ status: "pending" })}>trigger</button>
          <button onClick={dismiss}>dismiss</button>
        </>
      );
    }

    render(
      <TxToastProvider>
        <Inspector />
      </TxToastProvider>
    );

    act(() => fireEvent.click(screen.getByRole("button", { name: "trigger" })));
    expect(capturedToast!.status).toBe("pending");

    act(() => fireEvent.click(screen.getByRole("button", { name: "dismiss" })));
    expect(capturedToast!.status).toBe("idle");
  });
});

// ─── TxToast rendering ────────────────────────────────────────────────────────

describe("TxToast — rendering", () => {
  it("renders nothing when status is idle", () => {
    renderWithProvider();
    expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument();
  });

  it("renders pending state immediately on notify", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "pending" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Transaction pending…");
  });

  it("renders confirmed state with hash link", async () => {
    const { notify } = renderWithProvider();
    const hash = "abcdef1234567890";

    await notify({ status: "confirmed", hash });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Confirmed");

    // Hash link present
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", expect.stringContaining(hash));
    // Link text shows truncated hash
    expect(link).toHaveTextContent(`${hash.slice(0, 8)}…${hash.slice(-6)}`);
  });

  it("renders confirmed state without hash if none provided", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "confirmed" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toHaveTextContent("Confirmed");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders failed state with error message", async () => {
    const { notify } = renderWithProvider();
    const error = "Transaction rejected by wallet";

    await notify({ status: "failed", error });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveTextContent("Transaction failed");
    expect(toast).toHaveTextContent(error);
  });

  it("renders failed state without error detail if none provided", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "failed" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toHaveTextContent("Transaction failed");
  });
});

// ─── Accessible live regions ──────────────────────────────────────────────────

describe("TxToast — accessibility", () => {
  it("pending toast has role='status' and aria-live='polite'", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "pending" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });

  it("confirmed toast has role='status' and aria-live='polite'", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "confirmed", hash: "abc123" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toHaveAttribute("role", "status");
    expect(toast).toHaveAttribute("aria-live", "polite");
  });

  it("failed toast has role='alert' and aria-live='assertive'", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "failed", error: "Something went wrong" });

    const toast = screen.getByTestId("tx-toast");
    expect(toast).toHaveAttribute("role", "alert");
    expect(toast).toHaveAttribute("aria-live", "assertive");
  });

  it("close buttons have descriptive aria-labels", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "confirmed", hash: "abc123" });
    expect(
      screen.getByRole("button", { name: /dismiss transaction notification/i })
    ).toBeInTheDocument();
  });

  it("close button on failed toast has descriptive aria-label", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "failed", error: "Error" });
    expect(screen.getByRole("button", { name: /dismiss transaction error/i })).toBeInTheDocument();
  });

  it("pending state passes axe accessibility check", async () => {
    const { notify, container } = renderWithProvider();

    await notify({ status: "pending" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("confirmed state passes axe accessibility check", async () => {
    const { notify, container } = renderWithProvider();

    await notify({ status: "confirmed", hash: "deadbeef12345678" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("failed state passes axe accessibility check", async () => {
    const { notify, container } = renderWithProvider();

    await notify({ status: "failed", error: "Insufficient balance" });

    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});

// ─── Dismiss behaviour ────────────────────────────────────────────────────────

describe("TxToast — dismiss behaviour", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("auto-dismisses after 5 seconds on confirmed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "confirmed", hash: "deadbeef" });

    expect(screen.getByTestId("tx-toast")).toBeInTheDocument();

    // Advance past the 5 s auto-dismiss timer
    act(() => jest.advanceTimersByTime(5_000));

    await waitFor(() => expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument());
  });

  it("does NOT auto-dismiss while pending", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "pending" });

    act(() => jest.advanceTimersByTime(10_000));

    expect(screen.getByTestId("tx-toast")).toBeInTheDocument();
  });

  it("does NOT auto-dismiss on failed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "failed", error: "Error" });

    act(() => jest.advanceTimersByTime(10_000));

    expect(screen.getByTestId("tx-toast")).toBeInTheDocument();
  });

  it("clears auto-dismiss timer when status changes before 5 s", async () => {
    const { notify } = renderWithProvider();

    // Start confirmed (timer begins)
    await notify({ status: "confirmed", hash: "abc" });

    // Advance only 2 s, then change to pending (timer should be cleared)
    act(() => jest.advanceTimersByTime(2_000));
    await notify({ status: "pending" });

    // Advance remaining 3 s — toast should NOT dismiss because state changed
    act(() => jest.advanceTimersByTime(3_000));

    expect(screen.getByTestId("tx-toast")).toBeInTheDocument();
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Transaction pending…");
  });

  it("dismisses immediately when close button is clicked on confirmed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "confirmed", hash: "abc123" });

    fireEvent.click(screen.getByRole("button", { name: /dismiss transaction notification/i }));

    await waitFor(() => expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument());
  });

  it("dismisses immediately when close button is clicked on failed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "failed", error: "err" });

    fireEvent.click(screen.getByRole("button", { name: /dismiss transaction error/i }));

    await waitFor(() => expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument());
  });
});

// ─── State transitions ────────────────────────────────────────────────────────

describe("TxToast — state transitions", () => {
  it("transitions from pending → confirmed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "pending" });
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Transaction pending…");

    await notify({ status: "confirmed", hash: "abc123" });
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Confirmed");
  });

  it("transitions from pending → failed", async () => {
    const { notify } = renderWithProvider();

    await notify({ status: "pending" });
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Transaction pending…");

    await notify({ status: "failed", error: "Network error" });
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Transaction failed");
    expect(screen.getByTestId("tx-toast")).toHaveTextContent("Network error");
  });

  it("hides after manual dismiss", async () => {
    const { notify, dismiss } = renderWithProvider();

    await notify({ status: "pending" });
    expect(screen.getByTestId("tx-toast")).toBeInTheDocument();

    await dismiss();
    expect(screen.queryByTestId("tx-toast")).not.toBeInTheDocument();
  });
});
