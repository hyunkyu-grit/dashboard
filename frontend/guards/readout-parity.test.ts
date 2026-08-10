/* Guard (§C): the popup must render at least every readout the preview does.
 * A larger view with fewer readouts is the defect this catches — it stops the
 * next feature from landing on only one surface. Mechanically: the popup's
 * declared readout set must be a superset of the preview's.
 *
 * Extended in pass L to the table's two LEVEL surfaces. 현재 and the 52-week
 * high/low/mean are the same quantity in the same unit, so they must print
 * IDENTICALLY — byte for byte, for every instrument kind. The failure this
 * pins has already shipped in this repo once: the carry & roll block rounded
 * its components and its headline separately and the parts summed to −3.2
 * against a −3.1 total, purely from display digits. */

import { describe, expect, it } from "vitest";

import { code } from "./_source";

import type { Unit } from "../src/lib/api";
import { entryLevelText } from "../src/ui/BacktestWindow";
import { levelText, rangeText } from "../src/ui/cells";
import {
  CURVE_READOUTS,
  POPUP_READOUTS,
  PREVIEW_READOUTS,
} from "../src/ui/readouts";
import type { Row } from "../src/ui/rows";

describe("the popup is a superset of the preview (§C)", () => {
  it("every preview readout is also in the popup", () => {
    const popup = new Set(POPUP_READOUTS);
    for (const r of PREVIEW_READOUTS) {
      expect(popup.has(r), `popup is missing the preview readout "${r}"`).toBe(true);
    }
  });
});

/* pass N: the idle curve got the preview's readout, on a tenor instead of a
 * date. Two surfaces answering one question must not drift into two answers, so
 * the sets are pinned against each other and both must route through the one
 * shared card. The interesting failure this catches is the cheap one: adding a
 * statistic to whichever surface you happen to be editing. */
describe("the curve tooltip and the preview tooltip are one readout (§C)", () => {
  it("the two sets differ ONLY in what x is", () => {
    const swapXForTenor = (r: string) => (r === "date" ? "tenor" : r);
    expect([...CURVE_READOUTS].sort()).toEqual(
      [...PREVIEW_READOUTS].map(swapXForTenor).sort(),
    );
  });

  it("the curve names a tenor, never a date", () => {
    // a curve node has no date: its x is a tenor, and claiming otherwise would
    // put a second answer for a hovered DATE on the screen (§I)
    expect(CURVE_READOUTS).toContain("tenor");
    expect(CURVE_READOUTS).not.toContain("date");
    expect(PREVIEW_READOUTS).not.toContain("tenor");
  });

  it("both surfaces render the ONE shared card, and neither rounds", () => {
    for (const f of ["ui/CurveView.tsx", "ui/PreviewChart.tsx"]) {
      const src = code(f);
      expect(src, `${f} does not use the shared readout card`).toMatch(
        /<ReadoutCard/,
      );
      // labels come from the shared map, so the two cannot word one row
      // differently while showing the same statistic
      expect(src, `${f} hardcodes a readout label`).toMatch(/READOUT_LABEL\./);
    }
    // The card itself is the only place a readout number is formatted, and it
    // formats through fmtLevel/fmtDelta. No toFixed anywhere in it.
    const card = code("ui/ReadoutCard.tsx");
    expect(card).toContain("fmtLevel");
    expect(card).toContain("fmtDelta");
    expect(card, "the shared card rounds for display itself").not.toMatch(
      /toFixed/,
    );
    expect(code("ui/PreviewChart.tsx")).not.toMatch(/toFixed\(\s*[24]\s*\)/);
  });

  it("the curve reads its statistics from the payload, never differences them", () => {
    // §16: `deltas.d1` and `range1y` are the backend's. A `now - prev` here
    // would be a browser-side calculation AND would disagree with the table's
    // 어제 column at the displayed precision.
    const src = code("ui/CurveView.tsx");
    expect(src).toMatch(/deltas\.d1/);
    expect(src).toMatch(/range1y\.(max|min|avg)/);
    expect(src, "the curve differences levels in the browser").not.toMatch(
      /now\s*-\s*(n\.)?prev/,
    );
  });
});

