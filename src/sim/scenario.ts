/* 시뮬레이션의 **입력** — 지금 커브에서 시작해 금리가 이렇게 움직이면 어떻게 되나.
 *
 * 백테스트가 과거를 되짚는다면 이쪽은 앞을 본다. 포지션은 "그때 넣었던 것" 이
 * 아니라 **오늘 새로 치는 상품**이고, 고정금리는 그 날의 par 다.
 *
 * 이 파일은 순수하다 — fetch 도 DOM 도 없다. 엔진이 받는 페이로드를 만드는 규칙만
 * 있고, 그래서 규칙을 DOM 없이 검증할 수 있다.
 *
 * ── v1 과 대사하며 고친 것 (2026-08-14) ────────────────────────────────────
 *
 * 첫 판은 세 군데가 계약과 어긋나 있었고, 셋 다 **답이 조용히 달라지는** 종류였다:
 *
 *  ① 다리를 브라우저가 만들었다. 오너가 2026-08-07 에 이미 기각한 모델이다 —
 *    "다리를 손으로 둘 만들고 명목을 눈대중으로 맞추라고 하는 것은 도구가 할 일을
 *    사람에게 미루는 것". 게다가 DV01 중립 가중에는 커브가 필요하고 브라우저는
 *    계산하지 않는다(§16). 지금은 `POST /api/instruments/expand` 가 만든다.
 *
 *  ② par 커브를 브라우저가 실었다. v1 의 `use-book` 은 `irsParRates: []` 를 보낸다 —
 *    "백엔드가 기준일의 IRS 스냅샷에서 가져오고, 그날 호가가 없으면 조용한 0 대신
 *    명시적으로 제외한다". 내가 화면의 요약에서 만들어 보내면 시장 데이터의 출처가
 *    둘이 되고, 둘이 갈린 날에도 숫자는 멀쩡해 보인다.
 *
 *  ③ `shockMode: "parallel"` 로 전 구간을 같이 밀었다. 엔진은 parallel 에서
 *    swapCurve 를 **버리고** 전 만기에 같은 bp 를 쓴다(chart.py
 *    `_build_irs_shock_curve`). 그건 오버나이트까지 같이 움직인다는 주장이고,
 *    원화에서 그건 금통위가 했다는 뜻이다. v1 은 언제나 `matrix` 이고 짧은 끝은
 *    금통위 이벤트만 움직인다. 실측 차이(3Y 페이 100억·90일·+50bp): 총손익
 *    100,058,141 vs 99,869,511 — 18.9만원. 3Y 한 다리라 이 정도이고, 짧은 다리나
 *    스프레드에서는 이 차이가 답을 바꾼다.
 */

/* ── 상품 한 줄 ───────────────────────────────────────────────────────────── */

/** 모니터의 그룹과 같은 이름. 변동성은 관측이지 포지션이 아니라 여기 없다.
 *
 * 현금채권·자산스왑이 뒤에 붙는다 [OWNER, 2026-08-14 — "시뮬레이션 포지션에
 * 스왑 뿐만아니라 현금채권이랑 자산스왑 추가해줘", v1 642c5c46]. 백테스트의 그
 * 두 탭과 **같은 상품·같은 id 문법**(`CB:KTB:3Y`)이라, 같은 문자열이 세
 * 화면에서 같은 것을 뜻한다. */
export type InstrumentKind =
  | "outright"
  | "spread"
  | "fly"
  | "forward"
  | "cashbond"
  | "assetswap";

export const KIND_LABEL: Record<InstrumentKind, string> = {
  outright: "아웃라이트",
  spread: "스프레드",
  fly: "버터플라이",
  forward: "포워드",
  cashbond: "현금채권",
  assetswap: "자산스왑",
};

export const KIND_ORDER: InstrumentKind[] = [
  "outright",
  "spread",
  "fly",
  "forward",
  "cashbond",
  "assetswap",
];

/** 채권은 **살 수만** 있다 [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"].
 * 공매도는 채권을 빌리는 것이고 그 대차료를 이 화면은 모른다 — 모르는 비용을
 * 0 으로 두면 공매도가 늘 이기는 시뮬이 된다. 백엔드도 같은 이유로 거절한다
 * (`app/instruments._expand_bond`), 화면은 방향 칸 자체를 안 그린다. */
export function isBondKind(kind: InstrumentKind): boolean {
  return kind === "cashbond" || kind === "assetswap";
}

/** 이 다리가 채권인가 — 다리 목록이 "수취/지급" 대신 "매수" 를 적을지 정한다. */
export function isBondLeg(leg: EngineLeg): boolean {
  return leg.bondType === "bond";
}

/** `GET /api/instruments` 의 한 항목. `key` 는 모니터의 표가 쓰는 주요/전체
 * 구분이고 판정도 같은 곳(`derive.is_key`)에서 나온다 — 프론트가 자기 목록을
 * 들면 두 화면의 "주요 스프레드" 가 갈린다. 고를 수 있는 것을 줄이지는 않고
 * **순서만** 정한다. */
export interface InstrumentOption {
  id: string;
  label: string;
  key?: boolean;
}

export type InstrumentCatalog = Record<InstrumentKind, InstrumentOption[]>;

/** id 만 보고 종류를 안다 — 백엔드 `instruments.kind_of` 와 같은 규칙이다.
 * 접두사가 **가장 먼저**인 이유: `CB:KTB:3Y` 에는 `-` 가 없어 아웃라이트로
 * 읽힌다. `x` 가 그 다음인 이유는 포워드에 `-` 가 없기 때문이다. */
export function kindOf(seriesId: string): InstrumentKind {
  if (seriesId.startsWith("CB:")) return "cashbond";
  if (seriesId.startsWith("ASW:")) return "assetswap";
  if (seriesId.includes("x")) return "forward";
  const dashes = (seriesId.match(/-/g) ?? []).length;
  return dashes === 0 ? "outright" : dashes === 1 ? "spread" : "fly";
}

