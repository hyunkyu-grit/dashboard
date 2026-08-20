/* 다섯째 칸 — 시장이 이미 프라이싱한 것과 모형이 말하는 것의 차.
 *
 * `src/lab/scenario/assemble.ts` 가 앵커(시장)와 편차(모형)를 더하는 유일한
 * 자리다. 그 산술을 여기서 잠근다.
 *
 * ── 이 파일이 지키는 명제 하나 ──────────────────────────────────────────────
 * **전망과 트레이드는 다른 칸이다.**
 *
 *   시나리오 − 현재    전망. 시장이 이미 그만큼 프라이싱했으면 포지션이 없다.
 *   모형 Δ − 시장 캐리  트레이드.
 *
 * 두 양이 비교 가능한 이유는 **같은 질문에 대한 두 답**이기 때문이다. 모형의
 * `irs[τ][h]` 는 그 시나리오 안에서 τ 스왑이 오늘부터 h 까지 움직이는 폭이고,
 * 시장 캐리는 오늘 커브가 함의하는 같은 폭이다. 레벨끼리가 아니라 **이동끼리**
 * 견준다.
 *
 * ── 실측 앵커를 쓴다 ────────────────────────────────────────────────────────
 * 2026-08-19 라이브에서 뽑은 값이다(`/api/wall/summary` 호가 + `/api/forwards`
 * 부트스트랩 캐리). 지어낸 숫자로 조립을 시험하면 자릿수·부호·null 이 실제로
 * 어떻게 생겼는지를 못 본다 — 특히 10Y 는 **캐리가 아예 없다**는 것이 이 화면의
 * 성질이라 픽스처가 그것을 담고 있어야 한다.
 */

import { describe, expect, it } from 'vitest';

import {
  BASIS,
  IRS_TENORS,
  ZERO_KNOBS,
  combine,
  frameDiffs,
  type Knobs,
} from '@/lab/scenario/combine';
import {
  H_12M,
  assembleFrames,
  assembleRows,
  type Anchors,
} from '@/lab/scenario/assemble';

/** 2026-08-19 실측. 손으로 고치지 않는다 — 다시 뽑으려면 라이브에서 읽는다. */
const ANCHORS: Anchors = {
  asof: '2026-08-19',
  cd: 2.93,
  base: 2.75,
  irs: {
    '1y': { spot: 3.4375, carry12mBp: 55.17, live: true },
    '2y': { spot: 3.7075, carry12mBp: 33.29, live: true },
    '3y': { spot: 3.83, carry12mBp: 24.01, live: false },
    '5y': { spot: 3.9625, carry12mBp: 16.72, live: false },
    '10y': { spot: 4.105, carry12mBp: null, live: false },
  },
};

const rowOf = (rows: ReturnType<typeof assembleRows>, t: string) =>
  rows.find((r) => r.tenor === t)!;

describe('12개월이 어디인가', () => {
  it('h=4 다 — 기저가 분기 색인이고 h=0 이 오늘이다', () => {
    expect(H_12M).toBe(4);
    expect(BASIS.irs_h).toBeGreaterThan(H_12M);
  });
});

describe('손잡이를 안 건드려도 다섯째 칸은 0 이 아니다', () => {
  const rows = assembleRows(ANCHORS, combine(BASIS, ZERO_KNOBS));

  it('시나리오가 현재와 정확히 같다', () => {
    for (const t of IRS_TENORS) {
      const r = rowOf(rows, t);
      expect(r.scenario12m, t).toBe(r.spot);
      expect(Math.abs(r.deltaBp), t).toBeLessThan(1e-9);
    }
  });

  it('그런데 Δ vs 시장은 캐리의 음수다 — 시장은 이미 움직일 것을 프라이싱했다', () => {
    /* 이 화면의 출발점이다. 아무것도 안 해도 −24bp 라는 사실이 "동결이면
     * 리시브" 라는 진술이고, 그건 모형이 아니라 커브가 하는 말이다. */
    expect(rowOf(rows, '1y').vsMarketBp).toBeCloseTo(-55.17, 9);
    expect(rowOf(rows, '2y').vsMarketBp).toBeCloseTo(-33.29, 9);
    expect(rowOf(rows, '3y').vsMarketBp).toBeCloseTo(-24.01, 9);
    expect(rowOf(rows, '5y').vsMarketBp).toBeCloseTo(-16.72, 9);
  });

  it('시장 12M 이 현재 + 캐리다', () => {
    const r = rowOf(rows, '3y');
    expect(r.market12m).toBeCloseTo(3.83 + 0.2401, 9);
  });
});

