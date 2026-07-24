/* Guard: the history chart must not silently clip its requested time domain.
 * A narrow container makes fitContent (with minBarSpacing 0.05) show only the
 * trailing bars — the exact 2016→2019 clip this project already hit. We feed
 * the clipped logical range such a container produces and assert the throw.
 * (lightweight-charts needs a real 2D canvas jsdom lacks, so we test the pure
 * guard the chart calls, not a live render.) */

import { describe, expect, it } from "vitest";

import { assertDomainRendered } from "../src/theme/domainGuard";

const N = 2608; // full KRW 10y history
const REQ = { first: "2016-01-04", last: "2026-07-24" };

describe("assertDomainRendered", () => {
  it("throws when a narrow container clips the early years", () => {
    // ~100px container at minBarSpacing 0.05 shows ~2000 of 2608 bars,
    // dropping the front → from ≈ 608.
    expect(() =>
      assertDomainRendered({ from: 608, to: N - 1 }, N, REQ),
    ).toThrow(/clipped the requested domain/);
  });

  it("includes both the requested and rendered ranges in the message", () => {
    expect(() =>
      assertDomainRendered({ from: 608, to: N - 1 }, N, REQ),
    ).toThrow(/2016-01-04…2026-07-24.*608\.0/s);
  });

  it("does not throw when the full domain is visible", () => {
    expect(() =>
      assertDomainRendered({ from: -0.5, to: N - 0.5 }, N, REQ),
    ).not.toThrow();
  });

  it("tolerates up to one bar of edge slack", () => {
    expect(() =>
      assertDomainRendered({ from: 1, to: N - 2 }, N, REQ),
    ).not.toThrow();
  });

  it("throws on a clipped tail as well as a clipped head", () => {
    expect(() =>
      assertDomainRendered({ from: -0.5, to: N - 50 }, N, REQ),
    ).toThrow(/clipped/);
  });

  it("is a no-op before the first layout pass (null range)", () => {
    expect(() => assertDomainRendered(null, N, REQ)).not.toThrow();
  });
});