/** 화면이 들고 있는 한 줄. **상품 하나**이지 스왑 다리 하나가 아니다. */
export interface SimRow {
  /** 행의 안정적인 신원 — 삭제·React key 가 여기 매달린다. */
  key: string;
  /** 상품 id. `10Y` · `3Y-10Y` · `2Y-5Y-10Y` · `1Yx1Y`. 모니터·백테스트가 쓰는
   * 문법 그대로라, 같은 문자열이 세 화면에서 같은 것을 뜻한다. */
  seriesId: string;
  /** `+1` = 그 상품의 **호가값을 롱**. 모니터·백테스트와 같은 정의다.
   *
   * 스왑 다리의 부호(+1 = 고정 수취)와 반대라 헷갈리기 쉬운데, **뒤집는 곳은
   * 백엔드 한 곳**이다(`instruments.expand` 의 `_LEG_TO_SWAP`). 실측으로
   * 확인했다: `direction:+1` 로 3Y 를 전개하면 다리가 `direction:-1`(고정 지급)로
   * 돌아온다. 프론트가 한 번 더 뒤집으면 화면의 "페이" 가 엔진에서 리시브가
   * 되고, 숫자는 그럴듯하게 나온다. */
  direction: 1 | -1;
  /** 억 원. 사람이 말하는 단위로 들고 있다가 요청에서만 원으로 바꾼다. */
  eok: number;
  /** 다리별 고정금리 덮어쓰기, 퍼센트 [v1 트레이더 피드백 3, 2026-08-07:
   * "기본적으로는 Par Rate가 들어가있되, 원하면 내가 원하는 금리를 넣고 싶다"].
   *
   * **다리별**인 이유: 한 줄이 상품 하나이고 상품은 다리를 여럿 갖는다. 3s10s 에
   * 금리 하나를 넣으라고 하면 그 하나가 3Y 것인지 10Y 것인지 말할 수 없다. 화면이
   * 이미 다리마다 par 를 적고 있으므로 그 칸이 그대로 입력칸이 되는 것이 가장 적은
   * 새 개념이다.
   *
   * 키는 다리 id(`3Y-10Y#0`)다. 상품을 바꾸면 다리가 달라지므로 그때 비운다 —
   * 남겨 두면 3s10s 의 3Y 금리가 2s5s 의 2Y 다리에 조용히 붙는다.
   *
   * 대가를 적어 둔다: par 로 치면 진입 MtM 이 0 이라 결과에 남는 것이 경로가 만든
   * 손익뿐인데, 덮어쓰면 진입 시점에 이미 평가손익이 있다. 그건 오프마켓 진입이
   * 실제로 그렇다는 뜻이지 오류가 아니다. 화면이 그 사실을 말한다. */
  rateOverrides?: Record<string, number>;
}

/** 이 다리가 실제로 쓸 고정금리(퍼센트) — 덮어썼으면 그 값, 아니면 par. */
export function effectiveRate(leg: EngineLeg, r: SimRow): number {
  const v = r.rateOverrides?.[leg.id];
  return typeof v === "number" && Number.isFinite(v) ? v : leg.couponRate;
}

/** 페이로드에 실을 다리들. **한 곳에서만** 덮어쓴다 — 화면과 요청이 각자 적용하면
 * 보이는 금리와 평가되는 금리가 갈라질 수 있다. */
export function applyRateOverrides(legs: EngineLeg[], r: SimRow): EngineLeg[] {
  if (!r.rateOverrides) return legs;
  return legs.map((l) => {
    const rate = effectiveRate(l, r);
    return rate === l.couponRate ? l : { ...l, couponRate: rate };
  });
}

/** 덮어쓴 다리가 하나라도 있는가 — 화면이 진입 MtM 안내를 띄울지 정한다. */
export function hasRateOverride(legs: EngineLeg[], r: SimRow): boolean {
  return legs.some((l) => effectiveRate(l, r) !== l.couponRate);
}

/** 한 다리의 금리를 옮기거나(숫자) 되돌린다(null → par).
 *
 * 남은 항목이 없으면 필드 자체를 지운다 — 빈 객체가 남으면 "덮어썼다가 되돌린 줄"
 * 과 "한 번도 안 건드린 줄" 을 구분 못 한 채 커진다. */
export function setLegRate(
  r: SimRow,
  legId: string,
  v: number | null,
): Pick<SimRow, "rateOverrides"> {
  const next = { ...(r.rateOverrides ?? {}) };
  if (v === null) delete next[legId];
  else next[legId] = v;
  return { rateOverrides: Object.keys(next).length > 0 ? next : undefined };
}

/** 한 창에 여덟 줄. 백테스트의 열둘과 같은 근거 — 헤드라인 한 줄이 무엇의 합인지
 * 눈으로 셀 수 있어야 한다. 시뮬은 줄마다 전개 요청이 하나씩 붙어 조금 더 조인다. */
export const MAX_ROWS = 8;

export const DEFAULT_SERIES_ID = "3Y";
export const DEFAULT_NOTIONAL_EOK = 100;

let seq = 0;
export function newRow(seriesId = DEFAULT_SERIES_ID): SimRow {
  seq += 1;
  return { key: `s${seq}`, seriesId, direction: 1, eok: DEFAULT_NOTIONAL_EOK };
}

export function notionalToKrw(eok: number): number {
  return eok * 1e8;
}

/** 이 줄이 실행 가능한가. 불가능하면 그 이유. */
export function rowError(r: SimRow): string | null {
  if (!r.seriesId) return "상품을 골라주세요";
  if (!(r.eok > 0)) return "명목이 0보다 커야 해요";
  return null;
}

/** 백엔드가 돌려준 다리 하나 — 페이로드에 그대로 실린다. 화면에는 읽기 전용이다.
 *
 * 파생 필드(`remainingDays`·`currentFloatRate`·`krdMap`)가 0 인 채로 오는 것은
 * 빠진 것이 아니라 **백엔드가 채운다는 뜻**이다. 여기서 채우면 진실이 둘이 된다.
 * 실측: `currentFloatRate: 0` 으로 보낸 3Y 페이의 캐리가 정확히
 * −100억 × (3.84% − 2.93%) × 90/365 = −22,438,356 원이었다 — 엔진이 그날의 CD
 * 픽싱을 스스로 찾아 썼다. */
