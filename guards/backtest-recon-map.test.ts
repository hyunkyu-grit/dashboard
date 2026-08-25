import { describe, expect, it } from 'vitest';

import { backtestDays, bondReconNote, reconNote, reconPair } from '../src/backtest/recon';
import type { BacktestRecon, BacktestReconRow } from '../src/lib/api';

/**
 * 서버 대사 → 대사 스택 사이의 **사상**을 지킨다 [2026-08-21].
 *
 * 이 자리가 한 번 조용히 틀렸다. 창을 합치면서 조달 칸을 `r.funding ?? null` 로
 * 채웠더니 스왑만 있는 북에도 열이 서서 250줄이 전부 «—» 인 조달 칸이 생겼다.
 * 컴포넌트는 멀쩡했고 틀린 것은 넘겨주는 쪽이었는데, 그때 이 함수가 창 안에
 * 있어서 컴포넌트 가드가 닿지 못했다 — **가드가 못 보는 자리에 판단을 두지
 * 않는다**가 이 파일이 있는 이유다.
 */

const row = (over: Partial<BacktestReconRow> = {}): BacktestReconRow => ({
  t: '2026-08-19',
  krd: { '3Y': 100 },
  dbp: { '3Y': 0.5 },
  est: { '3Y': -50 },
  estTotal: -50,
  actual: -60,
  valuation: -40,
  rolldown: -10,
  carry: -10,
  residual: 10,
  ...over,
});

const recon = (rows: BacktestReconRow[], over: Partial<BacktestRecon> = {}): BacktestRecon => ({
  tenors: ['3Y'],
  rows,
  truncated: false,
  ...over,
});

describe('조달 칸 — 세 가지 상태가 다 다르다', () => {
  it('스왑만 있는 북: 필드가 **없다**(그 질문이 없다)', () => {
    const [d] = backtestDays(recon([row()]));
    expect('funding' in d).toBe(false);
  });

  it('채권이 섞인 북: 값이 그대로 온다 — 서버가 이미 음수로 준다', () => {
    const [d] = backtestDays(recon([row({ funding: -35_034_000 })]));
    expect(d.funding).toBe(-35_034_000);
  });

  it('이월 앵커: null 이다("아직 오지 않은 날") — 공란 정책', () => {
    const [d] = backtestDays(recon([row({ funding: null, carryover: true })]));
    expect(d.funding).toBeNull();
  });
});

describe('개시는 평가에 접힌다 [OWNER, 2026-08-14]', () => {
  it('평가 + 개시가 한 칸으로 간다', () => {
    const [d] = backtestDays(recon([row({ valuation: -40, startup: -7 })]));
    expect(d.valuation).toBe(-47);
  });

  it('공란인 행은 접지 않는다 — null 은 0 이 아니다', () => {
    const [d] = backtestDays(recon([row({ valuation: null, startup: null, carryover: true })]));
    expect(d.valuation).toBeNull();
  });
});

describe('이월 앵커는 자기 이름을 툴팁에 진다', () => {
  it('본문 행의 제목은 날짜뿐', () => {
    const [d] = backtestDays(recon([row()]));
    expect(d.title).toBe('2026-08-19');
  });

  it('앵커 행은 무슨 날인지 적는다', () => {
    const [d] = backtestDays(recon([row({ carryover: true })]));
    expect(d.title).toContain('들고 가는 이월 리스크');
  });
});

describe('표 아래 각주 — 데이터 사실만, 없으면 각주도 없다', () => {
  it('아무 일 없으면 각주를 안 세운다', () => {
    expect(reconNote(recon([row()]))).toBeUndefined();
  });

  it('잘린 창을 말한다', () => {
    expect(reconNote(recon([row()], { truncated: true }))).toContain('최근 영업일만');
  });

  it('채권 표는 캐리 라벨의 뜻을 **언제나** 말한다 [OWNER, 2026-08-25 — 표기 보강]', () => {
    const note = bondReconNote(recon([row({ funding: -100 })]));
    expect(note).toContain('조달 차감 전');
  });

  it('채권 표가 잘렸으면 둘 다 — 한 줄에 이어 붙인다', () => {
    const note = bondReconNote(recon([row({ funding: -100 })], { truncated: true }));
    expect(note).toContain('최근 영업일만');
    expect(note).toContain('조달 차감 전');
  });
});

describe('서버 대사 정규화 — 표 셋 [OWNER, 2026-08-25 — 엔진 단위 분리 · 선물 합류]', () => {
  it('라이브 서버의 {swap, bond, futures} 는 그대로 통과한다', () => {
    const swap = recon([row()]);
    const bond = recon([row({ funding: -100 })]);
    const futures = recon([row()]);
    expect(reconPair({ swap, bond, futures })).toEqual({ swap, bond, futures });
    // 선물 키가 없는 응답(선물 합류 전 구 서버·구 복원본)은 futures: null.
    expect(reconPair({ swap, bond: null })).toEqual({ swap, bond: null, futures: null });
  });

  it('없으면 셋 다 null — 표가 안 선다', () => {
    expect(reconPair(undefined)).toEqual({ swap: null, bond: null, futures: null });
  });

  it('구 복원본(순수 북 한 표)은 조달 숫자로 자리를 찾는다', () => {
    const swapLegacy = recon([row()]);
    expect(reconPair(swapLegacy)).toEqual({ swap: swapLegacy, bond: null, futures: null });
    const bondLegacy = recon([row({ funding: -100 })]);
    expect(reconPair(bondLegacy)).toEqual({ swap: null, bond: bondLegacy, futures: null });
  });

  it('구 병합판(접두사 열쇠)은 버린다 — 두 표로 되돌릴 수 없다', () => {
    const merged = recon([row()], { tenors: ['S:3Y', 'B:3Y'] });
    expect(reconPair(merged)).toEqual({ swap: null, bond: null, futures: null });
  });
});
