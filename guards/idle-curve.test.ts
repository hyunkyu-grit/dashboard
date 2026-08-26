import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { SeriesSummary, WallSummary } from '../src/lib/api';
import { idleCurve } from '../src/chart/curve';

/**
 * 아이들 커브 — 아무것도 안 고른 pane 이 그리는 IRS 파 커브.
 *
 * 여기서 틀리면 화면에는 **멀쩡한 커브가 나오고 그게 다른 커브다.** 노드가 몇 개
 * 빠지거나 순서가 어긋나도 선은 그럴듯하게 이어지기 때문에, 눈으로는 못 잡는다.
 */

function node(id: string, t: number, now: number | null, prev: number | null, d: number | null): SeriesSummary {
  return {
    id,
    label: id,
    kind: 'outright',
    unit: '%',
    now,
    deltas: { d1: d, mtd: null, ytd: null },
    basisValues: { d1: prev, mtd: null, ytd: null },
    range1y: { min: null, max: null, avg: null, pct: null },
    sortKey: [t],
    quoted: true,
    movePct: null,
    key: true,
  };
}

const SUMMARY = {
  asof: '2026-08-13',
  basisDates: { d1: '2026-08-12', mtd: null, ytd: null },
  specNodeOrder: [],
  // 벽면 표의 표시 집합 — 커브의 노드 집합이 **아니다**. 실측으로 8개뿐이었다.
  displayTenors: ['6M', '1Y', '10Y'],
  missingNodes: [],
  curveBanner: { kind: null },
  outrights: [
    node('10Y', 10, 4.0975, 4.09, 0.8),
    node('1D', 1 / 365, 2.781, 2.777, 0.4),
    node('3M', 0.25, 2.93, 2.93, 0.0),
    node('1Y', 1, 3.45, 3.45, 0.0),
    node('4Y', 4, 3.905, 3.897, 0.8),
  ],
  derived: [],
  events: [],
  regret: [],
  policy: { unit: '%', asof: '', through: '', steps: [], latest: null, warnings: [] },
} as unknown as WallSummary;

describe('커브의 노드 집합과 순서', () => {
  const c = idleCurve(SUMMARY)!;

  it('만기 순서로 선다 — 배열 순서가 아니라 백엔드 `sortKey` 로', () => {
    // 페이로드는 10Y 를 먼저 실어 보냈다. 그대로 그리면 커브가 뒤집힌다.
    expect(c.tenors).toEqual(['3M', '1Y', '4Y', '10Y']);
  });

  it('콜금리(1D)는 커브 노드가 아니다', () => {
    // 등간격 축에서 1/365년 노드를 6M 옆에 세우면 낙차가 만기 한 칸으로 보인다.
    expect(c.tenors).not.toContain('1D');
  });

  it('보간 노드(4Y)도 커브에 있다 — 커브는 연속이다', () => {
    expect(c.tenors).toContain('4Y');
  });

  it('`displayTenors` 를 쓰지 않는다 — 그건 표의 표시 집합이다', () => {
    // 실측: displayTenors 는 6M…10Y 8개뿐이라 짧은 끝(3M)과 보간 노드가 빠진다.
    expect(c.tenors.length).toBeGreaterThan(SUMMARY.displayTenors.length);
  });
});

describe('값은 백엔드 것', () => {
  const c = idleCurve(SUMMARY)!;

  it('오늘은 `now`, 전일은 `basisValues.d1`', () => {
    expect(c.now).toEqual([2.93, 3.45, 3.905, 4.0975]);
    expect(c.prev).toEqual([2.93, 3.45, 3.897, 4.09]);
  });

  it('변화는 `deltas.d1` 을 그대로 — 화면의 두 레벨을 빼지 않는다 (§16)', () => {
    /* 4Y 는 3.905 − 3.897 = 0.008%p = 0.8bp 로 맞아떨어지지만, 그건 이 픽스처가
     * 그렇게 생긴 것뿐이다. 반올림된 두 수의 차는 표의 어제 열과 어긋날 수 있고,
     * 그래서 뺄셈은 백엔드 몫이다. */
    expect(c.changeBp).toEqual([0.0, 0.0, 0.8, 0.8]);

    const src = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/PreviewPane.tsx'),
      'utf8',
    );
    // 리드아웃이 레벨 뺄셈으로 되돌아가지 않는지
    expect(src).not.toMatch(/curve\.now\[i\]\s*-\s*curve\.prev\[i\]/);
  });

  it('날짜를 같이 싣는다 — "언제 것인가" 를 pane 이 말할 수 있어야 한다', () => {
    expect(c.asof).toBe('2026-08-13');
    expect(c.prevDate).toBe('2026-08-12');
  });
});

describe('그릴 게 없으면 그리지 않는다', () => {
  it('요약이 없으면 null', () => {
    expect(idleCurve(undefined)).toBeNull();
  });

  it('아웃라이트가 없으면 null', () => {
    expect(idleCurve({ ...SUMMARY, outrights: [] } as WallSummary)).toBeNull();
  });

  it('전부 값이 없으면 null — 빈 축만 그리느니 안 그린다', () => {
    const blank = { ...SUMMARY, outrights: [node('1Y', 1, null, null, null)] } as WallSummary;
    expect(idleCurve(blank)).toBeNull();
  });
});

describe('마디는 직선으로 잇는다', () => {
  /* 규칙은 안 바뀌었고 **재는 자리가 옮겨졌다** [2026-08-26 라이트웨이트 이관].
   *
   * CDS 판에서는 기본이 `bump` 스플라인이라 `curve="linear"` 를 **켜야** 했다.
   * `lightweight-charts` 의 `LineSeries` 는 기본이 직선 세그먼트라 이제는
   * **끄지 않는 것**이 지키는 방법이다 — 그래서 「그 옵션이 있는가」가 아니라
   * 「그 옵션을 건드리지 않았는가」를 잰다.
   *
   * 우리가 아는 것은 노드의 값뿐이다. 곡선이 예뻐 보이는 대신 존재하지 않는
   * 만기의 금리를 그리는 거래는 하지 않는다. */
  const src = fs.readFileSync(
    path.resolve(import.meta.dirname, '../src/chart/CurveChart.tsx'),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');

  it('`lineType` 을 아예 안 건드린다 — 기본이 직선이다', () => {
    expect(code).not.toMatch(/lineType/);
  });

  it('스플라인·계단으로 바꾸지 않는다', () => {
    expect(code).not.toMatch(/LineType\.(Curved|WithSteps)/);
  });

  it('커브를 그리는 곳이 여기 하나다 — 화면마다 다른 보간이 생기지 않는다', () => {
    const pane = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/ui/PreviewPane.tsx'),
      'utf8',
    );
    expect(pane).toMatch(/<CurveChart/);
    /* 옛 커브 경로가 남아 있으면 둘이 갈린다. **히스토리 차트의**
       `curve="linear"` 는 아직 CDS 라 그대로 있다(이관 진행 중) — 그래서
       커브 차트의 계열 이름으로 좁혀 잰다. */
    expect(pane).not.toMatch(/seriesId="NOW"/);
    expect(pane).not.toMatch(/seriesId="PREV"/);
  });
});
