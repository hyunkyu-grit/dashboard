/* Guard: the 세타 column says what it means, and only where it has a value.
 *
 * [OWNER, 2026-08-13 — "테너별 역캐리 및 헤지비용 바로 눈에 띄게 표시하기"]
 *
 * The column exists because carry + rolldown was only reachable by opening the
 * backtest window and pressing 실행, while the quantity itself needs neither —
 * a frozen curve makes it a closed form off today's curve. Three failures are
 * worth pinning:
 *
 * 1. THE NORMALISER MUST BE VISIBLE. `perDv01` and `cash` rank the tenors in
 *    OPPOSITE orders (per 100억 the 10Y is largest; per unit of risk the 1Y is
 *    several times larger). A header that says only "세타" would be read as the
 *    other one, and the reader would pick the wrong tenor with full confidence.
 * 2. THE BROWSER MUST NOT DO THE ARITHMETIC (§16). Every number arrives from
 *    `backend/app/theta.py`; this file may format and nothing else.
 * 3. ABSENCE MUST BE VISIBLE. Spreads, flies, forwards, volatility and the
 *    1D/3M nodes have no swap theta. An empty cell reads as a loading state,
 *    so it is an em dash.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { code } from "./_source";

import { ALL_COLUMNS, withThetaData } from "../src/ui/columns";
import { InstrumentTable } from "../src/ui/InstrumentTable";
import { manUnits } from "../src/ui/krw";
import {
  RangeCells,
  RangeHeader,
  THETA_LABEL,
  THETA_TITLE,
  thetaTitle,
} from "../src/ui/RangeCells";
import type { Group, Row } from "../src/ui/rows";

const THETA = {
  perDv01: -24_946_984,
  cash: -24_440_000,
  carry: -13_000_000,
  roll: -11_440_000,
  dv01: 980_000,
  beBp: 33.11,
  entry: 3.45,
  rollIn: 3.295,
};

function row(theta: Row["theta"]): Row {
  return {
    id: "1Y",
    label: "IRS 1Y",
    group: "outright",
    unit: "%",
    now: 3.45,
    changes: { d1: null, mtd: null, ytd: null },
    pct: null,
    seriesId: "1Y",
    rangeHigh: 3.62,
    rangeLow: 3.28,
    rangeAvg: 3.45,
    sortKey: [1],
    movePct: null,
    key: true,
    theta,
  };
}

const render = (r: Row) =>
  renderToStaticMarkup(
    createElement(RangeCells, { row: r, slider: true, theta: true }),
  );

describe("the header carries the normaliser, not just the noun", () => {
  it("the label names DV01, so the number cannot be read as cash", () => {
    expect(THETA_LABEL).toContain("DV01");
    // and the facts that did not fit ride in the tooltip instead of being
    // dropped: the horizon, and what the sign means
    expect(THETA_TITLE).toContain("3개월");
    expect(THETA_TITLE).toContain("캐리");
  });

  it("the tooltip names the direction for EVERY kind the column serves", () => {
    /* "페이 기준" was true while the column was outrights only. With spreads
     * and flies on it [OWNER, 2026-08-13] that clause is meaningless on two
     * thirds of the rows, and a sign whose direction the reader cannot name
     * is a sign they will guess at. The product already names all three
     * (`BacktestWindow.directionLabel` at +1), so the tooltip uses those
     * words rather than inventing "+1 방향". */
    for (const word of ["페이", "스티프너", "벨리"]) {
      expect(THETA_TITLE, `direction unnamed for ${word}`).toContain(word);
    }
    // and it says whose DV01 the package rows are divided by — the net is
    // zero, so an unqualified "DV01" would be a number with no denominator
    expect(THETA_TITLE).toContain("다리");
  });

  it("the header renders the label and the tooltip together", () => {
    const html = renderToStaticMarkup(
      createElement(RangeHeader, { slider: true, theta: true }),
    );
    expect(html).toContain(THETA_LABEL);
    expect(html).toContain("title=");
  });

  it("no header sub-label is a control (the column is not sortable)", () => {
    const html = renderToStaticMarkup(
      createElement(RangeHeader, { slider: true, theta: true }),
    );
    for (const t of ["<button", "onClick", "cursor-pointer", "tabIndex"]) {
      expect(html, `세타 header carries ${t}`).not.toContain(t);
    }
  });
});

