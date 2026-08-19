// @vitest-environment jsdom
/* 결과 창의 채권 성분 행 [OWNER, 2026-08-14 — 시뮬 포지션에 현금채권·자산스왑].
 *
 * 채권이 든 북에서는 채권평가·채권캐리·조달비용이 **자기 행**으로 서고(잔차로
 * 접지 않는다), 스왑만인 북에서는 그 행이 아예 없다 — 상수 0 을 줄로 그리면
 * "조달이 0이었다" 가 아니라 "조달이라는 게 있고 마침 0이다" 로 읽히는데,
 * 둘은 다른 주장이다(v1 components.ts 의 규칙 그대로).
 *
 * 그리고 성분들은 **표시 정밀도에서 토탈로 더해진다** — 각자 만원 한 번씩
 * 반올림하고 스왑캐리가 잔차를 진다(splitKrw 의 수법).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@coinbase/cds-web';
import { defaultTheme } from '@coinbase/cds-web/themes/defaultTheme';

import { ResultsWindow } from '../src/sim/ResultsWindow';
import { DEFAULT_SCENARIO, type SimResponse } from '../src/sim/scenario';

afterEach(cleanup);

function draw(runs: { base: SimResponse }) {
  return render(
    <ThemeProvider theme={defaultTheme} activeColorScheme="light">
      <ResultsWindow runs={runs} scenario={DEFAULT_SCENARIO} asOf="2026-08-14" onClose={() => {}} />
    </ThemeProvider>,
  );
}

function response(bond: boolean): SimResponse {
  const d = bond
    ? { total: 100_017_003, swapMtm: 50_000_000, swapCarry: 0, swapRolldown: 10_000_000,
        bondMtm: 30_004_999, bondCarry: 20_012_004, fundingCost: -10_000_000 }
    : { total: 60_000_000, swapMtm: 50_000_000, swapCarry: 0, swapRolldown: 10_000_000,
        bondMtm: 0, bondCarry: 0, fundingCost: 0 };
  return {
    totalReturnDecomposition: d,
    decompositionDaily: [
      { day: 0, swapMtm: 0, swapCarry: 0, swapRolldown: 0, bondMtm: 0, bondCarry: 0, fundingCost: 0, total: 0 },
      { day: 1, swapMtm: d.swapMtm, swapCarry: 0, swapRolldown: d.swapRolldown,
        bondMtm: d.bondMtm, bondCarry: d.bondCarry, fundingCost: d.fundingCost, total: d.total },
    ],
  } as unknown as SimResponse;
}

describe('채권 성분 행', () => {
  it('채권이 든 북 — 채권평가·채권캐리·조달비용이 행으로 선다', () => {
    const { container } = draw({ base: response(true) });
    const text = container.textContent ?? '';
    expect(text).toContain('채권평가');
    expect(text).toContain('채권캐리');
    expect(text).toContain('조달비용');
    // 토탈 = manUnits(100,017,003) = 10,002만 — 성분들이 이 값으로 더해진다
    expect(text).toContain('+1억 2만원');
  });

  it('스왑만인 북 — 채권 행이 아예 없다', () => {
    const { container } = draw({ base: response(false) });
    const text = container.textContent ?? '';
    expect(text).not.toContain('채권평가');
    expect(text).not.toContain('조달비용');
  });
});
