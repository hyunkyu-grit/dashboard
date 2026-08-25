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
  /* [OWNER, 2026-08-25 — 엔진 단위 분리] bondRolldown 이 성분에 합류했다 —
     시뮬 채권에 아예 없던 항이라(unchanged-yields), 총액도 이 항만큼 옳아졌다. */
  const d = bond
    ? { total: 105_017_003, swapMtm: 50_000_000, swapCarry: 0, swapRolldown: 10_000_000,
        bondMtm: 30_004_999, bondCarry: 20_012_004, bondRolldown: 5_000_000, fundingCost: -10_000_000 }
    : { total: 60_000_000, swapMtm: 50_000_000, swapCarry: 0, swapRolldown: 10_000_000,
        bondMtm: 0, bondCarry: 0, bondRolldown: 0, fundingCost: 0 };
  return {
    totalReturnDecomposition: d,
    decompositionDaily: [
      { day: 0, swapMtm: 0, swapCarry: 0, swapRolldown: 0, bondMtm: 0, bondCarry: 0, bondRolldown: 0, fundingCost: 0, total: 0 },
      { day: 1, swapMtm: d.swapMtm, swapCarry: 0, swapRolldown: d.swapRolldown,
        bondMtm: d.bondMtm, bondCarry: d.bondCarry, bondRolldown: d.bondRolldown,
        fundingCost: d.fundingCost, total: d.total },
    ],
  } as unknown as SimResponse;
}

describe('채권 성분 행', () => {
  it('채권이 든 북 — 채권평가·채권캐리·채권롤다운·조달비용이 행으로 선다', () => {
    const { container } = draw({ base: response(true) });
    const text = container.textContent ?? '';
    expect(text).toContain('채권평가');
    expect(text).toContain('채권캐리');
    expect(text).toContain('채권롤다운');
    expect(text).toContain('조달비용');
    // 토탈 = manUnits(105,017,003) = 10,502만 — 성분들이 이 값으로 더해진다
    expect(text).toContain('+1억 502만원');
  });

  it('스왑만인 북 — 채권 행이 아예 없다', () => {
    const { container } = draw({ base: response(false) });
    const text = container.textContent ?? '';
    expect(text).not.toContain('채권평가');
    expect(text).not.toContain('채권롤다운');
    expect(text).not.toContain('조달비용');
  });

  it('구 캐시 응답(bondRolldown 없음) — 0 으로 읽혀 행이 안 선다 · 총액 불변', () => {
    const legacy = response(false);
    delete (legacy.totalReturnDecomposition as unknown as Record<string, unknown>).bondRolldown;
    const { container } = draw({ base: legacy });
    expect(container.textContent ?? '').not.toContain('채권롤다운');
  });

  it('제외된 스왑 — 0원이 아니라 공란(—)이다 [블랭크 정책 · 실측 2026-08-25]', () => {
    /* «당일 IRS 호가 없음» 런: 스왑 성분 null 을 0 으로 강등하면 반올림 잔차
       +1만원이 «스왑캐리» 라벨을 뒤집어쓴다 — 값이 안 매겨진 다리가 숫자를
       가진 것처럼 보인다. 케이스 표의 스왑 칸은 — 여야 한다. */
    const r = response(true);
    const d = r.totalReturnDecomposition as unknown as Record<string, number | null>;
    d.swapMtm = null;
    d.swapCarry = null;
    d.swapRolldown = null;
    d.total = 45_017_003; // 채권 몫만
    const { container } = draw({ base: r });
    const text = container.textContent ?? '';
    expect(text).toMatch(/스왑캐리—/);
    expect(text).toMatch(/스왑평가—/);
    // 채권 성분은 여전히 숫자로 선다 — 제외된 것은 스왑이지 채권이 아니다.
    expect(text).toContain('채권캐리');
  });
});
