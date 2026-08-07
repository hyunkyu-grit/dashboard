/**
 * SimulationDataPort — the ONLY contract the Simulation Screen consumes for its
 * data (protocol §1.3). The screen never touches the legacy source store shape,
 * the raw fetch, or a global app store: it reads/writes params + inputs and calls
 * run() through this port. Non-streaming by design (no tick channel) — the source
 * has a single POST /api/simulate request/response (Phase 0 runtime audit).
 *
 * Implemented by ../store/simulation-data-store.ts (client state) + assembled with
 * the TanStack Query mutation in ../hooks/use-simulation.ts (server transport).
 */
import type { Position, ShockCurves } from "./portfolio";
import type { IrsParRate, SimulateRequest, SimulateResponse, Waypoint } from "../api/simulate-dto";

export type RunStatus = "idle" | "running" | "success" | "error";

/** N1 — the pillar the designed path/target pins (국고 curve). Owner-fixed
 * choice set; 3Y is the legacy anchor and the default. */
export type AnchorTenor = "1Y" | "3Y" | "5Y" | "10Y";
export const ANCHOR_TENOR_CHOICES: readonly AnchorTenor[] = ["1Y", "3Y", "5Y", "10Y"];

/**
 * Ambient inputs the screen depends on but does NOT own — supplied by the host
 * (in the source these arrive as props on <ScenarioSimulator>, fed by the Excel
 * upload pipeline). In the target these are pushed in via setInputs() by whatever
 * mounts the tab (Phase 3), or later sourced from the app's portfolio store.
 */
export interface SimulationInputs {
  positions: Position[];
  baseDate: string;
  /** s15 — optional and normally ABSENT: the live bridge no longer supplies a
   * funding rate, so the payload omits fundingRate and the backend derives it
   * from its 기준금리+10bp constant (the single source). Set only to reproduce
   * legacy explicit-funding payloads. */
  fundingRate?: number;
  dailyShockCurves: ShockCurves;
  irsParRates: IrsParRate[];
}

/**
 * User-editable scenario parameters. Numeric fields are kept as strings where the
 * source keeps them as free-text inputs (converted at request-build time, mirroring
 * the source's toNum()), so the port faithfully represents what the UI edits.
 */
export interface ScenarioParams {
  simDays: number;
  baseShockBp: string;
  waypoints: Waypoint[];
  spread1y: string;
  spread10y: string;
  spread30y: string;
  creditSpreads: Record<string, string>;
  irsSpread: string;
  /** 금통위 이벤트. `shiftBp` 는 그 날 **기준금리**가 움직이는 폭이고,
   * `cdSpreadBp` 는 CD 가 그보다 더(또는 덜) 움직이는 폭이다
   * [트레이더 피드백 4, 2026-08-07]. CD 의 그날 이동 = shiftBp + cdSpreadBp.
   *
   * cdSpreadBp 가 여기 있는 이유는 `lib/scenario-curves.buildSimulateRequest`
   * 의 주석에 적혀 있다 — 짧게: 커브의 짧은 끝은 **이벤트 계단으로만** 움직이고,
   * 커브 스프레드 쪽의 터미널 손잡이는 3M 마디에서 그 계단에 덮인다. */
  shortEndEvents: { id: number; date: string; shiftBp: string; cdSpreadBp?: string }[];
  /** s13 — fan-chart σ in bp/√business-day (free-text like the other numeric
   * params; sanitized to (0, 25] at request-build time, backend default 2.0). */
  sigmaBp: string;
  /** SIM2-5 (ruling ④) — opt-in 금통위 funding stepping (default off = the
   * s15 fixed constant, byte-identical). Rides the payload as fundingStepping. */
  fundingStepping: boolean;
  /* `spreadCd` 가 여기 있었다 [OWNER, 2026-08-06 → 트레이더 피드백 4,
   * 2026-08-07]. 커브 스프레드 옆에 선 터미널 손잡이였는데, 그 자리에서는
   * **3M 마디에 닿지 못했다** — 금통위 이벤트가 있으면 스왑 커브의 짧은 끝은
   * 이벤트 계단이 통째로 정하고 터미널 노드는 무시된다(엔진 `_cum_shock_r`,
   * τ ≤ 0.25 에서 BOK 누적 bp 직결). 그래서 손잡이를 이벤트 안으로 내렸다:
   * `shortEndEvents[].cdSpreadBp`. 터미널 값은 이제 그 합에서 파생된다. */
  /** SIM2-2 (ruling ①) — the intermediate waypoint days the USER has edited
   * (stepper, typed commit, or drag). Explicit flags, never value-equality
   * inference: an untouched waypoint re-lerps onto the line toward
   * {simDays, baseShockBp} on every horizon/target change; a touched one is
   * byte-preserved. Not read by buildSimulateRequest (payload unchanged). */
  touchedWaypointDays: number[];
  /** N1 — which 국고 pillar the target/waypoints/drag design (owner ruling:
   * 1Y/3Y/5Y/10Y, default 3Y). The WIRE stays 3Y-normalized: at request-build
   * time the design is re-expressed via base_wire = X − s_rel(τa) (tenor
   * spreads stay defined vs 3Y — the anchor moves the path, not the spread
   * reference). Anchor 3Y ⇒ the conversion is the identity ⇒ pre-N1 payloads
   * byte-for-byte (golden pin). OPTIONAL: absent ≡ "3Y" everywhere (old
   * in-memory param states and pre-N1 fixtures stay valid and identical). */
  anchorTenor?: AnchorTenor;
}

