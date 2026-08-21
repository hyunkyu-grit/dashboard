/* 정책 경로 → 편차 경로. 이 면의 **유일한 입력**이 여기로 들어온다.
 *
 * ## 왜 `lab/scenario/combine.ts` 를 안 부르나
 *
 * 그 파일은 세션 3 의 은퇴 대상이다(소유권 지도). 은퇴하는 모듈에 이 면을
 * 매달면 은퇴하는 날 이 면이 같이 죽는다. 그리고 이 면은 그 파일이 다루는
 * 손잡이 여섯 중 **하나만** 쓴다 — 물가·갭·수출·Fed·유가는 이 화면에 없다.
 *
 * 그래서 정책 축만 옮겨 왔다. 옮긴 것은 두 함수뿐이고(`forwardSub` ·
 * 기저 선형결합), 둘 다 **구운 상수의 선형결합**이라 새 모형이 아니다.
 * 파이썬 원본(`bigfoot/scenario_basis/replay_ref.py`)이 낸 패리티 벡터로
 * 잠근다 — `guards/model-strategy-basis.test.ts`.
 *
 * ## 8개 점은 스텝이 아니라 레벨이다
 *
 * `dots[q]` 는 «그 분기에 얼마 움직인다» 가 아니라 **«그 분기의 기준금리가
 * 베이스라인 대비 몇 bp 에 있다»** 이다. `[-25, -25, ...]` 는 **한 번** 인하하고
 * 그대로 두는 것이지 여덟 번의 인하가 아니다.
 *
 * ## 0 은 «아무 일도 없음» 이 아니라 «동결» 이다 — 그런데 편차로는 0 이다
 *
 * 편차 공간의 베이스라인이 곧 «지금 자리 그대로» 라, 여덟 점을 전부 0 으로 두면
 * 모형의 응답도 **정확히 0** 이다(실측 2026-08-21). 그게 결핍이 아니다 — 그
 * 경로의 트레이드는 **시장 캐리에서 전부 나온다**. 화면이 그 사실을 말해야지
 * «모형이 리시브를 본다» 로 옮기면 안 된다.
 */

import basisJson from '../artifacts/scenario_basis.json';

/** 오너가 찍는 점의 개수. 기저가 정한다 — 여기서 늘릴 수 없다. */
export const PINNED_Q = 8;

/** 기저가 담은 IRS 테너. **다섯뿐이다.** 열셋은 데이터의 이야기이고 모형의
 *  이야기가 아니다(진단 §C.5). 나머지 여덟을 보간해 세우면 그건 우리가 만든
 *  숫자다. */
export const TENORS = ['1y', '2y', '3y', '5y', '10y'] as const;
export type Tenor = (typeof TENORS)[number];

/** 테너의 연수. 기대가설 평균 구간의 길이다. */
export const TENOR_YEARS: Record<Tenor, number> = {
  '1y': 1,
  '2y': 2,
  '3y': 3,
  '5y': 5,
  '10y': 10,
};

/** 준칙 평활 — 기저 지평(24분기) 밖의 정책 편차가 잦아드는 속도.
 *  `assembler.PHI_I_TAIL` 과 같은 값이어야 한다(엔진이 기저를 그렇게 구웠다). */
export const PHI_I_TAIL = 0.85;

/** 기저 지평 밖까지 늘린 정책 경로의 길이. `_irs_diff_path` 와 같다. */
export const PAD_Q = 44;

type BasisEntry = {
  i_kr: number[];
  kr3y: number[];
  kr10y: number[];
  irs: Record<Tenor, number[]>;
};

export type Basis = {
  as_of: string;
  horizon_q: number;
  irs_h: number;
  policy_step_bp: number;
  M_policy: number[][];
  bases: Record<string, BasisEntry>;
  conditioning_residuals: Record<string, { policy_rule?: number[] }>;
  domain: { policy_bp_per_q: [number, number] };
};

export const BASIS = basisJson as unknown as Basis;

/** 이 면이 부르는 기저 여덟. 정책 축 말고는 안 쓴다. */
const POLICY_BASES = Array.from({ length: PINNED_Q }, (_, q) => `policy_q${q + 1}`);

/**
 * 하삼각 전진대입. `M c = b`.
 *
 * 정책 기저가 하삼각인 것은 구성이다 — 기저 q 는 q 분기에만 +25bp 를 얹으므로
 * 앞선 분기의 `i_kr` 에 영향이 없다. 그래서 임의의 8분기 경로가 **정확한**
 * 선형결합으로 풀린다(최소자승도 역행렬도 아니다).
 */
export function forwardSub(M: number[][], b: number[]): number[] {
  const n = b.length;
  const c = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let s = b[i];
    for (let j = 0; j < i; j += 1) s -= M[i][j] * c[j];
    c[i] = s / M[i][i];
  }
  return c;
}

