/* 계약 — 엔진이 내고 화면이 읽는 JSON 의 모양.
 *
 * ## 읽기 전용 규칙
 *
 * UI 는 `backend/bigfoot/**` 를 **import 하지 않는다.** 엔진이 `backend/output/`
 * 에 쓴 JSON 만 읽는다. 그 경계가 이 파일이다.
 *
 * ## 세션 2·3 은 이 타입에 맞춰 짠다
 *
 * 두 세션이 동시에 돌기 때문에, 각자 «내가 필요한 모양» 을 상상해서 짜면 병합
 * 시점에 둘 다 틀린 게 된다. 그래서 모양을 여기서 못 박고 둘 다 읽기만 한다.
 * 실제 산출물은 `backend/output/{scenario_basis,assumptions,engine_status}.json`
 * 이고, 픽스처는 `src/lab/model/fixtures/` 에 있다.
 */

/* ── assumptions.json ──────────────────────────────────────────────────────── */

/**
 * 이 가정이 **화면의 bp 를 움직이나**.
 *
 * 이 필드가 계약의 핵심이다. 진단(2026-08-21)에서 실측한 것:
 *
 *   - `r*` 를 1.5%·2.5% 로 바꿔 기저를 다시 풀면 15개 기저 전부의 10년 IRS
 *     반응 최대 절대차가 **0.000000bp** 다. eq (35) 에서 `r*` 는 가법 상수이고
 *     베이스라인 0 인 편차 공간에서 상수는 소거된다.
 *   - 미 정책금리·유가·해외성장은 기저가 **단위 충격**으로 담는다. 현재 수준을
 *     새로 받아와도 기저의 숫자는 하나도 안 바뀐다.
 *
 * 그래서 「미 정책금리: 3.75%」 를 다른 값들과 나란히 세우면, 트레이더는 **안
 * 쓰인 숫자를 근거로 읽는다.** 화면은 이 구분을 보여줘야 한다.
 */
export type AssumptionEffect =
  /** 이 값이 화면의 bp 를 실제로 움직인다. */
  | 'delta'
  /** 레벨 전망에만 쓰인다 — 이 앱은 델타를 팔므로 영향 0. */
  | 'level_only'
  /** 기저가 아예 안 쓴다. 참고로만 보여준다. */
  | 'not_in_basis';

export type Assumption = {
  key: string;
  label: string;
  /** 못 받았으면 `null`. **0 으로 채우지 않는다.** */
  value: number | null;
  unit: string | null;
  /** 빈 문자열이면 빌드가 선다(`rebake/layer2.py::validate`). */
  source: string;
  as_of: string | null;
  fetched: boolean;
  effect: AssumptionEffect;
  /** 왜 그 `effect` 인지. 화면이 이 문장을 그대로 쓴다. */
  effect_note: string;
};

export type Assumptions = {
  module: 'assumptions';
  basis_as_of: string;
  data_edge_q: string;
  written_at: string;
  headline: string;
  items: Assumption[];
};

/* ── engine_status.json ────────────────────────────────────────────────────── */

/**
 * `fresh` 마지막 리베이크 뒤로 이벤트가 안 지났다
 * `stale` 이벤트가 지났는데 다시 안 구웠다
 * `blocked` Layer 2 필수 입력을 못 받았거나 캐시로 때웠다
 *
 * **두 화면이 각자 판정하지 않는다.** 엔진이 판정해서 싣고, 화면은 읽는다.
 */
export type Staleness = {
  state: 'fresh' | 'stale' | 'blocked';
  why: string;
  blocked_on: string[];
};

export type ScorecardMiss = {
  anchor_id: string;
  shock: string;
  panel: string;
  /** 논문이 적은 값, 단위까지 붙은 문자열. */
  anchor: string;
  /** 아직 안 재 봤으면 `null`. **0 으로 채우면 «밴드 정중앙» 처럼 보인다.** */
  measured: number | null;
  page: string;
  why: string;
};

