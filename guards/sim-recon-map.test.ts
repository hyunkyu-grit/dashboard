import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { hasBondRows, simDays } from '../src/sim/ResultsWindow';
import type { SimReconRow } from '../src/sim/scenario';

/**
 * 시뮬레이션 대사표의 사상 [2026-08-21].
 *
 * 이 표는 오래 **스왑만** 셌다 — 이름이 `irsDailyReconciliation` 이었고 실제로도
 * IRS 만 받았다. 시뮬은 2026-08-14 부터 채권을 섞을 수 있었으므로, 혼합 북에서
 * 표의 합이 헤드라인과 조용히 어긋났다(대표 요청 실측 2억 1,826만원).
 *
 * 백테스트 쪽(`guards/backtest-recon-map`)과 **같은 두 질문**을 여기서도 본다:
 * 조달 칸의 세 상태가 구별되는가, 그리고 그 판단이 가드가 닿는 자리에 있는가.
 */

const row = (over: Partial<SimReconRow> = {}): SimReconRow => ({
  date: '2026-07-16',
  day: 1,
  pvbp: { '3Y': 100 },
  dailyDbp: { '3Y': 0.5 },
  pnl: { '3Y': -50 },
  totalEstPnl: -50,
  totalActual: -60,
  valuationPnl: -40,
  carryPnl: -10,
  rolldownPnl: -10,
  ...over,
});

describe('조달 칸 — 전선이 null 을 실어 와도 «없음» 을 읽어낸다', () => {
  /* 시뮬 응답은 고정 Pydantic 모델을 지나므로 스왑만 있는 북에서도 `funding: null`
   * 이 **전 행에** 실려 온다. 그래서 판정이 «필드가 있나» 일 수 없다 — 백테스트는
   * 필드를 아예 안 싣지만 여기는 못 그런다. 두 화면이 한 규칙으로 옳으려면
   * «숫자가 하나라도 있나» 여야 한다. */
  it('전 행이 null 이면 채권 줄이 없는 것이다', () => {
    expect(hasBondRows([row({ funding: null }), row({ funding: null })])).toBe(false);
  });

  it('숫자가 하나라도 있으면 채권 줄이 있는 것이다', () => {
    expect(hasBondRows([row({ funding: null }), row({ funding: -1234 })])).toBe(true);
  });

  it('0 도 숫자다 — 조달이 0원인 날과 조달이 없는 북은 다른 말이다', () => {
    expect(hasBondRows([row({ funding: 0 })])).toBe(true);
  });

  it('필드가 아예 없어도(구 캐시 응답) 없는 것으로 읽는다', () => {
    expect(hasBondRows([row()])).toBe(false);
  });
});

describe('어댑터는 이름만 바꾼다 — 두 번째 정의를 만들지 않는다', () => {
  it('조달은 그대로 넘어간다 — `?? 0` 으로 채우지 않는다', () => {
    expect(simDays([row({ funding: -777 })])[0].funding).toBe(-777);
    expect(simDays([row({ funding: null })])[0].funding).toBeNull();
  });

  it('3분해와 그날 손익은 서버 값 그대로다', () => {
    const [d] = simDays([row()]);
    expect([d.valuation, d.carry, d.rolldown, d.actual]).toEqual([-40, -10, -10, -60]);
  });

  it('구 캐시 응답의 빠진 3분해는 0 이 아니라 null 이다 — 공란 정책', () => {
    const [d] = simDays([row({ carryPnl: undefined, rolldownPnl: undefined })]);
    expect(d.carry).toBeNull();
    expect(d.rolldown).toBeNull();
  });

  it('이월 앵커는 무슨 날인지 적는다', () => {
    expect(simDays([row({ carryover: true })])[0].title).toContain('이월 리스크');
  });

  it('산술이 없다 — 서버가 낸 값을 옮기기만 한다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/sim/ResultsWindow.tsx'),
      'utf8',
    );
    const body = src.slice(src.indexOf('export function simDays'), src.indexOf('export function simDays') + 900);
    expect(body).not.toMatch(/[+*/-]\s*r\./);
  });
});

describe('격자가 무엇의 것인지 표가 말한다', () => {
  /* 손익 줄은 북 전체(채권 포함)를 세지만 KRD·Δbp 격자는 스왑의 것이다 — 시뮬의
   * 채권은 테너별 감도를 매일 재계산하지 않는다. 지어내지 않고 적는다. */
  it('채권 줄이 있을 때만 각주가 선다', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/sim/ResultsWindow.tsx'),
      'utf8',
    );
    expect(src).toMatch(/hasBondRow\s*\n?\s*\?\s*'격자\(KRD·Δbp\)는 스왑 줄의 것이에요/);
    expect(src).toMatch(/const hasBondRow = hasBondRows\(recon\)/);
  });
});
