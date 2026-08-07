/**
 * Scoped Zustand slice backing the SimulationDataPort (protocol §1.3). Holds the
 * screen's client state: ambient inputs, user scenario params, and the last run's
 * result. Authored in the target's store idiom (plain `create<State>((set) => …)`,
 * cf. src/stores/*-store.ts) but lives INSIDE the slice — it is not registered in
 * the app-wide src/stores/ dir, keeping the vertical slice self-contained.
 *
 * (The old placeholder's `src/stores/simulation-store.ts` trade-sandbox store this
 * slice was once distinguished from was removed in R3B-PLUS A1 — see git history.)
 *
 * Server transport (POST /api/simulate) is NOT here — it goes through the TanStack
 * Query mutation in ../hooks/use-simulation.ts, which writes the result back via
 * ingestResult(). Cross-screen consumers read results through selectSimulationResults.
 */
import { create } from "zustand";

import type { SimulateRequest, SimulateResponse } from "../api/simulate-dto";
import { newManualPosition, type ManualPosition } from "../lib/manual-position";
import {
  DEFAULT_CASES,
  DEFAULT_SCENARIO_PARAMS,
  EMPTY_SIMULATION_INPUTS,
  caseFromParams,
  type AnchorTenor,
  type CaseId,
  type RunStatus,
  type ScenarioCase,
  type ScenarioParams,
  type SimulationInputs,
} from "../types/simulation-port";

interface SimulationDataState {
  inputs: SimulationInputs;
  params: ScenarioParams;
  lastRun: SimulateResponse | null;
  lastRunRequest: SimulateRequest | null;
  /** N1 — the anchor pillar `lastRunRequest` was DESIGNED on (the wire itself
   * stays 3Y-normalized). Set by runCurrent on arrival; null before any run.
   * Results reconstructs the anchor-native target X from the wire's 국채
   * curve at this pillar. */
  lastRunAnchorTenor: AnchorTenor | null;
  setLastRunAnchorTenor: (anchor: AnchorTenor) => void;
  status: RunStatus;
  error: string | null;

  /** Demo sprint (two-pane) — the analyst's explicit valuation-date override.
   * null = automatic (today in Seoul). The app-layer bridge reads this when it
   * assembles inputs, so a ledger refresh never clobbers a user-chosen date. */
  userBaseDate: string | null;
  setUserBaseDate: (date: string | null) => void;

  /** SIM2-1 — which preview the Curve View panel shows. UI-only: survives
   * stage navigation (module-level store) and NEVER enters the payload. */
  previewMode: "curve" | "path";
  setPreviewMode: (mode: "curve" | "path") => void;

  /* ── 시나리오 케이스 [트레이더 피드백 2, 2026-08-07] ──────────────────────
   * `params` 는 **지금 편집 중인** 케이스의 살아 있는 값이고, `cases` 는 나머지
   * 셋을 재워 둔다. 활성 케이스의 항목은 그래서 낡아 있다 — 읽는 쪽은 활성
   * 케이스면 `params` 를 보고, 아닌 것만 `cases` 를 본다(`caseParams`).
   * 매 타건마다 두 곳에 쓰는 대신 전환 시점에만 옮긴다: 쓰기 경로가 하나면
   * 두 값이 어긋날 자리가 없다. */
  cases: Record<CaseId, ScenarioCase>;
  activeCase: CaseId;
  /** 편집 대상을 바꾼다. 지금 값을 그 자리에 저장하고 다음 케이스를 꺼내 온다. */
  setActiveCase: (id: CaseId) => void;
  /** 커브 미리보기에 **겹쳐 그릴** 케이스들. 활성 케이스는 언제나 그려지므로
   * 여기 없어도 된다 — 편집 중인 것이 안 보이는 상태는 만들지 않는다. */
  overlayCases: CaseId[];
  toggleOverlayCase: (id: CaseId) => void;

  /** SIM2-6 — the staged flow's screen, MOVED here from SimulationFlow's
   * component state so leaving the tab and returning restores EXACTLY what
   * was on screen (the s17 ES precedent). ingestResult lands on "results"
   * (a run finishing while the user sits elsewhere still lands Results);
   * markCancelled returns to "configure"; 조건 수정 sets it explicitly. */
  stage: "configure" | "results";
  setStage: (stage: "configure" | "results") => void;

