/* 52주 위치 표식은 **옆에 인쇄된 숫자와 어긋날 수 없다**.
 *
 * v1 패리티 레인 P0-3 (LANE-v1-parity-2026-08-20.md). v1 의 `range-slider`.
 *
 * ## 이 가드가 잡은 것
 *
 * 표의 트랙이 서버의 `range1y.pct` 를 `left` 에 그대로 넣고 있었다. 그 값은
 * **순위 백분위**(`bisect_left(sorted, now)/len`, `derive.py:54`)이고, 트랙의
 * 두 끝은 **최저·최고**다. 두 양은 다르다. 라이브 실측 2026-08-20, 99행:
 *
 *     6M-1Y-2Y   현재 2.500  저 −17.000  고 14.750   순위 85.3%  선형 61.4%
 *     10%p 초과 20행 · 최대 23.9%p
 *
 * 마커는 85% 에 서서 "고점에 거의 붙었다" 고 말하는데 옆 숫자로 재면 61% 였다.
 * 눈으로는 못 잡고, 암산하는 사람만 잡는다 — 그리고 이 표의 존재 이유가 그
 * 암산이다.
 *
 * [OWNER, 2026-08-20] 마커는 선형 위치다. 순위 백분위는 스크리너의
 * 고점권/저점권 칩에 남는다 — 거기서는 순위로 말하는 것이 옳다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { rangePosition } from '../src/lib/range';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('자리는 옆의 숫자에서 나온다', () => {
  it('고점이면 끝, 저점이면 시작, 중간이면 중간', () => {
    expect(rangePosition(4, 2, 4)).toBe(100);
    expect(rangePosition(2, 2, 4)).toBe(0);
    expect(rangePosition(3, 2, 4)).toBe(50);
  });

  it('음수 범위에서도 같은 셈이다 — 스프레드는 음수로 간다', () => {
    // 실측 행: 6M-1Y-2Y
    expect(rangePosition(2.5, -17, 14.75)).toBeCloseTo(61.4, 1);
  });

  it('극값 밖이면 끝으로 클램프한다 — 트랙을 벗어나지 않는다', () => {
    expect(rangePosition(5, 2, 4)).toBe(100);
    expect(rangePosition(1, 2, 4)).toBe(0);
  });

  it('자리라는 개념이 없으면 null 이다 — 0 으로 그리지 않는다', () => {
    /* 0 으로 그리면 "바닥에 있다" 는 없는 사실을 말한다. */
    expect(rangePosition(3, 3, 3)).toBeNull();
    expect(rangePosition(3, 4, 2)).toBeNull();
    expect(rangePosition(null, 2, 4)).toBeNull();
    expect(rangePosition(3, null, 4)).toBeNull();
    expect(rangePosition(3, 2, null)).toBeNull();
    expect(rangePosition(NaN, 2, 4)).toBeNull();
  });
});

describe('순위 백분위와 선형 위치는 다른 양이다', () => {
  /** 화면이 쓰던 옛 값. 비교 대상으로만 둔다. */
  const rankPct = (now: number, sample: number[]) => {
    const s = [...sample].sort((a, b) => a - b);
    let i = 0;
    while (i < s.length && s[i] < now) i += 1;
    return (i / s.length) * 100;
  };

  it('치우친 분포에서 크게 갈린다 — 이 가드의 존재 이유', () => {
    /* 1년 내내 3.0 근처였다가 한 번 4.0 을 찍은 시리즈. 오늘은 3.05. */
    const sample = [...Array(200).fill(3.0), ...Array(5).fill(4.0), 2.9];
    const now = 3.05;
    const lo = Math.min(...sample);
    const hi = Math.max(...sample);

    const linear = rangePosition(now, lo, hi)!;
    const rank = rankPct(now, sample);

    expect(linear).toBeCloseTo(13.6, 1); // 바닥 근처
    expect(rank).toBeGreaterThan(90); // 상위권
    expect(Math.abs(rank - linear)).toBeGreaterThan(70);
  });

  it('실측 행에서도 갈린다 — 6M-1Y-2Y (2026-08-20)', () => {
    const linear = rangePosition(2.5, -17, 14.75)!;
    expect(Math.abs(85.3 - linear)).toBeGreaterThan(20);
  });
});

