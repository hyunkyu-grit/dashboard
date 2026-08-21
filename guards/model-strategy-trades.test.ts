/* 트레이드 후보 — 테너 벡터에서 **순수 함수로** 다시 나온다.
 *
 * ## 하중
 *
 * 「후보는 산술이다」가 이 파일의 명제다. 숨은 모수가 하나라도 있으면 그 순간
 * 이 화면은 «모형이 시킨 것» 이 아니라 «우리가 고른 것» 을 내미는 물건이 된다.
 * 그래서 후보를 손으로 다시 계산해 대조한다 — 구현을 다시 부르지 않고.
 *
 * 그리고 **10년이 후보에서 빠졌는지**를 본다. 실측: IRS 커브가 10Y 에서 끝나
 * 1Y×10Y 포워드가 커브 밖이고, 백엔드가 외삽을 거절하며 `null` 을 보낸다.
 * 빈칸이 0 으로 굴러떨어지면 없는 트레이드가 화면에 선다.
 */

import { describe, expect, it } from 'vitest';

import { solvePath } from '@/lab/model/strategy/path';
import {
  H_12M,
  HEADLINE_TENOR,
  LAST_H,
  bestCurve,
  bestFly,
  bestOutright,
  candidates,
  gapVector,
  headlineGap,
  type StrategyAnchors,
} from '@/lab/model/strategy/trades';

/** 라이브 백엔드가 실제로 보낸 모양 그대로(2026-08-19 실측). 10Y 의 `null` 이
 *  이 픽스처의 핵심이다 — 0 으로 바꾸면 이 가드가 아무것도 안 잰다. */
const ANCHORS: StrategyAnchors = {
  asof: '2026-08-19',
  cd: 2.93,
  base: 2.75,
  irs: {
    '1y': { spot: 3.4375, carry12mBp: 55.1691, live: true },
    '2y': { spot: 3.7075, carry12mBp: 33.2887, live: true },
    '3y': { spot: 3.83, carry12mBp: 24.0084, live: false },
    '5y': { spot: 3.9625, carry12mBp: 16.7191, live: false },
    '10y': { spot: 4.105, carry12mBp: null, live: false },
  },
};

const HOLD = solvePath([0, 0, 0, 0, 0, 0, 0, 0]);
const CUT = solvePath([-25, -25, -25, -25, -25, -25, -25, -25]);

describe('모형 − 시장 벡터', () => {
  const v = gapVector(CUT, ANCHORS, H_12M);

  it('다섯 테너가 다 나오고 넷만 트레이드 가능이다', () => {
    expect(v.gaps).toHaveLength(5);
    expect(v.tradable.map((g) => g.tenor)).toEqual(['1y', '2y', '3y', '5y']);
  });

  it('10년이 왜 빠졌는지 말한다 — 빈칸이 0 이 아니다', () => {
    expect(v.excluded.map((x) => x.tenor)).toEqual(['10y']);
    expect(v.excluded[0].why).toContain('커브 밖');
    expect(v.gaps.find((g) => g.tenor === '10y')!.vsMarketBp).toBeNull();
  });

  it('vsMarket = 모형 Δ − 캐리 다', () => {
    for (const g of v.tradable) {
      expect(g.vsMarketBp!, g.tenor).toBeCloseTo(g.deltaBp - g.carry12mBp!, 10);
    }
  });

  it('12개월이 아닌 자리에서는 캐리를 비례로 잘라 쓰지 않는다', () => {
    const q1 = gapVector(CUT, ANCHORS, 1);
    expect(q1.tradable).toHaveLength(0);
    expect(q1.excluded).toHaveLength(5);
    expect(q1.excluded[0].why).toContain('12개월');
  });

  it('동결이면 모형 Δ 가 0 이고 트레이드는 캐리에서만 나온다', () => {
    const h = gapVector(HOLD, ANCHORS, H_12M);
    for (const g of h.tradable) {
      expect(Math.abs(g.deltaBp), g.tenor).toBeLessThan(1e-12);
      expect(g.vsMarketBp!, g.tenor).toBeCloseTo(-g.carry12mBp!, 10);
    }
    /* 시장이 인상을 프라이싱하고 있어서 «동결» 이 그 자체로 리시브다. */
    expect(bestOutright(h)!.label).toContain('리시브');
  });
});

