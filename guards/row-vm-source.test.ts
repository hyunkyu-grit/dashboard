/* 행 뷰모델의 **계산 경계** — 프런트가 시장 데이터에 산술을 하지 않는다.
 *
 * v1 패리티 레인 P0-1 (LANE-v1-parity-2026-08-20.md).
 *
 * `src/table/rows.ts` 는 `ROW_FIELD_SOURCE` 를 들고 있고, 그 파일의 머리글은
 * **"`guards/row-vm-source.test.ts` 가 빌드를 실패시킨다"** 고 적어 두었다.
 * 그 가드가 이 리포에 없었다 — 2026-08-20 확인. 표는 있고 강제만 없었다.
 *
 * 명제는 v1 것 그대로다:
 *
 *   1. 세 어댑터가 실제로 행을 짓는다 (빈 목록을 훑고 초록을 내지 않는다)
 *   2. 지어진 행이 담는 **모든** 키가 `ROW_FIELD_SOURCE` 에 선언돼 있다
 *   3. 출처는 `dto` 아니면 `format` 뿐이다 — `compute` 레인이 없다
 *   4. `dto` 로 선언된 필드는 페이로드 값과 **글자 그대로 같다**(숨은 산술 없음)
 *   5. 52주 통계는 읽어 넘길 뿐, 여기서 파생하지 않는다
 *
 * 4번이 핵심이다. 나머지는 선언을 검사하지만 4번은 **값**을 검사한다 — 누가
 * `now: dto.now * 100` 이라고 적어도 3번은 통과하고 4번만 잡는다.
 */

import { describe, expect, it } from 'vitest';

import type {
  CashBondInstruments,
  ForwardsPayload,
  UniversePayload,
  WallSummary,
} from '../src/lib/api';
import { toCashBondRows } from '../src/table/cashbondRows';
import { ROW_FIELD_SOURCE, buildRows, type Row } from '../src/table/rows';
import { toRows as toUniverseRows } from '../src/table/universeRows';

/* ── 페이로드 ───────────────────────────────────────────────────────────────
 * 값은 **서로 구별되는 숫자**로 고른다. 4번 검사가 "페이로드 값과 같은가" 를
 * 보는데, 0 이나 1 처럼 흔한 값을 쓰면 우연히 같아져서 통과할 수 있다. */

const cashbond = (): CashBondInstruments => ({
  asof: '2026-08-19',
  from: '2020-01-02',
  types: [{ id: 'KTB', label: '국고채' }],
  rows: [
    {
      id: 'CB:KTB:3Y',
      kind: 'CB',
      bondType: 'KTB',
      tenor: '3Y',
      label: '국고채 3Y',
      unit: '%',
      now: 2.4731,
      changes: { d1: -7.13, mtd: 3.29, ytd: -11.47 },
      pct: 12.37,
      rangeHigh: 4.1853,
      rangeLow: 2.4325,
      rangeAvg: 3.3567,
      sortKey: [0, 3],
      theta: { perDv01: 1.11, cash: 2.22, carry: 3.33, roll: -1.44, dv01: 4.55, beBp: 0.166 },
    },
  ],
  thetaBasis: { horizonDays: 1, notional: 1e10, side: 'buy' },
});

const universe = (): UniversePayload =>
  ({
    asof: '2026-08-19',
    from: '2020-01-02',
    types: [{ id: 'KTB', label: '국고채' }],
    rows: [
      {
        id: 'UNI:KTB:5Y',
        kind: 'credit',
        label: '국고채 5Y',
        unit: '%',
        now: 2.7913,
        deltas: { d1: 1.27, mtd: -2.31, ytd: 8.19 },
        range1y: { max: 4.4417, min: 2.5119, avg: 3.4913, pct: 41.73 },
        sortKey: [0, 5],
        movePct: 17.29,
        key: true,
      },
    ],
  }) as unknown as UniversePayload;

/** `buildRows` 가 먹는 셋. 세 갈래(아웃라이트·파생·포워드)가 **다 서야** 한다 —
 * 포워드가 없으면 `keyForward`·`startLabel` 이 한 번도 안 나타나고, 아래 "표가
 * 썩지 않는다" 가 그것을 거짓 양성으로 잡는다. */
const summary = (): WallSummary =>
  ({
    asof: '2026-08-19',
    outrights: [
      {
        id: '10Y',
        label: '10Y',
        unit: '%',
        now: 3.1479,
        deltas: { d1: -2.13, mtd: 4.71, ytd: -9.23 },
        range1y: { max: 3.9917, min: 2.6113, avg: 3.2419, pct: 33.19 },
        sortKey: [0, 10],
        key: true,
        quoted: true,
        movePct: 21.37,
      },
    ],
    derived: [
      {
        id: '2Y-10Y',
        kind: 'spread',
        label: '2Y-10Y',
        unit: 'bp',
        now: 41.73,
        deltas: { d1: 1.19, mtd: -3.27, ytd: 12.41 },
        range1y: { max: 58.13, min: 11.29, avg: 33.47, pct: 64.91 },
        sortKey: [1, 2, 10],
        key: false,
        quoted: false,
        movePct: 9.13,
      },
    ],
  }) as unknown as WallSummary;

const forwards = (): ForwardsPayload =>
  ({
    tenors: ['1YF'],
    startPoints: [{ label: '1Y' }],
    grid: {
      '1YF': [
        {
          start: '1Y',
          values: { now: 2.9137 },
          deltas: { d1: -1.17, mtd: 2.93, ytd: -4.19 },
          range1y: { max: 3.7719, min: 2.1193, avg: 2.9431, pct: 47.83 },
          sortKey: [3, 1, 1],
          keyForward: true,
          quoted: true,
        },
      ],
    },
  }) as unknown as ForwardsPayload;

