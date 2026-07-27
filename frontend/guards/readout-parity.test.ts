/* Guard (§C): the popup must render at least every readout the preview does.
 * A larger view with fewer readouts is the defect this catches — it stops the
 * next feature from landing on only one surface. Mechanically: the popup's
 * declared readout set must be a superset of the preview's. */

import { describe, expect, it } from "vitest";

import { POPUP_READOUTS, PREVIEW_READOUTS } from "../src/ui/readouts";

describe("the popup is a superset of the preview (§C)", () => {
  it("every preview readout is also in the popup", () => {
    const popup = new Set(POPUP_READOUTS);
    for (const r of PREVIEW_READOUTS) {
      expect(popup.has(r), `popup is missing the preview readout "${r}"`).toBe(true);
    }
  });
});
