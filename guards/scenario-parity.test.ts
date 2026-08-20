/* 시나리오 재조합 — 파이썬 기준 구현과 글자 그대로 같은 값을 낸다.
 *
 * `src/lab/scenario/combine.ts` 는 BIGFOOT 의
 * `bigfoot/scenario_basis/replay_ref.py` 를 옮긴 것이다. 그 모듈은 스스로를
 * REFERENCE 라고 부르고, 원본 랩 페이지의 JS 는 node 로 실행돼 1e-9 로
 * 대조된다(`tests/test_lab.py::test_js_parity_with_python_reference`). 이
 * 포트는 그 계보의 세 번째 구현이므로 같은 대조를 진다.
 *
 * ── 왜 눈으로 읽은 값이 아니라 기계가 쓴 값인가 ─────────────────────────────
 * `scenario-parity.vectors.json` 은 파이썬이 직접 뱉은 것이다. 사람이 옮겨
 * 적으면 옮겨 적은 그 순간의 구현을 굳히는 것이지 기준을 굳히는 게 아니고,
 * 자릿수 하나가 틀려도 "우리 구현이 원본과 같다" 는 명제가 조용히 약해진다.
 * 벡터를 손으로 고치지 않는다 — 고칠 일이 생기면 파이썬으로 다시 뽑는다.
 *
 * ── 무엇을 재는가 ───────────────────────────────────────────────────────────
 *   1. 손잡이가 0 이면 전부 0 이다 (항등)
 *   2. 분기 경로 24개 × 변수 넷이 기준값과 같다
 *   3. IRS 경로 13개 × 테너 다섯이 기준값과 같다
 *   4. 정책 계수가 같다 — 전진대입이 같은 답을 낸다
 *   5. 리플레이 13프레임의 bp 편차가 같다 (h=0 절단 포함)
 *   6. 기저의 모양이 안 변했다 — 다시 구웠는데 계약이 달라지면 여기서 걸린다
 *   7. 검증 영역 판정이 원본 랩의 배지와 같다
 *
 * 5번이 가장 잘 깨지는 자리다. `irs[τ]` 의 h=0 은 구성상 0 이고 보간 노드는
 * 한 분기 뒤부터 시작하므로, 안 자르면 경로 전체가 한 분기 밀린다. 원본도 그
 * 자리를 회귀 테스트로 잠가 두었다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  BASIS,
  DAY_GRID,
  IRS_TENORS,
  ZERO_KNOBS,
  combine,
  forwardSub,
  frameDiffs,
  interpAtDay,
  outOfDomain,
  type Knobs,
} from '@/lab/scenario/combine';

/** 원본이 대조에 쓰는 값과 같은 허용치. */
const TOL = 1e-9;

type Vectors = {
  basisAsOf: string;
  cases: Record<
    string,
    {
      knobs: Knobs;
      iKr: number[];
      kr3y: number[];
      kr10y: number[];
      cpiYoy: number[];
      irs: Record<string, number[]>;
      coefs: Record<string, number>;
      frames: { day: number; dyBp: Record<string, number> }[];
    }
  >;
};

const vectors = JSON.parse(
  fs.readFileSync(
    path.join(import.meta.dirname, 'scenario-parity.vectors.json'),
    'utf8',
  ),
) as Vectors;

const CASES = Object.entries(vectors.cases);

/** 배열 대조. `toBeCloseTo` 를 원소마다 부르면 실패 메시지가 어느 원소인지를
 * 안 말한다 — 자리를 같이 싣는다. */
function expectClose(got: number[], want: number[], what: string) {
  expect(got, `${what}: 길이`).toHaveLength(want.length);
  const off = got
    .map((v, i) => ({ i, d: Math.abs(v - want[i]) }))
    .filter((x) => x.d > TOL)
    .map((x) => `[${x.i}] ${got[x.i]} ≠ ${want[x.i]} (Δ${x.d.toExponential(2)})`);
  expect(off, `${what}: 어긋난 자리`).toEqual([]);
}

