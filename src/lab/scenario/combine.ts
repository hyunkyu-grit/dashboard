/* 시나리오 재조합 — BIGFOOT 선형 기저에서 커브 응답을 뽑는다.
 *
 * 원본은 `project_bigfoot/bigfoot/scenario_basis/replay_ref.py` (140줄)이고,
 * 그 모듈이 스스로를 REFERENCE 라고 부른다: 랩 페이지의 JS 가 같은 순수 함수를
 * 구현하고 `tests/test_lab.py::test_js_parity_with_python_reference` 가 node 로
 * 그 JS 를 실행해 파이썬과 1e-9 로 대조한다. 이 파일은 그 JS 자리를 이어받는
 * 세 번째 구현이므로, 같은 대조를 `guards/scenario-parity.test.ts` 가 진다.
 *
 * ── 이 파일은 순수하다 ──────────────────────────────────────────────────────
 * fetch 도 DOM 도 없다(`sim/scenario.ts` 와 같은 규율). 입력은 구운 기저 계수와
 * 손잡이 값뿐이고, 출력은 **편차 경로**뿐이다.
 *
 * ── 관측 커브를 여기서 더하지 않는다 [계약, 2026-08-20] ─────────────────────
 * 원본 `replay_frames()` 는 `observed["irs"][t] + dv` 로 절대 레벨을 만든다.
 * 이 포트는 **일부러 그 덧셈을 빼고** bp 편차까지만 낸다.
 *
 *   `guards/row-vm-source.test.ts` 가 방금(2026-08-20) "프런트가 시장 데이터에
 *   산술을 하지 않는다" 를 심었다. 지금 그 가드의 범위는 행 어댑터 셋이지만,
 *   명제 자체는 리포 전체를 향한다. 기저 계수는 **구운 상수**라 시장 데이터가
 *   아니지만 관측 커브는 시장 데이터다. 그래서 경계를 여기에 둔다 —
 *   계수 조합은 프런트, `관측 + Δ` 는 백엔드(`/api/cdlayer/...`).
 *
 * 그래서 이 모듈이 못 하는 것이 하나 있다: 리플레이의 절대 커브를 못 그린다.
 * 그건 결핍이 아니라 배치다.
 *
 * ── 두 숫자의 기준이 다르다 (실측 2026-08-20, 화면에서 화해시킬 것) ─────────
 * 같은 시나리오에서 부호가 갈릴 수 있다:
 *
 *     irs[τ][h]    **오늘 대비** 변화.   h=0 이 0 인 것이 정의다.
 *     kr3y[t]      **베이스라인 대비** 편차. t=0 도 0 이 아니다.
 *
 * 지속 −25bp 핀에서 `irs.3y[4]` = +13.2bp 인데 `kr3y[4]` = −4.8bp 다. 둘 다
 * 옳고 뜻이 다르다. 표(IRS)와 스파크라인(KTB)을 한 화면에 두면서 이 차이를
 * 말하지 않으면 화면이 거짓말을 한다. 화해는 UI 의 몫이고, 이 파일은 원본이
 * 주는 두 양을 그대로 낸다 — 여기서 한쪽을 몰래 바꾸면 패리티가 깨진다.
 *
 * ── 8개 점은 스텝이 아니라 레벨이다 ─────────────────────────────────────────
 * `policyBp[q]` 는 "그 분기에 얼마 움직인다" 가 아니라 **"그 분기의 기준금리가
 * 베이스라인 대비 몇 bp 에 있다"** 이다. `[-25, 0, ...]` 은 인하 후 되돌림이지
 * 두 번의 인하가 아니다. 원본 주석의 표현 그대로: 8개 점이 곧 금통위 결정이고,
 * i_kr 의 첫 8분기가 그 경로에 고정되며, q9 부터 준칙이 복귀한다.
 */

import raw from './basis.json';

/* ── 상수 (원본과 같은 값) ───────────────────────────────────────────────── */

/** 리플레이 13프레임. D+0 부터 D+360 까지 30일 간격. */
export const DAY_GRID: readonly number[] = [
  0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360,
];

/** 한 분기의 일수. 365.25 / 4 — 원본이 쓰는 값 그대로. */
export const Q_DAYS = 91.3125;

export const IRS_TENORS = ['1y', '2y', '3y', '5y', '10y'] as const;
export const KTB_TENORS = ['3y', '10y'] as const;

export type IrsTenor = (typeof IRS_TENORS)[number];
export type KtbTenor = (typeof KTB_TENORS)[number];

