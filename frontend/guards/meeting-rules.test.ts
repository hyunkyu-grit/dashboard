/* Guard: policy-meeting rules on the enlarged chart (strip session, Pass E).
 *
 * A BACKDROP, not data: neutral grey, thin, genuinely behind the series (the
 * chart's own background is transparent so a DOM underlay can sit under the
 * canvas — an overlay would paint a backdrop on top of data). Only in the
 * enlarged chart; the preview stays clean. Above a recorded density they are
 * DROPPED entirely rather than drawn as a hatch. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { meetingsInRange } from "../src/ui/calendar";

const src = (p: string) => readFileSync(join(__dirname, "..", "src", p), "utf8");
const detail = src("wall/DetailChart.tsx");
const preview = src("ui/PreviewChart.tsx");

describe("only the enlarged chart carries them", () => {
  it("the preview chart knows nothing about meetings", () => {
    expect(preview).not.toMatch(/meeting|calendar/i);
  });
});

describe("a backdrop, not data", () => {
  it("neutral ink at low alpha, one pixel wide", () => {
    expect(detail).toMatch(/w-px bg-ink\/15/);
    // never a direction colour — that is reserved for data (§9)
    expect(detail).not.toMatch(/bg-(up|down)/);
  });

  it("sits BEHIND the series: transparent canvas over a DOM underlay", () => {
    expect(detail).toMatch(/background: \{ color: "transparent" \}/);
    // the rules div precedes the chart container, so the canvas paints above
    expect(detail.indexOf("meetingX.map")).toBeLessThan(
      detail.indexOf("ref={containerRef}"),
    );
  });

  it("is inert — it never intercepts the crosshair", () => {
    const layer = detail.slice(
      detail.indexOf("meeting rules"),
      detail.indexOf("ref={containerRef}"),
    );
    expect(layer).toMatch(/pointer-events-none/);
  });
});

describe("density: dropped, never hatched", () => {
  const MAX = Number(detail.match(/const MEETING_RULE_MAX = (\d+)/)?.[1]);

  it("the threshold is recorded in the source", () => {
    expect(MAX).toBeGreaterThan(0);
    expect(detail).toMatch(/recorded threshold/);
  });

  it("about two years of meetings still draw", () => {
    expect(meetingsInRange("2024-01-01", "2025-12-31").length).toBeLessThanOrEqual(MAX);
  });

  it("a decade is far past it, so the rules are dropped entirely", () => {
    expect(meetingsInRange("2016-01-01", "2026-12-31").length).toBeGreaterThan(MAX);
    expect(detail).toMatch(/if \(inView\.length > MEETING_RULE_MAX\) \{\s*setMeetingX\(\[\]\)/);
  });
});
