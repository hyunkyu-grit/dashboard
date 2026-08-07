/** Test-only fixture loader — real `/api/simulate` captures generated against
 * the backend TestClient. Loaded with fs, not `import`, so the ~87KB JSON
 * literals never enter the TS program.
 *
 * MOVED in the port: this lived at `lib/recon/fixtures.ts` and served the
 * scenario-reconciliation panel, which is out of scope here. It survives
 * because path-matrix.test.ts uses these captures to pin the FE's path
 * evaluator against the ENGINE's applied path — and path-matrix now drives the
 * curve preview, so that agreement still has to hold. The third capture
 * (`settlement.json`) was settlement-lane-only and did not come across.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";

export interface SimFixture {
  request: SimulateRequest;
  response: SimulateResponse;
}

/** cwd-based (vitest runs from the frontend root): import.meta.url is rebased
 * under the jsdom environment and resolves off-tree there. */
const FIXTURE_DIR = join(process.cwd(), "src", "sim", "lib", "__fixtures__");

export function loadFixture(name: "linear" | "shaped"): SimFixture {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf-8")) as SimFixture;
}

/** Structured clone for fixture mutation in regime tests. */
export function cloneFixture(f: SimFixture): SimFixture {
  return JSON.parse(JSON.stringify(f)) as SimFixture;
}