  /** 직접 입력한 포지션 [OWNER, 2026-08-07].
   *
   * 북(`Portfolio Data.xlsx`)이 한동안 쓰이지 않는다. 질문이 "내 북이 어떻게
   * 되나"에서 "이 포지션을 이 경로에 두면 어떻게 되나"로 바뀌었기 때문이다.
   * 이제 이것이 `inputs.positions`의 원천이고, 북 브릿지는 기준일과 데이터
   * 범위만 준다.
   *
   * 페이로드 모양이 아니라 **입력 폼의 상태**를 들고 있다 — 상품 id, 방향,
   * 억 원. 스왑 다리로의 전개는 백엔드가 한다(POST /api/instruments/expand):
   * DV01 중립 가중에 커브가 필요하고 브라우저는 계산하지 않는다.
   * localStorage에 남는다: 시나리오를 여러 번 바꿔가며 돌리는 것이 이 화면의
   * 일인데 새로고침마다 다시 입력하는 건 말이 안 된다. */
  manualPositions: ManualPosition[];
  addManualPosition: () => void;
  updateManualPosition: (id: string, patch: Partial<ManualPosition>) => void;
  removeManualPosition: (id: string) => void;
  clearManualPositions: () => void;

  setInputs: (inputs: Partial<SimulationInputs>) => void;
  patchParams: (patch: Partial<ScenarioParams>) => void;
  resetParams: () => void;

  // Called by the transport layer (use-simulation.ts) — not by UI directly.
  markRunning: () => void;
  ingestResult: (request: SimulateRequest, result: SimulateResponse) => void;
  markError: (message: string) => void;
  /** s15 — user-cancelled run: back to idle, previous result untouched
   * (re-run REPLACES outright only when a new result actually arrives). */
  markCancelled: () => void;
}

/* 직접 입력 포지션의 영속화. localStorage 하나에 배열 통째로 — 행이 수십 개를
 * 넘길 화면이 아니고, 부분 갱신은 여기서 살 것이 없다.
 *
 * 키에 버전을 박아둔 이유: ManualPosition의 모양이 바뀌면 예전에 저장된 줄이
 * 새 코드로 들어와 조용히 반쪽짜리 포지션이 된다. 이 프로젝트가 반복해서 겪은
 * 결함이 정확히 그것(디스크 캐시의 SCHEMA_VERSION)이라, 모양을 바꾸면 v를
 * 올리고 옛 줄은 버린다.
 *
 * 읽기가 절대 던지지 않는다: 스토어 생성은 모듈 로드 시점이고, 여기서 던지면
 * 손상된 항목 하나가 탭 전체를 못 열게 만든다. */
const MANUAL_KEY = "bw-sim-manual-v2";

function loadManualPositions(): ManualPosition[] {
  if (typeof window === "undefined") return []; // SSR — localStorage가 없다
  try {
    const raw = window.localStorage.getItem(MANUAL_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as ManualPosition[]) : [];
  } catch {
    return [];
  }
}

/** 저장하고, set()에 넘길 조각을 돌려준다. 쓰기와 상태 갱신이 갈라지면 한쪽만
 * 일어나는 경로가 생긴다. */
function persistManual(manualPositions: ManualPosition[]): { manualPositions: ManualPosition[] } {
  try {
    window.localStorage.setItem(MANUAL_KEY, JSON.stringify(manualPositions));
  } catch {
    /* 스토리지 불가 — 이번 세션에서만 유지될 뿐이다 */
  }
  return { manualPositions };
}