/* ── 시나리오 케이스 ─────────────────────────────────────────────────────────
 * [트레이더 피드백 2, 2026-08-07: "Base Case 뿐만 아니라 Bull/Bear/Crisis를
 *  추가하고 싶다"]
 *
 * 케이스는 **금리 시나리오만** 담는다. 기간·앵커 테너·포지션·기준일은 넷이
 * 공유한다 — 그것들이 케이스마다 다르면 네 개를 나란히 놓고 비교한다는 말이
 * 성립하지 않는다. 같은 북, 같은 지평, 다른 금리 경로. 그것이 케이스다.
 *
 * `ScenarioParams` 를 갈아엎지 않았다. `params` 는 여전히 **지금 편집 중인**
 * 케이스의 살아 있는 값이고, 케이스를 바꿀 때만 스토어가 아래 필드를 저장·복원
 * 한다. 그래서 buildSimulateRequest 도, 경로 설계 폼도, 골든 픽스처도 그대로다. */
export type CaseId = "base" | "bull" | "bear" | "crisis";

/** 케이스가 소유하는 필드 — 나머지 `ScenarioParams` 는 넷이 공유한다. */
export type ScenarioCase = Pick<
  ScenarioParams,
  | "baseShockBp"
  | "waypoints"
  | "touchedWaypointDays"
  | "spread1y"
  | "spread10y"
  | "irsSpread"
  | "shortEndEvents"
>;

export const CASE_KEYS = [
  "baseShockBp",
  "waypoints",
  "touchedWaypointDays",
  "spread1y",
  "spread10y",
  "irsSpread",
  "shortEndEvents",
] as const satisfies readonly (keyof ScenarioCase)[];

/** 케이스 필드만 뽑아낸다 — 공유 필드가 케이스에 섞여 들어가면 케이스를 바꿀 때
 * 기간이나 앵커까지 따라 움직인다. */
export function caseFromParams(params: ScenarioParams): ScenarioCase {
  const out = {} as Record<string, unknown>;
  for (const k of CASE_KEYS) out[k] = params[k];
  return out as ScenarioCase;
}

export const SCENARIO_CASES: readonly { id: CaseId; label: string }[] = [
  { id: "base", label: "Base" },
  { id: "bull", label: "Bull" },
  { id: "bear", label: "Bear" },
  { id: "crisis", label: "Crisis" },
];

/** 씨앗 값. 방향은 **채권시장 관행**이다 — 불은 금리 하락, 베어는 상승.
 * (주식의 불/베어와 반대 방향이라 화면에도 그렇게 적어 둔다.)
 * 어디까지나 씨앗이고, 네 칸 다 사용자가 고쳐 쓴다. */
const seedCase = (bp: number, days: number): ScenarioCase => ({
  baseShockBp: String(bp),
  waypoints: [
    { day: 0, bp: 0 },
    { day: days, bp },
  ],
  touchedWaypointDays: [],
  spread1y: "0",
  spread10y: "0",
  irsSpread: "0",
  shortEndEvents: [],
});

export interface SimulationDataPort {
  /** Ambient, host-provided inputs. */
  inputs: SimulationInputs;
  /** User-edited scenario parameters. */
  params: ScenarioParams;
  /** Result of the most recent successful run (also the cross-screen selector source). */
  lastRun: SimulateResponse | null;
  /** Exact request that produced `lastRun` (curve-preview reuse). */
  lastRunRequest: SimulateRequest | null;
  status: RunStatus;
  error: string | null;

  setInputs: (inputs: Partial<SimulationInputs>) => void;
  patchParams: (patch: Partial<ScenarioParams>) => void;
  resetParams: () => void;

  /**
   * Execute one scenario from a fully-assembled request. Returns the result, or null
   * on failure (error text is placed on `error`). Owns transport + result state.
   */
  run: (request: SimulateRequest) => Promise<SimulateResponse | null>;

  /**
   * Execute the current scenario: assembles the /api/simulate request from `inputs` +
   * `params` (via lib/scenario-curves buildSimulateRequest) and runs it. The screen
   * only sets params and calls this — it never builds the wire payload (§1.3).
   */
  runCurrent: () => Promise<SimulateResponse | null>;

  /**
   * s15 — abort the in-flight run (Running interstitial's cancel). Status returns
   * to idle; the previous result is kept (replace-on-arrival, no history).
   */
  cancelRun: () => void;
}

export const DEFAULT_SCENARIO_PARAMS: ScenarioParams = {
  simDays: 180,
  baseShockBp: "30",
  waypoints: [
    { day: 0, bp: 0 },
    { day: 180, bp: 30 },
  ],
  spread1y: "0",
  spread10y: "0",
  spread30y: "0",
  creditSpreads: { 특은채: "0", 은행채: "0", 카드채: "0", 회사채: "0" },
  irsSpread: "0",
  shortEndEvents: [],
  sigmaBp: "2.0",
  fundingStepping: false,
  touchedWaypointDays: [],
  anchorTenor: "3Y",
};

/** 케이스 넷의 씨앗. **Base 는 기존 기본값 그대로다** — 케이스가 생기기 전에
 * 이 화면을 쓰던 사람이 처음 보는 값이 달라지면 안 된다. */
export const DEFAULT_CASES: Record<CaseId, ScenarioCase> = {
  base: caseFromParams(DEFAULT_SCENARIO_PARAMS),
  bull: seedCase(-50, DEFAULT_SCENARIO_PARAMS.simDays),
  bear: seedCase(100, DEFAULT_SCENARIO_PARAMS.simDays),
  crisis: seedCase(250, DEFAULT_SCENARIO_PARAMS.simDays),
};

export const EMPTY_SIMULATION_INPUTS: SimulationInputs = {
  positions: [],
  baseDate: "",
  // fundingRate deliberately absent (s15): omitted → backend constant.
  dailyShockCurves: { bondCurves: {}, swapCurve: [] },
  irsParRates: [],
};
