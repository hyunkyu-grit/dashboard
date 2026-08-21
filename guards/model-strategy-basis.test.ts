/* 전략 면의 계산 코어 — 파이썬 기준 구현과 같은 값을 낸다.
 *
 * ## 이 가드의 하중
 *
 * `src/lab/model/strategy/path.ts` 는 `bigfoot/scenario_basis/replay_ref.py` 의
 * **정책 축만** 옮긴 것이다. 그림자 엔진이 아니라 구운 상수의 선형결합이라는
 * 것이 그 주장인데, 주장은 대조로만 선다.
 *
 * 기준값은 파이썬이 직접 뱉은 `scenario-parity.vectors.json` 이다 —
 * `python -m bigfoot.scenario_basis.parity_vectors <경로>` 로 다시 뽑는다.
 * **손으로 고치지 않는다.**
 *
 * ## 세션 3 에게 — 이 벡터 파일을 지우지 마세요
 *
 * 파일 이름이 `scenario-*` 라 시나리오 레인 은퇴에 딸려 갈 수 있는데, 그러면
 * 전략 면의 유일한 대조축이 사라진다. 은퇴시키려면 파일을 옮기고 이 가드의
 * 경로를 같이 고쳐 주세요. **없으면 이 테스트는 조용히 통과하지 않고 선다** —
 * 「검사할 게 없었다」가 「깨끗하다」로 읽히는 자리를 하나 더 만들지 않는다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASIS,
  PINNED_Q,
  TENORS,
  ehTerm,
  forwardSub,
  headOnly,
  outOfDomain,
  padPolicy,
  solvePath,
} from '@/lab/model/strategy/path';

const TOL = 1e-9;

const VECTOR_PATH = path.join(import.meta.dirname, 'scenario-parity.vectors.json');

type Vectors = {
  basisAsOf: string;
  cases: Record<
    string,
    {
      knobs: { policyBp: number[]; cpiPp: number; gapPp: number; exportsPct: number; usBp: number; oilPct: number };
      iKr: number[];
      kr3y: number[];
      kr10y: number[];
      irs: Record<string, number[]>;
      coefs: Record<string, number>;
    }
  >;
};

it('파이썬 기준 벡터 파일이 제자리에 있다', () => {
  expect(
    fs.existsSync(VECTOR_PATH),
    'scenario-parity.vectors.json 이 없어요 — 옮겼다면 이 가드의 경로도 같이 고쳐 주세요',
  ).toBe(true);
});

const vectors = JSON.parse(fs.readFileSync(VECTOR_PATH, 'utf8')) as Vectors;

/** 이 면이 다루는 것은 **정책 축뿐**이다. 다른 손잡이가 켜진 케이스는 이 코어의
 *  대조 대상이 아니다 — 대상이 아닌 것을 대조하면 실패가 정보를 안 준다. */
const POLICY_ONLY = Object.entries(vectors.cases).filter(
  ([, c]) =>
    c.knobs.cpiPp === 0 &&
    c.knobs.gapPp === 0 &&
    c.knobs.exportsPct === 0 &&
    c.knobs.usBp === 0 &&
    c.knobs.oilPct === 0,
);

function expectClose(got: readonly number[], want: readonly number[], what: string) {
  expect(got, `${what}: 길이`).toHaveLength(want.length);
  const off = got
    .map((v, i) => ({ i, d: Math.abs(v - want[i]) }))
    .filter((x) => x.d > TOL)
    .map((x) => `[${x.i}] ${got[x.i]} ≠ ${want[x.i]} (Δ${x.d.toExponential(2)})`);
  expect(off, `${what}: 어긋난 자리`).toEqual([]);
}

describe('같은 기저를 보고 있다', () => {
  it('벡터를 뽑은 기저와 같은 기저다', () => {
    expect(BASIS.as_of).toBe(vectors.basisAsOf);
  });

  it('정책 축 케이스가 하나 이상 있다 — 없으면 이 가드는 아무것도 안 잰다', () => {
    expect(POLICY_ONLY.length).toBeGreaterThan(0);
  });

  it('M_policy 가 하삼각이고 대각이 0 이 아니다', () => {
    const M = BASIS.M_policy;
    expect(M).toHaveLength(PINNED_Q);
    const upper = M.flatMap((row, i) => row.map((v, j) => (j > i && Math.abs(v) > TOL ? `M[${i}][${j}]` : '')))
      .filter(Boolean);
    expect(upper, '상삼각에 값이 있다').toEqual([]);
    expect(M.map((row, i) => Math.abs(row[i]) < TOL).filter(Boolean), '대각이 0 이면 나눗셈이 터진다').toEqual([]);
  });
});

