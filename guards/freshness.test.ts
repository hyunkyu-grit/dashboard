/* 신선도는 **읽는 사람의 시계**가 아니라 서울의 달력으로 잰다.
 *
 * v1 패리티 레인 P2 (LANE-v1-parity-2026-08-20.md). v1 `freshness`.
 *
 * 이 화면은 원화 IRS 종가를 그린다. "오늘이 며칠인가" 는 서울에 대한 질문이지
 * 읽는 사람이 어디 앉아 있느냐에 대한 질문이 아니다. 그리고 세는 단위는
 * **완성된 종가**다 — 오늘 것은 아직 종가가 아니다(전일종가 규칙).
 *
 * 틀려도 화면은 멀쩡하다. 숫자 옆의 "최신" 표시만 하루씩 어긋날 뿐이고, 그건
 * 읽는 사람이 낡은 커브를 오늘 것으로 읽게 만드는 딱 한 가지 방법이다.
 */

import { describe, expect, it } from 'vitest';

import { freshnessFrom, marketIsoDate, type Manifest } from '../src/lib/freshness';

/** 2026-08-19(수) 이후의 영업일 사다리. 주말이 빠져 있다. */
const LADDER = [
  '2026-08-20', // 목
  '2026-08-21', // 금
  '2026-08-24', // 월 ← 주말 건너뜀
  '2026-08-25',
  '2026-08-26',
];

const manifest = (over: Partial<Manifest> = {}): Manifest =>
  ({
    asof: '2026-08-19',
    businessDaysAfter: LADDER,
    freshnessThresholds: { behind: 1, stale: 2 },
    ...over,
  }) as Manifest;

/** 그 순간에 서울이 며칠인지로 고정한다(UTC 로 준다). */
const at = (iso: string) => new Date(iso);

describe('사다리가 영업일이다 — 그냥 평일이 아니다', () => {
  it('주말을 건너뛴다', () => {
    /* 08-21(금) 다음이 08-24(월)이다. 주말이 들어 있으면 이틀치가 유령으로
     * 세어져 신선한 데이터가 stale 로 읽힌다. */
    expect(LADDER).toContain('2026-08-24');
    expect(LADDER).not.toContain('2026-08-22');
    expect(LADDER).not.toContain('2026-08-23');
  });

  it('오름차순이고 asof 보다 뒤다', () => {
    const m = manifest();
    expect(m.businessDaysAfter).toEqual([...m.businessDaysAfter!].sort());
    expect(m.businessDaysAfter![0] > m.asof).toBe(true);
  });

  it('임계값은 매니페스트가 든다 — 여기서 복제하지 않는다', () => {
    /* 두 벌이 되면 서버가 임계를 바꾸는 날 화면만 옛 규칙으로 판단한다. */
    const m = manifest({ freshnessThresholds: { behind: 3, stale: 5 } });
    expect(freshnessFrom(m, at('2026-08-24T01:00:00Z')).level).toBe('current');
  });
});

describe('전일종가 규칙 — 오늘은 아직 종가가 아니다', () => {
  it('as-of 그날은 current', () => {
    // 서울 2026-08-19
    expect(freshnessFrom(manifest(), at('2026-08-19T01:00:00Z')).ageBusinessDays).toBe(0);
    expect(freshnessFrom(manifest(), at('2026-08-19T01:00:00Z')).level).toBe('current');
  });

  it('**다음 영업일에도** current — 오늘 종가는 아직 없다', () => {
    /* 이것이 규칙의 핵심이다. `<=` 로 세면 모든 데이터가 영구히 하루 뒤처져
     * 보이고, 그러면 아무도 그 표시를 안 믿게 된다. */
    const f = freshnessFrom(manifest(), at('2026-08-20T01:00:00Z'));
    expect(f.ageBusinessDays).toBe(0);
    expect(f.level).toBe('current');
  });

  it('금요일 종가는 **주말 내내** current — 시장이 닫혀 있었다', () => {
    /* asof 가 금요일(08-21)이면 다음 영업일은 월요일(08-24)이다. 토·일에는
       놓친 종가가 없으므로 나이가 0 이다. 달력일로 세면 여기서 2 가 나오고,
       월요일 아침마다 데이터가 stale 로 보인다. */
    const friday = manifest({
      asof: '2026-08-21',
      businessDaysAfter: ['2026-08-24', '2026-08-25', '2026-08-26'],
    });
    expect(freshnessFrom(friday, at('2026-08-22T01:00:00Z')).ageBusinessDays).toBe(0);
    expect(freshnessFrom(friday, at('2026-08-23T01:00:00Z')).ageBusinessDays).toBe(0);
    expect(freshnessFrom(friday, at('2026-08-23T01:00:00Z')).level).toBe('current');
    // 그리고 월요일에도 아직 current 다(전일종가 규칙).
    expect(freshnessFrom(friday, at('2026-08-24T01:00:00Z')).level).toBe('current');
  });

  it('수요일 asof 로 토요일까지 가면 종가 둘이 빠진다 — 그건 stale 이 맞다', () => {
    /* 위 규칙이 "언제나 current" 라는 뜻이 아니다. 지나간 영업일만큼은 센다. */
    expect(freshnessFrom(manifest(), at('2026-08-22T01:00:00Z')).ageBusinessDays).toBe(2);
  });

  it('완성된 종가가 하나 빠지면 behind, 둘이면 stale', () => {
    expect(freshnessFrom(manifest(), at('2026-08-21T01:00:00Z')).level).toBe('behind');
    expect(freshnessFrom(manifest(), at('2026-08-24T01:00:00Z')).level).toBe('stale');
  });
});

describe('서울의 달력이다 — 읽는 사람의 달력이 아니다', () => {
  it('런던의 밤 10시는 이미 서울의 다음 날이다', () => {
    /* 2026-08-19 22:00 런던 = 2026-08-20 06:00 서울. */
    expect(marketIsoDate(at('2026-08-19T21:00:00Z'))).toBe('2026-08-20');
  });

  it('뉴욕의 밤 9시도 마찬가지다', () => {
    expect(marketIsoDate(at('2026-08-19T13:00:00Z'))).toBe('2026-08-19');
    expect(marketIsoDate(at('2026-08-19T15:00:00Z'))).toBe('2026-08-20');
  });

  it('서울의 아침을 어제로 읽지 않는다 — toISOString 의 실패', () => {
    /* 서울 2026-08-20 08:00 = UTC 2026-08-19 23:00. `toISOString()` 이었다면
     * 오전 내내 어제로 보고했을 것이다. */
    const seoulMorning = at('2026-08-19T23:00:00Z');
    expect(marketIsoDate(seoulMorning)).toBe('2026-08-20');
    expect(seoulMorning.toISOString().slice(0, 10)).toBe('2026-08-19');
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('`<=` 로 세면 하루 뒤처진다', () => {
    const today = '2026-08-20';
    const strict = LADDER.filter((d) => d < today).length;
    const loose = LADDER.filter((d) => d <= today).length;
    expect(strict).toBe(0);
    expect(loose).toBe(1); // ← 영구히 하루 뒤처지는 그 값
  });

  it('사다리에 주말을 넣으면 나이가 부푼다', () => {
    const withWeekend = ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'];
    const today = '2026-08-24';
    expect(withWeekend.filter((d) => d < today).length).toBe(4);
    expect(LADDER.filter((d) => d < today).length).toBe(2);
  });
});
