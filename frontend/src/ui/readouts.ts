/* Readout registry (DESIGN §C, Session 16). The popup is a LARGER view of the
 * same series as the preview, so it must render at least every readout the
 * preview does — a bigger view with less information is a defect. These are the
 * canonical readout keys each surface renders; `guards/readout-parity.test.ts`
 * asserts the popup's set is a superset of the preview's, so the next feature
 * cannot land on only one of them.
 *
 * Each surface's chart component renders exactly its declared set (the link is
 * a convention, like ROW_FIELD_SOURCE). Keys are semantic, not the visible
 * labels (which differ — 10년 vs 구간 — by §F). */

export type Readout =
  | "date"
  | "tenor" // the curve's x identity, where a time series has a date
  | "level"
  | "rangeHigh"
  | "rangeLow"
  | "rangeAvg"
  | "dailyChange"
  | "crosshair"
  | "lastValue"; // popup-only badge (LWC lastValueVisible)

/** PreviewChart (hand-rolled SVG) tooltip + crosshair. */
export const PREVIEW_READOUTS: Readout[] = [
  "date",
  "level",
  "rangeHigh",
  "rangeLow",
  "rangeAvg",
  "dailyChange",
  "crosshair",
];

/** CurveView's idle-curve tooltip + crosshair [OWNER, pass N]. The SAME
 * statistics as the preview, on a different x: hovering a curve node answers
 * "what is this tenor, where does it sit in its own 52 weeks, and how far did it
 * move" — the question the outright's history line already answered, asked of
 * the curve. `tenor` stands where `date` stands; everything else is identical,
 * which is why both surfaces render one shared card (`ui/ReadoutCard.tsx`) and
 * why `guards/readout-parity.test.ts` pins the two sets against each other.
 *
 * §I's "the tooltip is the SOLE readout for a hovered date" is untouched: this
 * is a readout for a hovered TENOR, and it adds no second answer for a date. */
export const CURVE_READOUTS: Readout[] = [
  "tenor",
  "level",
  "rangeHigh",
  "rangeLow",
  "rangeAvg",
  "dailyChange",
  "crosshair",
];

/** DetailChart line mode (lightweight-charts) — a superset: everything the
 * preview shows, plus the last-value badge. */
export const POPUP_READOUTS: Readout[] = [
  "date",
  "level",
  "rangeHigh",
  "rangeLow",
  "rangeAvg",
  "dailyChange",
  "crosshair",
  "lastValue",
];