export interface EngineLeg {
  id: string;
  name: string;
  tenor: string;
  direction: number;
  notional: number;
  couponRate: number;
  startDate: string;
  maturityDate: string;
  /** `"swap"` 또는 `"bond"`. 자산스왑 한 줄은 둘 다 갖는다 — 채권 매수 + 같은
   * 명목의 페이 고정이라, 다리 목록에 두 줄이 서로 다른 문법으로 뜬다
   * (`isBondLeg`). 스왑 전개에는 없던 필드라 옵셔널이다. */
  bondType?: string;
  [key: string]: unknown;
}

/* ── 시나리오 ─────────────────────────────────────────────────────────────── */

/** 기준금리 이벤트 한 건 [v1 OWNER, 2026-08-10 — 제목은 "기준금리 이벤트"].
 *
 * "금통위" 는 기관명이고 트레이더가 실제로 조작하는 것은 **기준금리 그 자체**라
 * 화면도 그렇게 부른다. 날짜는 금통위 일정에서 고르지만 그 날짜에 묶이지는 않는다.
 *
 * `cdSpreadBp` 는 CD 가 기준금리 **대비** 더(덜) 움직이는 폭이다
 * [v1 트레이더 피드백 4, 2026-08-07]. 이 손잡이가 커브 스프레드 쪽이 아니라
 * 이벤트 안에 있는 이유는 엔진 때문이다: `_cum_shock_r` 은 τ ≤ 0.25 에서 이
 * 계단의 누적 bp 를 그대로 쓰고 터미널 쇼크 노드를 쳐다보지 않는다. 즉 CD 가
 * 기준금리와 다르게 움직인다는 주장은 **여기 실려야만** 3M 마디에 닿는다.
 * 기본값 0 = "CD 는 기준금리만큼 움직인다" 이고, 그게 아무 근거도 더하지 않는 값이다. */
export interface RateEvent {
  key: string;
  /** ISO 날짜. 빈 문자열이면 아직 안 고른 것이라 페이로드에서 빠진다. */
  date: string;
  /** 기준금리 변동, bp. 인하가 흔하므로 씨앗은 −25 다. */
  shiftBp: number;
  /** CD 추가, bp. */
  cdSpreadBp: number;
}

let evSeq = 0;
export function newEvent(date = ''): RateEvent {
  evSeq += 1;
  return { key: `e${evSeq}`, date, shiftBp: -25, cdSpreadBp: 0 };
}

/** 앵커 — 목표 변동을 **어느 국고 기둥에서** 말하는가.
 *
 * 트레이더는 "IRS 3Y 커브 노드를 30bp 민다" 라고 말하지 않고 "국고 10Y 가 30bp
 * 오르면" 이라고 말한다. 그래서 설계는 국고 기둥에서 하고, 전선에는 3Y 기준으로
 * 환산해 싣는다(`toWireBp`). */
export type AnchorTenor = "1Y" | "3Y" | "5Y" | "10Y";
export const ANCHOR_TENORS: AnchorTenor[] = ["1Y", "3Y", "5Y", "10Y"];

/** 케이스 넷 [v1 OWNER, 2026-08-10 — "실행결과 나란히 보여주는 거 ㄱㄱ"].
 *
 * 실행 하나가 **넷을 전부** 돌린다. 셋만 있는 결과 화면은 "비교" 라는 이 화면의
 * 목적을 반쪽으로 만든다 — 그래서 하나라도 실패하면 전체가 실패다. */
export type CaseId = "base" | "bull" | "bear" | "crisis";
export const SIM_CASES: readonly { id: CaseId; label: string }[] = [
  { id: "base", label: "Base" },
  { id: "bull", label: "Bull" },
  { id: "bear", label: "Bear" },
  { id: "crisis", label: "Crisis" },
];

/** 케이스가 **혼자 갖는** 것. 나머지(기간·앵커·모양)는 넷이 공유한다 — 케이스를
 * 갈아 끼울 때 기간까지 따라 움직이면 비교가 아니게 된다. */
/** 스테퍼 한 걸음, 그리고 목표 칸의 걸음이기도 하다 [v1 `WAYPOINT_STEP_BP`].
 * 목표와 그 경유지가 다른 눈금을 쓰면, 손으로 맞춰 놓은 경로가 목표를 한 번 누를
 * 때마다 어긋난다. */
export const WAYPOINT_STEP_BP = 5;

/** 경유지의 대칭 클램프: ±max(|목표| + 50, 100). */
export function waypointClampMax(shockBp: number): number {
  return Math.max(Math.abs(shockBp) + 50, 100);
}

/** 손대지 않은 경유지의 **직선 위 기본값** — 목표 × day/기간, 0.1bp 로 반올림해서
 * 격자 기본값이 읽히게 둔다(정확한 직선에서 ≤0.05bp 벗어난다). */
export function lerpDefaultBp(targetBp: number, day: number, simDays: number): number {
  if (simDays <= 0) return 0;
  return Math.round(((targetBp * day) / simDays) * 10) / 10;
}

/** 손댈 수 있는 날들 — 30일 간격의 **중간점만**이다. D+0 과 마감일은 고정 핀이라
 * 여기 없다: 시작은 0 이고 끝은 목표 금리 칸이 정한다. 기간이 60일보다 짧으면
 * 중간점이 없고 경로는 직선이다. */
export function waypointGrid(simDays: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < Math.floor(simDays / 30); i++) out.push(i * 30);
  return out;
}