describe('10Y — 캐리가 없으면 빈칸이지 0 이 아니다', () => {
  const rows = assembleRows(ANCHORS, combine(BASIS, ZERO_KNOBS));
  const r = rowOf(rows, '10y');

  it('시장 12M 과 Δ vs 시장이 둘 다 null 이다', () => {
    expect(r.market12m).toBeNull();
    expect(r.vsMarketBp).toBeNull();
  });

  it('그래도 전망 칸은 산다 — 모형은 10Y 를 말할 수 있다', () => {
    const hiked = assembleRows(
      ANCHORS,
      combine(BASIS, { ...ZERO_KNOBS, policyBp: new Array(8).fill(25) } as Knobs),
    );
    expect(Math.abs(rowOf(hiked, '10y').deltaBp)).toBeGreaterThan(0);
    expect(rowOf(hiked, '10y').vsMarketBp).toBeNull();
  });

  it('null 이 0 으로 굴러떨어지지 않는다 — 심어서 확인', () => {
    const planted: Anchors = {
      ...ANCHORS,
      irs: { ...ANCHORS.irs, '3y': { ...ANCHORS.irs['3y'], carry12mBp: null } },
    };
    expect(rowOf(assembleRows(planted, combine(BASIS, ZERO_KNOBS)), '3y').vsMarketBp)
      .toBeNull();
  });
});

describe('실측 한 벌 — 지속 −25bp 핀', () => {
  const knobs: Knobs = { ...ZERO_KNOBS, policyBp: new Array(8).fill(-25) };
  const diffs = combine(BASIS, knobs);
  const rows = assembleRows(ANCHORS, diffs);

  it('전망과 트레이드가 다른 부호를 낼 수 있다', () => {
    const r = rowOf(rows, '3y');
    /* 인하 경로인데 전망은 **위**다(핀이 끝난 뒤 준칙이 되받아친다). 그런데
     * 시장은 그보다 더 큰 상승을 프라이싱하고 있어 트레이드는 **아래**다.
     * 이 두 부호가 갈리는 것이 이 화면의 존재 이유다. */
    expect(r.deltaBp).toBeGreaterThan(0);
    expect(r.vsMarketBp!).toBeLessThan(0);
  });

  it('다섯째 칸이 두 칸의 뺄셈과 정확히 같다', () => {
    for (const t of IRS_TENORS) {
      const r = rowOf(rows, t);
      if (r.marketCarryBp === null) continue;
      expect(r.vsMarketBp!, t).toBeCloseTo(r.deltaBp - r.marketCarryBp, 12);
    }
  });

  it('캐리는 손잡이와 무관하다 — 시나리오를 바꿔도 안 움직인다', () => {
    const other = assembleRows(
      ANCHORS,
      combine(BASIS, { ...ZERO_KNOBS, policyBp: new Array(8).fill(50) } as Knobs),
    );
    for (const t of IRS_TENORS) {
      expect(rowOf(other, t).marketCarryBp, t).toBe(rowOf(rows, t).marketCarryBp);
    }
  });

  it('live 플래그가 그대로 실린다 — 3Y·5Y 는 끝점이 비호가다', () => {
    expect(rowOf(rows, '1y').live).toBe(true);
    expect(rowOf(rows, '2y').live).toBe(true);
    expect(rowOf(rows, '3y').live).toBe(false);
    expect(rowOf(rows, '5y').live).toBe(false);
  });
});