describe('그리는 곳은 전부 이 한 함수를 지난다', () => {
  const SURFACES = [
    'src/table/InstrumentTable.tsx',
    'src/ui/ForwardMatrix.tsx',
    'src/ui/PreviewPane.tsx',
  ];

  it('세 표면이 모두 rangePosition 을 쓴다', () => {
    const missing = SURFACES.filter((f) => !read(f).includes('rangePosition('));
    expect(missing).toEqual([]);
  });

  it('그 표면들이 pct 를 자리로 쓰지 않는다', () => {
    /* `left: {pct}%` 또는 `pct` 를 프랙션으로 나누는 모양이 다시 나타나면
     * 그때가 이 병이 돌아온 순간이다. 스크리너의 임계 비교(`pct >= 90`)는
     * 순위로 쓰는 정당한 자리라 여기 표면 목록에 없다. */
    const offenders: string[] = [];
    for (const f of SURFACES) {
      const src = read(f);
      for (const m of src.matchAll(/left:\s*`\$\{[^}]*pct[^}]*\}%`/g)) offenders.push(`${f}: ${m[0]}`);
      for (const m of src.matchAll(/\bpct\s*\/\s*100\b/g)) offenders.push(`${f}: ${m[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('표의 트랙은 세 숫자를 받는다 — 백분위 하나가 아니다', () => {
    const src = read('src/table/InstrumentTable.tsx');
    expect(src).toMatch(/<RangeTrack\s+now=\{row\.now\}\s+low=\{row\.rangeLow\}\s+high=\{row\.rangeHigh\}/);
  });

  it('두 트랙이 같은 함수를 지나므로 서로 갈릴 수 없다', () => {
    /* 각자 계산하던 시절에 하나가 순위로 새어 나갔다. 한 함수로 모은 것이
     * 그 재발을 막는 장치이고, 이 검사가 그 장치를 지킨다. */
    for (const f of ['src/table/InstrumentTable.tsx', 'src/ui/ForwardMatrix.tsx']) {
      expect(read(f), f).toMatch(/from '@\/lib\/range'/);
    }
  });
});

describe('순위 백분위는 자기 자리를 지킨다', () => {
  it('스크리너의 고점권/저점권은 여전히 pct 를 쓴다', () => {
    /* 마커에서 걷어냈다고 해서 통계가 틀린 것은 아니다 — "상위 10%" 는
     * 순위로 말하는 것이 옳고, 그 칩이 그 자리다. */
    const src = read('src/table/screener.ts');
    expect(src).toMatch(/r\.pct != null && r\.pct >= 90/);
    expect(src).toMatch(/r\.pct != null && r\.pct <= 10/);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('옛 코드 모양을 심으면 잡힌다', () => {
    const planted = 'style={{ left: `${clamped}%` }}'.replace('clamped', 'pct');
    const hits = [...planted.matchAll(/left:\s*`\$\{[^}]*pct[^}]*\}%`/g)];
    expect(hits.length).toBe(1);
  });

  it('선형 위치는 옆 숫자와 산술적으로 묶여 있다', () => {
    /* 자리를 알면 값을 되찾을 수 있다 — 그 가역성이 "어긋날 수 없다" 의 뜻이다. */
    const lo = -17;
    const hi = 14.75;
    for (const now of [-17, -5, 0, 2.5, 10, 14.75]) {
      const pos = rangePosition(now, lo, hi)!;
      expect(lo + (pos / 100) * (hi - lo)).toBeCloseTo(now, 10);
    }
  });
});