/** 마지막 실패 이유. 삼킨 예외를 실패 문장에 실어 주지 않으면, 이 가드가
 * "0줄이다" 라고만 말하고 왜인지는 다음 사람이 다시 찾아야 한다. */
let wallError: string | null = null;

function allRows(): { name: string; rows: Row[] }[] {
  let wall: Row[] = [];
  try {
    wall = buildRows(summary(), forwards());
    wallError = null;
  } catch (e) {
    wallError = e instanceof Error ? e.message : String(e);
    wall = [];
  }
  return [
    { name: 'buildRows (wall)', rows: wall },
    { name: 'toCashBondRows', rows: toCashBondRows(cashbond()) },
    { name: 'toUniverseRows', rows: toUniverseRows(universe()) },
  ];
}

describe('행을 짓는 어댑터가 셋 다 실제로 돈다', () => {
  it('세 어댑터가 모두 행을 낸다 — 빈 목록을 훑고 초록을 내지 않는다', () => {
    const empty = allRows().filter((a) => a.rows.length === 0).map((a) => a.name);
    expect(empty, wallError ?? '(예외 없음 — 그냥 0줄)').toEqual([]);
  });
});

describe('모든 필드가 출처를 선언한다', () => {
  it('지어진 행의 키가 전부 ROW_FIELD_SOURCE 에 있다', () => {
    const declared = new Set(Object.keys(ROW_FIELD_SOURCE));
    const undeclared: string[] = [];
    for (const { name, rows } of allRows()) {
      for (const row of rows) {
        for (const k of Object.keys(row)) {
          if (!declared.has(k)) undeclared.push(`${name}: ${k}`);
        }
      }
    }
    expect([...new Set(undeclared)]).toEqual([]);
  });

  it('출처는 dto 아니면 format 뿐이다 — compute 레인은 없다', () => {
    const bad = Object.entries(ROW_FIELD_SOURCE)
      .filter(([, v]) => v !== 'dto' && v !== 'format')
      .map(([k, v]) => `${k}=${v}`);
    expect(bad).toEqual([]);
  });

  it('표가 썩지 않는다 — 선언만 있고 Row 에 없는 키는 없다', () => {
    /* 필드를 지운 뒤 표에서 안 지우면 다음 사람이 "이 필드 어디 갔지" 를 한다. */
    const seen = new Set<string>();
    for (const { rows } of allRows()) for (const r of rows) Object.keys(r).forEach((k) => seen.add(k));
    /* 선택 필드는 그 행에 없을 수 있으므로, 셋을 합쳐도 안 보이는 것만 센다. */
    const stale = Object.keys(ROW_FIELD_SOURCE).filter((k) => !seen.has(k));
    expect(stale).toEqual([]);
  });
});

describe('dto 필드는 페이로드 값 그대로다 — 숨은 산술이 없다', () => {
  it('현금채권: 서버가 준 숫자와 글자 그대로 같다', () => {
    const p = cashbond();
    const src = p.rows[0];
    const row = toCashBondRows(p).find((r) => r.id === src.id);
    expect(row, '행을 못 찾았다').toBeTruthy();
    expect(row!.now).toBe(src.now);
    expect(row!.pct).toBe(src.pct);
    expect(row!.changes).toEqual(src.changes);
    expect(row!.rangeHigh).toBe(src.rangeHigh);
    expect(row!.rangeLow).toBe(src.rangeLow);
    expect(row!.rangeAvg).toBe(src.rangeAvg);
    expect(row!.theta).toEqual(src.theta);
  });

  it('유니버스: 서버가 준 숫자와 글자 그대로 같다', () => {
    const p = universe();
    const src = (p as unknown as {
      rows: {
        id: string;
        now: number;
        deltas: Record<string, number>;
        range1y: { max: number; min: number; avg: number; pct: number };
        movePct: number;
      }[];
    }).rows[0];
    const row = toUniverseRows(p).find((r) => r.id === src.id);
    expect(row, '행을 못 찾았다').toBeTruthy();
    expect(row!.now).toBe(src.now);
    expect(row!.pct).toBe(src.range1y.pct);
    expect(row!.changes).toEqual(src.deltas);
    expect(row!.rangeHigh).toBe(src.range1y.max);
    expect(row!.rangeLow).toBe(src.range1y.min);
    expect(row!.rangeAvg).toBe(src.range1y.avg);
    expect(row!.movePct).toBe(src.movePct);
  });

  it('52주 통계는 읽어 넘길 뿐, 여기서 파생하지 않는다 (pass L)', () => {
    /* 평균을 (고+저)/2 로 "고쳐" 놓는 것이 이 계열의 고전적 사고다. 서버가 준
     * 평균은 실제 시계열의 평균이고, 두 값의 중점이 아니다. */
    const p = cashbond();
    const src = p.rows[0];
    const row = toCashBondRows(p)[0];
    const midpoint = ((src.rangeHigh as number) + (src.rangeLow as number)) / 2;
    expect(row.rangeAvg).toBe(src.rangeAvg);
    expect(row.rangeAvg).not.toBe(midpoint);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('선언 안 된 키가 있으면 잡힌다', () => {
    const declared = new Set(Object.keys(ROW_FIELD_SOURCE));
    const planted = { ...({ id: 'x' } as unknown as Row), 몰래붙인필드: 1 } as Record<string, unknown>;
    const undeclared = Object.keys(planted).filter((k) => !declared.has(k));
    expect(undeclared).toEqual(['몰래붙인필드']);
  });

  it('값이 변형되면 잡힌다', () => {
    const src = cashbond().rows[0];
    const tampered = { ...src, now: (src.now as number) * 100 };
    expect(tampered.now).not.toBe(src.now);
  });
});
