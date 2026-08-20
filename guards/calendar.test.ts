/* 금통위 달력 — 손으로 유지하는 파일이라 **손으로 썩는다**.
 *
 * v1 패리티 레인 P1-5 (LANE-v1-parity-2026-08-20.md). v1 `calendar`.
 *
 * `src/data/calendar.json` 은 발행 중앙은행에서 읽어 적은 것이고, 항목마다
 * 어디서 읽었는지를 들고 다닌다. 이 파일이 조용히 틀리면 시뮬의 기준금리 경로와
 * RV 의 금통위 입력이 같이 틀리는데, 화면은 완벽하게 정상으로 보인다 — 없는
 * 회의가 지나가거나 있는 회의가 안 지나갈 뿐이다.
 *
 * 백엔드는 이 파일의 **사본**(`app/policy.py::MPC_DATES`)을 들고 있고, 그 둘의
 * 일치는 `backend/tests/test_policy.py` 가 본다. 여기는 원본 자체를 본다.
 *
 * v1 의 명제 중 "생성된 LPR 이 가드를 침묵시키지 못한다" 는 빠졌다 — v2 에 LPR
 * 항목이 없다(2026-08-20 확인). 들어오는 날 같이 와야 한다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type Event = {
  date: string;
  kind: string;
  label: string;
  source: string;
  verified: boolean;
};

const raw = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'data', 'calendar.json'),
  'utf8',
);
const cal = JSON.parse(raw) as { note: string; events: Event[] };

/** 이 리포가 회의를 읽는 네 중앙은행. */
const KINDS = ['mpc', 'boj', 'fomc', 'ecb'] as const;

describe('파일이 통째로 있다 — 가드가 공허하지 않다', () => {
  it('항목이 실제로 여럿이다', () => {
    /* 잘린 파일·빈 배열을 훑고 초록을 내는 것이 이 계열 가드의 고전적 실패다. */
    expect(cal.events.length).toBeGreaterThan(20);
  });

  it('손으로 유지한다는 사실이 파일 안에 적혀 있다', () => {
    /* 다음 사람이 "이거 자동 생성인가" 를 묻지 않게. */
    expect(cal.note).toMatch(/HAND-MAINTAINED/);
  });

  it('네 중앙은행이 다 있다', () => {
    const kinds = new Set(cal.events.map((e) => e.kind));
    for (const k of KINDS) expect(kinds.has(k), k).toBe(true);
  });

  it('각 은행이 한두 번이 아니라 한 해치를 담는다', () => {
    for (const k of KINDS) {
      expect(cal.events.filter((e) => e.kind === k).length, k).toBeGreaterThanOrEqual(6);
    }
  });
});

describe('항목마다 출처와 검증 표시를 든다', () => {
  it('다섯 필드가 전부 있다', () => {
    const bad = cal.events.filter(
      (e) =>
        typeof e.date !== 'string' ||
        typeof e.kind !== 'string' ||
        typeof e.label !== 'string' ||
        typeof e.source !== 'string' ||
        typeof e.verified !== 'boolean',
    );
    expect(bad).toEqual([]);
  });

  it('출처가 비어 있지 않고 어느 기관인지 말한다', () => {
    const bad = cal.events.filter((e) => e.source.trim().length < 10);
    expect(bad.map((e) => e.date)).toEqual([]);
  });

  it('같은 기관은 같은 출처 문장을 쓴다 — 출처가 갈리면 둘 중 하나는 추측이다', () => {
    for (const k of KINDS) {
      const sources = new Set(cal.events.filter((e) => e.kind === k).map((e) => e.source));
      expect([...sources], k).toHaveLength(1);
    }
  });

  it('전부 검증됐다 — 검증 안 된 항목은 값이 아니라 추측이다', () => {
    const unverified = cal.events.filter((e) => !e.verified).map((e) => `${e.kind} ${e.date}`);
    expect(unverified).toEqual([]);
  });
});