describe("현재 and the 52-week stats are one grammar (pass L)", () => {
  // one row per instrument kind, each with its own unit; the level itself is
  // irrelevant to the formatter beyond its unit, which is the point
  const KINDS: { kind: string; unit: Unit }[] = [
    { kind: "outright", unit: "%" },
    { kind: "forward", unit: "%" },
    { kind: "spread", unit: "bp" },
    { kind: "fly", unit: "bp" },
    { kind: "volatility", unit: "ratio" },
  ];

  // values chosen to exercise every branch of the display grammar: a plain
  // rate, a negative bp spread, a value that rounds at the 4th decimal, a
  // trailing-zero case, an integer, zero, and the null placeholder
  const VALUES: (number | null)[] = [
    3.1234, -100.5, 4.24455, 2.5, 0, 12, -0.00004, 999.9999, null,
  ];

  function rowWith(now: number | null, unit: Unit): Row {
    return {
      id: "x",
      label: "x",
      group: "outright",
      unit,
      now,
      changes: { d1: null, mtd: null, ytd: null },
      pct: null,
      seriesId: null,
      rangeHigh: null,
      rangeLow: null,
      rangeAvg: null,
      key: true,
      sortKey: [1],
      movePct: null,
    };
  }

  it("the two paths agree byte for byte on every kind and every value", () => {
    for (const { kind, unit } of KINDS) {
      for (const v of VALUES) {
        const viaLevel = levelText(rowWith(v, unit));
        const viaRange = rangeText(v, unit);
        expect(
          viaRange,
          `${kind} (${unit}) at ${v}: 현재 printed "${viaLevel}" but the ` +
            `52-week cell printed "${viaRange}" — one quantity, two roundings`,
        ).toBe(viaLevel);
      }
    }
  });

  it("the null placeholder is the same em dash on both paths", () => {
    for (const { unit } of KINDS) {
      expect(rangeText(null, unit)).toBe(levelText(rowWith(null, unit)));
      expect(rangeText(null, unit)).toBe("—");
    }
  });

  it("the backtest's entry level is the SAME bytes as the main table's level (pass P)", () => {
    // The backtest entry row prints the level the table prints — one
    // quantity, one grammar, byte for byte. The failure this pins shipped in
    // that very sheet: `${p.entryValue}` raw and `${l.entryRate}%` raw, a
    // second display grammar beside fmtLevel's.
    for (const { kind, unit } of KINDS) {
      for (const v of VALUES) {
        expect(
          entryLevelText(v, unit),
          `${kind} (${unit}) at ${v}: backtest entry and 현재 disagree`,
        ).toBe(levelText(rowWith(v, unit)));
      }
    }
  });

  it("the backtest sheet rounds nothing for DISPLAY of its own", () => {
    // levels route through entryLevelText (= fmtLevel); money through
    // fmtKrw's integer-won Math.round. A toFixed on a displayed quantity is
    // a second grammar — the deleted fmtMove used one on its bp difference.
    // The only toFixed allowed is the SVG path-coordinate form `x(…)/y(…)
    // .toFixed(1)`, which rounds PIXELS, exactly as PreviewChart does.
    // 2026-08-10: PnlChart/LinkedPnlChart 가 BacktestPnlCharts.tsx 로,
    // 포매터가 krw.ts 로 나갔다 — 같은 규칙이 그 파일들도 스캔한다.
    for (const f of ["ui/BacktestWindow.tsx", "ui/BacktestPnlCharts.tsx", "ui/krw.ts"]) {
      const src = code(f);
      const all = (src.match(/\.toFixed\(/g) ?? []).length;
      const pixels = (src.match(/[xy]\([^()]*\)\.toFixed\(1\)/g) ?? []).length;
      expect(all, `${f}: a toFixed that is not a pixel coordinate`).toBe(pixels);
    }
  });

  it("neither surface reimplements the rounding", () => {
    // `identifiers` would blank the class strings we do not care about here;
    // `code` keeps them and still strips the comments above, which name
    // toFixed on purpose.
    for (const f of ["ui/cells.ts", "ui/RangeCells.tsx", "ui/InstrumentTable.tsx"]) {
      expect(code(f), `${f} rounds for display itself`).not.toMatch(/toFixed/);
    }
    // and both wrappers route to the ONE formatter
    expect(code("ui/cells.ts")).toContain("fmtLevel");
    expect((code("ui/cells.ts").match(/fmtLevel\(/g) ?? []).length).toBe(2);
  });
});
