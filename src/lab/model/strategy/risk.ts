/* 리스크 세 줄. 한 줄에 한 사실.
 *
 * ## 셋의 성질이 다르다
 *
 *     r*          숫자가 **0** 이다. 문장으로 쓴다
 *     지평 이탈    숫자가 크다. 경로마다 다시 잰다
 *     룰 이탈      과거 분포와 견준다
 *
 * ## r* 줄에 숫자를 안 쓰는 이유 [실측 2026-08-21, 두 번]
 *
 * `r*` 를 1.5 · 2.5 로 바꿔 기저를 다시 풀면 `i_kr` · `kr3y[0]` · `kr10y[0]` ·
 * IRS 12개월이 **전부 0.0000000000bp** 만큼 달라진다. eq (35) 에서 `r*` 와
 * `−φ_π·π*` 가 가법 상수이고, 베이스라인 0 인 편차 공간에서 상수는 소거된다.
 * 근사가 아니라 구조다.
 *
 * 「±0.5%면 10년이 ±XXbp」 를 쓰려면 XX 를 지어내야 한다. 안 쓴다 — 문장이
 * 답이다. 문장의 출처는 `assumptions.json` 의 `r_star.effect_note` 이고,
 * 이 파일이 그걸 다시 쓰지 않는다.
 *
 * ## 지평 이탈 — 감쇠를 구현하고 이름을 단다 [2026-08-24 뒤집혔다]
 *
 * 예전 기저는 «q9 에 `u_{i,t}` 가 0 으로 떨어지고 준칙이 되돌린다» 였다. 그게
 * 「급단절」이고, 이 파일은 그 이름을 달고 있었다. 그런데 그건 **정한 것이
 * 아니라 안 채운 것**이었다 — 못이 없는 분기의 잔차를 아무도 안 넣어서 0
 * 이었을 뿐이다(P4 §C.6).
 *
 * 2026-08-24 (D.4) 에 엔진이 부록 C 쪽으로 갔다. 못 창의 마지막 분기 잔차가
 * AR(1) **ρ = 0.801** 로 잦아든다(`system.py::RESIDUAL_TAIL`). 데이터가 그
 * 편이다 — Newey-West 표준오차 0.0745 라 급단절(ρ=0)은 10σ 밖이다.
 *
 * **화면의 숫자가 실제로 바뀌었다.** −25bp × 8분기 경로의 9~12분기 되돌림이
 * +27.8bp → **+14.8bp** 다. 되돌림이 절반으로 준 이유는 명확하다: 완화 쪽으로
 * 벗어난 잔차가 경로가 끝나는 순간 증발하지 않고 남아서 준칙을 붙잡는다.
 *
 * 이름은 기저가 싣고 온다(`scenario_basis.json::residual_tail.treatment`).
 * 여기서 다시 정하지 않는다 — 두 벌이면 한쪽만 낡는다.
 */

import basisJson from '../artifacts/scenario_basis.json';
import assumptionsJson from '../artifacts/assumptions.json';

import type { PathSolution } from './path';
import type { TenorDecomposition } from './decompose';

/** 준칙 잔차의 표준편차, pp. `backend/output/residual_moments.json` 의
 *  `sigma_diagonal_std.policy_rule` 이다.
 *
 *  사본이라 갈릴 수 있어서 `guards/model-strategy-risk.test.ts` 가 원본을 읽어
 *  대조한다. 눈으로 옮겨 적고 잊는 자리가 이 리포에 이미 여럿 있었다. */
export const RULE_SIGMA_PP = 0.4981;

/** 그 추정이 선 표본. 화면이 그대로 인용한다. */
export const RULE_SIGMA_SAMPLE = '2000Q1–2026Q2';

/** 과거 준칙 잔차의 자기상관. 부록 C 대안의 근거 숫자다.
 *
 *  **점추정만으로는 부족하다.** 2026-08-21 (P4) 에 같은 잔차를 OLS 로 다시
 *  풀어 표준오차를 붙였다(`backend/scripts/p4_ar1.py`) — Newey-West(L=4)
 *  0.0745, OLS 0.0589. 95% 구간이 대략 [0.65, 0.95] 이고, 급단절(ρ=0)은 그
 *  밖으로 한참 나간다. 상수 제외·추세 제거 판도 0.78~0.83 안이다. */
export const RULE_RESIDUAL_AR1 = 0.801;

/** 위 자기상관 추정의 Newey-West 표준오차. 화면이 0.801 을 인용할 때 같이 든다. */
export const RULE_RESIDUAL_AR1_SE = 0.0745;

/** 기저가 실제로 구운 지평 이탈 처리. 화면에 이 이름이 뜬다.
 *
 *  **기저에서 읽는다.** 예전에는 여기 `'급단절'` 이 상수로 박혀 있었고, 그건
 *  그때의 엔진과 맞았다. D.4 가 엔진을 바꾸자 그 상수가 그 자리에서 거짓이
 *  됐다 — 화면이 「급단절」이라고 말하면서 감쇠된 숫자를 보여 주는 상태다.
 *  이름과 숫자가 같은 곳에서 나와야 그 병이 다시 안 생긴다. */