export const useSimulationDataStore = create<SimulationDataState>((set) => ({
  inputs: EMPTY_SIMULATION_INPUTS,
  params: DEFAULT_SCENARIO_PARAMS,
  lastRun: null,
  lastRunRequest: null,
  lastRunAnchorTenor: null,
  setLastRunAnchorTenor: (anchor) => set({ lastRunAnchorTenor: anchor }),
  status: "idle",
  error: null,

  userBaseDate: null,
  setUserBaseDate: (date) => set({ userBaseDate: date }),

  previewMode: "curve",
  setPreviewMode: (mode) => set({ previewMode: mode }),

  cases: DEFAULT_CASES,
  activeCase: "base",
  setActiveCase: (id) =>
    set((s) =>
      id === s.activeCase
        ? {}
        : {
            // 나가는 케이스를 먼저 저장한다. 순서가 뒤바뀌면 같은 케이스를
            // 두 번 누를 때 방금 편집한 값이 씨앗으로 덮인다.
            cases: { ...s.cases, [s.activeCase]: caseFromParams(s.params) },
            activeCase: id,
            params: { ...s.params, ...s.cases[id] },
          },
    ),
  overlayCases: [],
  toggleOverlayCase: (id) =>
    set((s) => ({
      overlayCases: s.overlayCases.includes(id)
        ? s.overlayCases.filter((x) => x !== id)
        : [...s.overlayCases, id],
    })),

  stage: "configure",
  setStage: (stage) => set({ stage }),

  manualPositions: loadManualPositions(),
  addManualPosition: () =>
    set((s) => {
      // seq는 길이가 아니라 **지금까지 쓴 적 없는 번호**여야 한다. 길이로
      // 만들면 3개 중 가운데를 지우고 추가할 때 id가 겹치고, 겹친 id는 React
      // key와 삭제 대상을 동시에 헷갈리게 한다.
      const used = s.manualPositions.map((p) => Number(p.id.replace("manual-", "")) || 0);
      const seq = (used.length ? Math.max(...used) : 0) + 1;
      return persistManual([...s.manualPositions, newManualPosition(seq)]);
    }),
  updateManualPosition: (id, patch) =>
    set((s) =>
      persistManual(s.manualPositions.map((p) => (p.id === id ? { ...p, ...patch } : p))),
    ),
  removeManualPosition: (id) =>
    set((s) => persistManual(s.manualPositions.filter((p) => p.id !== id))),
  clearManualPositions: () => set(persistManual([])),

  setInputs: (inputs) => set((state) => ({ inputs: { ...state.inputs, ...inputs } })),
  patchParams: (patch) => set((state) => ({ params: { ...state.params, ...patch } })),
  // 케이스도 같이 되돌린다 — 셋만 씨앗으로 남고 하나는 편집된 상태는
  // "초기화" 라고 부를 수 없다.
  resetParams: () =>
    set({
      params: DEFAULT_SCENARIO_PARAMS,
      cases: DEFAULT_CASES,
      activeCase: "base",
      overlayCases: [],
    }),

  markRunning: () => set({ status: "running", error: null }),
  // SIM2-6: arrival LANDS the flow on Results (even if the tab was left and
  // remounted mid-flight — the request outlives the component).
  ingestResult: (request, result) =>
    set({ status: "success", error: null, lastRun: result, lastRunRequest: request, stage: "results" }),
  markError: (message) => set({ status: "error", error: message }),
  // SIM2-6: a user cancel returns to Configure with inputs intact (s15 rule).
  markCancelled: () => set({ status: "idle", error: null, stage: "configure" }),
}));

// ---------------------------------------------------------------------------
// Selectors — the sanctioned cross-screen read path (protocol §1.3). If the
// Portfolio or Backtest tabs later need simulation output, they select it here;
// they never import the simulation components.
// ---------------------------------------------------------------------------

/** 케이스 하나를 **완전한 `ScenarioParams`** 로 되살린다 — 공유 필드(기간·앵커·
 * σ)는 현재 값에서, 케이스 필드는 그 케이스에서. 활성 케이스는 `params` 자체가
 * 최신이므로 그대로 돌려준다(`cases` 항목은 전환 시점의 스냅샷이라 낡았다).
 *
 * 미리보기가 다른 케이스를 그리려면 `buildSimulateRequest` 에 넘길 것이 필요한데,
 * 그 함수는 부분 파라미터를 모른다. 여기서 한 번만 조립한다. */
export function caseParams(s: SimulationDataState, id: CaseId): ScenarioParams {
  return id === s.activeCase ? s.params : { ...s.params, ...s.cases[id] };
}

export const selectSimulationResults = (s: SimulationDataState): SimulateResponse | null => s.lastRun;
export const selectSimulationStatus = (s: SimulationDataState): RunStatus => s.status;
export const selectScenarioParams = (s: SimulationDataState): ScenarioParams => s.params;