export interface ScenarioCase {
  /** 지평 끝의 목표 변동(bp), **앵커 기둥 기준**. 음수면 하락. */
  shockBp: number;
  /** 1Y 가 3Y 대비 더(덜) 움직이는 폭, bp. 0 = 나란히. */
  spread1y: number;
  /** 10Y 가 3Y 대비 더(덜) 움직이는 폭, bp. */
  spread10y: number;
  /** 기준금리 이벤트. 비어 있으면 기준금리가 지평 내내 그대로다 — 그리고 그때
   * 짧은 끝(1D·3M)은 안 움직인다(`generateShockCurves` 참조). */
  events: RateEvent[];
  /** **손댄** 경유지만: 날 → bp. 안 손댄 날은 직선 위 기본값으로 계산된다
   * (`buildWaypoints`).
   *
   * 손댔는지를 **값으로 추론하지 않는 것**이 핵심이다 [v1 SIM2-2]. "지금 직선 위에
   * 있으니 안 손댄 것" 으로 치면, 우연히 직선에 놓인 편집이 목표를 바꾸는 순간
   * 지워진다. 여기 키가 있으면 손댄 것이다. */
  waypoints: Record<number, number>;
}

/** 씨앗. 방향은 **채권시장 관행**이다 — 불은 금리 하락, 베어는 상승(주식의
 * 불/베어와 반대라 화면에도 그렇게 적는다). 어디까지나 씨앗이고 넷 다 고쳐 쓴다. */
const seedCase = (bp: number): ScenarioCase => ({
  shockBp: bp,
  spread1y: 0,
  spread10y: 0,
  events: [],
  waypoints: {},
});

export const DEFAULT_CASES: Record<CaseId, ScenarioCase> = {
  base: seedCase(30),
  bull: seedCase(-50),
  bear: seedCase(100),
  crisis: seedCase(250),
};

export interface Scenario {
  /** 지금 편집 중인 케이스. 결과 창은 이 케이스로 열린다 — 방금 만지던 숫자의
   * 답이 먼저 보여야 한다. */
  activeCase: CaseId;
  cases: Record<CaseId, ScenarioCase>;
  /** 목표 변동을 말하는 국고 기둥. */
  anchorTenor: AnchorTenor;
  /** 달력 일수. 엔진이 영업일로 환산한다. */
  days: number;
  /** `ramp` 는 기간에 걸쳐 선형으로, `step` 은 첫날 한 번에.
   *
   * **v1 은 이 손잡이가 없다** — 언제나 `ramp` 를 보내고 모양은 waypoint 경로
   * 설계로 정한다. 그 설계기를 아직 안 옮겼고, 그동안 "첫날 한 번에" 는 사람이
   * 실제로 묻는 질문(지금 이 자리에서 50bp 튀면)이라 남겨 둔다. 스왑만 다루는
   * 지금 범위에서 `step` 이 바꾸는 것은 계단 인자뿐이다(chart.py `_factor`) —
   * 채권의 aging 경로는 닿지 않는다. */
  shape: "ramp" | "step";
}

/** v1 의 `DEFAULT_SCENARIO_PARAMS` 와 같은 씨앗 — 180일·+30bp·스프레드 0.
 * 두 화면을 같은 값에서 출발시키면 답을 나란히 놓고 볼 수 있다. */
export const DEFAULT_SCENARIO: Scenario = {
  activeCase: "base",
  cases: DEFAULT_CASES,
  anchorTenor: "3Y",
  days: 180,
  shape: "ramp",
};

/** 지금 편집 중인 케이스의 값. */
export function activeCase(sc: Scenario): ScenarioCase {
  return sc.cases[sc.activeCase];
}

/**
 * 앵커 기둥에서의 목표 → **전선에 싣는 3Y 기준 값** [v1 N1].
 *
 * 스프레드는 3Y 대비로 정의되므로(s(3Y) ≡ 0), 앵커 τ 의 최종 이동은
 * `base_wire + s_rel(τ)` 이다. 사용자가 말한 목표 X 가 그 자리에 오려면
 * `base_wire = X − s_rel(τ)` 여야 한다. 앵커가 3Y 면 항등식이다.
 */
export function tenorSpreadAt(tenor: AnchorTenor, spread1y: number, spread10y: number): number {
  switch (tenor) {
    case "1Y":
      return spread1y;
    case "3Y":
      return 0;
    case "5Y":
      return (spread10y * (5 - 3)) / (10 - 3);
    case "10Y":
      return spread10y;
  }
}

export function toWireBp(c: ScenarioCase, anchor: AnchorTenor): number {
  return anchor === "3Y" ? c.shockBp : c.shockBp - tenorSpreadAt(anchor, c.spread1y, c.spread10y);
}

/** 환산이 무너지는 하한 [v1 N1, 오너 지시]. 이 아래로는 **막는다** — 조용히
 * 0 으로 떨어뜨리면 "설계한 시나리오" 와 "돌아간 시나리오" 가 갈린다. */
export const ANCHOR_FLOOR_BP = 0.5;

/** 이 케이스를 이 앵커로 돌릴 수 없는 정직한 이유, 없으면 null.
 * 앵커 3Y 는 **절대 막지 않는다**(항등 경로). */
export function anchorError(c: ScenarioCase, anchor: AnchorTenor): string | null {
  if (anchor === "3Y") return null;
  if (c.shockBp === 0) {
    return `목표 변동 0bp에서는 ${anchor} 앵커 환산이 정의되지 않아요 — 앵커를 3Y로 두거나 목표를 지정해 주세요.`;
  }
  const wire = toWireBp(c, anchor);
  if (Math.abs(wire) < ANCHOR_FLOOR_BP) {
    return (
      `앵커 ${anchor} 목표(${c.shockBp}bp)가 그 테너 스프레드와 상쇄돼 3Y 환산이 ` +
      `${wire.toFixed(2)}bp (< ${ANCHOR_FLOOR_BP}bp)예요 — 목표나 스프레드를 조정해 주세요.`
    );
  }
  return null;
}

export interface ShockNode {
  t: number;
  val: number;
}