/** 기저가 담은 분기 시계열 변수. `irs` 는 모양이 달라 따로 둔다. */
const QUARTERLY_VARS = [
  'i_kr',
  'kr3y',
  'kr10y',
  'y_gap',
  'cpi_yoy',
  's',
  'hpi',
  'debt',
] as const;

export type QuarterlyVar = (typeof QUARTERLY_VARS)[number];

/* ── 타입 ────────────────────────────────────────────────────────────────── */

/** 기저 하나 — 단위 충격 하나에 대한 전 변수 응답. */
type BasisEntry = Record<QuarterlyVar, number[]> & {
  irs: Record<IrsTenor, number[]>;
};

export type Basis = {
  as_of: string;
  horizon_q: number;
  irs_h: number;
  policy_step_bp: number;
  basis_scales: Record<string, number>;
  /** 정책 기저의 하삼각 지도. `M[t][q]` = 기저 q 의 t 분기 i_kr. */
  M_policy: number[][];
  bases: Record<string, BasisEntry>;
  /** 손잡이별 검증 영역. 이 밖은 선형 외삽이고 화면이 그렇게 말해야 한다. */
  domain: {
    policy_bp_per_q: [number, number];
    cpi_pp: [number, number];
    gap_pp: [number, number];
    exports_pct: [number, number];
    us_bp: [number, number];
    us_dur_q: number[];
    oil_pct: [number, number];
    note: string;
  };
  caveats: string[];
};

/* ⚠ **미국 기저 셋(`us_2q`·`us_4q`·`us_6q`)은 못 쓴다** — 24분기에 걸쳐 **발산한다**
 * [실측 2026-08-20, 재검증 같은 날].
 *
 * ── 처음 적었던 진단은 틀렸다 ────────────────────────────────────────────────
 * 첫 판은 "400배 어긋난다" 고 적었다. 그건 **지평을 잘못 맞춘 비교**였다 — 엔진의
 * 12개월 숫자를 기저의 24분기(6년) 끝값과 나란히 놓았다. 지평을 맞추면 오히려 잘
 * 맞는다. 같은 충격(미국 +100bp × 4분기)에서:
 *
 *                       엔진(`output/hfl_conditional.json`)      기저 `us_4q`
 *     GDP 갭 (q4)            −0.5093pp                            −0.5111pp
 *     기준금리 12개월        −1.3bp                               −7.8bp
 *
 * 갭은 소수 셋째 자리까지 같다. 진짜 결함은 그 뒤에 있다.
 *
 * ── 진짜 결함: 감쇠하지 않는다 ───────────────────────────────────────────────
 *     us_4q  y_gap   q6 −0.68  →  q12 +1.79  →  q24 +5.73  (부호가 뒤집히고 커진다)
 *     us_4q  i_kr                              q24 +537bp
 *     us_2q  i_kr    q24 +76bp        us_6q  i_kr  q24 −374bp   ← 지속만 바꿨는데 부호가 뒤집힌다
 *
 * 국내 기저는 정상적으로 잦아든다 — `policy_q1` 은 q24 에 −4.4bp, `oil` −2.5bp,
 * `cpi` −18.4bp. 발산하는 것은 미국 셋뿐이다. 충격반응이 지평 끝까지 단조 발산하고
 * 지속 분기에 따라 부호가 뒤집히는 것은 경제 반응이 아니라 조립 오류다.
 *
 * 참고로 BIGFOOT 자신도 이 조건부 실행에 경고를 달아 두었다 —
 * `hfl_conditional.json` 의 `sanity_gate.gate_3x_5x_raw = "ABOVE"`.
 *
 * 그래서 화면에서 Fed 손잡이를 내렸다. 되살리려면 `scenario_basis.build` 의 미국
 * 기저 조립을 고쳐 다시 굽고, **q24 까지 잦아드는지**부터 대조해야 한다.
 */
export const US_BASES_USABLE = false;

/** 미국 충격의 지속 분기. 기저가 셋만 갖고 있어 다른 값은 못 쓴다. */
export type UsDurationQ = 2 | 4 | 6;

export type Knobs = {
  /** 8분기 정책 **레벨** 편차, bp. 길이 8 고정. */
  policyBp: number[];
  cpiPp: number;
  gapPp: number;
  exportsPct: number;
  usBp: number;
  usDurQ: UsDurationQ;
  oilPct: number;
};

export const ZERO_KNOBS: Knobs = {
  policyBp: [0, 0, 0, 0, 0, 0, 0, 0],
  cpiPp: 0,
  gapPp: 0,
  exportsPct: 0,
  usBp: 0,
  usDurQ: 4,
  oilPct: 0,
};