export const RESIDUAL_TREATMENT: '감쇠' | '급단절' =
  (basisJson as { residual_tail?: { treatment?: string } }).residual_tail
    ?.treatment === 'break'
    ? '급단절'
    : '감쇠';

export type RiskLine = {
  key: 'r-star' | 'horizon-exit' | 'rule-deviation';
  text: string;
  /** 「논문 미공표」 · 「논문에 없는 해석이에요」 · 논문 쪽 인용. */
  badges: string[];
  /** 툴팁이 쓰는 근거 한 문장. */
  source: string;
};

/** `assumptions.json` 의 r* 항. 문장을 여기서 다시 쓰지 않는다. */
function rStarItem() {
  const items = (assumptionsJson as { items: { key: string; effect: string; effect_note: string; source: string }[] })
    .items;
  const it = items.find((i) => i.key === 'r_star');
  if (!it) throw new Error('assumptions.json 에 r_star 가 없어요');
  return it;
}

/**
 * 9~12분기에 준칙이 되돌리는 크기, bp.
 *
 * `i_kr[q12] − i_kr[q8]` — 경로가 끝난 자리에서 네 분기 뒤까지 준칙이 얼마나
 * 끌고 갔나. 지어낸 숫자가 아니라 조합된 경로에서 그 자리를 읽은 것이다.
 */
export function horizonExitBp(sol: PathSolution): number {
  return (sol.iKr[11] - sol.iKr[7]) * 100;
}

/** 이 경로가 준칙에서 얼마나 떨어져 있나, σ 단위.
 *
 *  8분기 잔차의 **RMS** 를 쓴다. `max` 는 q1 이 독점해서(첫 분기의 놀람이 제일
 *  크다) 「한 번 놀래키는 경로」와 「두 해 내내 준칙과 싸우는 경로」를 구별
 *  못 한다. `max` 는 툴팁으로 같이 보인다. */
export function ruleDeviationSigma(sol: PathSolution): { rms: number; max: number } {
  const u = sol.ruleResidual;
  const rms = Math.sqrt(u.reduce((a, v) => a + v * v, 0) / u.length);
  const max = u.reduce((a, v) => Math.max(a, Math.abs(v)), 0);
  return { rms: rms / RULE_SIGMA_PP, max: max / RULE_SIGMA_PP };
}

const fix1 = (v: number) => (Math.abs(v) < 0.05 ? '0.0' : v.toFixed(1));

export function riskLines(sol: PathSolution, headline: TenorDecomposition | null): RiskLine[] {
  const rs = rStarItem();
  const exit = horizonExitBp(sol);
  const sigma = ruleDeviationSigma(sol);

  const share =
    headline && headline.ruleShare !== null
      ? ` 12개월 ${headline.tenor.toUpperCase()} 숫자의 ${Math.round(Math.abs(headline.ruleShare) * 100)}% 가 그 되돌림이에요.`
      : '';

  return [
    {
      key: 'r-star',
      text: rs.effect_note,
      badges: ['논문 각주 24', '논문 미공표'],
      source: rs.source,
    },
    {
      key: 'horizon-exit',
      text:
        Math.abs(exit) < 0.05
          ? '경로가 끝나도 룰이 되돌릴 것이 없어요 — 이 경로는 베이스라인과 같은 자리예요.'
          : `경로가 끝나면 룰이 다시 움직여요 — 9~12분기에 ${fix1(Math.abs(exit))}bp 되돌려요.${share}`,
      badges: ['논문에 없는 해석이에요', `잔차 처리: ${RESIDUAL_TREATMENT}`],
      source: `부록 B 각주 31 은 조건 변수마다 조정할 충격을 손으로 고른다고 해요. 정책금리에 조건을 걸면 eq (35) 의 준칙 잔차를 미는 셈인데, 논문은 그 예를 안 들어요. 경로가 끝나도 그 잔차는 0 으로 안 떨어지고 AR(1) ${RULE_RESIDUAL_AR1}(표준오차 ${RULE_RESIDUAL_AR1_SE}) 로 잦아들어요 — 부록 C 쪽이고, 과거 잔차를 다시 재서 고른 값이라 논문이 박은 값은 아니에요.`,
    },
    {
      key: 'rule-deviation',
      text:
        sigma.rms < 0.005
          ? '이 경로는 준칙이 하려는 것과 같아요 — 룰 이탈이 0 이에요.'
          : `이 경로는 과거 룰 이탈의 ${sigma.rms.toFixed(1)}σ예요.`,
      badges: [RULE_SIGMA_SAMPLE],
      source: `준칙 잔차 u_i 의 표준편차 ${(RULE_SIGMA_PP * 100).toFixed(1)}bp 로 나눈 값이에요(8분기 RMS · 가장 큰 분기는 ${sigma.max.toFixed(1)}σ). 출처는 residual_moments.json 의 policy_rule 이에요.`,
    },
  ];
}
