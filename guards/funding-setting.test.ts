// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FUNDING_DEFAULT, SPREAD_MAX, SPREAD_MIN } from '../src/state/funding';

/**
 * 조달 설정 — 값의 범위와 기본값, 그리고 **실패 상태를 그대로 보여주는지**.
 *
 * 기본은 **기준금리 +10bp** 다 [OWNER, 2026-08-20].
 *
 * 2026-08-19 까지 이 파일은 기본이 `call` 임을 핀하고 있었고, 그 근거는
 * "SQL `infomax.기준금리` 가 2026-03-21 에 멈춰 base 가 실패 상태" 였다.
 * 그 근거가 없어져서 핀을 갈았다 — 완화가 아니라 **명제가 바뀐 것**이다:
 * 출처를 한국은행 ECOS 로 옮기면서 base 가 다시 신선해졌다(2026-08-17 까지,
 * 7/16 인상 2.50→2.75% 포함). 게이트 자체는 그대로 남아 ECOS 를 잰다.
 */

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('기본값과 범위 — 백엔드와 같은 값', () => {
  it('기본은 기준금리 +10bp [OWNER 2026-08-20] — v1 과 같은 자리', () => {
    expect(FUNDING_DEFAULT).toEqual({ basis: 'base', spreadBp: 10 });
  });

  it('스프레드 범위는 서버 검증과 같다 (±500bp)', () => {
    expect(SPREAD_MIN).toBe(-500);
    expect(SPREAD_MAX).toBe(500);
    const be = read('backend/app/funding.py');
    expect(be).toMatch(/-500\.0 <= self\.spread_bp <= 500\.0/);
  });

  it('백엔드 기본 기준도 base 다 — 두 기본이 갈리면 첫 요청부터 어긋난다', () => {
    expect(read('backend/app/funding.py')).toMatch(/DEFAULT_BASIS = "base"/);
  });

  it('base 의 출처는 ECOS 다 — 멈춰 있던 SQL 테이블이 아니다', () => {
    const be = read('backend/app/funding.py');
    expect(be).toMatch(/from \. import ecos/);
    // 옛 출처로 되돌아가면 7월 인상이 다시 사라진다.
    expect(be).not.toMatch(/FROM infomax\.기준금리/);
  });
});

describe('실패 상태는 폴백이 아니라 문장이다', () => {
  it('백엔드 base 에는 신선도 게이트가 있고, 멈춘 날짜와 대안을 말한다', () => {
    /* 출처가 ECOS 로 바뀌어도 게이트는 남는다. ECOS 는 진짜 일별 피드라서
     * "최근 영업일에 행이 없다" 가 곧 "피드가 멈췄다" 를 뜻한다. */
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
