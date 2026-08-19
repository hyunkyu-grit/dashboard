import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { isBondKind, KIND_ORDER, kindOf } from '../src/sim/scenario';

/**
 * 시뮬레이션 포지션의 현금채권·자산스왑 [OWNER, 2026-08-14 — v1 642c5c46 포팅].
 * 백테스트의 두 탭과 같은 상품·같은 id 문법이라, 같은 문자열이 세 화면에서
 * 같은 것을 뜻한다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('id 만 보고 종류를 안다 — 백엔드 kind_of 와 같은 규칙', () => {
  it('접두사가 가장 먼저다 — CB: 에는 - 가 없어 아웃라이트로 읽힌다', () => {
    expect(kindOf('CB:KTB:3Y')).toBe('cashbond');
    expect(kindOf('ASW:KTB:1.5Y')).toBe('assetswap');
  });

  it('스왑 넷은 그대로다', () => {
    expect(kindOf('10Y')).toBe('outright');
    expect(kindOf('3Y-10Y')).toBe('spread');
    expect(kindOf('2Y-5Y-10Y')).toBe('fly');
    expect(kindOf('1Yx1Y')).toBe('forward');
  });

  it('종류 목록의 끝에 둘이 붙는다', () => {
    expect(KIND_ORDER.slice(-2)).toEqual(['cashbond', 'assetswap']);
  });
});

describe('채권은 살 수만 있다 [OWNER — "국고채는 매도는 없는거고"]', () => {
  it('isBondKind 가 그 판정이다', () => {
    expect(isBondKind('cashbond')).toBe(true);
    expect(isBondKind('assetswap')).toBe(true);
    expect(isBondKind('outright')).toBe(false);
  });

  it('화면은 채권에서 방향 칸을 안 그리고, 옮길 때 방향을 1 로 되돌린다', () => {
    const s = read('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/isBondKind\(rowKind\) \? null : \(/);
    expect(s).toMatch(/isBondKind\(k\) \? \{ direction: 1 as const \} : \{\}/);
  });

  it('백엔드도 같은 이유로 매도를 거절한다', () => {
    expect(read('backend/app/instruments.py')).toMatch(/채권은 매수만/);
  });
});

describe('채권 다리의 금리 칸은 읽기 전용이다 — 입력칸이면 조용한 거짓말', () => {
  it('bond 다리는 NumField 대신 텍스트로 선다', () => {
    const s = read('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/const bond = isBondLeg\(l\)/);
    expect(s).toMatch(/민평 수익률 — 표면금리와 할인율이 같아 진입가가 par 예요/);
  });

  it('목록이 비면 이유를 적는다 — 민평은 SQL 에만 있다', () => {
    expect(read('src/sim/SimulationPage.tsx')).toMatch(/민평 수익률을 못 읽었어요/);
  });
});
