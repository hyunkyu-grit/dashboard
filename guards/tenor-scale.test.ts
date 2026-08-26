import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { TENOR_SCALE, monthsToX } from '../src/chart/tenorScale';
import { tenorMonths } from '../src/chart/tenor';

/**
 * 커브의 가로축 [OWNER 2026-08-26 — 「√만기 축 — 짧은 쪽에 자리」].
 *
 * 라이브러리의 커브 축은 **선형 월수**다. 그 축에서 원화 데스크가 실제로 보는
 * 3M~1Y 가 왼쪽 끝에 뭉쳐서(실측: 10Y 커브에서 세 노드가 1Y 앞 5% 폭 안), 오너가
 * √만기를 골랐다. 그래서 축을 직접 정의했고, 여기서 재는 것은 **그 선택이 살아
 * 있는가** 다 — 캔버스라 화면으로는 안 보이고, 조용히 되돌아가기 쉽다.
 */

const SRC = path.resolve(import.meta.dirname, '../src/chart');
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8');
const codeOf = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DESK = ['3M', '6M', '9M', '1Y', '18M', '2Y', '3Y', '5Y', '7Y', '10Y'];

describe('① 자리는 √만기다', () => {
  it('만기 순서가 곧 자리 순서다 — 뒤집히면 커브가 꼬인다', () => {
    const xs = DESK.map((t) => monthsToX(tenorMonths(t)!));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it('같은 자리로 겹치는 만기가 없다', () => {
    const xs = DESK.map((t) => monthsToX(tenorMonths(t)!));
    expect(new Set(xs).size).toBe(xs.length);
  });

  it('짧은 쪽이 선형 축보다 **넓게** 선다 — 이 축의 존재 이유', () => {
    const m = (t: string) => tenorMonths(t)!;
    const span = (a: string, b: string) => monthsToX(m(b)) - monthsToX(m(a));
    const full = span('3M', '10Y');

    /* 3M~1Y 가 축에서 차지하는 몫. 선형 월수 축에서는 (12-3)/(120-3) = 7.7% 다. */
    const shortEnd = span('3M', '1Y') / full;
    const linear = (m('1Y') - m('3M')) / (m('10Y') - m('3M'));

    expect(linear).toBeCloseTo(0.077, 2);
    expect(shortEnd).toBeGreaterThan(linear * 2);
    /* 그러면서 긴 쪽을 삼키지도 않는다 — 절반을 넘기면 그건 다른 화면이다. */
    expect(shortEnd).toBeLessThan(0.5);
  });

  it('정수 자리다 — 라이브러리의 가로축은 정수 칸이다', () => {
    for (const t of DESK) expect(Number.isInteger(monthsToX(tenorMonths(t)!))).toBe(true);
  });

  it('배율이 바뀌면 여기서 걸린다 — 자리는 화면의 약속이다', () => {
    expect(TENOR_SCALE).toBe(20);
    expect(monthsToX(3)).toBe(35);
    expect(monthsToX(120)).toBe(219);
  });
});

describe('② 눈금과 글자는 **실제 만기**가 정한다', () => {
  const scale = read('tenorScale.ts');

  it('가중치 사다리가 월수로 매겨진다 — √ 값의 배수는 아무 뜻도 없다', () => {
    const code = codeOf(scale);
    expect(code).toMatch(/function weightOf\(months: number\)/);
    for (const step of [120, 60, 36, 12, 6, 3]) {
      expect(code).toMatch(new RegExp(`months % ${step} === 0`));
    }
  });

  it('우리 만기가 아닌 자리는 가중치 0 — 사이를 메우는 빈 점에 글자가 안 선다', () => {
    expect(codeOf(scale)).toMatch(/months == null\s*\?\s*0/);
  });

  it('글자는 노드에서만 나온다 — 없으면 빈 문자열이다', () => {
    expect(codeOf(scale)).toMatch(/return months == null \? '' : monthsLabel\(months\)/);
  });
});

describe('③ 사이를 빈 점으로 메운다 — 그게 곧 자리다', () => {
  const curve = codeOf(read('CurveChart.tsx'));

  it('노드만 넣지 않는다 — 노드만 넣으면 **등간격**이 되어 √축이 무효가 된다', () => {
    /* 라이브러리의 가로축은 인덱스 간격이다. 빈 점이 자리를 만든다. */
    expect(curve).toMatch(/for \(let x = lo; x <= hi; x\+\+\)/);
    expect(curve).toMatch(/data\.push\(v == null \? \{ time: x \} : \{ time: x, value: v \}\)/);
  });

  it('축에 어느 자리가 진짜 만기인지 알려 준다 — `setData` 전에', () => {
    const setNodes = curve.indexOf('scale.setNodes');
    const setData = curve.indexOf('s.setData');
    expect(setNodes).toBeGreaterThan(-1);
    expect(setData).toBeGreaterThan(setNodes);
  });

  it('양 끝에 여백이 있다 — 첫·끝 노드가 모서리에 붙어 잘리지 않게', () => {
    expect(curve).toMatch(/const lo = \(order\[0\]\?\.x \?\? 0\) - pad/);
  });
});

describe('④ 리드아웃은 가장 가까운 노드로 붙는다', () => {
  const curve = codeOf(read('CurveChart.tsx'));

  it('정확히 일치를 찾지 않는다 — 커서는 거의 항상 빈 자리에 선다', () => {
    /* 실측 2026-08-26: 일치로 뒀더니 크로스헤어는 뜨는데 카드가 안 떴다.
       CDS `Scrubber` 는 늘 가장 가까운 노드로 붙었고 이 화면은 그 위에 선다. */
    expect(curve).toMatch(/const nearest = useMemo/);
    expect(curve).toMatch(/Math\.abs\(xs\[k\] - x\) < Math\.abs\(xs\[best\] - x\)/);
    expect(curve).toMatch(/notify\(t == null \? null : nearest\(t\)\)/);
  });
});
