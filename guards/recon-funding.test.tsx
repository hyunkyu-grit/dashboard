// @vitest-environment jsdom
/* 대사 스택의 조달 열 [OWNER, 2026-08-14 — "현금채권/자산스왑 백테스트에서도
 * 대사 가능하게"].
 *
 * 열의 존재는 데이터가 정한다: `funding` 필드가 있으면 꼬리 여섯(합계·평가·
 * 캐리·롤다운·조달·그날 손익), 없으면 IRS 모양 그대로 다섯이다. IRS 대사에
 * 조달 열이 서면 그 열은 영원히 — 로 서고, 읽는 사람은 "왜 비었나" 를 묻는다.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { ReconStack, type ReconStackDay } from '../src/ui/window/ReconStack';

afterEach(cleanup);

const TENORS = ['3M', '3Y'];

function day(withFunding: boolean): ReconStackDay {
  return {
    date: '2026-03-02',
    krd: { '3M': -28400, '3Y': 185827 },
    dbp: { '3M': 0.25, '3Y': 1.0 },
    est: { '3M': -7100, '3Y': -185827 },
    estTotal: 654,
    valuation: -369066,
    carry: 143836,
    rolldown: 368131,
    ...(withFunding ? { funding: -76543 } : {}),
    actual: 142901,
  };
}

describe('조달 열은 현금채권 대사에서만 선다', () => {
  it('funding 필드가 있으면 헤더에 조달이 서고, 값이 원 단위 그대로 찍힌다', () => {
    const { container } = render(<ReconStack days={[day(true)]} tenors={TENORS} />);
    expect(container.textContent).toContain('조달');
    expect(container.textContent).toContain('-76,543');
    // 하루에 한 번인 칸: 날짜 1 + 평가·캐리·롤다운·조달·그날 손익 5
    expect(container.querySelectorAll('td[rowspan="3"]')).toHaveLength(6);
  });

  it('없으면 IRS 모양 그대로 — 헤더에 조달이 없다', () => {
    const { container } = render(<ReconStack days={[day(false)]} tenors={TENORS} />);
    expect(container.textContent).not.toContain('조달');
    expect(container.querySelectorAll('td[rowspan="3"]')).toHaveLength(5);
  });
});
