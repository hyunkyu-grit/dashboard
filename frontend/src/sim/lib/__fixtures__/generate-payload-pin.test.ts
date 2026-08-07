/**
 * FB4 T1 — the wire-byte pin for the request builder. `payload-pin.json` was
 * captured once against the untouched base builder (krw-fi-pms @ acb395f); this
 * asserts that the builder still produces those exact payloads for a
 * representative spread of selections.
 *
 * CHANGED IN THE PORT, twice:
 *
 *  1. The fixture path pointed at the old tree (`src/features/simulation/...`).
 *  2. More seriously, the original wrote the fixture when it was ABSENT and
 *     only asserted when it was present. Under a moved path that branch is the
 *     difference between a failing test and a silently regenerated golden — a
 *     pin that pins whatever you last did. The fixture is captured and
 *     committed, so the write branch is gone: absent fixture is now a failure,
 *     which is what it always should have been.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildSimulateRequest } from "../scenario-curves";
import {
  DEFAULT_SCENARIO_PARAMS,
  EMPTY_SIMULATION_INPUTS,
  type ScenarioParams,
  type SimulationInputs,
} from "../../types/simulation-port";

const FIXTURE = join(process.cwd(), "src", "sim", "lib", "__fixtures__", "payload-pin.json");

const INPUTS: SimulationInputs = { ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-07-15" };

/** Representative selections — every (baseDate, simDays) shape the new date
 * pickers can express, incl. a non-preset horizon and an N1 non-3Y anchor. */
export const PIN_CASES: Array<{ name: string; inputs: SimulationInputs; params: ScenarioParams }> = [
  { name: "default-180d", inputs: INPUTS, params: { ...DEFAULT_SCENARIO_PARAMS } },
  {
    name: "past-base-90d-shaped",
    inputs: { ...INPUTS, baseDate: "2026-07-10" },
    params: {
      ...DEFAULT_SCENARIO_PARAMS,
      simDays: 90,
      baseShockBp: "-25",
      waypoints: [
        { day: 0, bp: 0 },
        { day: 30, bp: -20 },
        { day: 60, bp: -10 },
        { day: 90, bp: -25 },
      ],
      touchedWaypointDays: [30, 60],
      spread1y: "-5",
      spread10y: "8",
      creditSpreads: { 특은채: "3", 은행채: "4", 카드채: "12", 회사채: "6" },
      irsSpread: "2",
      shortEndEvents: [{ id: 0, date: "2026-08-20", shiftBp: "-25" }],
    },
  },
  {
    name: "cap-365d",
    inputs: INPUTS,
    params: {
      ...DEFAULT_SCENARIO_PARAMS,
      simDays: 365,
      waypoints: [
        { day: 0, bp: 0 },
        { day: 365, bp: 30 },
      ],
    },
  },
  {
    name: "non-preset-100d-anchor-5y",
    inputs: INPUTS,
    params: {
      ...DEFAULT_SCENARIO_PARAMS,
      simDays: 100,
      anchorTenor: "5Y",
      baseShockBp: "20",
      spread10y: "10",
      waypoints: [
        { day: 0, bp: 0 },
        { day: 100, bp: 20 },
      ],
    },
  },
];

describe("FB4 T1 payload pin", () => {
  it("the builder still emits the base builder's wire bytes for every pin case", () => {
    const built = Object.fromEntries(
      PIN_CASES.map((c) => [c.name, buildSimulateRequest(c.inputs, c.params)]),
    );
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf-8"));
    expect(built).toEqual(fixture);
  });
});