export type PathSolution = {
  /** 오너가 찍은 점, bp. */
  dots: number[];
  /** 기저 계수. 화면에 안 쓰지만 대조에 쓴다. */
  coefs: Record<string, number>;
  /** 24분기 정책금리 편차, pp. `iKr[0..7]` 은 `dots/100` 과 **같아야** 한다. */
  iKr: number[];
  /** 국고 3년 — 기대가설 12분기 평균(`KR3Y_EH_ONLY`), pp. `t=0` 이 0 이 아니다. */
  kr3y: number[];
  /** 국고 10년 — 기간프리미엄이 **여기에만** 있다(eq 36/37 · β_sync), pp. */
  kr10y: number[];
  /** `irs[τ][h]` = h 분기 뒤의 **오늘 대비** 변화, pp. `h=0` 은 구성상 0. */
  irs: Record<Tenor, number[]>;
  /** 준칙 잔차 `u_i`, 8분기, pp. 이 경로를 만들려면 준칙을 얼마나 밀어야 하나. */
  ruleResidual: number[];
};

/** 여덟 점 → 편차 경로. 이 면의 계산은 전부 여기서 시작한다. */
export function solvePath(dots: number[]): PathSolution {
  if (dots.length !== PINNED_Q) {
    throw new Error(`정책 경로는 ${PINNED_Q}개 점이에요 — ${dots.length}개를 받았어요`);
  }
  const c = forwardSub(
    BASIS.M_policy,
    dots.map((v) => v / 100),
  );
  const coefs: Record<string, number> = {};
  POLICY_BASES.forEach((name, q) => {
    coefs[name] = c[q];
  });

  const T = BASIS.horizon_q;
  const H = BASIS.irs_h;
  const iKr = new Array<number>(T).fill(0);
  const kr3y = new Array<number>(T).fill(0);
  const kr10y = new Array<number>(T).fill(0);
  const irs = {} as Record<Tenor, number[]>;
  for (const t of TENORS) irs[t] = new Array<number>(H).fill(0);
  const ruleResidual = new Array<number>(PINNED_Q).fill(0);

  POLICY_BASES.forEach((name, q) => {
    const w = c[q];
    if (w === 0) return;
    const e = BASIS.bases[name];
    for (let t = 0; t < T; t += 1) {
      iKr[t] += w * e.i_kr[t];
      kr3y[t] += w * e.kr3y[t];
      kr10y[t] += w * e.kr10y[t];
    }
    for (const ten of TENORS) {
      for (let h = 0; h < H; h += 1) irs[ten][h] += w * e.irs[ten][h];
    }
    /* 준칙 잔차도 선형이다 — 기저마다 «그 분기를 못 박으려면 준칙을 얼마나
       밀어야 하나» 가 이미 실려 있다(`conditioning_residuals`). 새 산출물이
       필요 없다. */
    const u = BASIS.conditioning_residuals[name]?.policy_rule ?? [];
    for (let q2 = 0; q2 < PINNED_Q; q2 += 1) ruleResidual[q2] += w * (u[q2] ?? 0);
  });

  return { dots: [...dots], coefs, iKr, kr3y, kr10y, irs, ruleResidual };
}

/**
 * 24분기 편차를 44분기로 늘린다 — 그 뒤는 준칙 평활로 잦아든다.
 *
 * 엔진이 기저를 구울 때 한 것과 **같은 일**이다(`_irs_diff_path`). 여기서
 * 다르게 늘리면 아래의 분해가 기저와 안 맞는다.
 */
export function padPolicy(iKr: readonly number[]): number[] {
  const pad = new Array<number>(PAD_Q).fill(0);
  for (let t = 0; t < Math.min(iKr.length, PAD_Q); t += 1) pad[t] = iKr[t];
  for (let j = iKr.length; j < PAD_Q; j += 1) pad[j] = pad[j - 1] * PHI_I_TAIL;
  return pad;
}

/**
 * 기대가설 항 — **닫힌 형태**. 경로를 테너 구간에서 평균한 것뿐이다.
 *
 * `[h, h + 4τ)` 분기의 평균에서 `[0, 4τ)` 분기의 평균을 뺀다. 경로가 끝나면
 * 마지막 값을 그대로 이어 붙인다(엔진의 `_cd_avg` 규약).
 *
 * **엔진을 안 부른다.** 이것이 D.4 의 독립 검증 축이다 — 이 값이 오너가 찍은
 * 점들의 산술 평균과 같아야 하고, 같은지를 테스트가 본다.
 */
export function ehTerm(padded: readonly number[], tenorYears: number, h: number): number {
  const span = tenorYears * 4;
  const mean = (from: number) => {
    let acc = 0;
    for (let i = 0; i < span; i += 1) {
      const j = from + i;
      acc += j < padded.length ? padded[j] : padded[padded.length - 1];
    }
    return acc / span;
  };
  return mean(h) - mean(0);
}

/** 경로의 앞머리만 — 오너가 못 박은 여덟 분기. 뒤는 0 이라 꼬리도 0 이다. */
export function headOnly(iKr: readonly number[]): number[] {
  const pad = padPolicy(iKr.map((v, t) => (t < PINNED_Q ? v : 0)));
  return pad;
}

/** 경로의 꼬리만 — 준칙이 되돌리는 q9 이후 + 24분기 밖의 평활 꼬리. */
export function tailOnly(iKr: readonly number[]): number[] {
  return padPolicy(iKr.map((v, t) => (t < PINNED_Q ? 0 : v)));
}

/** 손잡이가 기저의 검증 영역 밖인가. 숫자는 기저가 들고 있다 — 여기서 다시
 *  적지 않는다. */
export function outOfDomain(dots: readonly number[]): boolean {
  const [lo, hi] = BASIS.domain.policy_bp_per_q;
  return dots.some((v) => v < lo || v > hi);
}
