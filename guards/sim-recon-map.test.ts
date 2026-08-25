import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { bondDays, bondReconNote, simDays } from '../src/sim/ResultsWindow';
import type { SimBondRecon, SimBondReconRow, SimReconRow } from '../src/sim/scenario';

/**
 * 시뮬레이션 대사의 사상 — 표 둘 [OWNER, 2026-08-25 — 엔진 단위 분리].
 *
 * 이 표는 오래 **스왑만** 셌고(혼합 북에서 표합이 헤드라인과 조용히 어긋났다,
 * 실측 2억 1,826만원), 2026-08-21 판은 채권 성분을 스왑 열에 합산해 그 합을
 * 맞췄다. 엔진 단위 분리로 스왑 표는 v1 계약(조달 필드 없음)으로 돌아갔고
 * 채권 대사는 자기 표(`bondDailyReconciliation`)가 됐다 — 이 파일은 그 두
 * 사상이 이름만 바꾸고 산술을 만들지 않는지를 지킨다(백테스트 쪽
 * `guards/backtest-recon-map` 과 같은 정신).
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

const bondRow = (over: Partial<SimBondReconRow> = {}): SimBondReconRow => ({
  date: '2026-07-16',
  day: 1,
  pvbp: { '국채:3Y': 200 },
  dailyDbp: { '국채:3Y': 0.5 },
  pnl: { '국채:3Y': -100 },
  totalEstPnl: -100,
  valuation: -90,
  carry: 30,
  rolldown: 12,
  funding: -20,
  actual: -68,
  residual: 10,
  ...over,
});

const bondRecon = (
  rows: SimBondReconRow[],
  basis: SimBondRecon['rollBasis'] = { applied: true, missing: [] },
): SimBondRecon => ({
  groups: [{ label: '국채', cols: [{ key: '국채:3Y', label: '3Y' }] }],
  tenors: ['국채:3Y'],
  rows,
  rollBasis: basis,
});

describe('스왑 표 — v1 계약으로 복귀: 조달이라는 질문이 없다', () => {
  it('조달 칸을 넘기지 않는다 — 값이 있어도(구 캐시 응답) 버린다', () => {
    const [d] = simDays([row({ funding: -777 })]);
    expect('funding' in d).toBe(false);
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
});

describe('채권 표 — 조달은 이 표의 것이고, 이름만 바꿔 넘긴다', () => {
  it('네 성분과 조달이 서버 값 그대로다 — 부호를 다시 주지 않는다', () => {
    const [d] = bondDays([bondRow()]);
    expect([d.valuation, d.carry, d.rolldown, d.funding, d.actual]).toEqual([
      -90, 30, 12, -20, -68,
    ]);
  });

  it('이월 앵커는 무슨 날인지 적는다', () => {
    expect(bondDays([bondRow({ carryover: true })])[0].title).toContain('이월 리스크');
  });
});

describe('산술이 없다 — 서버가 낸 값을 옮기기만 한다', () => {
  it.each(['export function simDays', 'export function bondDays'])('%s', (anchor) => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src/sim/ResultsWindow.tsx'),
      'utf8',
    );
    const body = src.slice(src.indexOf(anchor), src.indexOf(anchor) + 900);
    expect(body).not.toMatch(/[+*/-]\s*r\./);
  });
});

describe('채권 표 각주 — 캐리 라벨의 뜻과 롤 레인의 프로버넌스', () => {
  it('캐리가 조달 차감 전임을 **언제나** 말한다 [OWNER, 2026-08-25 — 표기 보강]', () => {
    expect(bondReconNote(bondRecon([bondRow()]))).toContain('조달 차감 전');
  });

  it('커브 공급자가 없던 실행은 롤 0 의 이유를 말한다 — 조용한 0 금지', () => {
    const note = bondReconNote(bondRecon([bondRow()], { applied: false, missing: ['국채'] }));
    expect(note).toContain('롤다운이 0');
    expect(note).toContain('조달 차감 전');
  });

  it('일부 섹터만 커브가 없으면 그 섹터를 이름으로 부른다', () => {
    const note = bondReconNote(bondRecon([bondRow()], { applied: true, missing: ['회사채'] }));
    expect(note).toContain('회사채');
  });
});
