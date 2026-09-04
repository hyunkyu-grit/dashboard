/* Mean Reversion 측정면의 서버 계약 — `/api/mr/board` · `/api/mr/history/{id}` ·
 * `/api/mr/strategy` · `/api/mr/book`.
 *
 * 숫자는 전부 서버가 끝낸다(§16, `backend/app/mr.py`): 밴드·z·%B·상태 판정·
 * 정렬·순위까지. 이 파일은 타입과 페처뿐이다. 라이브 전용이다 — BSS 가
 * SQL 에만 있어 미리 구울 수 없다(Credit RV 와 같은 사정).
 *
 * 네 번째(`/api/mr/book`)는 2026-09-01 에 붙은 **BSS 테너 통합 장부**다. 낱개
 * 계열이 아니라 아홉 만기를 한 장부로 더한 것이고, 노브는 낱개 창과 같다.
 */

import { BacktestUnavailable } from '@/lib/api';
import { mrBoardUrl, mrBookUrl, mrHistoryUrl, mrReconUrl, mrStrategyUrl } from '@/lib/staticPaths';
import type { BacktestRecon } from '@/lib/api';

/** 밴드 상태 — 판정이지 행동이 아니다. 검증 레인(bollinger-mr)과 같은 어휘. */
export type MrStateKind = 'below' | 'above' | 'reentry-low' | 'reentry-high' | 'inside';

export interface MrState {
  kind: MrStateKind;
  /** 밖이면 며칠째, 재진입이면 복귀 며칠째. `inside` 는 null. */
  days: number | null;
}

export interface MrRow {
  id: string;
  label: string;
  /** 계열 종류 — bss(국고−IRS) · fut(선물 내재금리) · fsw(퓨처스왑). */
  kind: 'bss' | 'fut' | 'fsw';
  /** 정의 문장 — 서브라인이 그대로 읽는다(혼합 유니버스의 «무엇인지»). */
  defn: string;
  /** 순위 — |z| 내림차순, 서버가 매긴다(§16). */
  rank: number;
  /** 값의 단위 — 스프레드류 bp · 내재금리 %. */
  unit: string;
  v: number;
  /** 전일 대비 — %-계열은 서버가 bp 로 끝내서 준다(`dUnit`). */
  d1: number;
  dUnit: string;
  ma: number | null;
  upper: number | null;
  lower: number | null;
  /** (값 − 중심선)/σ — 늘어남의 크기. 정렬 축이다. */
  z: number | null;
  /** 밴드 안 위치(0~100, 밖이면 범위 밖) — %B. */
  pctB: number | null;
  /** 밴드 전폭(상단−하단) — %-계열은 bp. */
  width: number | null;
  asof: string;
  state: MrState;
}

/** 통합 줄의 다리 하나 — 만기 순으로 늘어선다(랭킹 순이 아니다). */
export interface MrWatchLeg {
  id: string;
  label: string;
  tenor: string;
  v: number;
  d1: number;
  z: number | null;
  pctB: number | null;
  state: MrState;
  asof: string;
}

/** BSS 통합 한 줄 [OWNER 2026-09-01] — 랭킹 **아래**에 따로 선다.
 *
 * **레벨이 없다.** 만기가 다른 아홉 스프레드의 평균은 거래할 수 있는 값이
 * 아니라서 「값」·「전일」 칸을 안 만든다. 단위 없는 둘(|z|·%B)만 평균이고
 * 나머지는 개수다 — 밴드 워치가 답해야 하는 질문이 「지금 몇 개가 나가
 * 있나」이기 때문이다. 산술은 서버(`backend/app/mrbook.py::watch`).
 */
export interface MrWatch {
  id: string;
  label: string;
  kind: 'book';
  defn: string;
  /** 묶음에 든 만기 수. */
  n: number;
  outLow: number;
  outHigh: number;
  reentry: number;
  inside: number;
  meanAbsZ: number | null;
  meanPctB: number | null;
  /** 가장 늘어난 다리 — 개수만 남으면 「어디가」를 못 읽는다. */
  peak: { id: string; label: string; z: number } | null;
  asof: string | null;
  /** 가장 뒤처진 다리의 종가일. `asof` 와 같으면 아홉이 다 같은 날이다. */
  asofMin: string | null;
  /** 최신 종가일보다 뒤처진 다리 수 — 0 이 아니면 화면이 그 사실을 말한다. */
  stale: number;
  legs: MrWatchLeg[];
}

export interface MrBoard {
  /** 소스별 as-of — BSS(민평×IRS)와 선물(선물표×IRS)이 갈라질 수 있고,
   * 갈라진 날은 화면이 그렇다고 말한다(rv 의 B-2). */
  asof: { bss: string | null; fut: string | null };
  params: { window: number; k: number; recentN: number };
  rows: MrRow[];
  /** BSS 통합 줄. BSS 행이 하나도 안 서면 null 이다. */
  watch: MrWatch | null;
  /** 못 읽은 테너 — 조용히 빼지 않는다(rv 의 exclusions 문법, 사유는 서버 것). */
  excluded: { id: string; label: string; reason: string }[];
}

export interface MrHistoryPoint {
  t: string;
  v: number;
  ma: number | null;
  up: number | null;
  lo: number | null;
}

