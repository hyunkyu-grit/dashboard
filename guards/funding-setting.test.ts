// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FUNDING_DEFAULT, SPREAD_MAX, SPREAD_MIN } from '../src/state/funding';

/**
 * 조달 설정 — 값의 범위와 기본값, 그리고 **실패 상태를 그대로 보여주는지**.
 *
 * 기본값이 call 인 것은 취향이 아니라 검증 결과다: SQL `infomax.기준금리` 가
 * 2026-03-21 에 멈춰 base 는 신선도 게이트 뒤의 실패 상태다(백엔드
 * `app/funding.py` V2 절). 기본값이 늘 422 인 화면은 제품이 아니다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('기본값과 범위 — 백엔드와 같은 값', () => {
  it('기본은 콜금리 +10bp (v1 의 base 와 다르다 — 위 주석)', () => {
    expect(FUNDING_DEFAULT).toEqual({ basis: 'call', spreadBp: 10 });
  });

  it('스프레드 범위는 서버 검증과 같다 (±500bp)', () => {
    expect(SPREAD_MIN).toBe(-500);
    expect(SPREAD_MAX).toBe(500);
    const be = read('backend/app/funding.py');
    expect(be).toMatch(/-500\.0 <= self\.spread_bp <= 500\.0/);
  });

  it('백엔드 기본 기준도 call 이다 — 두 기본이 갈리면 첫 요청부터 어긋난다', () => {
    expect(read('backend/app/funding.py')).toMatch(/DEFAULT_BASIS = "call"/);
  });
});

describe('실패 상태는 폴백이 아니라 문장이다 [OWNER 2026-08-18 — SQL만]', () => {
  it('백엔드 base 에는 신선도 게이트가 있고, 멈춘 날짜와 대안을 말한다', () => {
    const be = read('backend/app/funding.py');
    expect(be).toMatch(/_require_fresh/);
    expect(be).toMatch(/콜금리로 바꾸/);
  });

  it('Setting 화면은 서버의 422 문장을 그대로 보여준다 — 바꿔 말하지 않는다', () => {
    const src = read('src/ui/SettingView.tsx');
    expect(src).toMatch(/서버가 이렇게 말해요/);
    // xlsx 폴백 같은 것이 이 화면에 없다
    expect(src).not.toMatch(/xlsx/i);
  });
});