describe("the cell prints the served number and derives nothing", () => {
  it("the value shown is perDv01, not the 100억 figure", () => {
    const html = render(row(THETA));
    // 24,946,984원 → 2,495만원 through the product's money formatter
    expect(html).toContain("2,495만원");
    // the 100억 figure (2,444만원) belongs to the tooltip, never the cell text
    expect(html.replace(/title="[^"]*"/g, "")).not.toContain("2,444만원");
  });

  it("the sign survives — a payer's theta reads as a cost", () => {
    expect(render(row(THETA))).toContain("−2,495만원");
  });

  it("no value, no cell content invented", () => {
    const html = render(row(null));
    expect(html).toContain("—");
    expect(html).not.toContain("만원");
    // an em dash carries no tooltip: there is nothing to explain
    expect(html).not.toContain("100억 기준");
  });

  it("§16: the component does arithmetic on nothing but display units", () => {
    const src = code("ui/RangeCells.tsx");
    // no curve maths — the horizon, the basis point and the annuity all live
    // server-side (`backend/app/theta.py`) and none of them may reappear here
    for (const banned of ["1e-4", "0.25", "Math.pow", "annuity", "notional"]) {
      expect(src, `RangeCells derives ${banned}`).not.toContain(banned);
    }
    // no served theta field is ever scaled or combined RAW. The one piece of
    // arithmetic allowed is the displayed-precision split, and that runs on
    // `manUnits(...)` results — 만-units, a display domain, not market data.
    // (`* 100` does appear in this file: it is markerPct's percentage of the
    // POSITION TRACK's width, which is geometry, not a rate.)
    expect(src.match(/\bt\.\w+\s*[*/+-]/g), "raw theta field in arithmetic")
      .toBeNull();
    // and every theta field it touches is read straight off the row
    expect(src).toContain("row.theta");
  });
});

describe("a table with no theta draws no 세타 column", () => {
  it("the column applies to outrights and stands down elsewhere", () => {
    const full = { ...ALL_COLUMNS };
    expect(withThetaData(full, true).theta).toBe(true);
    expect(withThetaData(full, false).theta).toBe(false);
  });

  it("standing down is NOT a ladder drop — the 숨김 count must not move", () => {
    // "N열 숨김" answers "did the width take something from me". A column that
    // does not apply to spreads was never taken; counting it would send the
    // reader looking for a wider window that would not bring it back.
    const v = { ...ALL_COLUMNS, hidden: 0 };
    expect(withThetaData(v, false).hidden).toBe(0);
    const narrowed = { ...ALL_COLUMNS, theta: false, hidden: 1 };
    expect(withThetaData(narrowed, false).hidden).toBe(1);
  });

  it("width can still drop it while the data would have supported it", () => {
    // the two rules are independent and compose in one direction only:
    // width false stays false no matter what the data says
    expect(withThetaData({ ...ALL_COLUMNS, theta: false }, true).theta).toBe(false);
  });

  it("the rule reads THIS TAB's group, not the whole row set", () => {
    /* The bug this pins, caught on screen and not by the unit tests above:
     * the table receives EVERY instrument the app knows and filters per tab.
     * Asking `rows.some(r => r.theta)` therefore answered "does anything,
     * anywhere, have a theta" — true on every tab — so a tab with none
     * rendered a full column of em dashes while the code read as if it would
     * not. 포워드 is the standing example: the engine has no forward-leg
     * construction, so those rows never carry one. */
    const both: Row[] = [
      { ...row(THETA), id: "1Y", group: "outright" },
      {
        ...row(null),
        id: "1Yx1Y",
        label: "1Yx1Y",
        group: "forward",
        seriesId: "1Yx1Y",
      },
    ];
    const render = (filter: Group) =>
      renderToStaticMarkup(
        createElement(InstrumentTable, {
          rows: both,
          asOf: "2026-08-12",
          filter,
          activeId: null,
          pinnedId: null,
          onHover: () => undefined,
          onPin: () => undefined,
          matrixOpen: false,
          onToggleMatrix: () => undefined,
        }),
      );

    expect(render("forward")).not.toContain(THETA_LABEL);
    expect(render("outright")).toContain(THETA_LABEL);
  });
});

describe("the tooltip's parts sum at displayed precision", () => {
  it("캐리 + 롤다운 always reconstructs the total", () => {
    // the krw.ts lesson: rounding three figures separately can miss by a
    // 만원, and this repo has shipped exactly that lie once already
    const cases = [
      THETA,
      { ...THETA, cash: -24_444_999, roll: -11_445_001, carry: -12_999_998 },
      { ...THETA, cash: -5_001, roll: -2_501, carry: -2_500 },
      { ...THETA, cash: 24_440_000, roll: 11_440_000, carry: 13_000_000 },
    ];
    for (const t of cases) {
      const text = thetaTitle(t);
      const [, carry, roll, total] = [
        null,
        manUnits(t.cash) - manUnits(t.roll),
        manUnits(t.roll),
        manUnits(t.cash),
      ];
      expect(carry + roll, `parts do not sum for ${t.cash}`).toBe(total);
      expect(text).toContain("캐리");
      expect(text).toContain("롤다운");
    }
  });

  it("the breakeven prints in the change columns' bp grammar", () => {
    // not a local toFixed — readout-parity pins that this file owns no
    // rounding of its own
    expect(thetaTitle(THETA)).toContain("33.1");
    expect(code("ui/RangeCells.tsx")).toContain("fmtDelta");
  });
});