export interface MrHistory {
  id: string;
  label: string;
  unit: string;
  points: MrHistoryPoint[];
}

/* ── 전략 실험 창 [OWNER 2026-08-25 — "첫 PMS 의 그 창 참고해서 구현"] ────────
 * 산술은 서버(backend/app/mrbacktest.py — PMS 원본 이식·적합성 벡터로 잠금).
 * 기본값도 PMS s16 기본 그대로다. */

/** 진입 규칙 — 「언제 실행에 옮기는가」 [OWNER 2026-08-28 — "진입 기준이 외부로
 * 이탈했다가 다시 그 선을 터치할 때"].
 *
 *   level — |z| ≥ 진입σ 인 봉에 들어간다. 밴드를 **뚫는** 그 봉이다(원본 PMS).
 *   touch — 밖에 있다가 밴드로 **복귀하는** 봉에 들어간다. 방향은 나갔던 쪽이
 *           정한다(복귀 봉의 z 부호가 아니다 — 지나쳐 내려올 수 있다).
 *
 * 규칙 둘의 전문은 서버가 진다(`backend/app/mrbacktest.py::_entry_signal`).
 * 측정면의 「재진입」 판정(`MrStateKind`)이 가리키는 봉이 `touch` 의 진입 봉이다 —
 * 두 화면이 같은 사건을 다른 규칙으로 말하지 않게 어휘를 맞춰 둔다. */
export type MrEntryMode = 'level' | 'touch';

export const MR_ENTRY_MODES: { v: MrEntryMode; label: string; help: string }[] = [
  { v: 'level', label: '이탈 즉시',
    help: '|z|가 진입σ를 넘는 봉에 들어가요 — 밴드를 뚫는 그 봉이에요. 첫 PMS 규칙이에요.' },
  { v: 'touch', label: '밴드 복귀',
    help: '밖에 있다가 밴드 선으로 돌아오는 봉에 들어가요. 방향은 나갔던 쪽이 정해요.' },
];

/* ── 실전 운용 규칙 [OWNER 2026-08-28 — "일단 민평 기준으로"] ─────────────────
 *
 * 다섯 지침을 화면 노브로 올린 것이다. **전부 끄면 원본 PMS 재현 그대로**이고,
 * 근거·실측은 `docs/MR_LANE_STATE.md` 와 `backend/scripts/mr_live_report.py` 가
 * 진다. 필터와 비용 경로는 서버가 만든다(§16) — `backend/app/mrregime.py`.
 *
 * 표본외 실측에서 기여가 균등하지 않았다는 점을 화면이 말해야 한다: 타임스탑이
 * 단독 최대(SR 0.63→0.95)이고, 동적 비용은 유일하게 깎는 항이며, 변동성 필터는
 * 검증 창에서 한 건도 안 막았다. */

/** 레짐 필터 — 진입만 막는다. 청산·손절은 필터를 안 본다(엔진 규약). */
export type MrRegime = 'none' | 'vol' | 'trend';

/** 거래비용 모델 — 고정 편도 bp 대 변동성 연동 0.15~0.25bp. */
export type MrCostModel = 'flat' | 'dynamic';

export const MR_REGIMES: { v: MrRegime; label: string; help: string }[] = [
  { v: 'none', label: '없음', help: 'z 문턱만 봐요. 원본 PMS 규칙이에요.' },
  { v: 'vol', label: '변동성',
    help: '30일 실현변동성이 그날까지의 상위 10%면 진입을 막아요. 백분위는 과거만 봐요.' },
  { v: 'trend', label: '추세',
    help: '20일 이동평균이 120일 위면(스프레드 확대 추세) 진입을 막아요. 실측에서는 과잉 차단이었어요.' },
];

export const MR_COST_MODELS: { v: MrCostModel; label: string; help: string }[] = [
  { v: 'flat', label: '고정', help: '옆 칸의 편도 bp를 모든 봉에 그대로 써요.' },
  { v: 'dynamic', label: '동적',
    help: '변동성 백분위에 연동해 편도 0.15~0.25bp를 물려요. 진입일은 평시보다 변동성이 높아요(중앙 백분위 0.71 대 0.46).' },
];

/** 타임스탑 선택지(영업일). 0 은 끔이다. 20 은 지시가 준 값이고 실측에서 단독
 *  최대 기여였다 — 앞뒤로 절반·두 배를 둔다. */
export const MR_TIME_STOPS = [0, 10, 20, 40] as const;

export interface MrStrategyParams {
  lookback: number;
  entryZ: number;
  exitZ: number;
  stopZ: number;
  costBp: number;
  notional: number;
  entryMode: MrEntryMode;
  /** 진입 후 N영업일이면 손익 불문 청산. 0 이면 끔. */
  timeStop: number;
  costModel: MrCostModel;
  regime: MrRegime;
  /** 반대 방향 진입 신호를 **나가는 문**으로 쓴다(그 방향으로 들어가지는 않는다). */
  reverseExit: boolean;
  /** 표본 끝의 미청산 다리를 거래로 센다 — 승률·거래 수·보유기간에 든다.
   *  총손익·MDD 는 원래부터 미청산을 지고 있어서 안 바뀐다. */
  countOpen: boolean;
}

