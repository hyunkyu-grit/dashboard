/**
 * Slice-local HTTP client for the Simulation backend (POST /api/simulate).
 *
 * Reuses the app's error shape (`ApiError`) and default base from @/lib/api-client
 * — the only app import this file is allowed to make under the slice boundary rule.
 *
 * SINGLE BACKEND, decided [OWNER, 2026-08-07]. The flag that used to sit here
 * asked the question and deferred it:
 *
 *   "the source's /api/simulate is served by rates-simulator-main/backend
 *    (FastAPI + QuantLib), which is a DIFFERENT service from the target's IRS
 *    Pricer backend that API_BASE points at ... Confirm the single-backend vs
 *    two-backend decision before S6."
 *
 * It is one backend. /api/simulate is registered on braveworld's app next to
 * /api/market-data, /api/credit-curve, /api/positions and the monitor's own
 * routes, all on :8100. So `SIMULATION_API_BASE` and its
 * NEXT_PUBLIC_SIMULATION_API_BASE_URL override are DELETED rather than left as
 * a dormant extension point: a second base origin is precisely what
 * guards/failure-visible.test.ts exists to prevent, and an override nobody
 * sets is an override nobody notices is wrong.
 */
import { API_BASE, ApiError } from "@/sim/lib/api-client";

import type { SimulateRequest, SimulateResponse } from "./simulate-dto";

const NETWORK_ERROR_MESSAGE =
  "Cannot reach the simulation server -- confirm it is running.";

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail =
      typeof body?.detail === "string" ? body.detail : `Request failed (HTTP ${res.status}).`;
    throw new ApiError(detail, res.status);
  }
  return body as T;
}

export const simulationApi = {
  /** Run one scenario. Single request/response — no streaming. `signal` (s15)
   * lets the Running interstitial's cancel button abort the in-flight request;
   * an abort is re-thrown as the original AbortError (NOT wrapped in ApiError)
   * so the caller can tell a user cancel from a network failure. */
  simulate: async (req: SimulateRequest, signal?: AbortSignal): Promise<SimulateResponse> => {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
        signal,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new ApiError(NETWORK_ERROR_MESSAGE, 0);
    }
    return handleResponse<SimulateResponse>(res);
  },
};