describe('기저가 계약대로 생겼다', () => {
  it('벡터를 뽑은 기저와 같은 기저다', () => {
    /* 다시 구운 기저를 넣으면 여기서 먼저 걸린다. 그때 할 일은 이 단언을
     * 고치는 게 아니라 벡터를 다시 뽑는 것이다. */
    expect(BASIS.as_of).toBe(vectors.basisAsOf);
  });

  it('경로 길이와 테너가 원본 그대로다', () => {
    expect(BASIS.horizon_q).toBe(24);
    expect(BASIS.irs_h).toBe(13);
    expect(DAY_GRID).toHaveLength(13);
    expect(DAY_GRID[DAY_GRID.length - 1]).toBe(360);
  });

  it('정책 기저 여덟과 충격 기저 일곱이 다 있다', () => {
    for (let q = 1; q <= 8; q += 1) {
      expect(BASIS.bases[`policy_q${q}`], `policy_q${q}`).toBeTruthy();
    }
    for (const n of ['cpi', 'gap', 'exports', 'oil', 'us_2q', 'us_4q', 'us_6q']) {
      expect(BASIS.bases[n], n).toBeTruthy();
    }
  });

  it('M_policy 가 하삼각이다 — 전진대입이 성립하는 근거', () => {
    const M = BASIS.M_policy;
    expect(M).toHaveLength(8);
    const upper = M.flatMap((row, i) =>
      row.map((v, j) => (j > i && Math.abs(v) > TOL ? `M[${i}][${j}]=${v}` : '')),
    ).filter(Boolean);
    expect(upper, '상삼각에 값이 있다').toEqual([]);
    const zeroDiag = M.map((row, i) => (Math.abs(row[i]) < TOL ? i : -1)).filter((i) => i >= 0);
    expect(zeroDiag, '대각이 0 이면 나눗셈이 터진다').toEqual([]);
  });
});

describe('항등 — 손잡이가 0 이면 아무 일도 안 일어난다', () => {
  const d = combine(BASIS, ZERO_KNOBS);

  it('모든 분기 경로가 0 이다', () => {
    for (const v of ['i_kr', 'kr3y', 'kr10y', 'cpi_yoy'] as const) {
      expectClose(d[v], new Array(24).fill(0), v);
    }
  });

  it('모든 IRS 경로가 0 이다', () => {
    for (const t of IRS_TENORS) expectClose(d.irs[t], new Array(13).fill(0), `irs.${t}`);
  });

  it('리플레이 13프레임이 전부 0 이다', () => {
    const frames = frameDiffs(BASIS, ZERO_KNOBS);
    expect(frames).toHaveLength(13);
    for (const f of frames) {
      for (const [k, v] of Object.entries(f.dyBp)) {
        expect(Math.abs(v), `D+${f.day} ${k}`).toBeLessThan(TOL);
      }
    }
  });
});

describe.each(CASES)('파이썬 기준값과 같다 — %s', (name, c) => {
  const d = combine(BASIS, c.knobs);

  it('분기 경로 넷', () => {
    expectClose(d.i_kr, c.iKr, `${name}.i_kr`);
    expectClose(d.kr3y, c.kr3y, `${name}.kr3y`);
    expectClose(d.kr10y, c.kr10y, `${name}.kr10y`);
    expectClose(d.cpi_yoy, c.cpiYoy, `${name}.cpi_yoy`);
  });

  it('IRS 경로 다섯', () => {
    for (const t of IRS_TENORS) expectClose(d.irs[t], c.irs[t], `${name}.irs.${t}`);
  });

  it('기저 계수 — 전진대입이 같은 답을 낸다', () => {
    for (const [k, want] of Object.entries(c.coefs)) {
      expect(Math.abs((d.coefs[k] ?? 0) - want), `${name}.coefs.${k}`).toBeLessThan(TOL);
    }
  });

  it('리플레이 13프레임의 bp 편차', () => {
    const frames = frameDiffs(BASIS, c.knobs);
    expect(frames.map((f) => f.day)).toEqual(c.frames.map((f) => f.day));
    frames.forEach((f, i) => {
      for (const [k, want] of Object.entries(c.frames[i].dyBp)) {
        expect(Math.abs(f.dyBp[k] - want), `${name} D+${f.day} ${k}`).toBeLessThan(TOL);
      }
    });
  });

  it('8개 점이 i_kr 첫 8분기에 그대로 박힌다 — 핀이 핀으로 작동한다', () => {
    /* 랩의 의미론: 8개 점이 곧 금통위 결정이다. 다른 손잡이가 준칙을 통해
     * 금리를 밀어도 첫 8분기는 내가 놓은 자리에 있어야 한다 — `mixed` 처럼
     * 충격이 다 켜진 경우에 이게 깨지면 정책 계수가 내생분을 못 상쇄한 것이다. */
    for (let q = 0; q < 8; q += 1) {
      expect(Math.abs(d.i_kr[q] * 100 - c.knobs.policyBp[q]), `q${q}`).toBeLessThan(1e-7);
    }
  });
});