export const MR_STRATEGY_DEFAULTS: MrStrategyParams = {
  lookback: 60,
  entryZ: 2.0,
  exitZ: 0.5,
  stopZ: 3.5,
  costBp: 0.5,
  notional: 1_000_000,
  entryMode: 'level',
  /* 실전 규칙은 **꺼진 채로 시작한다** — 이 창의 계약이 「원본 PMS 재현」이라,
     열자마자 딴 규칙의 수가 서 있으면 그 계약이 깨진다. */
  timeStop: 0,
  costModel: 'flat',
  regime: 'none',
  reverseExit: false,
  countOpen: false,
};

/** PMS 룩백 프리셋 그대로 — 20/60/120 + 자유 입력. */
export const MR_STRATEGY_LOOKBACKS = [20, 60, 120] as const;

/** σ 문턱의 선택지 [OWNER 2026-08-25 — "선택지로 다 줄 수 있는거야?"].
 *
 * 보드(MR_WINDOWS·MR_KS)와 같은 규율이다: **근거 있는 값만** 늘어놓는다.
 * 가운데가 PMS s16 기본이고 양옆이 문헌·데스크의 통상 변형이다.
 *
 *   진입 1.5 / 2.0 / 2.5 — 볼린저 밴드의 통상 배수(2가 기본, 1.5 민감·2.5 보수)
 *   청산 0 / 0.5 / 1.0   — 0 은 완전 평균회귀(중심선), 0.5 가 PMS 기본
 *   손절 3.0 / 3.5 / 4.0 — z-발산 손절. 진입의 대략 1.5~2배가 통상
 *
 * **「관찰 σ」(`warnZ`)는 2026-09-02 에 셋 다에서 빠졌다** [OWNER — "이건 뭔지
 * 확인하고 필요없으면 치우기"]. 「경보 문턱」이라는 이름이 그 값이 하는 일을
 * 과장하고 있었다 — 경보하는 곳이 없었고 z 그림에 점선 두 줄만 그었다. 값은
 * 프리셋·기본값·쿼리·백엔드 검증 네 층에 있었는데 결과를 한 번도 안 바꿨다.
 * 근거가 「문헌의 통상값」이어도, 그 값을 읽는 결정이 없으면 노브가 아니다.
 *
 * **명목은 프리셋이 없다** — 그건 「보통 쓰는 값」이 아니라 이 데스크의 포지션
 * 크기다. 세 개를 늘어놓으면 근거가 아니라 지어낸 기준이 된다.
 *
 * **비용은 2026-08-28 에 프리셋이 생겼다.** 종전에는 같은 이유로 자유 입력만
 * 뒀는데, 그 사이에 근거가 생겼다 — 오너가 국고3Y·IRS3Y 패키지 실제 편도를
 * **≤0.5bp** 로 답했다. 근거 있는 값이 있으면 프리셋이 지어낸 기준이 아니라
 * 사실이 된다. 셋의 뜻이 각각 다르다(`MR_COST_PRESETS`).
 */
/** 편도 비용(bp)의 선택지 — **셋의 뜻이 다르다**.
 *
 *   0.05  첫 PMS 의 값. 재현용이지 이 데스크의 호가폭이 아니다.
 *   0.2   중간. 좋은 날의 호가폭 언저리.
 *   0.5   **오너 실측** — 국고3Y·IRS3Y 패키지 실제 편도(2026-08-26). 기본값이다.
 *
 * 기본을 0.5 로 둔 이유: 싸게 잡은 비용은 결론을 통째로 뒤집는다. 이웃 레인이
 * 0.05 에서 통과하고 0.5 에서 죽는 판정을 냈고(손익분기 0.479bp), 이 창도
 * 0.05 로 열리면 그 함정을 매번 다시 밟게 된다. */
export const MR_COST_PRESETS = [0.05, 0.2, 0.5] as const;

export const MR_STRATEGY_PRESETS = {
  entryZ: [1.5, 2.0, 2.5],
  exitZ: [0, 0.5, 1.0],
  stopZ: [3.0, 3.5, 4.0],
} as const;

/** σ 표기 — 2.0 은 「2」로. 알약 넷이 한 줄에 서므로 자릿수가 곧 폭이다. */
export const fmtSigma = (v: number): string => `${Number(v.toFixed(1))}σ`;

