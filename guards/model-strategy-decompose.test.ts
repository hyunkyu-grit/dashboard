/* 논거 — 다섯 항이 헤드라인과 **정확히** 합쳐지고, EH 항은 엔진 없이 다시 나온다.
 *
 * ## 두 성질을 동시에 세우는 것이 이 가드의 하중
 *
 *   ① 합이 정확하다        — 다섯 항의 합 = 기저가 주는 값, 1e-6, 전 테너·전 경로
 *   ② EH 항이 독립이다     — 오너가 찍은 점들의 산술 평균과 같다
 *
 * ①만 있으면 성분을 아무렇게나 갈라 놓고 잔차로 메워도 통과한다. ②가 그 문을
 * 닫는다 — 「경로 그대로」 항은 기저를 안 보고 계산해도 같은 숫자여야 한다.
 *
 * ## 0 인 항이 표에 남아 있는지도 본다
 *
 * 기간프리미엄과 스왑 스프레드는 **구조적으로 0** 이다(IRS 다리에 안 오고,
 * OU 는 편차에서 상쇄된다). 열을 지우면 「이 모형에 기간프리미엄이 있다」로
 * 읽히므로, 지워지지 않았는지를 테스트가 본다.
 */

import { describe, expect, it } from 'vitest';

import { decompose, decomposeTenor, ehFromDots, sumError } from '@/lab/model/strategy/decompose';
import { PINNED_Q, TENORS, solvePath } from '@/lab/model/strategy/path';

/** 과제가 못 박은 허용치. */
const SUM_TOL = 1e-6;

const PATHS: [string, number[]][] = [
  ['동결', [0, 0, 0, 0, 0, 0, 0, 0]],
  ['지속 −25', [-25, -25, -25, -25, -25, -25, -25, -25]],
  ['지속 −50', [-50, -50, -50, -50, -50, -50, -50, -50]],
  ['계단', [-25, -50, -50, -50, -50, -50, -50, -50]],
  ['지그재그', [-25, 0, -25, 0, 0, 0, 0, 0]],
  ['인상', [25, 25, 50, 50, 50, 50, 50, 50]],
  ['한 분기만', [-25, 0, 0, 0, 0, 0, 0, 0]],
  ['꼬리만', [0, 0, 0, 0, 0, 0, 0, -50]],
];

const HORIZONS = [1, 2, 4, 8, 12];

describe.each(PATHS)('«%s»', (name, dots) => {
  const sol = solvePath(dots);

  it.each(HORIZONS)('h=%i · 다섯 항의 합이 헤드라인과 같다 (1e-6)', (h) => {
    const off = decompose(sol, h)
      .map((d) => ({ t: d.tenor, e: sumError(d) }))
      .filter((x) => x.e > SUM_TOL)
      .map((x) => `${x.t}: Δ${x.e.toExponential(2)}`);
    expect(off, `${name} h=${h}`).toEqual([]);
  });

  it.each(HORIZONS)('h=%i · EH 항이 찍은 점의 산술 평균과 같다', (h) => {
    const off = TENORS.map((t) => {
      const d = decomposeTenor(sol, t, h);
      const eh = d.terms.find((x) => x.key === 'eh')!.value;
      const closed = ehFromDots(dots, t, h);
      return { t, e: Math.abs(eh - closed) };
    })
      .filter((x) => x.e > 1e-9)
      .map((x) => `${x.t}: Δ${x.e.toExponential(2)}`);
    expect(off, `${name} h=${h}`).toEqual([]);
  });
});

describe('0 인 항은 지워지지 않는다', () => {
  const sol = solvePath([-25, -25, -25, -25, -25, -25, -25, -25]);

  it('다섯 항이 다 서 있다', () => {
    for (const d of decompose(sol, 4)) {
      expect(d.terms.map((t) => t.key), d.tenor).toEqual(['eh', 'rule', 'cd', 'tp', 'spread']);
    }
  });

  it('기간프리미엄과 스왑 스프레드는 0 이고 «구조적 0» 이라고 표시된다', () => {
    for (const d of decompose(sol, 4)) {
      for (const key of ['tp', 'spread'] as const) {
        const t = d.terms.find((x) => x.key === key)!;
        expect(t.value, `${d.tenor} ${key}`).toBe(0);
        expect(t.structuralZero, `${d.tenor} ${key}`).toBe(true);
      }
    }
  });

  it('0 인 항이 왜 0 인지를 말한다 — 안 잰 것과 구별돼야 한다', () => {
    const d = decomposeTenor(sol, '10y', 4);
    expect(d.terms.find((t) => t.key === 'tp')!.note).toContain('V1_NO_TERM_PREMIUM_IN_IRS');
    expect(d.terms.find((t) => t.key === 'spread')!.note).toContain('상쇄');
  });
});

describe('동결 경로는 통째로 0 이다', () => {
  it('모형이 할 말이 없는 경로라는 사실이 숫자로 남는다', () => {
    const sol = solvePath(Array<number>(PINNED_Q).fill(0));
    for (const d of decompose(sol, 4)) {
      expect(Math.abs(d.totalBp), d.tenor).toBeLessThan(1e-12);
      expect(d.ruleShare, d.tenor).toBeNull();
    }
  });
});

describe('준칙 몫', () => {
  /* 실측(진단 §C.1b): 지속 −25×8 의 12개월 3Y 는 +11.68bp 이고 그중 +3.85bp,
     33% 가 준칙 되돌림이다. 이 숫자가 리스크 줄의 근거라 값으로 핀을 박는다. */
  it('지속 −25×8 · 12개월 3Y 의 준칙 몫이 실측과 같다', () => {
    const d = decomposeTenor(solvePath(Array<number>(8).fill(-25)), '3y', 4);
    expect(d.totalBp).toBeCloseTo(11.676, 2);
    expect(d.terms.find((t) => t.key === 'eh')!.value).toBeCloseTo(8.333, 2);
    expect(d.terms.find((t) => t.key === 'rule')!.value).toBeCloseTo(3.854, 2);
    expect(d.terms.find((t) => t.key === 'cd')!.value).toBeCloseTo(-0.511, 2);
    expect(d.ruleShare!).toBeCloseTo(0.33, 2);
  });

  it('10년은 지평 이탈에 거의 안 흔들린다 — 앞뒤로 같은 꼬리가 들어가 상쇄된다', () => {
    const d = decomposeTenor(solvePath(Array<number>(8).fill(-25)), '10y', 4);
    expect(Math.abs(d.ruleShare!)).toBeLessThan(0.05);
  });

  it('합계가 0 에 가까우면 비중을 안 낸다 — 189% 같은 숫자는 정보가 아니다', () => {
    const d = decomposeTenor(solvePath(Array<number>(8).fill(-25)), '1y', 4);
    expect(d.ruleShare).toBeNull();
  });
});

describe('CD 전달이 잔차라는 것이 숨겨지지 않는다', () => {
  /* 실측(진단 §C.1b): 계단 경로 2Y 에서 −7.1bp. 작지 않다 — 「평이한 EH」를
     그대로 화면에 쓰면 그만큼 틀린다. */
  it('계단 경로에서 CD 전달이 bp 단위로 존재한다', () => {
    const sol = solvePath([-25, -50, -75, -100, -100, -100, -100, -100]);
    const cd = decomposeTenor(sol, '2y', 4).terms.find((t) => t.key === 'cd')!.value;
    expect(Math.abs(cd)).toBeGreaterThan(1);
  });
});