/**
 * 만기별 충격 커브 — v1 `generateShockCurves` 의 스왑 부분 그대로.
 *
 * 스프레드는 **3Y 대비**로 정의된다(s(3Y) ≡ 0). 짧은 끝이 이 함수의 핵심이다:
 * `shortSpread = shortEndBp − baseShockBp` 라, 금통위가 움직이지 않으면
 * (`shortEndBp = 0`) 1D·3M 노드의 최종 값이 **0** 이다. 즉 기본 시나리오는
 * "기준금리는 그대로인데 3Y 가 30bp 오른다" 이지 커브 전체의 평행이동이 아니다.
 *
 * 원화에서 그게 옳은 기본값인 이유: 오버나이트는 기준금리를 따라가고, 기준금리는
 * 금통위가 정한다. 짧은 끝을 같이 미는 것은 **다른 주장**이고, 그 주장은 금통위
 * 이벤트로 해야 한다.
 *
 * 채권 커브(`bondCurves`)는 비운다 — 이 화면의 범위가 스왑뿐이다
 * [v1 OWNER, 2026-08-06 · 실측: 채권을 빼도 스왑 손익이 바이트 그대로였고 채권
 * 성분과 조달비용은 정확히 0이었다].
 */
export function generateShockCurves(
  baseShockBp: number,
  spread1y: number,
  spread10y: number,
  shortEndBp = 0,
  cdSpreadBp = 0,
  irsSpread = 0,
): { bondCurves: Record<string, never>; swapCurve: ShockNode[] } {
  const shortSpread = shortEndBp - baseShockBp;
  /* CD 추가는 이 **터미널 커브**에서는 3M 마디에만 붙는다(1D 는 안 붙는다).
   *
   * ⚠ 그런데 화면에 보이는 결과는 그렇지 않다. 실측 2026-08-14: CD +10 을 준 날
   * 대사표의 1D 와 3M 이 **둘 다 −15.00** 이었다(기준금리 −25 + CD 10). 엔진의
   * 일별 경로는 τ ≤ 0.25 를 `fundingEvents` 의 누적 계단에서 읽고, 그 계단에는
   * 기준금리 변동과 CD 추가가 합쳐져 실린다(`buildSimulateBody` 참조) — 터미널
   * 커브의 1D 마디는 거기서 안 쳐다본다.
   *
   * v1 도 같은 페이로드를 보내므로 **동작은 v1 과 같다.** 다른 것은 주석뿐이다:
   * v1 은 이 자리에 "1D 는 안 건드린다" 라고만 적었고, 그건 이 함수 안에서만
   * 참이다. 화면에 보이는 답은 CD 추가가 오버나이트까지 민 결과다. */
  const cdSpread = shortSpread + cdSpreadBp;
  const sixMSpread = cdSpread + ((spread1y - cdSpread) * (0.5 - 0.25)) / (1.0 - 0.25);
  // 30Y 는 이 화면에 손잡이가 없다 — 10Y 를 그대로 끌고 간다(v1 의 spread30y = 0
  // 기본값과 같은 자리). 커브 노드는 v1 과 같은 열한 개를 유지한다: 노드를 빼면
  // 엔진의 보간이 달라진다.
  const spread30y = spread10y;
  const nodes: [number, number][] = [
    [1 / 365, shortSpread],
    [0.25, cdSpread],
    [0.5, sixMSpread],
    [1, spread1y],
    [2, (spread1y * (3 - 2)) / (3 - 1)],
    [3, 0],
    [5, (spread10y * (5 - 3)) / (10 - 3)],
    [7, (spread10y * (7 - 3)) / (10 - 3)],
    [10, spread10y],
    [20, spread10y + (spread30y - spread10y) * 0.5],
    [30, spread30y],
  ];
  return {
    bondCurves: {},
    swapCurve: nodes.map(([t, s]) => ({ t, val: baseShockBp + s + irsSpread })),
  };
}

/** 지평 끝의 기준금리 누적 변동(bp) — 창(0 ≤ day ≤ simDays) 안의 이벤트만 센다.
 *
 * v1 `deriveFundingSteps` + `shortEndBpFromSteps` 를 합친 것이다. v1 은 계단
 * 경로 전체를 만든 뒤 마지막 값을 읽는데, 그 경로의 나머지는 이 화면이 안 쓴다
 * (엔진이 `fundingEvents` 로 자기 계단을 다시 만든다). */
export function shortEndBpFrom(events: RateEvent[], baseDate: string, simDays: number): number {
  return inWindow(events, baseDate, simDays).reduce((sum, e) => sum + e.shiftBp, 0);
}

/** 지평 끝의 CD 추가 스프레드 — 같은 창의 이벤트 합.
 *
 * **같은 창을 쓰는 것이 중요하다** [v1]: 마감일 뒤의 이벤트가 터미널 노드에만
 * 들어가면 커브의 끝점과 거기까지 가는 계단이 어긋나고, 그게 미리보기와 실행이
 * 갈리는 자리다. */
export function cdSpreadBpFrom(events: RateEvent[], baseDate: string, simDays: number): number {
  return inWindow(events, baseDate, simDays).reduce((sum, e) => sum + e.cdSpreadBp, 0);
}

/**
 * 실행 전 검증 — 요청이 나가기 **전에**, 사람 말로, 자리를 명명해서.
 *
 * 존재 이유는 "조용히 빠지는 것들" 이다 (전체 앱 크리틱 #5, 2026-08-19):
 *   - `rowError` 가 있는 줄은 다리 전개에서 조용히 건너뛰어졌고,
 *   - 다리 전개가 실패한 줄은 조용히 페이로드에서 빠졌고,
 *   - 구간 밖(또는 날짜 미정) 이벤트는 `inWindow` 가 조용히 걸렀다.
 * 셋 다 화면은 멀쩡히 돌아서, 사용자는 자기가 넣은 조건이 반영된 줄 안다.
 * 넣은 것과 나가는 것이 다르면 실행 전에 말한다 — 다만 **막는 것은 아무것도
 * 실을 수 없을 때뿐**이고, 나머지는 첫 문제 하나를 이유로 막는다(엔진 422 의
 * 문법과 같다: 한 번에 한 이유).
 *
 * 케이스 이름을 붙이는 이유는 `anchorError` 와 같다 — 셋은 케이스 전환기 뒤에
 * 숨어 있어서 이름이 없으면 못 찾는다.
 */