export interface MrStrategyPoint {
  t: string;
  v: number;
  z: number | null;
  ma: number | null;
  /** 밴드 배수는 entryZ — PMS 의 «노브 하나, 뜻 둘» 그대로. */
  up: number | null;
  lo: number | null;
  /** 누적 손익(₩) — 표본 끝 미청산 MTM 포함. */
  cum: number;
  /** 그날의 분해 — 셋의 합이 `pnl` 이다. 거래를 누르면 **일별 대사**가 이걸
   *  편다(백테스트 창의 「일별 대사」와 같은 문법). */
  mtm: number;
  carry: number;
  /** 롤다운·조달 — **실가격 회계에서만 온다**(`run.real`). 엔진 근사에는 그
   *  항이 아예 없으므로 `undefined` 이고, 0 이 아니다: 0 은 「그날 롤다운이
   *  없었다」는 다른 말이다. 선물 계열은 자산스왑이 아니라 늘 없다. */
  rolldown?: number;
  funding?: number;
  cost: number;
  pnl: number;
  /** 그날의 포지션(엔진 부호). 0 이면 무포지션이다. */
  pos: number;
  /** 그 봉을 **통과해서 들고 있던** 포지션 — `pos` 와 다르다(진입 봉 0 · 청산
   *  봉 ±1). 대사표의 「감도」가 이 값이고, `평가 = 감도 × 명목 × Δ` 가 한 줄
   *  안에서 닫힌다(백테스트 대사표의 「전일 종가 KRD」와 같은 자리). */
  hold: number;
  /** 그 봉의 **거래 가능한** 변화(**bp**). 첫 봉은 null. 브라우저는 계산하지
   *  않는다(§16) — %-계열(선물 내재금리)의 환산도 서버가 끝낸다.
   *
   *  롤일(아래 `roll`)에는 **0** 이다 [OWNER 2026-09-02 — "롤일 Δ 를 0 으로
   *  마스크"]. 그날 수준은 움직이지만 그 움직임은 계약이 갈린 것이라 아무도
   *  실현하지 못한다. 대사표의 「감도 × 명목 × Δ = 평가」는 이 값 위에서 닫힌다. */
  dv: number | null;
  /** 그 봉이 선물 계약이 갈리는 날인가 — 참이면 `dv` 가 0 이다. BSS 는 늘
   *  거짓이다(상수만기라 롤이 없다). 구 백엔드는 이 열이 없다(undefined). */
  roll?: boolean;
  /** 그 거래 안에서의 누적(₩) — 무포지션이면 0, 청산 봉이면 확정 손익이다.
   *  대사표의 **세로합**을 줄마다 적어서, 「합계」 줄이 스스로 맞는지 보이게 한다. */
  tradePnl: number;
  /** 밴드 밖 여부 — `+1` 위(비쌈) · `-1` 아래(쌈) · `0` 안. 측정 보드의
   *  `MrState` 와 같은 어휘다(`밖`/`재진입`). */
  out: number;
  /** 연속 며칠째 밖인가. 안이면 0. */
  outRun: number;
  /** 다리 레벨(**%**) [OWNER 2026-09-02 — "스왑 파 커브 상의 레벨, 채권 커브
   *  상의 레벨, CD금리 레벨이 진입시점에 확인되고"]. 캐리와 같은 출처
   *  (`mrseries` — 국고 커브·IRS 파·CD 91일)를 날짜로 조인한 값이고, BSS 는
   *  (국고 − IRS) × 100 = v 가 정확히 성립한다(서버가 검증한 항등 — 화면은
   *  그 사실을 보이기만 한다). 선물·퓨처스왑(다리가 다름)과 구 백엔드는
   *  없다(`undefined`/null) — 화면 열이 조용히 접힌다. */
  govt?: number | null;
  irs?: number | null;
  cd?: number | null;
  /** 그 봉의 **다리별 대사 줄** [OWNER 2026-09-03 — "채권 KRD, bp, 손익과 IRS
   *  KRD, bp, 손익, 그리고 종합 손익이 하루에 찍혀야 함"]. 스프레드 플레이는
   *  한 물건이 아니라 다리 둘이라, 대사가 이중이어야 «어느 다리가 벌었나» 를
   *  말할 수 있다. 선물 아웃라이트는 다리가 하나라 길이가 1 이고, 그때 표는
   *  백테스트와 같은 3줄이다.
   *
   *  **항등 둘이 줄로 닫힌다**(서버가 봉마다 재고, 안 맞으면 아예 안 보낸다):
   *  `Σ mtm = 평가` · 다리가 둘이면 `Σ krd = 0`(DV01 중립이 눈에 보인다).
   *  구 백엔드는 이 열이 없다(undefined) — 화면이 조용히 접는다. */
  legs?: MrReconLeg[];
}

/** 대사표의 다리 한 줄. 값은 전부 **서버가 낸다**(§16).
 *
 * ⚠ `MrDirection.legs`(방향의 이름 — "국고 매수 · IRS 페이" 같은 **문장**)와
 * 이름이 겹친다. 이쪽은 봉마다의 **숫자 줄**이다. 둘이 같은 파일에 살아서
 * 헷갈릴 자리라 적어 둔다(화면의 `hasLegLevels` 도 같은 이유로 이름이 길다). */
export interface MrReconLeg {
  /** 다리 이름 — 표의 구분 칸이 이 말을 쓴다(`국고`·`IRS`·`선물`). */
  k: string;
  /** 그 다리의 레벨(**%**). */
  lvl: number;
  /** 그 다리의 그 봉 변화(**bp**). 첫 봉은 null. 롤일에는 **다리도 0** 이다 —
   *  한쪽만 살리면 「감도 × Δ = 손익」이 그 줄에서 안 닫힌다. */
  dv: number | null;
  /** 감도(**₩/bp**) — 백테스트 대사표의 부호 규약 그대로 `손익 = −KRD × Δbp`.
   *  다리 둘이면 크기가 같고 부호가 반대다(합 0 = DV01 중립). */
  krd: number;
  /** 그 다리의 그날 평가(₩). */
  mtm: number;
  /** 그 다리의 그날 캐리(₩). 선물 다리는 늘 0 이다 — 증거금·일일정산이라
   *  조달 현금흐름이 없고, 채권 캐리는 이미 선물 가격에 박혀 있다. */
  carry: number;
}

