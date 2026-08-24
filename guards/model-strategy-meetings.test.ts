/* 금통위 자리와 «변화량» 입력.
 *
 * ## 이 파일이 지는 명제
 *
 * **동결을 고르지 않아도 동결이다.** 예전 입력은 레벨(누적)이라 「한 번 인하하고
 * 유지」를 만들려면 뒤의 칸을 전부 같은 값으로 다시 골라야 했다 — 오너의 말로는
 * 「동결인 것도 다 선택해줘야 해서 아주 귀찮음」. 지금은 안 건드린 회의가 0 이고,
 * 그 성질이 깨지면 이 화면은 예전 것으로 돌아간 것이다.
 */

import { describe, expect, it } from 'vitest';

import { PINNED_Q } from '../src/lab/model/strategy/path';
import {
  MPC_MONTHS,
  STEP_CHOICES,
  meetings,
  paramToSteps,
  runningLevels,
  stepsToDots,
  stepsToParam,
} from '../src/lab/model/strategy/meetings';

/** 2026-08-24 — 2026Q3 은 7/16 이 지나 8/27 하나만 남는 날. */
const TODAY = new Date(2026, 7, 24);
const MS = meetings(TODAY);

describe('금통위 자리', () => {
  it('연 8회 · 1·2·4·5·7·8·10·11월 — 2026 실제 일정에서 읽은 규칙이다', () => {
    expect([...MPC_MONTHS]).toEqual([1, 2, 4, 5, 7, 8, 10, 11]);
    /* 분기마다 정확히 둘. 이게 성립해야 회의를 분기로 접는 데 애매함이 없다. */
    for (const q of [0, 1, 2, 3]) {
      expect(MPC_MONTHS.filter((m) => Math.floor((m - 1) / 3) === q)).toHaveLength(2);
    }
  });

  it('지나간 회의는 자리를 안 준다 — 오늘 이후의 결정만 놓을 수 있다', () => {
    expect(MS.every((m) => m.key >= '2026-08-27')).toBe(true);
    expect(MS[0]?.key).toBe('2026-08-27');
    expect(MS[0]?.q).toBe(0);
  });

  it('여덟 분기를 넘지 않는다', () => {
    expect(MS.every((m) => m.q >= 0 && m.q < PINNED_Q)).toBe(true);
    expect(Math.max(...MS.map((m) => m.q))).toBe(PINNED_Q - 1);
  });

  it('한은이 낸 일정은 날짜로, 안 낸 것은 달로 — **물음표를 안 붙인다**', () => {
    const dated = MS.filter((m) => m.dated);
    const guessed = MS.filter((m) => !m.dated);
    expect(dated.length).toBeGreaterThan(0);
    expect(guessed.length).toBeGreaterThan(0);
    /* 표기 자체가 구분이다. 물음표는 라벨 폭을 줄마다 바꿔서 셀렉트를 어긋나게
       했고(실측 2026-08-24), 없어도 「달만 적혀 있다」 가 그 사실을 말한다. */
    for (const m of MS) expect(m.label, m.key).not.toContain('?');
    for (const m of dated) expect(m.label, m.key).toMatch(/^\d+\/\d+$/);
    for (const m of guessed) expect(m.label, m.key).toMatch(/^\d+월$/);
  });
});

describe('변화량 → 분기 레벨', () => {
  it('아무것도 안 고르면 여덟 분기가 전부 0 이다 — 동결이 기본이다', () => {
    expect(stepsToDots({}, MS)).toEqual(new Array(PINNED_Q).fill(0));
  });

  it('첫 회의만 −25 를 골라도 **그 뒤가 전부 −25 로 유지된다**', () => {
    const dots = stepsToDots({ [MS[0]!.key]: -25 }, MS);
    expect(dots).toEqual(new Array(PINNED_Q).fill(-25));
  });

  it('두 회의를 고르면 누적된다', () => {
    const first = MS[0]!;
    const later = MS.find((m) => m.q === 2)!;
    const dots = stepsToDots({ [first.key]: -25, [later.key]: -25 }, MS);
    expect(dots[0]).toBe(-25);
    expect(dots[1]).toBe(-25);
    expect(dots[2]).toBe(-50);
    expect(dots[PINNED_Q - 1]).toBe(-50);
  });

  it('누적 레벨 열이 회의 수와 같고 마지막이 분기 레벨의 끝과 같다', () => {
    const steps = { [MS[0]!.key]: -25, [MS[1]!.key]: 25 };
    const lv = runningLevels(steps, MS);
    expect(lv).toHaveLength(MS.length);
    expect(lv[lv.length - 1]).toBe(stepsToDots(steps, MS)[PINNED_Q - 1]);
  });
});

describe('URL', () => {
  it('동결이면 키를 아예 안 쓴다', () => {
    expect(stepsToParam({})).toBeUndefined();
    expect(stepsToParam({ [MS[0]!.key]: 0 })).toBeUndefined();
  });

  it('왕복한다 — 그리고 **순번이 아니라 키**로 적는다', () => {
    const steps = { [MS[0]!.key]: -25, [MS[3]!.key]: 25 };
    const raw = stepsToParam(steps)!;
    /* 순번으로 적으면 하루 지나 첫 회의가 빠지는 순간 같은 주소가 다른 경로를
       뜻한다. 공유한 링크가 조용히 다른 말을 하는 것이 제일 나쁜 종류다. */
    expect(raw).toContain(MS[0]!.key);
    expect(paramToSteps(raw, MS)).toEqual(steps);
  });

  it('이상하면 반쯤 읽지 않고 통째로 버린다', () => {
    for (const bad of ['없는키:-25', `${MS[0]!.key}:-13`, 'x', `${MS[0]!.key}`, ':-25']) {
      expect(paramToSteps(bad, MS), bad).toBeNull();
    }
  });

  it('고를 수 있는 것은 25bp 배수 둘씩이다', () => {
    expect(STEP_CHOICES).toEqual([50, 25, 0, -25, -50]);
  });
});
