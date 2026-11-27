/**
 * Unit tests for the sliding-window rate limiter (lib/rateLimit.ts).
 *
 * jsdom provides a sessionStorage implementation, so the tests run against
 * the real storage path without any manual mocking.
 */

import { isAllowed, recordAction, getRemainingActions, RateLimit } from "../lib/rateLimit";

// ── Helpers ──────────────────────────────────────────────────────────────────

const LIMIT: RateLimit = { maxActions: 3, windowMs: 60_000 };

function storageKey(key: string): string {
  return `linkora_ratelimit_${key}`;
}

function clearKey(key: string): void {
  window.sessionStorage.removeItem(storageKey(key));
}

// Seed timestamps directly into sessionStorage to control "past" state.
function seedTimestamps(key: string, timestamps: number[]): void {
  window.sessionStorage.setItem(storageKey(key), JSON.stringify(timestamps));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("isAllowed", () => {
  beforeEach(() => clearKey("test"));

  it("allows an action when no events have been recorded", () => {
    expect(isAllowed("test", LIMIT)).toBe(true);
  });

  it("allows actions while under the limit", () => {
    recordAction("test", LIMIT);
    recordAction("test", LIMIT);
    expect(isAllowed("test", LIMIT)).toBe(true);
  });

  it("returns false when the limit is exactly reached", () => {
    recordAction("test", LIMIT);
    recordAction("test", LIMIT);
    recordAction("test", LIMIT);
    expect(isAllowed("test", LIMIT)).toBe(false);
  });

  it("returns false when the limit is exceeded", () => {
    for (let i = 0; i < 5; i++) recordAction("test", LIMIT);
    expect(isAllowed("test", LIMIT)).toBe(false);
  });

  it("allows again after the window expires", () => {
    const now = Date.now();
    // Seed three timestamps that are just outside the window.
    seedTimestamps("test", [now - 61_000, now - 65_000, now - 70_000]);
    expect(isAllowed("test", LIMIT)).toBe(true);
  });

  it("counts only timestamps within the window (sliding boundary)", () => {
    const now = Date.now();
    // Two inside, one outside.
    seedTimestamps("test", [now - 59_000, now - 30_000, now - 90_000]);
    // 2 active < maxActions 3 → allowed.
    expect(isAllowed("test", LIMIT)).toBe(true);
  });
});

describe("recordAction", () => {
  beforeEach(() => clearKey("rec"));

  it("stores a timestamp in sessionStorage", () => {
    const before = Date.now();
    recordAction("rec", LIMIT);
    const raw = window.sessionStorage.getItem(storageKey("rec"));
    const parsed: number[] = JSON.parse(raw!);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toBeGreaterThanOrEqual(before);
    expect(parsed[0]).toBeLessThanOrEqual(Date.now());
  });

  it("accumulates multiple timestamps", () => {
    recordAction("rec", LIMIT);
    recordAction("rec", LIMIT);
    recordAction("rec", LIMIT);
    const raw = window.sessionStorage.getItem(storageKey("rec"));
    expect(JSON.parse(raw!)).toHaveLength(3);
  });

  it("prunes expired timestamps on record", () => {
    const now = Date.now();
    // Seed one stale entry and two fresh ones.
    seedTimestamps("rec", [now - 120_000, now - 30_000, now - 10_000]);
    recordAction("rec", LIMIT);
    const raw = window.sessionStorage.getItem(storageKey("rec"));
    const parsed: number[] = JSON.parse(raw!);
    // Stale entry pruned; 2 fresh + 1 new = 3.
    expect(parsed).toHaveLength(3);
    parsed.forEach((t) => expect(t).toBeGreaterThan(now - 61_000));
  });
});

describe("getRemainingActions", () => {
  beforeEach(() => clearKey("rem"));

  it("returns maxActions when no events are recorded", () => {
    expect(getRemainingActions("rem", LIMIT)).toBe(3);
  });

  it("decrements as actions are recorded", () => {
    recordAction("rem", LIMIT);
    expect(getRemainingActions("rem", LIMIT)).toBe(2);
    recordAction("rem", LIMIT);
    expect(getRemainingActions("rem", LIMIT)).toBe(1);
  });

  it("returns 0 when limit is reached", () => {
    recordAction("rem", LIMIT);
    recordAction("rem", LIMIT);
    recordAction("rem", LIMIT);
    expect(getRemainingActions("rem", LIMIT)).toBe(0);
  });

  it("never returns a negative value", () => {
    for (let i = 0; i < 10; i++) recordAction("rem", LIMIT);
    expect(getRemainingActions("rem", LIMIT)).toBe(0);
  });

  it("restores full count after window expires", () => {
    const now = Date.now();
    seedTimestamps("rem", [now - 61_000, now - 70_000, now - 80_000]);
    expect(getRemainingActions("rem", LIMIT)).toBe(3);
  });

  it("counts only in-window timestamps accurately", () => {
    const now = Date.now();
    // 1 expired, 2 active.
    seedTimestamps("rem", [now - 90_000, now - 20_000, now - 10_000]);
    expect(getRemainingActions("rem", LIMIT)).toBe(1);
  });
});

describe("window auto-reset (sliding behavior)", () => {
  it("actions recorded before the window become irrelevant over time", () => {
    // Simulate: limit reached, then all timestamps slide out of the window.
    const now = Date.now();
    seedTimestamps("slide", [now - 61_000, now - 62_000, now - 63_000]);
    expect(isAllowed("slide", LIMIT)).toBe(true);
    clearKey("slide");
  });
});
