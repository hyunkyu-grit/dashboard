/* 표시된 돈이 **더해진다** — 화면이 주장하는 자리에서.
 *
 * v1 패리티 레인 P0-2 (LANE-v1-parity-2026-08-20.md).
 *
 * v1 이 이 가드를 만든 이유가 `src/lib/krw.ts` 머리글에 적혀 있다: 세 항목을
 * 각자 버림으로 반올림했더니 화면이
 *
 *     평가 10억 9,132만 + 캐리 82만  vs  총손익 10억 9,215만
 *
 * 이 되어 **1만원**이 사라졌다. 실제 장부는 원 단위로 정확히 맞았다. 눈으로는
 * 못 잡고, 암산하는 사람만 잡는다 — 그리고 이 표의 존재 이유가 바로 그
 * 암산이다.
 *
 * v2 는 `manUnits`/`splitKrw`/`splitCashBondKrw` 로 그 병을 이미 막아 두었다.
 * 막아 두었다는 것과 **막혀 있음을 매번 확인한다**는 것은 다르다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { fmtKrw, fmtKrwFromMan, manUnits, splitCashBondKrw, splitKrw } from '../src/lib/krw';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('실측 3중항 — 이 병이 실제로 났던 숫자', () => {
  /* krw.ts 머리글의 장부. 원 단위로는 정확히 맞는다:
   *     1,091,329,056 + 823,973 = 1,092,153,029 */
  const VALUATION = 1_091_329_056;
  const CARRY = 823_973;
  const PNL = VALUATION + CARRY;

  it('원 단위로는 애초에 맞는다 (전제 확인)', () => {
    expect(VALUATION + CARRY).toBe(PNL);
  });

  it('만원 단위에서도 맞는다 — 9,133 + 82 = 9,215', () => {
    const u = splitKrw(PNL, VALUATION);
    expect(u.uVal).toBe(109_133);
    expect(u.uCarry).toBe(82);
    expect(u.uRoll).toBe(0);
    expect(u.uVal + u.uRoll + u.uCarry).toBe(u.uPnl);
  });

  it('그 82 는 **원 단위 캐리를 반올림한 값 그대로**다', () => {
    /* 잔차가 우연히 82 가 된 것이 아니라, 캐리가 실제로 82만원이다. */
    expect(splitKrw(PNL, VALUATION).uCarry).toBe(manUnits(CARRY));
  });

  it('버림이었다면 어긋났을 것이다 — 이 가드가 지키는 바로 그 차이', () => {
    const floored = Math.floor(VALUATION / 10_000) + Math.floor(CARRY / 10_000);
    expect(floored).toBe(109_214); // 화면의 합
    expect(manUnits(PNL)).toBe(109_215); // 헤드라인
    expect(floored).not.toBe(manUnits(PNL)); // ← 1만원의 거짓말
  });
});

describe('항등이 참인 값들을 훑어도 등식이 유지된다', () => {
  /* 결정적 스윕이다 — 난수를 쓰면 실패가 재현되지 않는다. */
  const VALS = [0, 1, 4_999, 5_000, 9_999, 12_345, 823_973, 10_000_000, 1_091_329_056];
  const SIGNS = [1, -1];

  it('3분해: 평가 + 롤다운 + 캐리 = 총손익 (만원 단위에서)', () => {
    const bad: string[] = [];
    for (const v of VALS)
      for (const r of VALS)
        for (const sv of SIGNS)
          for (const sr of SIGNS) {
            const valuation = sv * v;
            const rolldown = sr * r;
            const carry = 823_973;
            const pnl = valuation + rolldown + carry;
            const u = splitKrw(pnl, valuation, rolldown);
            if (u.uVal + u.uRoll + u.uCarry !== u.uPnl) {
              bad.push(`val=${valuation} roll=${rolldown}`);
            }
          }
    expect(bad).toEqual([]);
  });

  it('4분해(현금채권): 평가 + 롤다운 + 조달 + 캐리 = 총손익', () => {
    const bad: string[] = [];
    for (const v of VALS)
      for (const r of VALS)
        for (const f of VALS) {
          const funding = -f; // 서버가 이미 음수로 준다
          const carry = 4_696_000;
          const pnl = v + r + funding + carry;
          const u = splitCashBondKrw(pnl, v, r, funding, 0);
          if (u.uVal + u.uRoll + u.uFund + u.uCarry !== u.uPnl) {
            bad.push(`val=${v} roll=${r} fund=${funding}`);
          }
        }
    expect(bad).toEqual([]);
  });

  it('개시는 평가에 접힌다 — 접힌 뒤에도 등식이 유지된다', () => {
    const u = splitKrw(1_092_153_029, 1_091_000_000, 0, 329_056);
    expect(u.uVal).toBe(manUnits(1_091_000_000 + 329_056));
    expect(u.uVal + u.uRoll + u.uCarry).toBe(u.uPnl);
  });
});

describe('반올림이지 버림이 아니다', () => {
  it('경계에서 올라간다', () => {
    expect(manUnits(5_000)).toBe(1);
    expect(manUnits(4_999)).toBe(0);
    expect(manUnits(14_999)).toBe(1);
    expect(manUnits(15_000)).toBe(2);
  });

  it('음수도 크기 기준으로 반올림한다 — 0 쪽으로 버리지 않는다', () => {
    expect(manUnits(-5_000)).toBe(-1);
    expect(manUnits(-4_999)).toBe(-0);
    expect(Math.abs(manUnits(-14_999))).toBe(1);
  });
});

