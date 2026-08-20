/* 성분의 합이 표의 Δ 와 같다.
 *
 * 「모형」 탭이 «무엇이 그 차이를 만드나» 라며 손잡이별 기여분을 적는다. 그 분해가
 * 정확한 근거는 **모형이 선형**이라는 것뿐이다 — 기저가 자기 안에 `linearity_gate`
 * 를 싣고 다니는 이유가 그것이다.
 *
 * 선형이면 합이 맞아야 한다. 안 맞으면 화면이 기여분을 «대략» 보여주면서 정확한
 * 것처럼 적고 있는 것이고, 그건 트레이더가 검사할 수 없는 종류의 거짓말이다.
 *
 * 여기서 다시 세는 이유는 화면이 `combine` 의 계수를 **다시 곱하기** 때문이다.
 * `combine` 이 안에서 이미 더한 값(`diffs.irs`)과, 화면이 밖에서 다시 곱해 더한
 * 값이 같은지는 따로 확인해야 하는 사실이다.
 */

import { describe, expect, it } from 'vitest';

import { H_12M } from '../src/lab/scenario/assemble';
import { BASIS, IRS_TENORS, ZERO_KNOBS, combine, type IrsTenor, type Knobs } from '../src/lab/scenario/combine';

/** 화면의 `DRIVERS` 와 같은 묶음. 여기가 진짜 목록이고 화면이 그것을 따른다. */
const DRIVERS: Record<string, string[]> = {
  policy: Array.from({ length: 8 }, (_, i) => `policy_q${i + 1}`),
  cpi: ['cpi'],
  gap: ['gap'],
  exports: ['exports'],
  oil: ['oil'],
};

function contribBp(coefs: Record<string, number>, bases: string[], tenor: IrsTenor): number {
  let pp = 0;
  for (const name of bases) {
    const c = coefs[name];
    if (!c) continue;
    pp += c * BASIS.bases[name].irs[tenor][H_12M];
  }
  return pp * 100;
}

/** 검증 영역(`domain`) 안에 있는 손잡이 조합들. 밖은 선형 외삽이라 별개 문제다. */
const CASES: { name: string; knobs: Knobs }[] = [
  { name: '전부 0 (Base)', knobs: ZERO_KNOBS },
  {
    name: '금통위만 — 앞 네 분기 인상',
    knobs: { ...ZERO_KNOBS, policyBp: [25, 50, 50, 50, 50, 50, 50, 50] },
  },
  {
    name: '금통위만 — 인하',
    knobs: { ...ZERO_KNOBS, policyBp: [0, -25, -25, -50, -50, -50, -50, -50] },
  },
  { name: '물가만', knobs: { ...ZERO_KNOBS, cpiPp: 0.6 } },
  { name: '갭만', knobs: { ...ZERO_KNOBS, gapPp: -0.4 } },
  { name: '수출만', knobs: { ...ZERO_KNOBS, exportsPct: -7 } },
  { name: '유가만', knobs: { ...ZERO_KNOBS, oilPct: 15 } },
  {
    name: '다섯 개 동시',
    knobs: {
      ...ZERO_KNOBS,
      policyBp: [25, 25, 50, 50, 25, 0, 0, -25],
      cpiPp: 0.35,
      gapPp: -0.25,
      exportsPct: -3,
      oilPct: -8,
    },
  },
];

