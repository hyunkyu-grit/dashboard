import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { pnlAtDates } from '../src/backtest/LinkedCharts';

/**
 * 차트 한 쌍 [v1 OWNER, 2026-08-04 — "완전히 수직적으로 얼라인"] — 정렬은
 * 조정이 아니라 **구성**이라는 사실의 핀. 두 차트가 같은 날짜 배열·같은 inset
 * 을 받으면 한 날짜의 x 가 위아래서 같고, 그 성질이 깨지는 유일한 길은 소스가
 * 두 벌의 도메인을 만드는 것이다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('누적 손익의 전진 워크 — 찾기이지 계산이 아니다 (§16)', () => {
  const published = [
    { t: '2026-01-05', pnl: 100 },
    { t: '2026-01-12', pnl: 250 },
    { t: '2026-01-19', pnl: -50 },
  ];

  it('각 날짜는 그 이전(포함) 가장 최근 발행점의 누적을 받는다', () => {
    expect(
      pnlAtDates(['2026-01-05', '2026-01-07', '2026-01-12', '2026-01-15', '2026-01-19'], published),
    ).toEqual([100, 100, 250, 250, -50]);
  });

  it('발행점보다 앞선 날짜는 0 — 진입 전에는 아무 일도 없다', () => {
    expect(pnlAtDates(['2026-01-02', '2026-01-05'], published)).toEqual([0, 100]);
  });

  it('발행점 사이 값을 보간하지 않는다 — 서버가 준 숫자만 나간다', () => {
    const vals = pnlAtDates(['2026-01-08'], published);
    expect(published.map((p) => p.pnl)).toContain(vals[0]);
  });
});

describe('정렬은 구성이다 (소스 핀)', () => {
  const src = read('src/backtest/LinkedCharts.tsx');

  it('두 차트가 **같은 dates 배열**을 x 도메인으로 받는다', () => {
    expect(src.match(/xAxis=\{\{ data: dates \}\}/g)).toHaveLength(2);
  });

  it('두 차트가 같은 INSET 을 쓴다', () => {
    expect(src.match(/inset=\{INSET\}/g)).toHaveLength(2);
  });

  it('십자선은 반대쪽 차트에 선다 — 짚는 쪽은 CDS 스크러버가 이미 세로선이다', () => {
    expect(src).toMatch(/hover\?\.src === 'bottom' \? <ReferenceLine dataX=\{hover\.i\}/);
    expect(src).toMatch(/hover\?\.src === 'top' \? <ReferenceLine dataX=\{hover\.i\}/);
  });

  it('0선은 항상 프레임 안 — 승패의 경계 (ReferenceLine dataY=0)', () => {
    expect(src).toMatch(/<ReferenceLine dataY=\{0\}/);
  });

  it('창이 하나다 — 껍데기가 두 벌이면 정렬 규칙도 두 벌이 된다', () => {
    /* 종전에는 IRS 창과 현금채권 창이 같은 컴포넌트를 쓰는지를 봤다. 두 창이
     * 한 창이 된 지금(2026-08-21) 그 질문의 답은 구조가 진다 — 확인할 것은
     * 그 창이 이 컴포넌트를 쓰는지와, **두 번째 창이 생기지 않았는지**다. */
    expect(read('src/backtest/BacktestWindow.tsx')).toMatch(/<LinkedCharts/);
    expect(fs.existsSync(path.join(__dirname, '..', 'src/cashbond/CashBondWindow.tsx'))).toBe(
      false,
    );
  });
});