export interface MrStrategyTrade {
  entryT: string;
  exitT: string;
  /** 엔진 부호 — 이름은 `run.dirs` 가 진다(계열마다 다른 다리다). */
  dir: number;
  entryZ: number;
  /** **null 일 수 있다** — 타임스탑은 z 를 안 보므로 time 청산이 σ=0(z=null)
   *  봉에 앉을 수 있다(countOpen 의사거래의 마지막 봉도 같다). 화면은 '—' 로
   *  적는다 — 무가드 toFixed 가 서버의 그 500 을 화면에서 재연하면 안 된다. */
  exitZ: number | null;
  entryV: number;
  exitV: number;
  pnl: number;
  /** 청산 사유. 우선순위가 곧 이름이다 — 손절 > 청산 > 역신호 > 타임스탑.
   *  `open` 은 표본 끝의 미청산 다리를 거래로 셀 때만 나온다(청산 비용 없음). */
  why: 'exit' | 'stop' | 'reverse' | 'time' | 'open';
  /** 대사 분해 — 실가격 회계에서는 **다섯**이 `pnl` 로 닫힌다
   *  (`평가 + 캐리 + 롤다운 + 조달 + 비용`), 엔진 근사에서는 셋이다
   *  (`평가 + 캐리 + 비용`). 화면이 그 항등을 보여 준다. */
  mtm: number;
  carry: number;
  rolldown?: number;
  funding?: number;
  cost: number;
  /** 보유 봉 수. */
  bars: number;
  /** 진입 직전의 밴드 밖 구간 — 언제 나갔고(outFrom) 며칠이었고(outDays)
   *  얼마나 벌어졌는지(peakZ · 부호 유지). `밴드 복귀` 판에서는 진입 z 가 밴드
   *  선 언저리라 이것 없이는 4σ 까지 갔다 온 것과 살짝 넘었다 온 것이 같은
   *  줄로 보인다. `이탈 즉시` 판에서는 outDays 가 늘 1 이다. */
  outFrom: string | null;
  outDays: number | null;
  peakZ: number | null;
  /** 보유 동안의 총 변화(**bp**) — 대사표 「합계」 줄의 Δ 칸이고, 줄마다의
   *  Δ 를 세로로 더한 값과 같아야 한다. **거래 가능한** Δ 의 합이다. */
  dv: number;
  /** 보유 중 지난 롤의 수. 0 이 아니면 **「청산 − 진입 ≠ Δ」가 정상**이고,
   *  그 차이가 곧 실현하지 못한 롤 점프다 [OWNER 2026-09-02]. 화면은 그 줄에
   *  표식을 세워 읽는 사람이 어긋남을 결함으로 읽지 않게 한다. 구 백엔드는
   *  없다(undefined → 0 으로 읽는다). */
  masked?: number;
}

/** 방향 하나의 이름 — 표 칸은 `short`, 문장은 `legs`. 서버가 계열마다 짓는다
 * (`backend/app/mr.py::DIR_LEGS`) — 「롱/숏」이라고만 적으면 BSS 에서는 정확히
 * 반대로 읽힌다(스프레드 롱 = 국고 매도). */
export interface MrDirName {
  short: string;
  legs: string;
}

/** 실행할 수 있는 방향 [OWNER 2026-08-25 — "BSS에서 숏은 없는거야,, 현물대차매도는
 * 안할거거든"]. 노브가 아니라 데스크의 사실이라 화면에 스위치가 없다 — 백테스트의
 * 현금채권이 매수만 받는 것과 같은 규칙이다(`backtest/book.ts::runnable`). */
export interface MrStrategyDirs {
  /** 엔진 부호 목록 — `+1`은 값이 오르면 버는 쪽. BSS 는 `[-1]` 뿐이다. */
  allowed: number[];
  plus: MrDirName;
  minus: MrDirName;
  /** 한 방향뿐일 때의 사유 문장. 양방향이면 null. */
  why: string | null;
  /** 막혀서 못 들어간 진입 신호 — 구간 수와 일수. 조용히 빠지면 «신호가
   * 없었다»로 읽히므로 화면이 세어서 말한다. */
  blocked: { spells: number; days: number };
}

/** 표본 끝의 미청산 다리. 원본 규약대로 거래·승률·건수에는 **안** 들어가고
 * 누적에만 있다 — 그래서 화면이 이걸 승률 옆에서 말하지 않으면 열려 있는 손실
 * 포지션이 승률에서 조용히 사라진다(실측 2026-08-26: 승률 80% = 12/15 였고
 * 빠진 한 건은 표본 두 번째로 나쁜 −600만이었다). */
export interface MrStrategyOpen {
  entryT: string;
  /** 엔진 부호 — 이름은 `run.dirs` 가 진다. */
  dir: number;
  entryZ: number;
  entryV: number;
  pnl: number;
  /** 진입 이후 지난 봉 수. */
  bars: number;
  outFrom: string | null;
  outDays: number | null;
  peakZ: number | null;
}