describe('모형 탭의 성분 분해', () => {
  it.each(CASES)('$name — 손잡이별 기여분의 합이 Δ 와 같다', ({ knobs }) => {
    const d = combine(BASIS, knobs);
    for (const tenor of IRS_TENORS) {
      const deltaBp = d.irs[tenor][H_12M] * 100;
      const parts = Object.values(DRIVERS).map((b) => contribBp(d.coefs, b, tenor));
      const sum = parts.reduce((a, b) => a + b, 0);
      // 부동소수 누적뿐이라 여유가 클 이유가 없다. 0.001bp 는 화면의 소수 한 자리
      // 보다 세 자리 작다.
      expect(Math.abs(sum - deltaBp), `${tenor}: 합 ${sum} vs Δ ${deltaBp}`).toBeLessThan(1e-3);
    }
  });

  it('손잡이 목록이 기저를 하나도 안 빠뜨린다', () => {
    /* 미국 셋은 일부러 빠져 있다(`US_BASES_USABLE = false`). 그 셋 말고 다른 것이
       빠지면 합이 조용히 어긋나므로, 목록 자체를 고정한다. */
    const covered = new Set(Object.values(DRIVERS).flat());
    const missing = Object.keys(BASIS.bases).filter((k) => !covered.has(k));
    expect(missing.sort()).toEqual(['us_2q', 'us_4q', 'us_6q']);
  });

  it('전부 0 이면 모든 기여분이 정확히 0 이다', () => {
    const d = combine(BASIS, ZERO_KNOBS);
    for (const tenor of IRS_TENORS) {
      for (const bases of Object.values(DRIVERS)) {
        expect(contribBp(d.coefs, bases, tenor)).toBe(0);
      }
    }
  });

  it('거시 손잡이 하나만 켜면 나머지 **거시** 기여분은 0 이다', () => {
    /* 화면이 «·» 로 비워 두는 칸의 근거다. 금통위 줄은 여기서 제외한다 — 아래
       검사가 그 줄이 0 이 아닌 것이 **옳다**는 것을 따로 고정한다. */
    const d = combine(BASIS, { ...ZERO_KNOBS, oilPct: 12 });
    for (const tenor of IRS_TENORS) {
      expect(contribBp(d.coefs, DRIVERS.cpi, tenor)).toBe(0);
      expect(contribBp(d.coefs, DRIVERS.gap, tenor)).toBe(0);
      expect(contribBp(d.coefs, DRIVERS.exports, tenor)).toBe(0);
      expect(Math.abs(contribBp(d.coefs, DRIVERS.oil, tenor))).toBeGreaterThan(0);
    }
  });

  it('금통위 줄은 다른 손잡이를 **막는 몫**을 뒤집어쓴다', () => {
    /* 화면의 라벨이 «금통위» 가 아니라 «금통위 경로 고정» 인 이유다.
     *
     * `combine` 은 앞 8분기 `i_kr` 이 내가 놓은 경로와 정확히 같아지도록 정책
     * 계수를 푼다. 그래서 유가만 켜도 준칙이 움직이려 하는 만큼을 정책 기저가
     * 되민다 — 그 값이 0 이 아닌 것이 정상이고, 0 이 되는 날은 핀이 풀린 것이다.
     *
     * 이걸 «버그» 로 읽고 금통위 줄을 0 으로 만들면 합이 Δ 와 안 맞게 된다.
     */
    const d = combine(BASIS, { ...ZERO_KNOBS, oilPct: 12 });
    expect(Math.abs(contribBp(d.coefs, DRIVERS.policy, '3y'))).toBeGreaterThan(1);

    /* 그리고 그 상쇄가 실제로 결과를 눌러 준다: 물가를 0.6pp 올려도 경로를
       동결해 두면 3년이 거의 안 움직인다(실측 +0.8bp). «모형이 물가를 무시한다»
       가 아니라 «내가 금통위를 묶어 뒀다» 는 뜻이고, 화면이 그렇게 적는다. */
    const infl = combine(BASIS, { ...ZERO_KNOBS, cpiPp: 0.6 });
    const direct = contribBp(infl.coefs, DRIVERS.cpi, '3y');
    const pinned = contribBp(infl.coefs, DRIVERS.policy, '3y');
    expect(direct).toBeLessThan(-10);
    expect(pinned).toBeGreaterThan(10);
    expect(Math.abs(direct + pinned)).toBeLessThan(5);
  });

  it('정책 경로는 8분기 뒤 준칙에 되돌려지므로 12개월 커브를 내린다', () => {
    /* 기저의 `irs` 는 레벨이 아니라 «h분기 뒤부터의 CD 평균 − 오늘부터의 CD 평균»
       이고, 핀은 8분기까지만 간다(그 뒤는 `PHI_I_TAIL = 0.85` 로 감쇠). 그래서
       12개월 뒤부터 재는 3년 평균은 오늘부터 재는 것보다 **낮다** — 인상 경로를
       넣어도 그렇다(실측: +100bp 계단이 −34.7bp).
     *
     * 다음 사람이 이걸 «부호 버그» 로 보고 뒤집지 않도록 못 박아 둔다. 뒤집으면
     * 시장 캐리와의 뺄셈이 통째로 반대가 된다. */
    for (const path of [
      [25, 0, 0, 0, 0, 0, 0, 0],
      [25, 25, 25, 25, 25, 25, 25, 25],
      [25, 50, 75, 100, 100, 100, 100, 100],
    ]) {
      const d = combine(BASIS, { ...ZERO_KNOBS, policyBp: path });
      expect(contribBp(d.coefs, DRIVERS.policy, '3y'), `경로 ${path.join('·')}`).toBeLessThan(0);
    }
    /* 인하 경로는 반대 부호다 — 감쇠 때문에 전부 음수가 되는 게 아니라는 증거. */
    const cut = combine(BASIS, { ...ZERO_KNOBS, policyBp: [-25, -50, -75, -100, -100, -100, -100, -100] });
    expect(contribBp(cut.coefs, DRIVERS.policy, '3y')).toBeGreaterThan(0);
  });
});
