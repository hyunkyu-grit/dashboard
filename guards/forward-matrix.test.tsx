import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { ForwardsPayload } from '@/lib/api';
import {
  MATRIX_FLOOR,
  MATRIX_FULL,
  MATRIX_PCT_HI,
  MATRIX_PCT_LO,
  matrixTint,
} from '@/table/tint';
import { ForwardMatrix, KeyForwardBlock } from '@/ui/ForwardMatrix';

/**
 * 표로 보기 — 격자의 뜻은 **틴트**이고, 틴트가 조용히 틀리면 아무 오류도 안 난다.
 *
 * 두 가지를 못박는다. ① 눈금이 자기 과거 백분위이고 문턱 아래는 **아예 안
 * 칠한다** — 작은 움직임을 옅게 칠하면 눈이 잡음을 신호로 읽는 법을 배운다.
 * ② 방향이 색과 일치한다 — 상승이 파랑으로 나오면 그림 전체가 거짓말이 된다.
 */

const ROOT = path.resolve(import.meta.dirname, '..');

const PAYLOAD: ForwardsPayload = {
  asof: '2026-08-14',
  basisDates: { d1: '2026-08-13', mtd: '2026-07-31', ytd: '2025-12-31' },
  startPoints: [
    { label: 'ON', t: 0, date: '2026-08-14' },
    { label: '3M', t: 0.25, date: '2026-11-14' },
  ],
  tenors: ['1YF', '3YF'],
  grid: {
    '1YF': [
      {
        start: 'ON', live: true,
        values: { now: 2.47, d1: 2.4, mtd: 2.3, ytd: 2.1 },
        deltas: { d1: 7, mtd: 17, ytd: 37 },
        sortKey: [0], keyForward: false, movePct: 99,
        range1y: { min: 2.1, max: 2.9, avg: 2.5 },
      },
      {
        start: '3M', live: false,
        values: { now: 2.51, d1: 2.55, mtd: 2.6, ytd: 2.2 },
        deltas: { d1: -4, mtd: -9, ytd: 31 },
        sortKey: [1], keyForward: false, movePct: 50,
        range1y: { min: 2.2, max: 3.0, avg: 2.6 },
      },
    ],
    '3YF': [
      {
        start: 'ON', live: false,
        values: { now: 3.11, d1: 3.1, mtd: 3.0, ytd: 2.8 },
        deltas: { d1: 1, mtd: 11, ytd: 31 },
        sortKey: [2], keyForward: false, movePct: null,
        range1y: { min: 2.8, max: 3.4, avg: 3.1 },
      },
      {
        start: '3M', live: true,
        values: { now: 3.2, d1: 3.25, mtd: 3.1, ytd: 2.9 },
        deltas: { d1: -5, mtd: 10, ytd: 30 },
        sortKey: [3], keyForward: false, movePct: 85,
        range1y: { min: 2.9, max: 3.5, avg: 3.2 },
      },
    ],
  },
  keyForwards: [
    {
      label: '1Yx1Y',
      values: { now: 3.0, d1: 2.95, mtd: 2.9, ytd: 2.7 },
      deltas: { d1: 5, mtd: 10, ytd: 30 },
      range1y: { min: 2.5, max: 3.5, avg: 3.0, pct: 95 },
    },
    {
      label: '5Yx5Y',
      values: { now: 3.4, d1: 3.4, mtd: 3.3, ytd: 3.1 },
      deltas: { d1: 0, mtd: 10, ytd: 30 },
      range1y: { min: null, max: null, avg: null, pct: null },
    },
  ],
};

function draw(node: React.ReactNode) {
  const { container } = render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      {node}
    </ThemeProvider>,
  );
  return container;
}

describe('포워드 매트릭스', () => {
  it('문턱 아래는 색이 없다', () => {
    expect(matrixTint(MATRIX_PCT_LO - 1, true)).toBeUndefined();
    expect(matrixTint(null, true)).toBeUndefined();
  });

  it('눈금의 양 끝이 바닥과 천장이다', () => {
    const lo = matrixTint(MATRIX_PCT_LO, true)!.backgroundColor as string;
    const hi = matrixTint(MATRIX_PCT_HI, true)!.backgroundColor as string;
    expect(lo).toContain(`${(MATRIX_FLOOR * 100).toFixed(1)}%`);
    expect(hi).toContain(`${(MATRIX_FULL * 100).toFixed(1)}%`);
    // 천장을 넘겨도 더 진해지지 않는다.
    expect(matrixTint(100, true)!.backgroundColor).toBe(hi);
  });

  it('방향이 색과 맞는다', () => {
    expect(matrixTint(99, true)!.backgroundColor).toContain('--sr-up');
    expect(matrixTint(99, false)!.backgroundColor).toContain('--sr-down');
  });

  it('ON 행은 현물이라고 적는다', () => {
    // 오버나이트 시작은 곧 오늘이다 — 포워드인 척하면 그 행을 잘못 읽는다.
    const c = draw(<ForwardMatrix payload={PAYLOAD} />);
    expect(c.textContent).toContain('현물');
  });

  it('고시 교차점만 테두리를 갖는다', () => {
    const c = draw(<ForwardMatrix payload={PAYLOAD} />);
    const live = c.querySelectorAll('.sr-matrix-live').length;
    expect(live).toBe(2); // 픽스처의 live=true 두 칸
  });

  it('격자가 시작 × 만기 전부를 그린다', () => {
    const c = draw(<ForwardMatrix payload={PAYLOAD} />);
    expect(c.querySelectorAll('tbody tr').length).toBe(PAYLOAD.startPoints.length);
    expect(c.querySelectorAll('.sr-matrix-td').length).toBe(
      PAYLOAD.startPoints.length * PAYLOAD.tenors.length,
    );
  });

  it('범례가 칸과 같은 눈금을 쓴다', () => {
    const c = draw(<ForwardMatrix payload={PAYLOAD} />);
    const swatches = [...c.querySelectorAll('.sr-tintlegend-sw')];
    const strongest = swatches[0].getAttribute('style') ?? '';
    // 견본의 가장 진한 끝 = 칸의 천장. 두 값이 갈리면 범례가 거짓말을 한다.
    expect(strongest).toContain(`${Math.round(MATRIX_FULL * 100)}%`);
    // 칠하지 않은 가운데가 있어야 "문턱 아래는 색 없음" 이 보인다.
    expect(c.querySelectorAll('.sr-tintlegend-none').length).toBe(1);
  });

  it('게이지는 범위가 있을 때만 선다', () => {
    const c = draw(<KeyForwardBlock payload={PAYLOAD} />);
    // 픽스처 둘 중 하나는 range 가 전부 null — 없는 자리를 지어내지 않는다.
    expect(c.querySelectorAll('.sr-gauge').length).toBe(1);
    expect(c.querySelectorAll('.sr-gauge-extreme').length).toBe(1); // pct 95
  });

  it('창으로 열린다 — 목록을 밀어내지 않는다', () => {
    const page = fs.readFileSync(path.join(ROOT, 'src', 'app', 'page.tsx'), 'utf8');
    expect(page).toContain('windowKey="matrix"');
    expect(page).toContain('표로 보기');
  });
});