export type EngineStatus = {
  module: 'engine_status';
  /** 기저를 **구운 날**. 데이터가 여기까지 왔다는 뜻이 아니다. */
  basis_as_of: string;
  /** 모형이 **마지막으로 본 분기**. 구속하는 것은 가장 이른 쪽이다. */
  data_edge: {
    per_series: Record<string, string | null>;
    binding_quarter: string | null;
    newest_quarter: string | null;
  };
  /** 세션 2 가 **그대로** 렌더하는 문장. 다시 쓰지 않는다. */
  as_of_sentence: string;
  next_event: {
    date: string | null;
    kind: string | null;
    label: string | null;
    source?: string;
    /** 출처가 없는 달력. 비어 있지 않으면 «다음 이벤트» 를 단정하면 안 된다. */
    missing_calendars: string[];
    note: string;
  };
  staleness: Staleness;
  scorecard: {
    passed: number;
    total: number;
    note: string;
    misses: ScorecardMiss[];
  };
  known_seams: { flag: string; what: string }[];
  tests: { collected: number | null; source: string };
  engine: {
    home: string;
    moved_on: string;
    source_commits: string[];
    note: string;
  };
};

/* ── paper_anchors.json ────────────────────────────────────────────────────── */

export type PaperAnchor = {
  id: string;
  panel: string;
  /** 모형 변수 이름. 대조할 변수가 없으면 `null`. */
  var: string | null;
  /** 논문이 숫자를 안 적었으면 `null` (`kind: 'shape'`). */
  value: number | null;
  unit: string;
  kind: 'peak' | 'shape';
  note?: string;
};

export type PaperShock = {
  id: string;
  label: string;
  /** 이 충격에 대응하는 기저 이름 (`scenario_basis.json` 의 키). */
  basis: string;
  page: string;
  anchors: PaperAnchor[];
};

export type PaperAnchors = {
  module: 'paper_anchors';
  paper: {
    id: string;
    title: string;
    authors: string;
    published: string;
    pdf: string;
  };
  /** 왜 그림에서 값을 읽지 않았는지. 화면 각주로 쓴다. */
  why_text_only: string;
  shocks: PaperShock[];
  scorecard: {
    passed: number;
    total: number;
    note: string;
    misses: { anchor_id: string; measured: number | null; why: string }[];
    measured_but_not_scored: { anchor_id: string; measured: number }[];
    outside_the_scorecard: {
      what: string;
      measured: number;
      unit: string;
      why: string;
    }[];
  };
};

/* ── 배선 엣지리스트 (세션 3 이 생성기를 만든다) ────────────────────────────
 *
 * 모양만 여기서 못 박는다. 생성은 **코드에서** 한다 — `backend/bigfoot/solve/
 * system.py` 의 solve 루프를 AST 로 읽어서. 손으로 PDF 를 베끼면 «논문에 있는
 * 것» 이 나오고, 코드를 읽으면 «실제로 배선된 것» 이 나온다. 2026-08-21 감사가
 * 잡은 결함(eq 21 에 IH·G 가 빠져 있었다)이 정확히 그 차이였다.
 *
 * 시제품 실측: 노드 23 · 엣지 51 이 나왔고 `y_gap ← [c, g, i_con, i_fi, m, x]`
 * 가 제대로 보인다. `KOREA_VARS` 는 31개라 8개가 빠지는데, 그 8개는 세 패턴이다
 * — 상태벡터를 거치는 것(`kr10y`·`kr3y`), 변수 키 루프(`r_hh`·`r_firm`), 중간
 * 지역변수(`d_m`·`uc`·`hpi_star_lag`). 생성기가 그 셋을 다뤄야 한다.
 */

export type WiringEdge = {
  from: string;
  to: string;
  block: 'external' | 'expenditure' | 'price' | 'financial';
  /** 장기(행태식) vs 단기(PAC/오차수정). 가계부채→소비는 **둘 다** 있고 부호가
   *  반대라, 같은 쌍에 엣지가 두 개 선다. */
  horizon: 'LR' | 'SR';
  sign: '+' | '-' | '?';
  /** `appendix_d_resolved.yaml` 의 슬롯 주소. 없으면 자유모수거나 항등식. */
  coefficient_slot: string | null;
  equation: string;
  paper_page: string | null;
};

export type WiringGraph = {
  module: 'wiring_graph';
  generated_from: string;
  /** 생성기가 못 잡은 자리. **비어 있는 척하지 않는다.** */
  uncovered: { var: string; why: string }[];
  nodes: { id: string; label: string; block: WiringEdge['block'] }[];
  edges: WiringEdge[];
};

/* ── 어디서 읽나 ───────────────────────────────────────────────────────────── */

/** 엔진 산출물의 자리. 프런트는 빌드 때 이 셋을 번들로 복사해 온다. */
export const ARTIFACT_PATHS = {
  basis: 'backend/output/scenario_basis.json',
  assumptions: 'backend/output/assumptions.json',
  status: 'backend/output/engine_status.json',
  paperAnchors: 'backend/config/paper_anchors.json',
} as const;