describe('페이어와 그 미러 리시버는 미러 숫자를 찍는다', () => {
  const VALS = [1, 4_999, 5_000, 823_973, 1_091_329_056, 9_999];

  it('manUnits 가 부호에 대칭이다', () => {
    for (const v of VALS) expect(manUnits(-v)).toBe(-manUnits(v));
  });

  it('찍힌 문자열이 부호만 다르다', () => {
    for (const v of VALS) {
      const plus = fmtKrw(v);
      const minus = fmtKrw(-v);
      expect(minus).toBe(plus.replace(/^\+/, '−'));
    }
  });

  it('마이너스는 U+2212 다 — 하이픈이 아니다', () => {
    /* 한 행에 두 종류의 마이너스가 섞이면 눈에 띈다. */
    expect(fmtKrw(-5_000).charCodeAt(0)).toBe(0x2212);
    expect(fmtKrwFromMan(-1).charCodeAt(0)).toBe(0x2212);
  });
});

describe('만원 이상에서 fmtKrw 와 단위 쌍둥이는 한 문법이다', () => {
  const VALS = [10_000, 12_345, 823_973, 100_000_000, 1_091_329_056, -1_092_153_029];

  it('같은 값을 같은 문자열로 찍는다', () => {
    for (const v of VALS) expect(fmtKrw(v)).toBe(fmtKrwFromMan(manUnits(v)));
  });

  it('만원 미만에서만 원 단위로 내려간다', () => {
    expect(fmtKrw(9_999)).toMatch(/원$/);
    expect(fmtKrw(9_999)).not.toMatch(/만원$/);
    expect(fmtKrw(10_000)).toMatch(/만원$/);
  });
});

describe('행과 합계는 단위를 찍는다 — 독립 fmtKrw 호출이 아니다', () => {
  /* 수법이 옳아도 **쓰는 쪽**이 각 칸에 `fmtKrw(원값)` 을 부르면 병이 돌아온다.
   * 소스를 훑어 성분 칸이 단위 쌍둥이를 지나는지 본다. */

  it('백테스트의 성분 칸은 splitKrw 의 단위를 찍는다', () => {
    const src = read('src/backtest/BacktestWindow.tsx');
    expect(src).toMatch(/splitKrw\(/);
    expect(src).toMatch(/fmtKrwFromMan\(/);
  });

  it('현금채권의 네 칸은 splitCashBondKrw 의 단위를 찍는다', () => {
    /* 창이 하나가 된 뒤(2026-08-21) 이 규칙도 같은 파일에 산다 — 채권 줄이
     * 섞인 북은 조달 칸이 하나 더 서고, 넷이 가로로 더해져야 한다. */
    const src = read('src/backtest/BacktestWindow.tsx');
    expect(src).toMatch(/splitCashBondKrw\(/);
    /* 줄마다 넷을 찍는 자리 — 평가·캐리·롤다운·조달이 모두 단위를 지난다. */
    const inline = src.match(/평가 \{fmtKrwFromMan[\s\S]{0,260}?조달 \{fmtKrwFromMan/);
    expect(inline, '줄의 4분해가 단위 쌍둥이를 지나지 않는다').toBeTruthy();
  });

  it('성분 칸에 원값 fmtKrw 가 직접 쓰이지 않는다', () => {
    /* `fmtKrw` 자체는 금지가 아니다 — 헤드라인·축 라벨·크기(노셔널)에 쓴다.
     * 금지는 **분해된 성분**에 쓰는 것이다. 성분 이름 바로 뒤에 오는 호출만 본다. */
    const offenders: string[] = [];
    for (const f of ['src/backtest/BacktestWindow.tsx', 'src/sim/ResultsWindow.tsx']) {
      const src = read(f);
      for (const m of src.matchAll(/(평가|캐리|롤다운|조달)\s*\{fmtKrw\(/g)) {
        offenders.push(`${f}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('버림으로 바꾼 분해는 등식을 깬다', () => {
    const floorUnits = (v: number) => Math.sign(v) * Math.floor(Math.abs(v) / 10_000);
    const valuation = 1_091_329_056;
    const carry = 823_973;
    const pnl = valuation + carry;
    expect(floorUnits(valuation) + floorUnits(carry)).not.toBe(floorUnits(pnl));
    // 그리고 진짜 구현은 안 깨진다.
    const u = splitKrw(pnl, valuation);
    expect(u.uVal + u.uRoll + u.uCarry).toBe(u.uPnl);
  });

  it('캐리를 독립 반올림하면 어긋나는 값이 실제로 존재한다', () => {
    /* 잔차로 내는 이유 자체의 증명. */
    const valuation = 5_000;
    const carry = 5_000;
    const pnl = valuation + carry;
    expect(manUnits(valuation) + manUnits(carry)).toBe(2);
    expect(manUnits(pnl)).toBe(1); // ← 독립 반올림이면 1 vs 2
    const u = splitKrw(pnl, valuation);
    expect(u.uVal + u.uRoll + u.uCarry).toBe(u.uPnl); // 잔차 방식은 맞는다
  });
});