export function preRunErrors(
  rows: SimRow[],
  legsByRow: Record<string, EngineLeg[] | { error: string }>,
  scenario: Scenario,
  baseDate: string,
  caseLabels: readonly { id: CaseId; label: string }[],
): string | null {
  if (!Number.isInteger(scenario.days) || scenario.days < 1) {
    return "기간(일)은 1 이상의 정수여야 해요.";
  }
  for (let i = 0; i < rows.length; i++) {
    const bad = rowError(rows[i]);
    if (bad) return `포지션 ${i + 1}번 줄: ${bad}`;
    const got = legsByRow[rows[i].key];
    if (got && !Array.isArray(got)) {
      return `포지션 ${i + 1}번 줄(${rows[i].seriesId}): ${got.error}`;
    }
  }
  for (const c of caseLabels) {
    for (const e of scenario.cases[c.id].events) {
      if (!e.date) {
        return `${c.label} 케이스: 날짜를 아직 안 고른 기준금리 이벤트가 있어요 — 날짜를 고르거나 지워 주세요.`;
      }
      if (inWindow([e], baseDate, scenario.days).length === 0) {
        return `${c.label} 케이스: 기준금리 이벤트(${e.date})가 시뮬 구간 밖이라 반영되지 않아요 — 날짜를 옮기거나 지워 주세요.`;
      }
    }
  }
  return null;
}

/** 지평 안에 드는 이벤트만. 날짜가 없는 줄(아직 안 고른 것)은 빠진다. */
function inWindow(events: RateEvent[], baseDate: string, simDays: number): RateEvent[] {
  if (!baseDate) return [];
  const base = Date.parse(baseDate);
  return events.filter((e) => {
    if (!e.date) return false;
    const day = Math.round((Date.parse(e.date) - base) / 86_400_000);
    return day >= 0 && day <= simDays;
  });
}

/** 테너 id → 연 단위 만기. **표가 아니라 파서다** [v1 `tenorToYears`] — 백엔드의
 * `curves.TENOR_T` 를 프론트에 베껴 두면 노드가 하나 늘 때 조용히 갈린다.
 * `10Y`·`6M`·`1.5Y` 는 모호하지 않으므로 읽으면 된다. 모르는 모양은 null 이고,
 * 그 기둥은 미리보기에서 빠진다(지어내지 않는다). */
export function tenorYears(id: string): number | null {
  const m = /^(\d+(?:\.\d+)?)([YMD])$/.exec(id.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === "Y" ? n : m[2] === "M" ? n / 12 : n / 365;
}

/** 충격 노드 커브를 만기 t 에서 선형 보간(bp). 양 끝은 클램프한다.
 * 커브 미리보기가 화면의 기둥마다 값을 얻는 방법이고, 엔진의 보간과 같은 규칙이다. */
export function shockAtTenor(nodes: ShockNode[], t: number): number {
  if (!nodes.length) return 0;
  if (t <= nodes[0].t) return nodes[0].val;
  if (t >= nodes[nodes.length - 1].t) return nodes[nodes.length - 1].val;
  for (let i = 0; i < nodes.length - 1; i++) {
    if (t >= nodes[i].t && t <= nodes[i + 1].t) {
      const r = (t - nodes[i].t) / (nodes[i + 1].t - nodes[i].t);
      return nodes[i].val + r * (nodes[i + 1].val - nodes[i].val);
    }
  }
  return 0;
}

/** 그 케이스의 충격 커브 — 미리보기와 실행이 **같은 함수**를 부른다. 둘이 갈리면
 * 화면이 보여준 시나리오와 돌아간 시나리오가 다르다. */
export function caseShockCurve(
  scenario: Scenario,
  caseId: CaseId,
  baseDate: string,
): ShockNode[] {
  const c = scenario.cases[caseId];
  return generateShockCurves(
    toWireBp(c, scenario.anchorTenor),
    c.spread1y,
    c.spread10y,
    shortEndBpFrom(c.events, baseDate, scenario.days),
    cdSpreadBpFrom(c.events, baseDate, scenario.days),
  ).swapCurve;
}

export interface Waypoint {
  day: number;
  bp: number;
}

/**
 * 그 케이스의 경로 — D+0 · **손댄** 중간점들 · 마감일(목표) 순.
 *
 * ⚠ **안 손댄 날은 안 싣는다.** 화면은 그 자리에 직선 위 기본값을 보여주지만
 * (`lerpDefaultBp`, 0.1bp 반올림 — 읽히라고), 그 값을 페이로드에 넣으면 안 된다.
 * 엔진이 점들 사이를 선형 보간하므로 직선 위의 점을 빼는 것은 **정확히 등가**이고,
 * 넣는 것은 등가가 아니다.
 *
 * 실측 2026-08-14 (3Y 페이 100억 · 180일):
 *
 *     목표      두 점 직선        정확 격자        0.1bp 반올림 격자
 *     −50    −178,024,749    −178,024,749      −175,347,974   (+1.50%)
 *     +100    178,258,080     178,258,080       173,070,725   (−2.91%)
 *     +250    521,291,310     521,291,310       508,814,693   (−2.39%)
 *
 * 정확 격자는 두 점과 **원 단위까지 같다** — 격자 자체는 무해하다. 0.1bp 반올림만이
 * 답을 바꾸고, 그 크기가 경로 편차(0.03bp)의 90배다. 엔진에 "이 경로가 직선인가"
 * 를 1e-9 로 재는 판정이 있어서, 반올림된 점 하나가 시나리오를 통째로 다른 갈래로
 * 보낸다. 손대지도 않은 반올림이 그 문턱을 넘게 두면 안 된다.
 *
 * (v1 은 방문한 케이스에만 격자를 쓰고 나머지 셋은 두 점 씨앗을 그대로 보낸다.
 * 그래서 이 함정이 케이스마다 달리 나타났다 — 여기서는 아예 없앤다.)
 */
export function buildWaypoints(c: ScenarioCase, simDays: number): Waypoint[] {
  const clamp = waypointClampMax(c.shockBp);
  const out: Waypoint[] = [{ day: 0, bp: 0 }];
  for (const day of waypointGrid(simDays)) {
    const touched = c.waypoints[day];
    if (typeof touched !== "number" || !Number.isFinite(touched)) continue;
    out.push({ day, bp: Math.max(-clamp, Math.min(clamp, touched)) });
  }
  out.push({ day: simDays, bp: c.shockBp });
  return out;
}

/** 화면이 그 날 칸에 보여줄 값 — 손댔으면 그 값, 아니면 직선 위 기본값(0.1bp).
 * **보여주는 값과 싣는 값이 다르다**는 것이 위 주석의 요점이다. */
export function shownWaypointBp(c: ScenarioCase, day: number, simDays: number): number {
  const touched = c.waypoints[day];
  return typeof touched === "number" && Number.isFinite(touched)
    ? touched
    : lerpDefaultBp(c.shockBp, day, simDays);
}

/** 경유지 사이를 선형 보간한다 — 엔진이 `customPath` 를 읽는 방식과 같은 규칙이다.
 * 미리보기가 다른 규칙으로 그리면 화면의 경로와 돌아간 경로가 다르다. */
export function lerpWaypoints(day: number, sorted: Waypoint[]): number {
  if (!sorted.length) return 0;
  if (day <= sorted[0].day) return sorted[0].bp;
  const last = sorted[sorted.length - 1];
  if (day >= last.day) return last.bp;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (day >= sorted[i].day && day <= sorted[i + 1].day) {
      const r = (day - sorted[i].day) / (sorted[i + 1].day - sorted[i].day);
      return sorted[i].bp + r * (sorted[i + 1].bp - sorted[i].bp);
    }
  }
  return 0;
}