describe.each(POLICY_ONLY)('정책 경로 «%s»', (name, c) => {
  const sol = solvePath(c.knobs.policyBp);

  it('기저 계수가 같다', () => {
    for (let q = 1; q <= PINNED_Q; q += 1) {
      const key = `policy_q${q}`;
      expect(Math.abs(sol.coefs[key] - c.coefs[key]), `${name} ${key}`).toBeLessThan(TOL);
    }
  });

  it('i_kr · kr3y · kr10y 24분기가 같다', () => {
    expectClose(sol.iKr, c.iKr, `${name} i_kr`);
    expectClose(sol.kr3y, c.kr3y, `${name} kr3y`);
    expectClose(sol.kr10y, c.kr10y, `${name} kr10y`);
  });

  it('IRS 13프레임 × 다섯 테너가 같다', () => {
    for (const t of TENORS) expectClose(sol.irs[t], c.irs[t], `${name} irs ${t}`);
  });

  /* 이 성질이 EH 항의 닫힌 형태를 성립시킨다 — 못 박은 여덟 분기에서 모형의
     정책금리가 오너가 찍은 점과 **글자 그대로** 같아야, 「경로 그대로」 항을
     엔진 없이 다시 계산할 수 있다. */
  it('앞 여덟 분기의 i_kr 이 찍은 점 그대로다', () => {
    for (let q = 0; q < PINNED_Q; q += 1) {
      expect(Math.abs(sol.iKr[q] - c.knobs.policyBp[q] / 100), `${name} q${q + 1}`).toBeLessThan(1e-12);
    }
  });
});

describe('준칙 잔차', () => {
  it('경로가 0 이면 잔차도 0 이다', () => {
    const sol = solvePath(Array<number>(PINNED_Q).fill(0));
    expect(sol.ruleResidual.every((v) => Math.abs(v) < TOL)).toBe(true);
  });

  /* 선형이라 두 배 경로의 잔차는 두 배여야 한다. 이 성질이 깨지면 계수 조합이
     아니라 다른 무엇이 끼어든 것이다. */
  it('경로를 두 배로 하면 잔차도 두 배다', () => {
    const a = solvePath([-25, -25, -25, -25, -25, -25, -25, -25]);
    const b = solvePath([-50, -50, -50, -50, -50, -50, -50, -50]);
    a.ruleResidual.forEach((v, q) => {
      expect(Math.abs(b.ruleResidual[q] - 2 * v), `q${q + 1}`).toBeLessThan(1e-10);
    });
  });

  it('첫 분기 잔차가 첫 점과 같은 부호이고 크기가 비슷하다', () => {
    const sol = solvePath([-25, 0, 0, 0, 0, 0, 0, 0]);
    expect(sol.ruleResidual[0]).toBeLessThan(0);
    expect(Math.abs(sol.ruleResidual[0])).toBeGreaterThan(0.2);
    expect(Math.abs(sol.ruleResidual[0])).toBeLessThan(0.3);
  });
});

describe('꼬리와 EH 산술', () => {
  it('24분기 밖은 준칙 평활 0.85 로 잦아든다', () => {
    const pad = padPolicy(Array.from({ length: 24 }, () => 1));
    expect(pad).toHaveLength(44);
    expect(pad[24]).toBeCloseTo(0.85, 12);
    expect(pad[25]).toBeCloseTo(0.85 * 0.85, 12);
  });

  it('경로 머리만 남기면 꼬리도 0 이다', () => {
    const sol = solvePath([-25, -25, -25, -25, -25, -25, -25, -25]);
    const head = headOnly(sol.iKr);
    expect(head.slice(PINNED_Q).every((v) => v === 0)).toBe(true);
  });

  it('h=0 의 EH 항은 구성상 0 이다', () => {
    const sol = solvePath([-25, 0, 25, 0, 0, 0, 0, 0]);
    for (const years of [1, 2, 3, 5, 10]) {
      expect(Math.abs(ehTerm(padPolicy(sol.iKr), years, 0)), `${years}y`).toBeLessThan(1e-15);
    }
  });

  it('전진대입이 하삼각을 정확히 푼다', () => {
    const M = [
      [2, 0, 0],
      [1, 4, 0],
      [3, 2, 5],
    ];
    const c = forwardSub(M, [2, 6, 15]);
    expect(c.map((v) => Number(v.toFixed(10)))).toEqual([1, 1.25, 1.9]);
  });
});

describe('검증 영역', () => {
  it('기저가 든 영역 안이면 배지가 안 뜬다', () => {
    expect(outOfDomain([-50, -50, 0, 0, 0, 0, 0, 50])).toBe(false);
  });

  it('영역 밖이면 배지가 뜬다 — 숫자는 기저가 든 것을 쓴다', () => {
    const [lo] = BASIS.domain.policy_bp_per_q;
    expect(outOfDomain([lo - 1, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
  });
});

describe('점 개수는 기저가 정한다', () => {
  it('여덟 개가 아니면 거절한다', () => {
    expect(() => solvePath([0, 0, 0])).toThrow(/8개 점/);
  });
});