/** 노브 하나를 프리셋 안에서 옮겼을 때의 결과 한 칸. */
export interface MrNeighborCell {
  v: number;
  totalPnl: number;
  sharpe: number | null;
  winRate: number | null;
  numTrades: number;
  /** 지금 고른 칸인가. */
  current: boolean;
}

/** 노브 하나의 프리셋 행 — 견고성은 «고른 칸» 이 아니라 «이웃과의 차이» 다. */
export interface MrNeighborRow {
  knob: 'lookback' | 'entryZ' | 'exitZ' | 'stopZ';
  label: string;
  suffix: string;
  cells: MrNeighborCell[];
}

export interface MrStrategyRun {
  id: string;
  label: string;
  /** 이 실행의 수가 **실가격 회계**인가 **엔진 근사**인가
   *  [OWNER 2026-09-03 — "캐리 롤다운 다 넣고 우리가 원래 사용하던 백테스트/
   *  시뮬레이션에서의 대사와 동일하게"].
   *
   *  `true` — BSS. 진입·청산 시점은 엔진(`mrbacktest.simulate`, PMS 원본
   *  이식이라 잠겨 있다)이 정하고, **그 구간의 돈은 실제 자산스왑을 가격해서**
   *  센다: 평가·캐리·롤다운·조달에 전략의 비용을 더한 다섯이 그날 손익이다.
   *  일별 대사표가 그 수를 **그대로** 편다(실측 차 0.00원).
   *
   *  `false` — 선물 계열. 자산스왑이 아니라 그 경로가 없다(증거금·일일정산).
   *  종전 근사(`평가 = 명목 × Δ스프레드`)라 롤다운·조달 항이 없다. 두 회계가
   *  한 화면에 있으므로 화면이 그 사실을 말한다. */
  real: boolean;
  unit: string;
  asof: string | null;
  params: MrStrategyParams;
  points: MrStrategyPoint[];
  trades: MrStrategyTrade[];
  dirs: MrStrategyDirs;
  /** 명목(₩/bp)의 액면 환산 [OWNER 2026-09-02 — "기준 노셔널이 다 나올 수
   *  있게"]. **지금 커브의 pv01 하나**로 나눈 근사다(서버 주석 — 커브가 6년
   *  내내 하나라 크기만 좌우한다). 선물은 원금이 없어(증거금·일일정산) null. */
  principal: { krw: number; pv01: number } | null;
  /** 미청산이 없으면 null. */
  open: MrStrategyOpen | null;
  neighbors: MrNeighborRow[];
  /** 캐리 — 두 다리의 중간 현금흐름 [OWNER 2026-08-27]. 끄면 `{on:false}` 이고
   *  그때의 수는 원본 PMS 산술 그대로다(`backend/app/mrcarry.py` 머리에 근거). */
  carry: { on: boolean; defn?: string | null; funding?: string };
  /** 실제로 문 비용 — 고정이면 한 숫자, 동적이면 범위와 중앙값이다. */
  cost:
    | { model: 'flat'; bp: number }
    | { model: 'dynamic'; lo: number; hi: number; mid: number };
  /* ── 진단 [OWNER 2026-08-28 — "승률이 이렇게 높을 수 있다는게 이해가 잘
   *    안간다" · "과거에 Overfitting 된거 아닌가"] ────────────────────────────
   * 의심 둘 다 화면 밖에서만 답할 수 있었다. 산술은 `backend/app/mrdiag.py`. */
  diag: {
    /** 청산 사유별 — 높은 승률의 정체가 여기서 갈린다. 순서는 고정(우선순위). */
    exits: {
      why: MrStrategyTrade['why'];
      n: number;
      wins: number;
      winRate: number;
      /** 명목으로 나눠 bp 로 되돌린 값 — 만기 간 비교가 서게. */
      avgBp: number;
      sumBp: number;
      avgBars: number;
    }[];
    /** 이긴 거래나 진 거래가 아예 없으면 null — 0 이나 ∞ 로 채우지 않는다. */
    payoff: {
      wins: number;
      losses: number;
      avgWinBp: number;
      avgLossBp: number;
      payoff: number | null;
      profitFactor: number | null;
    } | null;
    /** 청산 규칙을 **떼고** 신호일의 고정 보유 수익 — 승률이 진입의 공로인지
     *  청산 구조의 산물인지. 실행 가능한 방향만 센다. */
    forward: {
      bars: number;
      onSignal: { n: number; meanBp: number; hitRate: number; medianBp: number } | null;
      offSignal: { n: number; meanBp: number; hitRate: number; medianBp: number } | null;
    };
    /** 구간을 갈라 같은 규칙을 잰 것 — 과거적합이면 최근이 무너지고, 엣지
     *  소멸이면 크기만 단조로 줄어든다. 봉이 모자라면 빈 배열. */
    periods: {
      from: string;
      to: string;
      days: number;
      totalPnl: number;
      maxDrawdown: number;
      sharpe: number | null;
    }[];
  };
  /** 레짐 필터가 지운 진입 신호 — 구간 수와 일수. 방향 때문에 못 한 것
   *  (`dirs.blocked`)과 **따로** 센다: 방향은 데스크의 제약이고 필터는 우리가
   *  고른 것이라, 한 숫자로 합치면 선택의 대가가 제약 뒤에 숨는다. */
  gated: { spells: number; days: number };
  summary: {
    totalPnl: number;
    maxDrawdown: number;
    winRate: number | null;
    sharpe: number | null;
    numTrades: number;
    /** 미청산 다리의 MTM(₩) — 총손익에는 있고 승률에는 없다. */
    openPnl: number | null;
    /** 총손익이 0 이 되는 편도 비용(bp). 거래가 z 에만 달려 있어 닫힌형이다
     *  (`mrbacktest.breakeven_cost_bp`). 음수면 «비용 0 이어도 손실» 이다.
     *  동적 비용 판에서는 한 숫자로 안 나오므로 null 이고, 대신 아래 배수가 선다. */
    breakevenCostBp: number | null;
    /** 주어진 비용 **경로의 몇 배**까지 견디는가. 고정 비용 판에서는 null. */
    breakevenCostMult: number | null;
  };
}