/** 기간이 바뀌면 격자가 바뀐다 — 새 격자에 없는 날의 편집은 **버린다** [v1].
 * 안 버리면 마감일이 지난 경유지를 그대로 물고 들어가 경로가 거짓이 된다. */
export function pruneWaypoints(
  touched: Record<number, number>,
  simDays: number,
): Record<number, number> {
  const grid = new Set(waypointGrid(simDays));
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(touched)) if (grid.has(Number(k))) out[Number(k)] = v;
  return out;
}

export interface SimulateBody {
  positions: EngineLeg[];
  shockCurves: { bondCurves: Record<string, never>; swapCurve: ShockNode[] };
  dailyShockCurves: { bondCurves: Record<string, never>; swapCurve: never[] };
  fundingEvents: { date: string; shiftBp: number }[];
  simDays: number;
  shockType: "ramp" | "step";
  shockMode: "matrix";
  baseShockBp: number;
  baseDate: string;
  irsCurves: never[];
  customPath: Waypoint[];
  sigma_bp: number;
  fundingStepping: false;
  includeDistribution: false;
}

/**
 * 요청 본문. 손대면 안 되는 상수들이 있어서 값마다 이유를 적어 둔다.
 *
 * `includeDistribution: false` 가 눈에 보이는 차이를 만든다: v1 실측으로 분위수
 * 팬이 109.9초 중 82.8초(75%)였고 끄면 27초였다. v2 첫 실측은 3Y 한 다리에
 * 1.7초다. (그 필드에는 사연이 있다 — 프론트는 예전부터 `false` 를 보내고
 * 있었는데 **백엔드에 그 필드가 없어서** Pydantic 이 조용히 버렸다. 요청 하나가
 * 두 시스템에서 서로 다른 뜻이었고, 2026-08-06 에 백엔드가 그 이름을 듣게 되면서
 * 주석이 사실이 됐다.)
 */
export function buildSimulateBody(
  legs: EngineLeg[],
  scenario: Scenario,
  baseDate: string,
  caseId: CaseId = scenario.activeCase,
): SimulateBody | null {
  if (legs.length === 0 || !baseDate) return null;
  const c = scenario.cases[caseId];
  const shortEndBp = shortEndBpFrom(c.events, baseDate, scenario.days);
  const cdBp = cdSpreadBpFrom(c.events, baseDate, scenario.days);
  // 앵커 기둥의 목표를 3Y 기준으로 환산해 싣는다 — 앵커 3Y 면 항등식이다.
  const wireBp = toWireBp(c, scenario.anchorTenor);
  return {
    positions: legs,
    shockCurves: generateShockCurves(
      wireBp,
      c.spread1y,
      c.spread10y,
      shortEndBp,
      cdBp,
    ),
    dailyShockCurves: { bondCurves: {}, swapCurve: [] },
    /* 이 배열이 **커브의 짧은 끝**을 정한다 [v1 트레이더 피드백 4, 2026-08-07].
     *
     * 엔진의 `_cum_shock_r` 은 τ ≤ 0.25 에서 이 계단의 누적 bp 를 그대로 쓴다 —
     * 터미널 쇼크 노드는 거기서 쳐다보지 않는다. 그래서 여기 나가는 값은 **CD 의
     * 그날 이동**이다: 기준금리 변동 + CD 추가.
     *
     * 대가를 적어 둔다: `fundingStepping` 이 켜지면 같은 배열이 조달비용 계단으로도
     * 쓰이고, 그러면 조달이 기준금리가 아니라 CD 만큼 걷는다. 이 화면에서는 그
     * 토글이 구조적으로 false 라 지금은 안 닿는다. 되살릴 일이 생기면 CD 추가를
     * 여기서 빼고 짧은 끝을 다른 경로로 실어야 한다.
     *
     * 창 밖의 이벤트도 그대로 보낸다 — 자르는 것은 위 두 스칼라(터미널 값)뿐이다.
     * 엔진은 자기 지평 안에서만 계단을 밟으므로 결과는 같고, 사용자가 적어둔 것을
     * 조용히 버리지 않는다. */
    fundingEvents: c.events
      .filter((e) => e.date)
      .map((e) => ({ date: e.date, shiftBp: e.shiftBp + e.cdSpreadBp })),
    simDays: scenario.days,
    shockType: scenario.shape,
    // 언제나 matrix. parallel 은 swapCurve 를 통째로 버린다(모듈 주석 ③).
    shockMode: "matrix",
    baseShockBp: wireBp,
    baseDate,
    // 비워 보낸다 — 백엔드가 기준일 IRS 스냅샷에서 읽는다(모듈 주석 ②).
    irsCurves: [],
    /* 경로. 설계한 것은 **앵커 기둥**에서의 bp 이므로 전선에 실을 때 같은 비율로
     * 환산한다(`wireBp / shockBp`) — 그래야 앵커에서 경로가 설계 그대로 재현된다.
     * 앵커 3Y 면 비율이 1 이라 항등식이다. 목표가 0 이면(앵커 3Y 에서만 가능)
     * 나눌 수 없으므로 비율을 1 로 둔다 — 그때 경로도 전부 0 이다.
     *
     * `shape: 'step'` 은 경로를 비운다: 직선 경로와 계단 인자를 같이 보내면 엔진이
     * 경로를 따르고 계단은 무시된다. */
    customPath:
      scenario.shape === "ramp"
        ? buildWaypoints(c, scenario.days).map((w) => ({
            day: w.day,
            bp: c.shockBp === 0 ? w.bp : (w.bp * wireBp) / c.shockBp,
          }))
        : [],
    // 분위수 팬을 끄므로 닿지 않는 값이지만, 백엔드 계약이 (0, 25] 라 기본값을
    // 명시한다. 생략하면 백엔드 기본 2.0 과 같다.
    sigma_bp: 2.0,
    // 조달비용 계단. 스왑 전용 범위에서는 구조적으로 false 다.
    fundingStepping: false,
    includeDistribution: false,
  };
}

