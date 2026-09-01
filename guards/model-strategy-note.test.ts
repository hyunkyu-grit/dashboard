/* 다섯 줄 · 시간축 · 문체.
 *
 * ## 문체 가드가 여기 있는 이유
 *
 * 백엔드의 `test_register.py::COVERED` 는 **백엔드 페이로드**를 읽는다. 이 면은
 * 새 페이로드를 안 만든다 — 읽는 것은 세션 1 의 산출물 JSON 과, 이미 「시나리오」로
 * 덮인 앵커 라우트다. `COVERED` 에 「전략」을 더하면 아무것도 안 덮는 한 줄이 된다.
 * 그래서 이 면의 문자열은 프런트에서 진다.
 *
 * 검사 방식은 그쪽과 같다 — **나가는 글자 전부를 읽는다.** 소스를 읽으면 «인용
 * 부호 안이라 괜찮겠지» 를 못 잡는다(그쪽이 두 번 겪었다).
 */

import { describe, expect, it } from 'vitest';

import { decompose, decomposeTenor } from '@/lab/model/strategy/decompose';
import {
  DEFAULT_HORIZON,
  HORIZONS,
  MPC_NO_CURVE,
  MPC_NO_TERMS,
  NO_CARRY_HERE,
  buildNote,
  mpcDecision,
  noteText,
  pathInWords,
} from '@/lab/model/strategy/note';
import { PINNED_Q, solvePath } from '@/lab/model/strategy/path';
import { riskLines } from '@/lab/model/strategy/risk';
import {
  H_12M,
  candidates,
  gapVector,
  headlineGap,
  type StrategyAnchors,
} from '@/lab/model/strategy/trades';
import {
  CONDITIONAL_NOTE,
  ENGINE_STATUS,
  NO_DELTA_ITEMS,
  STALENESS_LABEL,
  effectGroups,
} from '@/lab/model/strategy/assumptions';

const ANCHORS: StrategyAnchors = {
  asof: '2026-08-19',
  cd: 2.93,
  base: 2.75,
  irs: {
    '1y': { spot: 3.4375, carry12mBp: 55.1691, live: true },
    '2y': { spot: 3.7075, carry12mBp: 33.2887, live: true },
    '3y': { spot: 3.83, carry12mBp: 24.0084, live: false },
    '5y': { spot: 3.9625, carry12mBp: 16.7191, live: false },
    '10y': { spot: 4.105, carry12mBp: null, live: false },
  },
};

function note(dots: number[], h: number | null) {
  const sol = solvePath(dots);
  const gaps = h === null ? null : gapVector(sol, ANCHORS, h);
  const head = gaps ? headlineGap(gaps) : null;
  const decomp = h === null ? null : decomposeTenor(sol, head?.tenor ?? '3y', h);
  return buildNote({
    sol,
    gaps,
    headlineGap: head,
    headlineDecomp: decomp,
    candidates: gaps ? candidates(gaps) : [],
    risks: riskLines(sol, decomp),
    h,
    provenance: '경로 산술',
  });
}

describe('경로를 말로', () => {
  it('전부 0 이면 동결이다', () => {
    expect(pathInWords(Array<number>(PINNED_Q).fill(0))).toBe('8분기 동결');
  });

  it('여덟 점은 레벨이라 지속 −25 는 인하 「한 번」이다', () => {
    const w = pathInWords(Array<number>(PINNED_Q).fill(-25));
    expect(w).toContain('1분기 −25bp');
    expect(w).not.toContain('2분기');
    expect(w).toContain('유지');
  });

  it('계단은 변화가 있는 분기를 다 적는다 — 요약하면 틀릴 자리가 생긴다', () => {
    const w = pathInWords([-25, -50, -50, -50, -50, -50, -50, -50]);
    expect(w).toContain('1분기 −25bp');
    expect(w).toContain('2분기 −25bp');
  });
});

describe('다섯 줄', () => {
  const n = note(Array<number>(PINNED_Q).fill(-25), H_12M);

  it('뷰·함의·논거·트레이드·리스크가 다 있다', () => {
    expect(n.view).toBeTruthy();
    expect(n.implication).toBeTruthy();
    expect(n.argument).toBeTruthy();
    expect(n.trade).toBeTruthy();
    expect(n.risk).toHaveLength(3);
  });

  it('as-of 문장은 엔진이 준 것 그대로다 — 다시 안 쓴다', () => {
    expect(n.asOf).toContain('분기 모형');
    expect(n.asOf).toContain('2026Q2');
  });

  it('함의는 프로비넌스 등급을 달고 나간다', () => {
    expect(n.implication).toContain('경로 산술');
    expect(n.implication).toMatch(/리치|치퍼/);
  });

  it('논거는 다섯 항을 다 적는다', () => {
    for (const label of ['경로 그대로', '준칙 되돌림', 'CD 전달', '기간프리미엄', '스왑 스프레드']) {
      expect(n.argument, label).toContain(label);
    }
  });

  it('평문 노트가 다섯 줄과 두 날짜를 싣는다', () => {
    const t = noteText(n, { asof: '2026-08-19', basisAsOf: '2026-08-21' });
    for (const k of ['뷰', '함의', '논거', '트레이드', '리스크']) expect(t, k).toContain(k);
    expect(t).toContain('커브 2026-08-19');
    expect(t).toContain('모형 기저 2026-08-21');
    /* 붙여 넣는 자리가 워드일 수도 텔레그램일 수도 있다 — 마크다운 강조는 안 쓴다. */
    expect(t).not.toContain('**');
  });
});