export type Diffs = Record<QuarterlyVar, number[]> & {
  irs: Record<IrsTenor, number[]>;
  /** 어느 기저가 얼마나 섞였나. 화면에 안 쓰지만 대조에 쓴다. */
  coefs: Record<string, number>;
};

/** 리플레이 한 프레임 — **편차만**. 절대 레벨은 백엔드가 붙인다(위 §계약). */
export type FrameDiff = {
  day: number;
  /** `irs_3y` · `ktb_10y` 같은 키 → bp. */
  dyBp: Record<string, number>;
};

/** 구운 기저. `resolveJsonModule` 로 들어오므로 모양을 여기서 한 번 좁힌다. */
export const BASIS = raw as unknown as Basis;

/* ── 순수 함수 ───────────────────────────────────────────────────────────── */

/**
 * 하삼각 전진대입. `M c = b` 를 푼다.
 *
 * 정책 기저가 하삼각인 것은 우연이 아니라 구성이다 — 기저 q 는 q 분기에만
 * +25bp 를 얹으므로 그보다 앞선 분기의 i_kr 에 영향이 없다. 그래서 임의의
 * 8분기 경로가 **정확한** 선형 결합으로 풀린다(역행렬도 최소자승도 아니다).
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

/**
 * 손잡이 → 편차 경로.
 *
 * 정책 계수가 겨냥하는 것은 경로 그 자체가 아니라 **경로에서 다른 성분들의
 * 내생 정책을 뺀 것**이다. CPI 를 올리면 준칙이 알아서 금리를 올리는데, 8개
 * 점은 "그래도 나는 여기에 둔다" 는 선언이므로 그 내생분을 상쇄해야 한다.
 * 그래서 `target8 − other8` 을 풀고, 0 을 놓는 것도 **의도된 동결**이 된다.
 */
export function combine(basis: Basis, knobs: Knobs): Diffs {
  const b = basis.bases;
  const sc = basis.basis_scales;

  const coefs: Record<string, number> = {
    cpi: knobs.cpiPp / sc.cpi,
    gap: knobs.gapPp / sc.gap,
    exports: knobs.exportsPct / sc.exports,
    [`us_${knobs.usDurQ}q`]: knobs.usBp / sc.us_bp,
    oil: knobs.oilPct / sc.oil_pct,
  };

  /* 정책을 뺀 나머지가 첫 8분기 i_kr 에 남기는 것. */
  const other8: number[] = [];
  for (let t = 0; t < 8; t += 1) {
    let acc = 0;
    for (const [name, c] of Object.entries(coefs)) {
      if (c !== 0) acc += c * b[name].i_kr[t];
    }
    other8.push(acc);
  }

  const target8 = knobs.policyBp.map((v) => v / 100);
  const cPol = forwardSub(
    basis.M_policy,
    target8.map((v, t) => v - other8[t]),
  );
  for (let q = 0; q < 8; q += 1) coefs[`policy_q${q + 1}`] = cPol[q];

  const T = basis.horizon_q;
  const H = basis.irs_h;

  const out = {} as Diffs;
  for (const v of QUARTERLY_VARS) out[v] = new Array<number>(T).fill(0);

  const irs = {} as Record<IrsTenor, number[]>;
  for (const t of IRS_TENORS) irs[t] = new Array<number>(H).fill(0);

  for (const [name, c] of Object.entries(coefs)) {
    if (c === 0) continue;
    const entry = b[name];
    for (const v of QUARTERLY_VARS) {
      const src = entry[v];
      const dst = out[v];
      for (let t = 0; t < T; t += 1) dst[t] += c * src[t];
    }
    for (const ten of IRS_TENORS) {
      const src = entry.irs[ten];
      const dst = irs[ten];
      for (let h = 0; h < H; h += 1) dst[h] += c * src[h];
    }
  }

  out.irs = irs;
  out.coefs = coefs;
  return out;
}

/**
 * 분기 경로를 일 단위로 읽는다 — 단조 조각선형.
 *
 * 노드는 `day = q * Q_DAYS` 이고 D+0 은 0 으로 못 박혀 있다(경로는 오늘부터
 * 시작하므로 오늘의 편차는 0). 이건 **표시용 표본화**이고, 원본이 그렇게
 * 선언해 두었다 — 프레임 사이의 트위닝은 화면 몫이지 숫자가 아니다.
 */
export function interpAtDay(qpath: number[], day: number): number {
  if (day <= 0) return 0;
  const q = day / Q_DAYS;
  const k = Math.floor(q);
  const lo = k >= 1 ? qpath[k - 1] : 0;
  if (k >= qpath.length) return qpath[qpath.length - 1];
  return lo + (q - k) * (qpath[k] - lo);
}