/* ── BSS 테너 통합 장부 [OWNER 2026-09-01 — "BSS 테너 통합 밴드 워치를 하나
 * 만들어서 승률 및 세부사항들을 확인할 수 있게"] ─────────────────────────────
 *
 * 같은 규칙을 아홉 만기에 **동시에** 걸었을 때의 한 장부다. 노브는 낱개 창과
 * 완전히 같고(`MrStrategyParams`) 종목만 없다 — 두 창이 다른 기본값에서 열리면
 * 「낱개로는 벌고 통합으로는 잃는다」가 규칙 탓인지 기본값 탓인지 화면이
 * 구분해 주지 못한다.
 *
 * 산술은 서버(`backend/app/mrbook.py`)가 끝낸다. 계열 하나의 준비·시뮬은 낱개
 * 창과 **같은 함수**(`main._mr_leg`)라, 통합의 수는 낱개 아홉의 합과 갈릴 수
 * 없다. */

/** 다리 하나의 성적 — 만기 순으로 늘어선다. */
export interface MrBookLeg {
  id: string;
  label: string;
  tenor: string;
  totalPnl: number;
  maxDrawdown: number;
  sharpe: number | null;
  winRate: number | null;
  numTrades: number;
  /** 평균 보유 봉 수. 거래가 없으면 null. */
  avgBars: number | null;
  openPnl: number | null;
  /** 총손익에서 이 다리의 몫. 총합이 0 이하거나 이 다리가 음수면 null 이다 —
   *  120% 같은 수를 안 적는다. */
  share: number | null;
  blocked: { spells: number; days: number };
  gated: { spells: number; days: number };
  /** 이 만기의 마지막 종가일 — 만기마다 다를 수 있다(민평×IRS 교집합). */
  asof: string | null;
}

export interface MrBookPoint {
  t: string;
  /** 그날 아홉을 합친 손익(₩). */
  pnl: number;
  cum: number;
  /** 그 봉에 포지션이 서 있던 다리 수 — 걸린 명목이 이 수 × 명목이다. */
  legs: number;
}

/** 한 통에 모은 거래 — 낱개 창의 거래 줄에 «어느 만기» 셋이 붙은 모양이다. */
export interface MrBookTrade extends MrStrategyTrade {
  sid: string;
  label: string;
  tenor: string;
}

export interface MrBookOpen {
  sid: string;
  label: string;
  tenor: string;
  entryT: string;
  dir: number;
  entryZ: number;
  entryV: number;
  pnl: number;
  bars: number;
}

export interface MrBookRun {
  id: string;
  label: string;
  defn: string;
  unit: string;
  asof: string | null;
  from: string | null;
  to: string | null;
  bars: number;
  params: MrStrategyParams;
  legs: MrBookLeg[];
  points: MrBookPoint[];
  trades: MrBookTrade[];
  open: MrBookOpen[];
  dirs: MrStrategyDirs;
  carry: { on: boolean; defn?: string | null; funding?: string };
  cost:
    | { model: 'flat'; bp: number }
    | { model: 'dynamic'; lo: number; hi: number; mid: number };
  gated: { spells: number; days: number };
  /** 못 선 만기 — 조용히 빠지지 않는다(보드의 exclusions 문법). */
  excluded: { id: string; label: string; reason: string }[];
  diag: {
    exits: MrStrategyRun['diag']['exits'];
    payoff: MrStrategyRun['diag']['payoff'];
    periods: MrStrategyRun['diag']['periods'];
    /** 통합의 값어치 — 쌍상관이 낮을수록 아홉이 진짜 아홉으로 센다. */
    diversification: {
      meanPairCorr: number | null;
      /** N / (1 + (N−1)·ρ̄). 상관이 0 이면 N, 1 이면 1 이다. */
      effectiveN: number | null;
      n: number;
    };
    /** 개별 다리의 SR — 통합 SR 옆에 있어야 «묶어서 나아졌나» 가 판정된다. */
    legSharpe: {
      median: number | null;
      min: number | null;
      max: number | null;
      positive: number;
      n: number;
    };
  };
  summary: {
    totalPnl: number;
    maxDrawdown: number;
    winRate: number | null;
    sharpe: number | null;
    numTrades: number;
    /** 표본 끝에 열려 있는 다리 수. 승률에는 안 들어간다(원본 규약). */
    openLegs: number;
    openPnl: number | null;
    breakevenCostBp: number | null;
    breakevenCostMult: number | null;
  };
  /** 걸린 돈 — 동일가중 합의 대가다. 안 적으면 화면의 「명목」이 실제로 움직인
   *  돈을 최대 아홉 배 작게 말한다. */
  book: {
    maxLegs: number;
    meanLegs: number | null;
    /** 다리가 하나도 없던 날의 비율. */
    idleShare: number | null;
    peakT: string | null;
    peakNotional: number;
  };
}

