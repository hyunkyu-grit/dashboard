/**
 * Wire DTOs for the Simulation Screen's single backend endpoint: POST /api/simulate.
 *
 * Shapes are transcribed from the source's real request/response usage
 * (rates-simulator-main: components/ScenarioSimulator.tsx runSimulation() and
 * hooks/usePortfolioMetrics.ts). There is NO streaming / websocket variant — this
 * endpoint is a single request/response (confirmed in the Phase 0 runtime audit).
 */
import type {
  BookDailyPnL,
  FundingEvent,
  Position,
  PVBPSensitivity,
  ShockCurves,
} from "../types/portfolio";

export interface Waypoint {
  day: number;
  bp: number;
}

export interface IrsParRate {
  t: number;
  rate: number;
  maturityDate?: string;
  tenor?: string;
}

/** Request body of POST /api/simulate. Mirrors the source payload exactly. */
export interface SimulateRequest {
  positions: Position[];
  shockCurves: ShockCurves;
  dailyShockCurves: ShockCurves;
  /** s15 — OMITTED by the live bridge: the backend then derives funding as its
   * 기준금리+10bp constant, fixed for the whole horizon (no 금통위 stepping).
   * Sending an explicit value keeps the legacy source semantics (value +
   * fundingEvents stepping) — used only by old payloads/tests. */
  fundingRate?: number;
  fundingEvents: FundingEvent[];
  simDays: number;
  shockType: "ramp" | "step";
  shockMode: "matrix" | "parallel";
  baseShockBp: number;
  baseDate: string;
  irsCurves: IrsParRate[];
  customPath?: Waypoint[];
  /** s13 — fan-chart σ in bp/√business-day. Optional; backend defaults to 2.0
   * (byte-identical to the s11 constant) and 422s outside (0, 25]. */
  sigma_bp?: number;
  /** SIM2-5 (ruling ④, additive) — true + omitted fundingRate: fixed-mode
   * funding STEPS at the request's 금통위 events (base = the policy constant
   * pair). false/omitted = the s15 constant, byte-identical. */
  fundingStepping?: boolean;
  /** 분위수 팬을 계산할지. 생략/true = 종전 동작. 이 앱은 **false를 보낸다.**
   *
   * 이 필드는 원본에도 있었고 값도 false였는데, **백엔드에 그 필드가 없었다.**
   * Pydantic이 모르는 필드를 조용히 버리므로 프론트는 팬을 껐다고 믿었고
   * 백엔드는 계속 네 번 더 돌렸다 — 요청 하나가 두 시스템에서 다른 뜻이었다.
   * 2026-08-06에 백엔드가 이 이름을 듣게 해서 주석이 사실이 됐다.
   *
   * 실측: 팬이 총 109.9초 중 82.8초(75%)였다. 끄면 27초다. */
  includeDistribution?: boolean;
}

export interface SimulationSummary {
  finalMTM: number;
  finalCarry: number;
  finalSwap: number;
  finalTotal: number;
  breakEvenDay: number;
}

/** One point on the Total-Return trace. `day` is always present; the remaining
 * numeric series keys (mtmPnL, cumulativeCarry, swapThetaPnL, swapValuationPnL,
 * totalPnL) and the optional `bokBreakdown` block vary, so the row stays open. */
export interface SimulationChartPoint {
  day: number;
  [key: string]: unknown;
}

/** s11 T4 — funding rate along the simulation time axis. Rates are decimals
 * (0.0285 = 2.85%); positionRate/carryBp are null (unknown, not zero) when no
 * live bonds remain at that step. s15: with fundingRate omitted from the
 * request, fundingRate here is the backend's 기준금리+10bp constant on every
 * row, and carryBp === (positionRate − fundingRate) × 1e4. */
export interface FundingCurvePoint {
  day: number;
  date: string;
  fundingRate: number;
  positionRate: number | null;
  carryBp: number | null;
}