describe('날짜가 날짜다', () => {
  it('전부 2026년이다 — 조작된 과거는 수리가 아니라 삭제였다', () => {
    /* v1 이 지어낸 이력을 고치지 않고 지운 자리다. 한 해만 담고, 해가 바뀌면
     * 사람이 새로 읽어 적는다. */
    const off = cal.events.filter((e) => !e.date.startsWith('2026')).map((e) => e.date);
    expect(off).toEqual([]);
  });

  it('YYYY-MM-DD 이고 실제로 존재하는 날이다', () => {
    const bad = cal.events.filter((e) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return true;
      const d = new Date(`${e.date}T00:00:00Z`);
      return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== e.date;
    });
    expect(bad.map((e) => e.date)).toEqual([]);
  });

  it('한 기관 안에서 날짜가 겹치지 않는다', () => {
    for (const k of KINDS) {
      const dates = cal.events.filter((e) => e.kind === k).map((e) => e.date);
      expect(new Set(dates).size, k).toBe(dates.length);
    }
  });

  it('한 기관의 회의가 시간순이다 — 뒤섞이면 사람이 하나를 빠뜨린 것이다', () => {
    for (const k of KINDS) {
      const dates = cal.events.filter((e) => e.kind === k).map((e) => e.date);
      expect(dates, k).toEqual([...dates].sort());
    }
  });

  it('회의 간격이 사람이 정하는 주기 안에 있다', () => {
    /* 두 달 반을 넘으면 하나 빠뜨린 것이고, 일주일 안이면 하나를 두 번 적은
     * 것이다. 둘 다 손으로 유지하는 파일의 전형적인 사고다. */
    const off: string[] = [];
    for (const k of KINDS) {
      const dates = cal.events.filter((e) => e.kind === k).map((e) => e.date);
      for (let i = 1; i < dates.length; i += 1) {
        const gap =
          (Date.parse(dates[i]) - Date.parse(dates[i - 1])) / (1000 * 60 * 60 * 24);
        if (gap < 14 || gap > 80) off.push(`${k} ${dates[i - 1]}→${dates[i]} (${gap}일)`);
      }
    }
    expect(off).toEqual([]);
  });
});

describe('백엔드 사본과 갈리지 않는다', () => {
  it('금통위 날짜가 backend/app/policy.py 의 목록과 같다', () => {
    /* 사본은 조용히 썩는다. 백엔드에도 대조 테스트가 있지만, 원본 쪽에서도
     * 한 번 본다 — 둘 중 하나만 고치는 날 어느 쪽에서든 걸리게. */
    const py = fs.readFileSync(
      path.join(__dirname, '..', 'backend', 'app', 'policy.py'),
      'utf8',
    );
    /* `MPC_DATES` 는 `dt.date(2026, 1, 15)` 꼴이다 — ISO 문자열이 아니다. */
    const inPy = [...py.matchAll(/dt\.date\((\d{4}),\s*(\d{1,2}),\s*(\d{1,2})\)/g)].map(
      (m) => `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`,
    );
    const mpc = cal.events.filter((e) => e.kind === 'mpc').map((e) => e.date);
    const missing = mpc.filter((d) => !inPy.includes(d));
    expect(missing, 'policy.py 에 없는 금통위 날짜').toEqual([]);
    // 반대 방향도 본다 — policy.py 에만 있는 날짜는 달력에서 지워진 회의다.
    const extra = inPy.filter((d) => !mpc.includes(d));
    expect(extra, 'calendar.json 에 없는데 policy.py 에 있는 날짜').toEqual([]);
  });
});

describe('판정기 자신 — 심어서 실패하는지', () => {
  it('검증 안 된 항목을 심으면 잡힌다', () => {
    const planted = [...cal.events, { ...cal.events[0], verified: false }];
    expect(planted.filter((e) => !e.verified)).toHaveLength(1);
  });

  it('없는 날짜를 심으면 잡힌다', () => {
    const bad = '2026-02-30';
    const d = new Date(`${bad}T00:00:00Z`);
    expect(d.toISOString().slice(0, 10)).not.toBe(bad);
  });

  it('빠뜨린 회의를 심으면 간격 검사가 잡는다', () => {
    const gap = (Date.parse('2026-07-16') - Date.parse('2026-01-15')) / (1000 * 60 * 60 * 24);
    expect(gap).toBeGreaterThan(80);
  });
});