describe('부호 규약 — 양수면 페이', () => {
  it('모형이 시장보다 크게 오른다고 하면 양수다', () => {
    /* 캐리를 0 으로 둔 앵커에서 인상 경로를 넣으면 전망 = 트레이드가 된다. */
    const flat: Anchors = {
      ...ANCHORS,
      irs: Object.fromEntries(
        IRS_TENORS.map((t) => [t, { ...ANCHORS.irs[t], carry12mBp: 0 }]),
      ) as Anchors['irs'],
    };
    const rows = assembleRows(
      flat,
      combine(BASIS, { ...ZERO_KNOBS, policyBp: new Array(8).fill(-25) } as Knobs),
    );
    const r = rowOf(rows, '3y');
    expect(r.vsMarketBp).toBeCloseTo(r.deltaBp, 12);
    expect(r.vsMarketBp!).toBeGreaterThan(0);
  });
});

describe('리플레이 — 오늘에서 출발한다', () => {
  const knobs: Knobs = { ...ZERO_KNOBS, policyBp: [-25, -25, -25, -25, 0, 0, 0, 0] };
  const frames = assembleFrames(ANCHORS, frameDiffs(BASIS, knobs));

  it('13프레임이고 D+0 .. D+360 이다', () => {
    expect(frames).toHaveLength(13);
    expect(frames[0].day).toBe(0);
    expect(frames[12].day).toBe(360);
  });

  it('D+0 의 절대 레벨이 스팟과 **정확히** 같다', () => {
    for (const t of IRS_TENORS) {
      expect(frames[0].irs[t], t).toBe(ANCHORS.irs[t].spot);
    }
    /* KTB 는 앵커가 없어 편차로 남는다. D+0 이면 그 편차가 0 이다. */
    expect(frames[0].ktbDevBp['3y']).toBe(0);
    expect(frames[0].ktbDevBp['10y']).toBe(0);
  });

  it('KTB 는 절대 레벨이 아니라 편차다 — 두 축의 이름이 달라야 한다', () => {
    const moved = frames[6].ktbDevBp['3y'];
    expect(Math.abs(moved)).toBeGreaterThan(0);
    /* 편차가 % 레벨 자리로 새지 않았는지. 국고 3년이 2%대인데 편차는 bp 라
     * 한 자릿수여야 한다 — 이 검사가 두 기준이 섞이는 사고를 잡는다. */
    expect(Math.abs(moved)).toBeLessThan(200);
  });

  it('중간 프레임은 실제로 움직인다 — 이 검사가 공허하지 않다', () => {
    const moved = IRS_TENORS.filter(
      (t) => Math.abs(frames[6].irs[t] - ANCHORS.irs[t].spot) > 1e-6,
    );
    expect(moved.length).toBeGreaterThan(0);
  });

  it('절대 레벨이 스팟 + bp 편차와 맞는다', () => {
    for (const f of frames) {
      for (const t of IRS_TENORS) {
        expect(f.irs[t], `${t} D+${f.day}`)
          .toBeCloseTo(ANCHORS.irs[t].spot + f.dyBp[`irs_${t}`] / 100, 12);
      }
    }
  });
});

describe('반올림하지 않는다', () => {
  it('다섯째 칸이 두 반올림의 차가 아니다', () => {
    /* 조립 단계에서 반올림하면 없던 1bp 가 생긴다. 소수가 살아 있는지 본다. */
    const rows = assembleRows(
      ANCHORS,
      combine(BASIS, { ...ZERO_KNOBS, policyBp: new Array(8).fill(-25) } as Knobs),
    );
    const r = rowOf(rows, '3y');
    expect(Number.isInteger(r.deltaBp), 'deltaBp 가 정수로 뭉개졌다').toBe(false);
    expect(Number.isInteger(r.vsMarketBp!), 'vsMarketBp 가 정수로 뭉개졌다').toBe(false);
  });
});
