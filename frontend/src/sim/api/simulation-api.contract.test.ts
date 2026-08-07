// @vitest-environment jsdom
//
// jsdom, where this test used to run under plain `node` (2026-08-07). The
// simulation's API_BASE is the monitor's now, and the monitor's default is the
// EMPTY STRING — same-origin, so the deployed site's fetches go to
// `/api/simulate` and Next's rewrite proxies them. A relative URL resolves
// against the document origin, and `node` has no document: fetch could not
// even form the request, so every case failed as "cannot reach the server"
// before MSW saw it. It used to pass only because the simulation carried its
// own absolute :8200 default, which is exactly what the merge deleted.
//
// jsdom supplies the origin the browser would. Nothing here is mocked that
// was not mocked before.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ApiError } from "@/sim/lib/api-client";

import { DEFAULT_SCENARIO_PARAMS, EMPTY_SIMULATION_INPUTS } from "../types/simulation-port";
import { buildSimulateRequest } from "../lib/scenario-curves";
import { simulationApi } from "./simulation-api";
import { API_BASE } from "@/sim/lib/api-client";

const ENDPOINT = `${API_BASE}/api/simulate`;

const FIXTURE = {
  chartData: [
    { day: 0, totalPnL: 0 },
    { day: 180, totalPnL: 12_345 },
  ],
  summary: { finalMTM: -100, finalCarry: 200, finalSwap: 50, finalTotal: 150, breakEvenDay: 90 },
};

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const requestFor = (overrides = {}) =>
  buildSimulateRequest({ ...EMPTY_SIMULATION_INPUTS, baseDate: "2026-01-01", ...overrides }, DEFAULT_SCENARIO_PARAMS);

describe("simulationApi.simulate contract", () => {
  it("POSTs the assembled request and returns the parsed SimulateResponse", async () => {
    let received: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        received = await request.json();
        return HttpResponse.json(FIXTURE);
      }),
    );

    const result = await simulationApi.simulate(requestFor());

    expect(result).toEqual(FIXTURE);
    expect(received).toMatchObject({ shockType: "ramp", shockMode: "matrix", simDays: 180, baseShockBp: 30 });
  });

  it("surfaces the backend's error detail as an ApiError with status", async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.json({ detail: "engine boom" }, { status: 500 })),
    );

    await expect(simulationApi.simulate(requestFor())).rejects.toMatchObject({
      name: "ApiError",
      message: "engine boom",
      status: 500,
    });
    await expect(simulationApi.simulate(requestFor())).rejects.toBeInstanceOf(ApiError);
  });

  it("maps a network failure to the friendly ApiError (status 0)", async () => {
    server.use(
      http.post(ENDPOINT, () => HttpResponse.error()),
    );

    await expect(simulationApi.simulate(requestFor())).rejects.toMatchObject({ status: 0 });
  });
});
