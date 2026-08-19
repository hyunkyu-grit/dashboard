import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { fmtKrw, manUnits } from '../src/lib/krw';
import { CELL_INSET, colPx, visibleColumns } from '../src/table/columns';
import { InstrumentTable } from '../src/table/InstrumentTable';
import type { Row } from '../src/table/rows';
import { hasTheta, thetaTitle } from '../src/table/theta';

/**
 * 세타 열 — 폭이 되나(라더)와 여기 있나(데이터)는 **다른 질문**이다.
 *
 * 이 둘을 한 조건으로 합치면 두 가지 거짓말 중 하나가 나온다: 값이 없는 탭에서
 * em dash 로만 채운 열이 폭을 먹거나, 값이 있는데도 "N열 숨었어요" 가 세타를
 * 세지 않아 읽는 사람이 열이 있는 줄도 모르게 된다. 그래서 **적용 여부는 라더의
 * 입력**(`hasTheta`)이고, `hidden` 은 폭이 가져간 열만 센다.
 */

const CH = 8;
const w = colPx(CH);

function row(id: string, theta: Row['theta']): Row {
  return {
    id,
    label: id,
    group: 'outright',
    unit: '%',
    now: 3,
    changes: { d1: 1, mtd: 1, ytd: 1 },
    pct: 50,
    seriesId: id,
    rangeHigh: 4,
    rangeLow: 2,
    rangeAvg: 3,
    sortKey: [1],
    movePct: null,
    key: true,
    theta,
  } as Row;
}

const THETA: NonNullable<Row['theta']> = {
  perDv01: -1_234_567,
  cash: -12_345_678,
  carry: -3_000_000,
  roll: -9_345_678,
  dv01: 8_210_000,
  beBp: 1.5,
};

describe('꼬리의 순서 — 위치가 세타에게 자리를 내준다 [OWNER 2026-08-14]', () => {
  /* `CELL_INSET` 이 더해지는 이유는 52주 꼬리 전체가 셀 **하나** 안에 살기
   * 때문이다. 이걸 빼먹은 라더가 표에 가로 스크롤바를 만들었다(실측 2026-08-14). */
  const base = w.label + w.level + w.delta * 3 + w.range + CELL_INSET;
  const full = base + w.theta + w.rangeSub;

  it('전부 들어가는 폭에서는 셋 다 보인다', () => {
    const v = visibleColumns(full, CH, null);
    expect(v.range52 && v.slider && v.theta).toBe(true);
    expect(v.hidden).toBe(0);
  });

  it('폭이 모자라면 **위치**가 먼저 떨어지고 세타는 남는다', () => {
    // 오너가 요청한 열이 제일 먼저 사라지고 있었다(실측: 뷰포트 1390 아래).
    // 위치는 옆 세 숫자의 그림이라 없어져도 같은 사실이 행에 남지만,
    // 세타는 화면 어디에도 없는 양이다.
    const v = visibleColumns(full - 1, CH, null);
    expect(v.slider).toBe(false);
    expect(v.theta).toBe(true);
    expect(v.hidden).toBe(1);
  });

  it('세타는 52주 세 숫자 다음 rung — 그것도 없으면 세타도 없다', () => {
    const v = visibleColumns(base + w.theta - 1, CH, null);
    expect(v.range52).toBe(true);
    expect(v.theta).toBe(false);
    expect(v.slider).toBe(false); // 세타가 못 들어가는 폭이면 위치도 못 들어간다
  });

  it('꼬리는 셀 인셋을 낸 뒤에 잰다 — 안 그러면 표가 가로로 넘친다', () => {
    expect(visibleColumns(base + w.theta - CELL_INSET, CH, null).theta).toBe(false);
    expect(visibleColumns(base + w.theta, CH, null).theta).toBe(true);
  });
});

