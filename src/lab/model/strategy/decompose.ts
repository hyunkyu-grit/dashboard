/* 논거 — 테너별 bp 가 **무엇으로 이루어져 있나**.
 *
 * ## 다섯 항이고 둘은 0 이다. 0 을 지우지 않는다
 *
 *     경로 그대로 (EH)   오너가 못 박은 여덟 분기의 평균
 *     준칙 되돌림        q9 부터 준칙이 되돌리는 몫 (+ 24분기 밖 0.85 꼬리)
 *     CD 전달            정책 → CD 의 감쇠·시차 (cd_layer)
 *     기간프리미엄        **0** — IRS 다리까지 안 온다 (V1_NO_TERM_PREMIUM_IN_IRS)
 *     스왑 스프레드       **0** — OU 위성은 편차에서 상쇄된다
 *
 * 뒤의 둘을 표에서 지우면 «이 모형에는 기간프리미엄이 있다» 로 읽힌다. 있는데
 * 이 다리에 안 오는 것과, 애초에 없는 것은 다른 이야기다.
 *
 * ## 왜 CD 전달이 잔차인가 — 그리고 그게 왜 정직한가
 *
 * 앞의 두 항은 **닫힌 형태**다(경로의 산술 평균). 합계는 기저가 들고 있는
 * 엔진의 숫자다. 셋째 항은 그 둘의 차이인데, 그 차이가 정확히 `cd_layer` 가
 * 하는 일이다 — 정책 변화가 CD 에 즉시·전부 반영되지 않는 것(사전 반영 0.113 ·
 * 발표일 점프 0.558 · τ 78.8영업일).
 *
 * 그래서 합은 **정의상** 정확하고(테스트 1e-6), EH 항은 **엔진과 무관하게**
 * 다시 계산해 대조할 수 있다(테스트: 오너가 찍은 점들의 평균과 같다).
 * 두 성질을 동시에 세우는 배치는 이것뿐이다.
 *
 * 크기가 작지 않다 — 실측(진단 §C.1b) 계단 경로 2Y 에서 −7.1bp 다.
 *
 * ## 왜 «3분의 1» 이 리스크 줄로 가나
 *
 * 지속 −25×8 의 12개월 3Y 는 +11.68bp 인데 그중 +3.38bp(29%)가 준칙 되돌림이다.
 * 5Y 는 34%. **오너의 뷰가 만든 것이 아니라 테일러 준칙이 만든 몫**이라,
 * 그 비중을 화면이 말해야 한다.
 */

import {
  BASIS,
  ehTerm,
  headOnly,
  padPolicy,
  PINNED_Q,
  tailOnly,
  TENOR_YEARS,
  TENORS,
  type PathSolution,
  type Tenor,
} from './path';

/** 분해 항 하나. `value` 는 bp. */
export type Term = {
  key: 'eh' | 'rule' | 'cd' | 'tp' | 'spread';
  label: string;
  value: number;
  /** 왜 이 값인지 — 툴팁이 그대로 쓴다. 방정식·플래그·논문 쪽을 댄다. */
  note: string;
  /** 구조적으로 0 인 항인가. 화면이 «비어 있음» 과 구별해야 한다. */
  structuralZero: boolean;
};

export type TenorDecomposition = {
  tenor: Tenor;
  /** 기저가 주는 값, bp. 다섯 항의 합이 이것과 같다. */
  totalBp: number;
  terms: Term[];
  /** 준칙 되돌림이 합계에서 차지하는 몫. 합계가 0 에 가까우면 `null`. */
  ruleShare: number | null;
  /** 기대가설 평균 구간의 길이(분기). 이 면의 «구조적 내용» 축이다. */
  spanQ: number;
};

/** 합계가 이보다 작으면 비중을 안 낸다 — 0 에 가까운 수로 나누면 «189%» 같은
 *  숫자가 나오고 그건 정보가 아니라 잡음이다. */
const SHARE_FLOOR_BP = 0.5;

const TP_NOTE =
  '기간프리미엄은 IRS 다리까지 안 와요 — 국고 10년에만 있어요 (V1_NO_TERM_PREMIUM_IN_IRS).';
const SPREAD_NOTE =
  '스왑 스프레드는 편차에서 상쇄돼요 — 같은 OU 위성이 오늘과 그날 양쪽에 들어가거든요.';
const EH_NOTE =
  '찍은 점들을 이 테너 구간에서 평균한 값이에요. 엔진을 안 거치고 다시 계산해도 같은 숫자예요 (eq 36/37).';
const RULE_NOTE =
  '경로가 끝난 9분기부터 준칙이 되돌리는 몫이에요. 24분기 밖은 준칙 평활 0.85 로 잦아들어요 (eq 35).';
const CD_NOTE =
  '정책금리가 CD 로 옮겨 가는 데 걸리는 시차와 감쇠예요 — 사전 반영 0.113 · 발표일 0.558 · τ 78.8영업일.';

/** 오너가 찍은 점만으로 EH 항을 다시 만든다 — **기저를 안 본다.**
 *
 *  D.4 의 독립 검증축이다. 기저가 못 박힌 여덟 분기에서 `i_kr` 을 찍은 점과
 *  똑같이 내놓으므로(하삼각 정확해), 이 함수의 값이 `terms.eh` 와 같아야 한다. */
export function ehFromDots(dots: readonly number[], tenor: Tenor, h: number): number {
  const path = new Array<number>(PINNED_Q).fill(0).map((_, q) => (dots[q] ?? 0) / 100);
  const padded = padPolicy(path.concat(new Array<number>(BASIS.horizon_q - PINNED_Q).fill(0)));
  return ehTerm(padded, TENOR_YEARS[tenor], h) * 100;
}

/** 테너 하나의 분해. `h` 는 분기(정수) — 이 면은 분기 사이를 보간하지 않는다. */
export function decomposeTenor(sol: PathSolution, tenor: Tenor, h: number): TenorDecomposition {
  const years = TENOR_YEARS[tenor];
  const totalBp = sol.irs[tenor][h] * 100;
  const eh = ehTerm(headOnly(sol.iKr), years, h) * 100;
  const rule = ehTerm(tailOnly(sol.iKr), years, h) * 100;
  const cd = totalBp - eh - rule;

  const terms: Term[] = [
    { key: 'eh', label: '경로 그대로', value: eh, note: EH_NOTE, structuralZero: false },
    { key: 'rule', label: '준칙 되돌림', value: rule, note: RULE_NOTE, structuralZero: false },
    { key: 'cd', label: 'CD 전달', value: cd, note: CD_NOTE, structuralZero: false },
    { key: 'tp', label: '기간프리미엄', value: 0, note: TP_NOTE, structuralZero: true },
    { key: 'spread', label: '스왑 스프레드', value: 0, note: SPREAD_NOTE, structuralZero: true },
  ];

  return {
    tenor,
    totalBp,
    terms,
    ruleShare: Math.abs(totalBp) < SHARE_FLOOR_BP ? null : rule / totalBp,
    spanQ: years * 4,
  };
}

/** 다섯 테너 전부. 화면의 「논거」 표가 이걸 그대로 그린다. */
export function decompose(sol: PathSolution, h: number): TenorDecomposition[] {
  return TENORS.map((t) => decomposeTenor(sol, t, h));
}

/** 합이 맞나. 테스트가 쓰고, 화면은 안 쓴다 — 화면이 검산하면 검산이 화면의
 *  성질이 되고, 틀렸을 때 조용히 넘어간다. */
export function sumError(d: TenorDecomposition): number {
  return Math.abs(d.terms.reduce((a, t) => a + t.value, 0) - d.totalBp);
}