describe('h=0 절단 — 안 자르면 경로가 한 분기 밀린다', () => {
  const knobs: Knobs = { ...ZERO_KNOBS, policyBp: [-25, -25, -25, -25, -25, -25, -25, -25] };

  it('IRS 의 h=0 은 구성상 0 이다', () => {
    const d = combine(BASIS, knobs);
    for (const t of IRS_TENORS) expect(Math.abs(d.irs[t][0]), `irs.${t}[0]`).toBeLessThan(TOL);
  });

  it('안 자른 구현은 다른 답을 낸다 — 이 검사가 공허하지 않다', () => {
    const d = combine(BASIS, knobs);
    const cut = interpAtDay(d.irs['3y'].slice(1), 180) * 100;
    const uncut = interpAtDay(d.irs['3y'], 180) * 100;
    expect(Math.abs(cut - uncut), '두 방식이 같으면 이 테스트가 아무것도 안 지킨다')
      .toBeGreaterThan(0.5);
  });
});

describe('검증 영역 — 커널이 맞춰진 곳 밖이면 화면이 회색이 된다', () => {
  it('기저가 자기 영역을 들고 있다 — 여기서 숫자를 다시 안 적는다', () => {
    expect(BASIS.domain.us_bp).toEqual([0, 150]);
    expect(BASIS.domain.us_dur_q).toEqual([2, 4, 6]);
    expect(BASIS.domain.note).toMatch(/100bp/);
  });

  it.each([
    ['기본값', ZERO_KNOBS, false],
    ['Fed 100bp × 4분기 = 맞춰진 상한', { ...ZERO_KNOBS, usBp: 100 } as Knobs, false],
    ['Fed 125bp = 커널 밖', { ...ZERO_KNOBS, usBp: 125 } as Knobs, true],
    ['Fed 6분기 = 커널 밖', { ...ZERO_KNOBS, usBp: 25, usDurQ: 6 } as Knobs, true],
    ['정책 −75bp = 영역 밖', { ...ZERO_KNOBS, policyBp: [-75, 0, 0, 0, 0, 0, 0, 0] } as Knobs, true],
  ])('%s', (_label, knobs, want) => {
    expect(outOfDomain(BASIS, knobs as Knobs)).toBe(want);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('전진대입에 틀린 값을 심으면 대조가 잡는다', () => {
    const M = [
      [2, 0],
      [1, 4],
    ];
    const c = forwardSub(M, [6, 10]);
    expectClose(c, [3, 1.75], 'forwardSub');
    expect(() => expectClose(c, [3, 1.76], 'planted')).toThrow();
  });

  it('보간이 노드 사이에서 실제로 움직인다', () => {
    const p = [1, 2, 3];
    expect(interpAtDay(p, 0)).toBe(0);
    expect(interpAtDay(p, 91.3125)).toBeCloseTo(1, 12);
    expect(interpAtDay(p, 45.65625)).toBeCloseTo(0.5, 12);
    expect(interpAtDay(p, 10_000)).toBe(3);
  });
});