/**
 * 13프레임의 테너별 bp 편차.
 *
 * ── h=0 을 버리는 것 ────────────────────────────────────────────────────────
 * `irs[τ]` 는 h 로 색인되고 h=0 은 **구성상 0**(오늘 대비 오늘)이다. 반면
 * 보간 노드는 `day = Q_DAYS` 부터 시작한다. 그래서 h=0 을 첫 노드로 쓰면 경로
 * 전체가 한 분기씩 밀린다. 원본이 `[1:]` 로 잘라내고 그 사실을 회귀 테스트로
 * 잠가 두었다(`tests/test_lab.py`). 여기서도 같은 자리를 자른다.
 *
 * KTB 는 분기 경로(`kr3y`·`kr10y`)를 그대로 쓴다 — 그쪽은 h 색인이 아니라
 * 시간 색인이라 자를 것이 없다.
 */
export function frameDiffs(basis: Basis, knobs: Knobs): FrameDiff[] {
  const diffs = combine(basis, knobs);
  const ktbSource: Record<KtbTenor, number[]> = {
    '3y': diffs.kr3y,
    '10y': diffs.kr10y,
  };

  return DAY_GRID.map((day) => {
    const dyBp: Record<string, number> = {};
    for (const t of IRS_TENORS) {
      dyBp[`irs_${t}`] = interpAtDay(diffs.irs[t].slice(1), day) * 100;
    }
    for (const t of KTB_TENORS) {
      dyBp[`ktb_${t}`] = interpAtDay(ktbSource[t], day) * 100;
    }
    return { day, dyBp };
  });
}

/**
 * 기저 하나의 **단위 응답**을 그대로 읽는다 — 「모형」 탭이 그리는 것.
 *
 * `combine()` 과 다른 점이 하나뿐인데 그게 결정적이다: **정책 핀이 없다.**
 * `combine` 은 8분기를 내가 놓은 자리에 고정하려고 정책 계수를 푸는데, 충격반응을
 * 그릴 때 그러면 «Fed 가 100bp 올리는데 한은은 2년간 꿈쩍도 안 한다» 를 푸는 셈이
 * 된다. 그 답은 모형의 응답이 아니라 기괴한 시나리오다(실측 2026-08-20: 기준금리
 * +520bp, GDP 갭 +5.6pp).
 *
 * 기저에 저장된 것은 애초에 «그 충격 하나에 준칙이 반응한 결과» 이므로, 읽기만
 * 하면 된다. 정책 기저(`policy_q1`)도 마찬가지다 — 그 분기에만 +25bp 를 얹고
 * 나머지는 준칙이 정한 것이 이미 들어 있다.
 */
export function impulse(basis: Basis, name: string): Diffs {
  const b = basis.bases[name];
  if (!b) throw new Error(`시나리오 기저: ${name} 이 없어요`);
  const out = {} as Diffs;
  for (const v of QUARTERLY_VARS) out[v] = [...b[v]];
  const irs = {} as Record<IrsTenor, number[]>;
  for (const t of IRS_TENORS) irs[t] = [...b.irs[t]];
  out.irs = irs;
  out.coefs = { [name]: 1 };
  return out;
}

/**
 * 손잡이가 커널 검증 영역을 벗어났나.
 *
 * 값은 기저가 자기 안에 들고 있다(`domain`) — 여기서 숫자를 다시 적지 않는다.
 * 기저를 다시 구우면 영역도 같이 갱신되고, 화면은 물어보기만 한다.
 */
export function outOfDomain(basis: Basis, knobs: Knobs): boolean {
  const d = basis.domain;
  const outside = (v: number, [lo, hi]: [number, number]) => v < lo || v > hi;
  if (knobs.policyBp.some((v) => outside(v, d.policy_bp_per_q))) return true;
  if (outside(knobs.cpiPp, d.cpi_pp)) return true;
  if (outside(knobs.gapPp, d.gap_pp)) return true;
  if (outside(knobs.exportsPct, d.exports_pct)) return true;
  if (outside(knobs.usBp, d.us_bp)) return true;
  if (outside(knobs.oilPct, d.oil_pct)) return true;
  if (!d.us_dur_q.includes(knobs.usDurQ)) return true;
  /* 커널이 맞춰진 곳은 100bp × 4분기까지다. 영역 상한(150bp)과 다르고, 원본
   * 랩이 그 둘을 구별해 배지를 띄운다 — 같은 판정을 승계한다. */
  return knobs.usBp > 100 || (knobs.usBp > 0 && knobs.usDurQ === 6);
}