describe('시간축', () => {
  it('기본은 12개월이고 세 칸이 선다', () => {
    expect(DEFAULT_HORIZON).toBe('q4');
    expect(HORIZONS.map((x) => x.label)).toEqual(['다음 금통위까지', '3개월', '12개월']);
  });

  it('분기 사이를 보간하지 않는다 — h 는 정수뿐이다', () => {
    for (const x of HORIZONS) {
      if (x.h !== null) expect(Number.isInteger(x.h), x.label).toBe(true);
    }
  });

  it('다음 금통위 칸은 찍은 첫 점을 말한다 — 빈칸도 보간도 아니다', () => {
    const n = note(Array<number>(PINNED_Q).fill(-25), null);
    expect(n.implication).toBe(mpcDecision(Array<number>(PINNED_Q).fill(-25)));
    expect(n.implication).toContain('−25bp');
    /* 날짜를 박지 않는다. 이 칸이 말하는 날은 구운 아티팩트의
       `next_event.date` 이고, 그 회의가 지나면 다음 회의로 넘어간다 —
       2026-08-27 을 박아 뒀다가 그날이 지나며 깨졌다(2026-09-01, 화면은
       옳게 2026-10-22 을 말하고 있었다). 재는 것은 날짜가 아니라 «찍은 첫
       점을 그 회의에 붙여 말한다» 는 성질이므로 출처를 그대로 본다. */
    expect(ENGINE_STATUS.next_event.date).toBeTruthy();
    expect(n.implication).toContain(ENGINE_STATUS.next_event.date);
    expect(MPC_NO_CURVE).toContain('한 분기');
    /* 그래도 뷰와 리스크는 선다 — 그 셋은 구운 기저만으로 나온다. */
    expect(n.view).toBeTruthy();
    expect(n.risk).toHaveLength(3);
  });

  it('동결이면 금통위 칸도 동결이라고 말한다', () => {
    expect(mpcDecision(Array<number>(PINNED_Q).fill(0))).toContain('동결');
  });

  /* 같은 문장이 세 줄에 그대로 찍히면 화면이 고장 난 것처럼 읽힌다 —
     실측 2026-08-21 에 그 상태로 한 번 떴다. */
  it('금통위 칸의 세 줄이 서로 다른 말을 한다', () => {
    const n = note(Array<number>(PINNED_Q).fill(-25), null);
    expect(new Set([n.implication, n.argument, n.trade]).size).toBe(3);
    expect(n.argument).toBe(MPC_NO_TERMS);
    expect(n.trade).toBe(NO_CARRY_HERE);
  });

  it('12개월이 아닌 자리는 트레이드가 없다고 말한다 — 캐리를 잘라 쓰지 않는다', () => {
    const n = note(Array<number>(PINNED_Q).fill(-25), 1);
    expect(n.implication).toBe(NO_CARRY_HERE);
    expect(n.trade).toBe(NO_CARRY_HERE);
  });
});

describe('문체 — 해요체', () => {
  /* `test_register.py::FORMAL` 과 같은 규칙. 나가는 글자 전부를 읽는다. */
  const FORMAL = /(니다|한다\.|이다\.|않는다\.)/;

  function allStrings(): string[] {
    const out: string[] = [];
    for (const h of HORIZONS) out.push(h.label);
    for (const dots of [Array<number>(PINNED_Q).fill(0), Array<number>(PINNED_Q).fill(-25), [-25, -50, -50, -50, -50, -50, -50, -50]]) {
      for (const h of [null, 1, H_12M]) {
        const n = note(dots, h);
        out.push(n.view, n.asOf, n.implication, n.argument, n.trade, ...n.risk);
        out.push(noteText(n, { asof: '2026-08-19', basisAsOf: '2026-08-21' }));
        const sol = solvePath(dots);
        for (const r of riskLines(sol, h === null ? null : decompose(sol, h)[2])) {
          out.push(r.text, r.source, ...r.badges);
        }
      }
    }
    for (const g of effectGroups()) {
      out.push(g.headline);
      /* 띠가 실제로 그리는 것만 모은다 — 라벨·값·출처·as_of. `effect_note` 는
         r* 항만 화면에 나가고(리스크 줄), 그건 위에서 `r.text` 로 이미 들어와
         있다. 안 그리는 문자열까지 문체로 재면 실패가 정보를 안 준다. */
      for (const it of g.items) out.push(it.label, it.source, it.as_of ?? '');
    }
    out.push(CONDITIONAL_NOTE, NO_DELTA_ITEMS, MPC_NO_CURVE, MPC_NO_TERMS, NO_CARRY_HERE);
    out.push(...Object.values(STALENESS_LABEL), mpcDecision([0, 0, 0, 0, 0, 0, 0, 0]));
    return out;
  }

  it('합니다체·해라체가 안 나간다', () => {
    const bad = allStrings().filter((s) => FORMAL.test(s));
    expect(bad, '이 문장들이 문체를 벗어났어요').toEqual([]);
  });

  /* 마크다운 강조는 JSX 안에서 별표 그대로 찍힌다. 실측 2026-08-21: 컨트롤
     설명 한 줄과 «하나도 없어요» 문장이 그렇게 나가고 있었다. */
  it('마크다운 강조가 글자 그대로 안 나간다', () => {
    const bad = allStrings().filter((s) => s.includes('**'));
    expect(bad, '별표가 화면에 찍혀요').toEqual([]);
  });

  it('빈 문자열이 화면으로 안 나간다', () => {
    const empty = allStrings().filter((s) => s !== '' && !s.trim());
    expect(empty).toEqual([]);
  });
});