describe('폭이 되는 것과 값이 있는 것은 다른 질문', () => {
  const full = w.label + w.level + w.delta * 3 + w.range + CELL_INSET + w.theta + w.rangeSub;

  it('값이 하나도 없으면 열을 안 그린다', () => {
    expect(visibleColumns(full, CH, null, false).theta).toBe(false);
  });

  it('그건 라더 드롭이 아니라서 숨김 수를 늘리지 않는다', () => {
    // "1열 숨었어요" 가 찾을 수도 없는 열을 가리키면 안 된다. 적용되지 않는
    // 열은 숨은 게 아니라 애초에 없는 것이다.
    expect(visibleColumns(full, CH, null, false).hidden).toBe(0);
  });

  it('안 그리는 열이 옆 열의 폭을 잡아먹지 않는다', () => {
    /* `withThetaData` 를 두 번째 패스로 두면 이게 깨진다: 라더는 세타 폭을 이미
     * 예약해 두고 뒤늦게 열만 끈다. 포워드·민평 탭에서 그리지도 않는 열 때문에
     * 위치 트랙이 떨어지는 상태였다. */
    const narrow = w.label + w.level + w.delta * 3 + w.range + CELL_INSET + w.rangeSub;
    expect(visibleColumns(narrow, CH, null, false).slider).toBe(true);
  });

  it('hasTheta 는 한 행만 있어도 참', () => {
    expect(hasTheta([row('3Y', null), row('5Y', THETA)])).toBe(true);
    expect(hasTheta([row('3Y', null), row('5Y', undefined)])).toBe(false);
  });
});

describe('툴팁은 표시 정밀도에서 더해진다', () => {
  it('캐리 + 롤다운 = 합계, 화면에 찍힌 그대로', () => {
    const t = thetaTitle(THETA);
    // 세 숫자를 각각 반올림하면 만원 하나가 어긋나는 날이 있다. 캐리는 차로 낸다.
    const uCash = manUnits(THETA.cash);
    const uRoll = manUnits(THETA.roll);
    const uCarry = uCash - uRoll;
    expect(uCarry + uRoll).toBe(uCash);
    expect(t).toContain('100억 기준');
    expect(t).toContain('본전');
  });

  it('세타 파일은 반올림을 소유하지 않는다', () => {
    const body = fs
      .readFileSync(path.resolve(import.meta.dirname, '../src/table/theta.ts'), 'utf8')
      // 주석을 먼저 걷는다 — 규칙을 적어둔 문장에 규칙이 걸리면 안 된다
      // (`table-contract.test.ts` 가 같은 이유로 같은 두 줄을 쓴다)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    // toFixed / Math.round 가 여기 생기면 돈이 두 문법으로 찍히기 시작한다
    expect(body).not.toMatch(/toFixed|Math\.round/);
  });
});

/* jsdom 기하 스텁 — `hover-preview.test.tsx` 와 같은 이유, 같은 방법. */
const SIZE = { offsetWidth: 1200, offsetHeight: 600 };
const originals: Record<string, PropertyDescriptor | undefined> = {};
beforeAll(() => {
  for (const [prop, value] of Object.entries(SIZE)) {
    originals[prop] = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop);
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, value });
  }
});
afterAll(() => {
  for (const [prop, desc] of Object.entries(originals)) {
    if (desc) Object.defineProperty(HTMLElement.prototype, prop, desc);
  }
});

function draw(rows: Row[]) {
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <div style={{ overflowY: 'auto', height: 600 }}>
        <InstrumentTable rows={rows} onSelect={() => undefined} />
      </div>
    </ThemeProvider>,
  );
  return container;
}

describe('셀이 그리는 것', () => {
  it('값이 있으면 돈 문법으로, 없으면 em dash — 빈 칸이 아니다', () => {
    const c = draw([row('5Y', THETA), row('4Y', null)]);
    const text = c.textContent ?? '';
    expect(text).toContain(fmtKrw(THETA.perDv01));
    // 빈 칸은 로딩으로 읽힌다. 값이 없다는 건 문자로 말해야 한다.
    expect(text).toContain('—');
  });

  it('세타 없는 표에는 헤더 라벨도 안 나온다', () => {
    const c = draw([row('4Y', null), row('6Y', null)]);
    expect(c.textContent ?? '').not.toContain('세타');
  });
});