/* ── 응답에서 읽는 것 ────────────────────────────────────────────────────── */

export interface SimSummary {
  finalMTM: number;
  finalCarry: number;
  finalSwap: number;
  finalTotal: number;
  /** −1 = 손익분기 없음(첫날부터 이익이거나 끝까지 손실). 0 이 아니다. */
  breakEvenDay: number;
}

/** 지평 끝의 성분 분해(반올림 전 원 단위).
 *
 * `swapMtm + swapCarry + swapRolldown + bondMtm + bondCarry + fundingCost = total`
 * (±₩1, 서버가 못박는다). 스왑만 싣는 이 화면에서는 채권 셋이 0 이어야 하고,
 * 0 이 아니면 화면이 그 사실을 말한다 — 잔차로 접어 넣으면 캐리가 조용히 틀린다.
 *
 * `swapRolldown` 은 2026-08-11 3분해에서 생겼다. 구 캐시 응답에는 없고 그때는
 * `swapCarry` 가 세타 전액이다 — 옵셔널인 이유다. */
export interface SimDecomposition {
  swapMtm: number;
  swapCarry: number;
  swapRolldown?: number | null;
  bondMtm: number;
  bondCarry: number;
  fundingCost: number;
  total: number;
}

/** 스왑 한 건의 지평 끝 기여. `total === mtm + carry` 이고 모든 행의 합이 응답의
 * 스왑 성분 합과 같다(±₩1, 백엔드 테스트가 못박는다). */
export interface SimContribution {
  positionId: string;
  positionName: string;
  notional: number;
  /** `+1 = 고정 수취`, `−1 = 고정 지급` — 다리의 부호다(줄의 부호가 아니다). */
  direction: number;
  fixedRate: number;
  maturityDate: string | null;
  mtm: number;
  carry: number;
  total: number;
}

/** 엔진의 하루치 IRS 대사 한 행.
 *
 * `pvbp` 는 그 행의 추정에 쓴 **전일(start-of-day) KRD** 다 — 한 블록 안에서
 * `pvbp × dailyDbp = pnl` 이 닫힌다. 마지막 날의 종가 KRD 는 끝의 이월 앵커
 * 행(`carryover`)이 싣고 그 행의 손익 필드는 전부 null 이다: 아직 오지 않은 날의
 * 손익을 0 이라고 말하지 않는다(공란 정책).
 *
 * 전일 KRD 를 쓰는 것은 P&L explain 민감도 방식의 교과서 관행이다 — "어제의 민감도
 * × 오늘의 변동". 마켓 컨벤션 주의: "N일자 KRD" 는 N 의 결제일(다음 영업일) 기준
 * 재평가 값이라, 트레이딩 시스템과 대조할 때 하루 어긋나 보이면 이 규칙부터 본다. */
export interface SimReconRow {
  date: string;
  day: number;
  pvbp: Record<string, number>;
  dailyDbp: Record<string, number>;
  pnl: Record<string, number>;
  totalEstPnl: number | null;
  totalActual: number | null;
  valuationPnl: number | null;
  /** 구 캐시 응답에는 3분해가 없다 — 0 이 아니라 미정의(공란 정책). */
  carryPnl?: number | null;
  rolldownPnl?: number | null;
  carryover?: boolean;
}

export interface SimResponse {
  status?: string;
  chartData: { day: number; totalPnL?: number }[];
  summary: SimSummary;
  totalReturnDecomposition: SimDecomposition;
  swapContributions?: SimContribution[];
  irsDailyReconciliation?: SimReconRow[];
  /** 성분의 **누적** 경로(하루 한 행). 서버가 누적을 주므로 화면은 차분하지
   * 않는다 — 차분하면 서버와 갈릴 수 있는 두 번째 정의가 생긴다. 스왑이 제외된
   * 실행에서는 스왑 성분이 null 이다(공란 정책). */
  decompositionDaily?: {
    day: number;
    swapMtm: number | null;
    swapCarry: number | null;
    swapRolldown?: number | null;
    /** 채권 성분 — 서버는 늘 싣는다(스왑만인 북에서는 0). 화면은 0 이 아닐
     * 때만 선을 세운다 [OWNER, 2026-08-14 — 시뮬 포지션에 현금채권·자산스왑]. */
    bondMtm?: number | null;
    bondCarry?: number | null;
    fundingCost?: number | null;
    total: number;
  }[];
  /** 자산군이 통째로 빠진 이유. 빠진 것은 0 이 아니라 **공란**으로 말한다. */
  exclusions?: { assetClass?: string; reason?: string; asOf?: string }[];
}