/** 노브 → 쿼리. 낱개 창과 **한 곳**에서 만든다 — 두 벌이면 한쪽만 늙는다. */
function strategyQuery(p: MrStrategyParams): URLSearchParams {
  return new URLSearchParams({
    lookback: String(p.lookback),
    entryZ: String(p.entryZ),
    exitZ: String(p.exitZ),
    stopZ: String(p.stopZ),
    costBp: String(p.costBp),
    notional: String(p.notional),
    entryMode: p.entryMode,
    timeStop: String(p.timeStop),
    costModel: p.costModel,
    regime: p.regime,
    reverseExit: String(p.reverseExit),
    countOpen: String(p.countOpen),
  });
}

export function fetchMrStrategy(id: string, p: MrStrategyParams): Promise<MrStrategyRun> {
  const q = strategyQuery(p);
  q.set('id', id);
  return get<MrStrategyRun>(mrStrategyUrl(q.toString()), 'mr strategy');
}

export function fetchMrBook(p: MrStrategyParams): Promise<MrBookRun> {
  return get<MrBookRun>(mrBookUrl(strategyQuery(p).toString()), 'mr book');
}

/** 거래 하나의 **실가격 일별 대사** [OWNER 2026-09-03 — "이 방향이 정확한 대사"].
 *
 *  BSS 를 자산스왑(국고 매수 · IRS 페이)으로 세워 민평 노드를 1bp 씩 범프한
 *  **테너별 KRD** 와 그 위의 Δbp·추정을 받는다. 응답 모양은 백테스트 대사와
 *  같아서 `backtestDays` 로 그대로 `ReconStack` 에 든다.
 *
 *  **행마다 다리 둘이 실린다** [OWNER 2026-09-04]: 국고 다리는 민평 노드·Δ민평,
 *  IRS 다리는 IRS 노드·ΔIRS 다. 표의 열은 두 다리의 합집합이라 `recon.tenors` 가
 *  아니라 `reconTenors(recon)` 를 넘겨야 한다 — 민평 목록만 넘기면 IRS 전용
 *  노드(1D·4Y·6Y·8Y)의 감도가 화면에서 소리 없이 사라진다.
 *
 *  **거래를 누를 때만** 부른다 — KRD 범프가 본체보다 비싸서 서버도 라우트를
 *  갈라 뒀다(`cashbond` 의 그 근거).
 *
 *  못 서는 자리는 `available: false` 와 **왜인지**가 온다: 민평 이력은
 *  2020-01-02 부터라 MR 표본의 절반이 그 앞이고, 선물 계열은 자산스왑이
 *  아니다. 지어낸 대사를 세우지 않는다. */
export function fetchMrRecon(
  id: string, entry: string, exit: string, dir: number, notional: number,
): Promise<MrRecon> {
  const q = new URLSearchParams({
    id, entry, exit, dir: String(dir), notional: String(notional),
  });
  return get<MrRecon>(mrReconUrl(q.toString()), 'mr recon');
}

/** 실가격 대사 — 서 있거나(`available`), 왜 못 서는지(`why`)거나 둘 중 하나다. */
export type MrRecon =
  | ({ available: true; principal: { krw: number; pv01: number } } & BacktestRecon)
  | { available: false; why: string };

async function get<T>(url: string, what: string): Promise<T> {
  const r = await fetch(url);
  if (r.status === 404) throw new BacktestUnavailable();
  if (!r.ok) {
    const detail = await r.json().catch(() => null);
    throw new Error(detail?.detail ?? `${what}: HTTP ${r.status}`);
  }
  return r.json();
}

/** 룩백·밴드 폭 — 서버 허용값(mr.py WINDOWS·KS)과 같은 목록. 근거는 서버 쪽
 * 주석이 진다: 20·2σ 볼린저 기본, 60/120/252 채권 RV 관례 창, 1.5/2.5σ 문헌 변형. */
export const MR_WINDOWS = [20, 60, 120, 252] as const;
export const MR_KS = [1.5, 2.0, 2.5] as const;
export type MrParams = { window: number; k: number };

const qs = (p: MrParams) => `window=${p.window}&k=${p.k}`;

export function fetchMrBoard(p: MrParams): Promise<MrBoard> {
  return get<MrBoard>(mrBoardUrl(qs(p)), 'mr board');
}

export function fetchMrHistory(id: string, p: MrParams): Promise<MrHistory> {
  return get<MrHistory>(mrHistoryUrl(id, qs(p)), 'mr history');
}