export interface DistributionBand {
  day: number;
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

/** s11 T3 — totalPnL percentile fan. p50 equals the base scenario's totalPnL
 * trace; each band is a real engine run of the scenario plus a parallel shock
 * ramping to its terminal quantile offset (see backend
 * simulation_service.build_distribution_bands for the documented assumptions).
 *
 * s18 T3 (dual-axis separation): the p-keys of `bands` are RETURN trajectories
 * keyed to their generating RATE-quantile scenario — they are NOT outcome
 * ranks and may cross on non-monotone books; render them as per-scenario
 * LINES labeled by scenario (금리 P95 시나리오), never as rank bands.
 * `ratePaths` carries each scenario's 국채 **3Y-관측** cumulative-bp path (the
 * 3.0-year cross-section of the shocked 국채 curve, chart.py `_ktb3y_bp`) —
 * N1/T2: this stays a 3Y OBSERVATION under any designed anchor; a revived
 * consumer must label it "3Y 관측", never as the designed-anchor path. Rates are
 * monotone in the quantile by construction, so THOSE bands never cross and
 * P5..P95 labels are truthful there. Optional: older cached responses lack it. */
export interface SimulationDistribution {
  sigmaBpDaily: number;
  sigmaTerminalBp: number;
  percentiles: number[];
  method: string;
  bands: DistributionBand[];
  ratePaths?: DistributionBand[];
}

/** s15 T2 — explicit asset-class exclusion. An excluded class renders as a
 * notice + blank (—) line, NEVER as a numeric zero (blank-MtM policy). */
export interface SimulationExclusion {
  assetClass: string;
  reason: string;
  asOf: string;
}

/** s15 T2 — horizon Total Return decomposition (unrounded KRW floats).
 * bondMtm + bondCarry + fundingCost + swapMtm + swapCarry === final totalPnL
 * (±₩1, pinned server-side). swapMtm/swapCarry are null when swaps were
 * excluded (unknown, not zero). */
/** SIM2-7 — funding-basis provenance (see SimulateResponse.fundingBasis). */
export interface FundingBasis {
  seriesStart: string | null;
  joinDate: string | null;
  seriesLatestRate: number | null;
  policyRate: number;
  spreadBp: number;
  stale: boolean;
  applied: boolean;
}

/** HARDEN-1 — one day of the cumulative component decomposition (unrounded
 * KRW floats, swap split on the theta/valuation axis like the final
 * decomposition). swapMtm/swapCarry are null when swaps were excluded. */
export interface DecompositionDailyPoint {
  day: number;
  fundingCost: number;
  bondMtm: number;
  bondCarry: number;
  swapMtm: number | null;
  swapCarry: number | null;
  total: number;
}

export interface TotalReturnDecomposition {
  bondMtm: number;
  bondCarry: number;
  fundingCost: number;
  swapMtm: number | null;
  swapCarry: number | null;
  total: number;
}

/** RECON-SCEN — one refixing settlement the engine's FM path produced
 * (chart.py scf_s collection): the projected net settlement cash of one swap
 * on one day under SCENARIO fixings. Sign: receive-fixed collects
 * (fixed − float). These fields were always on the wire (backend
 * IrsSettlementEvent model, simulate.py) — previously typed `unknown`. */
export interface IrsSettlementEvent {
  day: number;
  date: string | null;
  positionName: string;
  positionId: string;
  notional: number;
  direction: number;
  fixedRate: number;
  settledCf: number;
}

/** RECON-SCEN — one business day of the engine's internal IRS daily recon
 * loop (SIM2-4 aligned; backend IrsDailyReconRow, simulate.py): per-tenor
 * daily KRD (`pvbp`), the applied cumulative/daily Δbp per tenor, the
 * per-tenor linear P&L estimate, and the actual-vs-estimate lanes. NOTE the
 * `residual` here is the engine's DAILY-linearization residual (actual −
 * Σ −pvbp(day)×dailyΔbp) — related to but not the same object as the
 * baseDate-KRD 잔차 path the 시나리오 대사 view derives (scenario-recon.ts). */
export interface IrsDailyReconRow {
  date: string;
  day: number;
  pvbp: Record<string, number>;
  cumulativeBp: Record<string, number>;
  dailyDbp: Record<string, number>;
  pnl: Record<string, number>;
  totalEstPnl: number;
  totalActual: number;
  settleCf: number;
  npvChange: number;
  residual: number;
  thetaPnl: number;
  valuationPnl: number;
}

/** 스왑 한 건의 만기 시점 기여 (2026-08-06, 추가 전용).
 *
 * 엔진이 스왑마다 이미 만들던 궤적의 **마지막 값**이다 — 추가 계산이 아니라
 * 버려지던 값을 줍는 것이라 런타임에 영향이 없다. 궤적 전체가 아니라 끝값만
 * 오는 이유는 페이로드다: 377건 × 181일이면 이 배열 하나가 응답보다 커진다.
 *
 * `total === mtm + carry`이고, 모든 행의 합은 응답의 스왑 성분 합과 같다(±₩1).
 * 둘 다 백엔드 test_simulate_api가 못박는다. */
export interface SwapContribution {
  positionId: string;
  positionName: string;
  book: string;
  notional: number;
  /** +1 = 고정 수취, −1 = 고정 지급. */
  direction: number;
  fixedRate: number;
  maturityDate: string | null;
  mtm: number;
  carry: number;
  total: number;
}

/** Response body of POST /api/simulate. */
export interface SimulateResponse {
  chartData: SimulationChartPoint[];
  summary: SimulationSummary;
  irsSettlementEvents?: IrsSettlementEvent[];
  irsDailyReconciliation?: IrsDailyReconRow[];
  pvbpSensitivity?: PVBPSensitivity[];
  bookDailyPnLs?: BookDailyPnL[];
  // s11 additive fields — optional so cached/older responses stay valid.
  fundingCurve?: FundingCurvePoint[];
  distribution?: SimulationDistribution | null;
  // s15 additive fields — same optionality rationale.
  exclusions?: SimulationExclusion[];
  totalReturnDecomposition?: TotalReturnDecomposition;
  // HARDEN-1 additive field — per-day cumulative five-component paths (the
  // Results component-curves hero). Same accumulators as the decomposition:
  // per day fundingCost + bondMtm + bondCarry + swapMtm + swapCarry == total
  // (±₩1 pinned server-side); final day == totalReturnDecomposition. Swap
  // components are null per day when swaps were excluded (blank policy).
  decompositionDaily?: DecompositionDailyPoint[];
  // SIM2-7 additive field — funding-basis provenance: historical BOK stairs
  // within series coverage (through joinDate), the policy constant beyond,
  // SIM2-5 events on top. `applied` only for fixed-mode (omitted fundingRate)
  // runs; `stale` = series latest disagrees with the policy constant.
  swapContributions?: SwapContribution[];
  fundingBasis?: FundingBasis;
}