describe('후보는 벡터의 뺄셈이다 — 손으로 다시 계산해 맞춘다', () => {
  const v = gapVector(CUT, ANCHORS, H_12M);
  const by = Object.fromEntries(v.tradable.map((g) => [g.tenor, g.vsMarketBp!]));

  it('아웃라이트 = |vsMarket| 최대', () => {
    const want = Object.entries(by).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
    const c = bestOutright(v)!;
    expect(c.legs).toEqual([want[0]]);
    expect(c.bp).toBeCloseTo(want[1], 10);
    expect(c.label).toContain(want[1] > 0 ? '페이' : '리시브');
  });

  it('커브 = 긴쪽 − 짧은쪽 중 |최대|', () => {
    const ts = ['1y', '2y', '3y', '5y'];
    let best = { legs: ['', ''], bp: 0 };
    for (let i = 0; i < ts.length; i += 1) {
      for (let j = i + 1; j < ts.length; j += 1) {
        const bp = by[ts[j]] - by[ts[i]];
        if (Math.abs(bp) > Math.abs(best.bp)) best = { legs: [ts[i], ts[j]], bp };
      }
    }
    const c = bestCurve(v)!;
    expect(c.legs).toEqual(best.legs);
    expect(c.bp).toBeCloseTo(best.bp, 10);
    expect(c.label).toContain(best.bp > 0 ? '스티프너' : '플래트너');
  });

  it('플라이 = 2×벨리 − 양날개 중 |최대|', () => {
    const ts = ['1y', '2y', '3y', '5y'];
    let best = { legs: ['', '', ''], bp: 0 };
    for (let i = 0; i < ts.length; i += 1) {
      for (let j = i + 1; j < ts.length; j += 1) {
        for (let k = j + 1; k < ts.length; k += 1) {
          const bp = 2 * by[ts[j]] - by[ts[i]] - by[ts[k]];
          if (Math.abs(bp) > Math.abs(best.bp)) best = { legs: [ts[i], ts[j], ts[k]], bp };
        }
      }
    }
    const c = bestFly(v)!;
    expect(c.legs).toEqual(best.legs);
    expect(c.bp).toBeCloseTo(best.bp, 10);
  });

  it('후보 셋 어디에도 10년 다리가 없다', () => {
    for (const c of candidates(v)) expect(c.legs, c.label).not.toContain('10y');
  });

  it('끝점이 호가가 아닌 다리를 배지로 말한다', () => {
    const c = candidates(v).find((x) => x.legs.includes('3y') || x.legs.includes('5y'));
    if (c) expect(c.interpolatedLeg).toBe(true);
  });

  it('수렴 지평이 1..12 안이다 — h=0 은 구성상 0 이라 후보가 못 된다', () => {
    for (const c of candidates(v)) {
      expect(c.convergenceQ, c.label).toBeGreaterThanOrEqual(1);
      expect(c.convergenceQ, c.label).toBeLessThanOrEqual(LAST_H);
    }
  });

  /* 「수렴 지평 12분기」 는 «12분기에 수렴한다» 가 아니라 «기저가 거기서
     끝난다» 이다. 실측: 한 분기 −25bp 인하의 1Y 는 h=12 까지 단조로 벌어진다.
     그 둘을 같은 문구로 찍으면 화면이 없는 수렴을 주장한다. */
  it('최댓값이 지평 끝에 있으면 «수렴» 이라고 안 부른다', () => {
    const one = gapVector(solvePath([-25, 0, 0, 0, 0, 0, 0, 0]), ANCHORS, H_12M);
    const g = one.gaps.find((x) => x.tenor === '1y')!;
    expect(g.convergenceQ).toBe(LAST_H);
    expect(g.convergenceAtEdge).toBe(true);
  });
});

describe('헤드라인 — 3년 고정 [OWNER 2026-08-21]', () => {
  /* 자동 선택이면 동결 경로에서 캐리가 제일 큰 1Y 가 매번 뽑힌다. 그러면
     헤드라인이 «오늘 뭐가 제일 싼가» 가 아니라 «어디 캐리가 제일 센가» 가
     되고, 매일 같은 칸을 읽는 화면이 매일 다른 것을 말한다. */
  it('경로가 무엇이든 3년을 말한다', () => {
    for (const sol of [HOLD, CUT, solvePath([25, 25, 50, 50, 50, 50, 50, 50])]) {
      expect(headlineGap(gapVector(sol, ANCHORS, H_12M))!.tenor).toBe(HEADLINE_TENOR);
    }
  });

  it('가장 큰 칸이 다른 테너여도 갈아타지 않는다', () => {
    const v = gapVector(HOLD, ANCHORS, H_12M);
    const biggest = [...v.tradable].sort(
      (a, b) => Math.abs(b.vsMarketBp!) - Math.abs(a.vsMarketBp!),
    )[0];
    expect(biggest.tenor, '동결이면 캐리 최대인 1Y 가 최대여야 이 가드가 뜻이 있다').toBe('1y');
    expect(headlineGap(v)!.tenor).toBe('3y');
  });

  it('커브가 없으면 헤드라인도 없다 — 0 을 만들지 않는다', () => {
    const v = gapVector(CUT, ANCHORS, 2);
    expect(headlineGap(v)).toBeNull();
  });
});
