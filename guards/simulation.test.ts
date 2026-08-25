import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  anchorError,
  applyRateOverrides,
  preRunErrors,
  SIM_CASES,
  buildSimulateBody,
  buildWaypoints,
  effectiveRate,
  hasRateOverride,
  lerpDefaultBp,
  lerpWaypoints,
  shownWaypointBp,
  pruneWaypoints,
  setLegRate,
  waypointClampMax,
  waypointGrid,
  caseShockCurve,
  DEFAULT_CASES,
  DEFAULT_SCENARIO,
  generateShockCurves,
  kindOf,
  newRow,
  notionalToKrw,
  rowError,
  shortEndBpFrom,
  tenorYears,
  toWireBp,
  type EngineLeg,
  type Scenario,
} from '../src/sim/scenario';

/**
 * 시뮬레이션 (레인 5) — **답이 조용히 달라지는 세 자리**를 지킨다.
 *
 * 이 파일이 있는 이유는 v1 과의 대사에서 첫 판이 세 군데 어긋나 있었기 때문이다.
 * 셋 다 예외를 던지지 않았다: 화면은 그대로 그려졌고 숫자도 그럴듯했다. 그런
 * 결함은 눈으로 못 잡으므로 규칙으로 잡는다.
 */

const src = (p: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', p), 'utf8');
/** 주석은 벗기고 본다 — 규칙을 설명하는 주석이 그 규칙의 증거로 잡힌 적이 세 번 있다. */
const body = (p: string) =>
  src(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const leg = (over: Partial<EngineLeg> = {}): EngineLeg => ({
  id: '3Y#0',
  name: '3Y · 3Y',
  tenor: '3Y',
  direction: -1,
  notional: 1e10,
  couponRate: 3.84,
  startDate: '2026-08-13',
  maturityDate: '2029-08-13',
  ...over,
});

describe('다리는 브라우저가 만들지 않는다 [§16]', () => {
  it('페이로드의 포지션은 서버가 준 다리 **그대로**다', () => {
    /* 첫 판은 만기·고정금리·다음픽싱을 브라우저에서 계산했다. 오너가 2026-08-07 에
     * 이미 기각한 모델이고(“다리를 손으로 둘 만들고 명목을 눈대중으로”), DV01 중립
     * 가중에는 커브가 필요해서 브라우저가 할 수 있는 일도 아니었다. */
    const legs = [leg(), leg({ id: '3Y-10Y#1', tenor: '10Y', direction: 1, notional: 2.9e10 })];
    const b = buildSimulateBody(legs, DEFAULT_SCENARIO, '2026-08-13');
    expect(b?.positions).toBe(legs); // 복사도 변형도 없다
  });

  it('scenario.ts 는 다리를 세우지 않는다 — 날짜·금리 산술이 없다', () => {
    /* 이름을 부르는 것(타입 선언)은 괜찮다. 없어야 하는 것은 **만드는 산술**이다:
     * 만기를 더하고, 픽싱일을 세고, par 를 골라 담던 코드가 첫 판에 있었다. */
    const s = body('src/sim/scenario.ts');
    expect(s).not.toMatch(/new Date\(|padStart|getMonth|toISOString/);
    expect(s).not.toMatch(/nextFixingDate/);
    expect(s).not.toMatch(/currentFloatRate/);
    // 커브를 읽던 자리도 없다 — par 는 서버가 고른다.
    expect(s).not.toMatch(/outrights/);
  });

  it('줄의 부호는 **호가 롱**이고 프론트는 안 뒤집는다', () => {
    /* 실측: `direction:+1` 로 3Y 를 전개하면 다리가 `direction:-1`(고정 지급)로
     * 돌아온다 — 뒤집기는 백엔드 `instruments.expand` 한 곳이다. 프론트가 한 번 더
     * 뒤집으면 화면의 "페이" 가 엔진에서 리시브가 되고 숫자는 그럴듯하게 나온다. */
    const s = body('src/sim/scenario.ts');
    expect(s).not.toMatch(/direction\s*[:=]\s*-1/);
    expect(s).not.toMatch(/directionSign/);
  });
});

describe('par 커브는 브라우저가 싣지 않는다', () => {
  it('irsCurves 는 언제나 빈 배열', () => {
    /* v1 `use-book`: "백엔드가 기준일의 IRS 스냅샷에서 가져오고, 그날 호가가 없으면
     * 조용한 0 대신 명시적으로 제외한다". 화면이 자기 요약에서 만들어 보내면 시장
     * 데이터의 출처가 둘이 되고, 둘이 갈린 날에도 숫자는 멀쩡해 보인다. */
    const b = buildSimulateBody([leg()], DEFAULT_SCENARIO, '2026-08-13');
    expect(b?.irsCurves).toEqual([]);
  });
});

describe('충격 커브 — 짧은 끝은 금통위만 움직인다', () => {
  const c = generateShockCurves(30, 0, 0);

  it('마디는 v1 과 같은 열한 개다', () => {
    // 마디를 빼거나 더하면 엔진의 보간이 달라진다.
    expect(c.swapCurve.map((n) => n.t)).toEqual([
      1 / 365, 0.25, 0.5, 1, 2, 3, 5, 7, 10, 20, 30,
    ]);
  });

  it('1D·3M 은 0 — 기준금리가 그대로면 오버나이트도 그대로다', () => {
    expect(c.swapCurve[0].val).toBe(0); // 1D
    expect(c.swapCurve[1].val).toBe(0); // 3M(CD)
  });

  it('3Y 는 지정한 그대로, 그 바깥은 스프레드가 정한다', () => {
    expect(c.swapCurve.find((n) => n.t === 3)?.val).toBe(30);
    expect(generateShockCurves(30, 0, 10).swapCurve.find((n) => n.t === 10)?.val).toBe(40);
    expect(generateShockCurves(30, -20, 0).swapCurve.find((n) => n.t === 1)?.val).toBe(10);
  });

  it('스프레드는 **3Y 대비**다 — s(3Y) ≡ 0', () => {
    for (const [s1, s10] of [[50, -50], [-30, 80]]) {
      expect(generateShockCurves(30, s1, s10).swapCurve.find((n) => n.t === 3)?.val).toBe(30);
    }
  });

  it('채권 커브가 같은 시나리오로 선다 [OWNER, 2026-08-25] — 빈 커브는 조용한 0 이었다', () => {
    /* v1 화석(bondCurves: {})은 채권이 시뮬에 합류한 08-14 이후로 채권 평가를
     * 전 케이스 0 으로 만들고 있었다 — 실측 2026-08-25: 국고 3Y +250bp 에서
     * 국고채 3Y 100억 평가 0. 엔진의 섹터 조회가 국채로 폴백하므로 «국채»
     * 한 커브가 모든 채권 섹터를 덮는다. */
    const bond = c.bondCurves['국채'];
    expect(bond).toBeDefined();
    expect(bond.map((n) => n.t)).toEqual(c.swapCurve.map((n) => n.t));
    // 앵커가 국고이므로 채권 3Y 노드 = 목표 그 자체.
    expect(bond.find((n) => n.t === 3)?.val).toBe(30);
  });

  it('채권 3M 은 CD 가 아니라 기준금리를 따른다 — CD 추가는 스왑 픽싱의 것이다', () => {
    const withCd = generateShockCurves(30, 0, 0, -25, 10);
    expect(withCd.swapCurve[1].val).toBe(-15); // 3M(CD) = 기준 −25 + CD 10
    expect(withCd.bondCurves['국채'][1].val).toBe(-25); // 채권 3M = 기준금리만
    expect(withCd.bondCurves['국채'][0].val).toBe(-25); // 1D 도 기준금리
  });

  it('irsSpread 는 스왑 커브에만 붙는다 — 채권 3Y 는 여전히 목표 그대로', () => {
    const withIrs = generateShockCurves(30, 0, 0, 0, 0, 5);
    expect(withIrs.swapCurve.find((n) => n.t === 3)?.val).toBe(35);
    expect(withIrs.bondCurves['국채'].find((n) => n.t === 3)?.val).toBe(30);
  });
});

describe('shockMode 는 언제나 matrix', () => {
  it('parallel 을 보내지 않는다', () => {
    /* 엔진은 parallel 에서 swapCurve 를 **버리고**(chart.py `_build_irs_shock_curve`)
     * 전 만기에 같은 bp 를 쓴다 — 오버나이트까지 같이 민다는 뜻이다. 실측 차이
     * (3Y 페이 100억·90일·+50bp): 100,058,141 vs 99,869,511 = 18.9만원. 3Y 한
     * 다리라 이 정도이고, 짧은 다리나 스프레드에서는 답을 바꾼다. */
    const b = buildSimulateBody([leg()], DEFAULT_SCENARIO, '2026-08-13');
    expect(b?.shockMode).toBe('matrix');
    expect(body('src/sim/scenario.ts')).not.toMatch(/parallel/);
  });
});

describe('모양 — 경로와 계단은 같이 보내지 않는다', () => {
  it('ramp 는 0 에서 목표까지 — 아무것도 안 꺾으면 두 점이다', () => {
    const b = buildSimulateBody([leg()], { ...DEFAULT_SCENARIO, days: 180 }, '2026-08-13');
    expect(b?.shockType).toBe('ramp');
    expect(b?.customPath).toEqual([{ day: 0, bp: 0 }, { day: 180, bp: 30 }]);
  });

  it('step 은 경로를 비운다 — 안 비우면 엔진이 경로를 따르고 계단이 무시된다', () => {
    const s: Scenario = { ...DEFAULT_SCENARIO, shape: 'step' };
    const b = buildSimulateBody([leg()], s, '2026-08-13');
    expect(b?.shockType).toBe('step');
    expect(b?.customPath).toEqual([]);
  });
});

describe('분위수 팬은 끈다', () => {
  it('includeDistribution: false', () => {
    // v1 실측: 팬이 109.9초 중 82.8초(75%). 끄면 27초.
    expect(buildSimulateBody([leg()], DEFAULT_SCENARIO, '2026-08-13')?.includeDistribution).toBe(
      false,
    );
  });
});

describe('실행할 수 없는 것은 안 보낸다', () => {
  it('다리가 없거나 기준일이 없으면 페이로드가 없다', () => {
    expect(buildSimulateBody([], DEFAULT_SCENARIO, '2026-08-13')).toBeNull();
    expect(buildSimulateBody([leg()], DEFAULT_SCENARIO, '')).toBeNull();
  });

  it('줄의 흠은 이유를 말한다', () => {
    expect(rowError({ ...newRow(), eok: 0 })).toBe('명목이 0보다 커야 해요');
    expect(rowError({ ...newRow(), seriesId: '' })).toBe('상품을 골라주세요');
    expect(rowError(newRow())).toBeNull();
  });

  it('억 ↔ 원은 한 자리에서만', () => {
    expect(notionalToKrw(100)).toBe(1e10);
  });

  /* 실행 전 검증(preRunErrors) — "조용히 빠지는 것들"이 요청 전에 이름을
     얻는다(전체 앱 크리틱 #5, 2026-08-19). 각 검사는 첫 문제 하나만 말한다. */
  describe('실행 전 검증 — 넣은 것과 나가는 것이 다르면 먼저 말한다', () => {
    const BASE = '2026-08-18';
    const ok = (sc: Scenario) => preRunErrors([], {}, sc, BASE, SIM_CASES);

    it('멀쩡한 기본 시나리오는 통과한다', () => {
      expect(ok(DEFAULT_SCENARIO)).toBeNull();
    });

    it('기간은 1 이상의 정수', () => {
      expect(ok({ ...DEFAULT_SCENARIO, days: 0 })).toContain('기간');
      expect(ok({ ...DEFAULT_SCENARIO, days: 1.5 })).toContain('기간');
    });

    it('줄의 흠은 줄 번호를 단다', () => {
      const bad = preRunErrors(
        [{ ...newRow(), eok: 0 }],
        {},
        DEFAULT_SCENARIO,
        BASE,
        SIM_CASES,
      );
      expect(bad).toContain('포지션 1번 줄');
      expect(bad).toContain('명목');
    });

    it('다리 전개 실패는 서버의 이유를 그대로 단다', () => {
      const r = newRow();
      const bad = preRunErrors(
        [r],
        { [r.key]: { error: '그 날 호가가 없어요' } },
        DEFAULT_SCENARIO,
        BASE,
        SIM_CASES,
      );
      expect(bad).toContain('그 날 호가가 없어요');
    });

    it('날짜 미정·구간 밖 이벤트는 케이스 이름을 달고 잡힌다', () => {
      const withEvent = (date: string): Scenario => ({
        ...DEFAULT_SCENARIO,
        cases: {
          ...DEFAULT_SCENARIO.cases,
          bear: {
            ...DEFAULT_SCENARIO.cases.bear,
            events: [{ key: 'e1', date, shiftBp: -25, cdSpreadBp: 0 }],
          },
        },
      });
      expect(ok(withEvent(''))).toContain('Bear');
      // 구간 = [기준일, 기준일+days] — 그 밖의 이벤트는 inWindow 가 조용히
      // 버리던 것이라, 하루라도 지나면 잡혀야 한다.
      expect(ok(withEvent('2030-01-01'))).toContain('구간 밖');
      expect(ok(withEvent('2026-08-20'))).toBeNull();
    });
  });
});

describe('상품 id 문법은 세 화면이 같다', () => {
  it('백엔드 `kind_of` 와 같은 규칙 — x 를 먼저 본다', () => {
    expect(kindOf('10Y')).toBe('outright');
    expect(kindOf('3Y-10Y')).toBe('spread');
    expect(kindOf('2Y-5Y-10Y')).toBe('fly');
    expect(kindOf('1Yx1Y')).toBe('forward');
  });
});

describe('스스로 실행되지 않는다', () => {
  it('실행은 버튼 하나에서만 시작된다', () => {
    const s = body('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/onClick=\{\(\) => void run\(\)\}/);
    expect(s).not.toMatch(/useEffect\([^)]*\brun\b/);
  });

  it('전개는 실행이 아니다 — 다리는 줄이 바뀔 때 다시 편다', () => {
    // 값싼 커브 조회다. 이게 없으면 스프레드의 다리 명목을 실행해 봐야 안다.
    expect(body('src/sim/SimulationPage.tsx')).toMatch(/loadLegs\(asOf, r\)/);
  });
});

describe('분해는 화면에서 합계와 맞는다', () => {
  it('성분마다 manUnits 한 번, 스왑캐리는 잔차 — 항목마다 반올림하지 않는다', () => {
    /* splitKrw 의 수법이 성분 여섯으로 늘어난 것이다(시뮬 포지션에 채권이
     * 들어오면서, v1 642c5c46). 각자 fmtKrw 로 반올림하면 1만원이 어긋난다 —
     * 백테스트에서 실측으로 걸린 그 결함. */
    const s = body('src/sim/ResultsWindow.tsx');
    // [OWNER, 2026-08-25 — 엔진 단위 분리] bondRoll 이 성분에 합류 — 잔차 앞
    // 반올림이 하나 늘었다(스왑캐리는 여전히 잔차 하나).
    expect(s).toMatch(/const carry = uPnl - val - roll - bondMtm - bondCarry - bondRoll - fund/);
  });

  it('채권·조달 성분은 잔차로 접지 않고 **자기 행**으로 선다 — 채권이 있을 때만', () => {
    const s = body('src/sim/ResultsWindow.tsx');
    expect(s).toMatch(/채권평가/);
    expect(s).toMatch(/조달비용/);
    expect(s).toMatch(/hasBond/);
  });
});

describe('창은 팝업을 자르지 않는다', () => {
  it('.sr-window 는 overflow: hidden 이 아니다', () => {
    /* CDS 드롭다운은 포털이 아니라 **창을 기준 삼아** 절대 배치된다. 창이 자르면
     * 목록의 아래쪽이 사라지고, 사라진 자리가 창 밖이라 "목록이 짧구나" 로 읽힌다.
     * 실측 2026-08-14: 백테스트 종목 99개가 70px 잘려 있었다. */
    // 주석을 먼저 벗긴다 — 안 그러면 이 규칙을 설명하는 주석이 그 규칙을 어긴
    // 증거로 잡힌다(이 리포에서 네 번째다).
    const css = src('src/theme/type.css').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.slice(css.indexOf('.sr-window {'));
    const block = rule.slice(0, rule.indexOf('}'));
    expect(block).not.toMatch(/overflow:\s*hidden/);
    expect(block).toMatch(/overflow:\s*visible/);
  });

  it('대신 마지막 자식이 아래 모서리를 진다', () => {
    const css = src('src/theme/type.css');
    expect(css).toMatch(/\.sr-window > \*:last-child \{[^}]*border-end-start-radius/);
    // 서랍의 채운 탭 바는 자기 안에서 잘린다
    expect(css).toMatch(/\.sr-drawer \{[^}]*overflow:\s*hidden/);
  });
});

describe('기준금리 이벤트 — 짧은 끝을 움직이는 유일한 길 `[검증됨]` 2026-08-14', () => {
  const ev = (date: string, shiftBp: number, cdSpreadBp = 0) => ({
    key: `k${date}`,
    date,
    shiftBp,
    cdSpreadBp,
  });

  /** 케이스 하나만 바꾼 시나리오 — 이벤트는 **케이스가 갖는다**(공유 필드가 아니다).
   * 케이스를 갈아 끼울 때 이벤트까지 따라오면 그건 비교가 아니다. */
  const withEvents = (events: ReturnType<typeof ev>[], over: Partial<Scenario> = {}): Scenario => ({
    ...DEFAULT_SCENARIO,
    ...over,
    cases: {
      ...DEFAULT_SCENARIO.cases,
      base: { ...DEFAULT_SCENARIO.cases.base, events },
    },
  });

  it('이벤트가 없으면 짧은 끝이 0 — 기준금리 불변이라는 뜻이다', () => {
    const c = generateShockCurves(30, 0, 0, 0, 0);
    expect(c.swapCurve[0].val).toBe(0);
    expect(c.swapCurve[1].val).toBe(0);
  });

  it('이벤트가 있으면 그 누적만큼 짧은 끝이 움직인다', () => {
    const b = buildSimulateBody([leg()], withEvents([ev('2026-08-27', -25)]), '2026-08-13')!;
    expect(b.shockCurves.swapCurve[0].val).toBe(-25); // 1D
    expect(b.shockCurves.swapCurve[1].val).toBe(-25); // 3M
    expect(b.shockCurves.swapCurve.find((n) => n.t === 3)?.val).toBe(30); // 3Y 는 그대로
  });

  it('창(0 ≤ day ≤ simDays) 밖의 이벤트는 터미널 값에 안 든다', () => {
    /* 마감일 뒤의 이벤트가 터미널 노드에만 들어가면 커브의 끝점과 거기까지 가는
     * 계단이 어긋난다 — 미리보기와 실행이 갈리는 자리다. */
    const sc = withEvents([ev('2026-10-22', -25)], { days: 30 });
    expect(shortEndBpFrom(sc.cases.base.events, '2026-08-13', sc.days)).toBe(0);
    expect(buildSimulateBody([leg()], sc, '2026-08-13')!.shockCurves.swapCurve[0].val).toBe(0);
  });

  it('그래도 **보내기는 한다** — 사용자가 적어둔 것을 조용히 버리지 않는다', () => {
    const sc = withEvents([ev('2026-10-22', -25)], { days: 30 });
    expect(buildSimulateBody([leg()], sc, '2026-08-13')!.fundingEvents).toHaveLength(1);
  });

  it('날짜가 없는 줄은 빠진다 — 아직 안 고른 것이다', () => {
    expect(
      buildSimulateBody([leg()], withEvents([ev('', -25)]), '2026-08-13')!.fundingEvents,
    ).toEqual([]);
  });

  it('fundingEvents 는 **CD 의 그날 이동**이다 — 기준금리 + CD 추가', () => {
    /* 엔진의 일별 경로는 τ ≤ 0.25 를 이 계단에서 읽는다. 실측 2026-08-14:
     * 기준금리 −25 · CD +10 을 준 날 대사표의 1D 와 3M 이 **둘 다 −15.00** 이었다
     * — 터미널 커브가 1D 와 3M 을 갈라 놓아도 일별 경로는 이 합을 쓴다. */
    expect(
      buildSimulateBody([leg()], withEvents([ev('2026-08-27', -25, 10)]), '2026-08-13')!
        .fundingEvents,
    ).toEqual([{ date: '2026-08-27', shiftBp: -15 }]);
  });

  it('이벤트는 케이스가 갖는다 — 다른 케이스로 새지 않는다', () => {
    const sc = withEvents([ev('2026-08-27', -25)]);
    expect(buildSimulateBody([leg()], sc, '2026-08-13', 'base')!.fundingEvents).toHaveLength(1);
    expect(buildSimulateBody([leg()], sc, '2026-08-13', 'bull')!.fundingEvents).toEqual([]);
  });

  it('회의 일정은 브라우저가 안 든다 — 백엔드의 `policy.upcoming` 을 읽는다', () => {
    /* `calendar.json` → `MPC_DATES` 로 이미 두 벌이고 테스트가 둘을 대조한다.
     * 세 번째 사본을 브라우저에 두면 그 대조에서 빠진 사본이 하나 생긴다. */
    const s = body('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/policy\.upcoming/);
    expect(s).not.toMatch(/2026-08-27|2026-10-22/); // 날짜 리터럴 없음
  });
});

describe('네 케이스 — 실행 하나가 넷을 돌린다 [v1 OWNER, 2026-08-10]', () => {
  it('케이스는 목표·스프레드·이벤트만 갖고, 기간·앵커는 공유한다', () => {
    /* 케이스를 갈아 끼울 때 기간까지 따라 움직이면 그건 비교가 아니다.
     * 씨앗 방향은 **채권시장 관행** — 불은 하락, 베어는 상승(주식과 반대). */
    expect(DEFAULT_CASES.bull.shockBp).toBeLessThan(0);
    expect(DEFAULT_CASES.bear.shockBp).toBeGreaterThan(0);
    expect(DEFAULT_CASES.crisis.shockBp).toBeGreaterThan(DEFAULT_CASES.bear.shockBp);
    expect(Object.keys(DEFAULT_CASES.base)).toEqual([
      'shockBp',
      'spread1y',
      'spread10y',
      'events',
      'waypoints',
    ]);
  });

  it('하나라도 실패하면 전체가 실패다 — 셋만 있는 비교는 반쪽이다', () => {
    const s = body('src/sim/SimulationPage.tsx');
    // Promise.all 이라 하나가 던지면 전체가 던진다. allSettled 면 안 된다.
    expect(s).toMatch(/Promise\.all\(\s*SIM_CASES\.map/);
    expect(s).not.toMatch(/allSettled/);
  });

  it('앵커 환산이 무너지는 케이스는 **요청 전에** 막고 이름을 댄다', () => {
    // 셋은 케이스 전환기 뒤에 숨어 있어서, 어느 케이스인지 안 대면 못 찾는다.
    const s = body('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/anchorError\(scenario\.cases\[c\.id\], scenario\.anchorTenor\)/);
    expect(s).toMatch(/\$\{c\.label\} 케이스/);
  });
});

describe('앵커 — 국고 기둥에서 설계하고 3Y 로 환산해 싣는다 [v1 N1]', () => {
  const c = { shockBp: 30, spread1y: -20, spread10y: 10, events: [], waypoints: {} };

  it('앵커 3Y 는 항등식이다', () => {
    expect(toWireBp({ ...c }, '3Y')).toBe(30);
    expect(anchorError(c, '3Y')).toBeNull();
  });

  it('다른 기둥은 그 테너 스프레드를 뺀다 — 앵커에서 목표가 정확히 나오도록', () => {
    // 10Y 앵커 +30: 전선은 20 이고, 10Y 노드는 20 + 10 = 30 으로 되돌아온다.
    expect(toWireBp(c, '10Y')).toBe(20);
    const nodes = generateShockCurves(20, c.spread1y, c.spread10y).swapCurve;
    expect(nodes.find((n) => n.t === 10)?.val).toBe(30);
    // 1Y 앵커도 같은 방식
    expect(toWireBp(c, '1Y')).toBe(50);
    expect(generateShockCurves(50, c.spread1y, c.spread10y).swapCurve.find((n) => n.t === 1)?.val)
      .toBe(30);
  });

  it('상쇄돼 0 에 가까워지면 **막는다** — 조용히 0 으로 떨어뜨리지 않는다', () => {
    const degenerate = { shockBp: 10, spread1y: 0, spread10y: 10, events: [], waypoints: {} };
    expect(anchorError(degenerate, '10Y')).toMatch(/상쇄/);
    expect(anchorError({ ...degenerate, shockBp: 0 }, '10Y')).toMatch(/정의되지 않아요/);
  });
});

describe('미리보기와 실행은 같은 커브를 쓴다', () => {
  it('`caseShockCurve` 가 페이로드의 swapCurve 와 같은 값을 낸다', () => {
    /* 둘이 갈리면 화면이 보여준 시나리오와 돌아간 시나리오가 다르고, 그건 이
     * 미리보기가 막으려던 바로 그 실패다. */
    const b = buildSimulateBody([leg()], DEFAULT_SCENARIO, '2026-08-13', 'bear')!;
    expect(caseShockCurve(DEFAULT_SCENARIO, 'bear', '2026-08-13')).toEqual(b.shockCurves.swapCurve);
  });

  it('테너는 **파싱**한다 — 백엔드 표를 베끼지 않는다', () => {
    expect(tenorYears('10Y')).toBe(10);
    expect(tenorYears('6M')).toBeCloseTo(0.5, 10);
    expect(tenorYears('1.5Y')).toBe(1.5);
    expect(tenorYears('1D')).toBeCloseTo(1 / 365, 10);
    expect(tenorYears('3s10s')).toBeNull(); // 모르는 모양은 지어내지 않는다
  });
});

describe('색은 실재하는 토큰만 쓴다 `[검증됨]` 2026-08-14', () => {
  it('`--color-chart*` 는 없는 토큰이다 — 쓰면 네 선이 같은 회색이 된다', () => {
    /* 실측: CDS 가 심는 `--color-*` 43개에 chart 계열이 하나도 없다. 무효값이라
     * 브라우저가 상속색으로 떨어뜨리고, 아무것도 안 깨져 보인다(이 리포가 폰트·
     * 면 토큰에서 이미 세 번 밟은 그 결함). */
    for (const f of ['src/sim/CurvePreview.tsx', 'src/sim/ResultsWindow.tsx']) {
      expect(body(f)).not.toMatch(/--color-chart/);
    }
  });

  it('케이스 색은 뜻과 맞는다 — Bull 은 하락(파랑), Bear 는 상승(빨강)', () => {
    const s = src('src/sim/CurvePreview.tsx');
    expect(s).toMatch(/bull: 'var\(--sr-down\)'/);
    expect(s).toMatch(/bear: 'var\(--sr-up\)'/);
  });

  it('기준 커브와 Base 케이스의 시리즈 id 가 안 부딪힌다', () => {
    /* 첫 판은 둘 다 `base` 였고, CDS 가 하나만 남겨 케이스 선이 조용히 기준
     * 커브를 다시 그렸다(실측: 두 path 의 `d` 가 완전히 동일). */
    const s = body('src/sim/CurvePreview.tsx');
    expect(s).toMatch(/id: 'now'/);
    expect(s).toMatch(/seriesId="now"/);
    expect(s).toMatch(/`case:\$\{l\.id\}`/);
  });
});

describe('컴포넌트는 CDS 것만 [OWNER 2026-08-13 §5.4]', () => {
  const files = [
    'src/sim/SimulationPage.tsx',
    'src/sim/CurvePreview.tsx',
    'src/sim/ResultsWindow.tsx',
  ];

  it('배타 선택·칩·표는 CDS 컴포넌트다 — 손으로 만들지 않는다', () => {
    /* 직접 만들면 키보드 이동·활성 인디케이터·포커스 링을 전부 다시 만들게 되고,
     * CDS 는 그걸 이미 조율해 뒀다(§5.4 가 `PeriodSelector` 에서 얻은 이득). */
    const page = src('src/sim/SimulationPage.tsx');
    expect(page).toMatch(/from '@coinbase\/cds-web\/tabs'/);
    expect(page).toMatch(/from '@coinbase\/cds-web\/collapsible'/);
    const results = src('src/sim/ResultsWindow.tsx');
    expect(results).toMatch(/from '@coinbase\/cds-web\/chips'/);
    expect(results).toMatch(/from '@coinbase\/cds-web\/tables'/);
  });

  it('`SegmentedControl` 은 deprecated 라 안 쓴다', () => {
    // 그 파일의 주석: "Please use Tabs or SegmentedTabs instead."
    // 주석에서 **이름을 부르는 것**은 정당하다(왜 안 쓰는지 적는 자리) — 본문만 본다.
    for (const f of files) expect(body(f)).not.toMatch(/SegmentedControl/);
  });

  it('직접 만든 컨트롤의 잔재가 없다', () => {
    // 클래스가 남아 있으면 다음 사람이 그걸 흉내 내서 두 번째 세그먼트를 만든다.
    for (const f of files) {
      expect(src(f)).not.toMatch(/className="sr-seg"|sr-casechip|sr-condchip|sr-linkbtn|sr-casetable/);
    }
    const css = src('src/theme/type.css');
    for (const dead of ['sr-seg', 'sr-casechip', 'sr-condchip', 'sr-linkbtn', 'sr-casetable']) {
      expect(css).not.toMatch(new RegExp(`\.${dead}[\s,{]`));
    }
  });

  it('남은 커스텀은 CDS 에 대응물이 없는 셋뿐이다', () => {
    /* 워터폴(CDS 에 없다) · 케이스 색 대시(시리즈 표식이라는 개념이 없다) ·
     * 설정 카드 표면(`.sr-card` 는 자르는데 이 카드는 드롭다운이 나가야 한다). */
    const css = src('src/theme/type.css');
    expect(css).toMatch(/\.sr-waterfall\s*\{/);
    expect(css).toMatch(/\.sr-casedash\s*\{/);
    expect(css).toMatch(/\.sr-simcard\s*\{/);
  });
});

describe('경로 설계 — D+0 과 마감일은 고정 핀 `[검증됨]` 2026-08-14', () => {
  it('격자는 30일 간격의 **중간점만**이다', () => {
    expect(waypointGrid(180)).toEqual([30, 60, 90, 120, 150]);
    expect(waypointGrid(90)).toEqual([30, 60]);
    // 기간이 60일보다 짧으면 중간점이 없다 — 경로는 직선이다.
    expect(waypointGrid(60)).toEqual([30]);
    expect(waypointGrid(30)).toEqual([]);
  });

  it('안 손댄 경유지는 직선 위 기본값(0.1bp 반올림)', () => {
    expect(lerpDefaultBp(30, 30, 180)).toBe(5);
    expect(lerpDefaultBp(30, 150, 180)).toBe(25);
    expect(lerpDefaultBp(100, 30, 180)).toBe(16.7); // 정확값 16.666… → 0.1 반올림
    expect(lerpDefaultBp(30, 0, 0)).toBe(0); // 기간 0 은 나눌 수 없다
  });

  it('경로는 0 에서 시작해 목표에서 끝난다 — 양 끝은 손댈 수 없다', () => {
    const c = { ...DEFAULT_CASES.base, shockBp: 30, waypoints: { 30: 20 } };
    const path = buildWaypoints(c, 180);
    expect(path[0]).toEqual({ day: 0, bp: 0 });
    expect(path.at(-1)).toEqual({ day: 180, bp: 30 });
    expect(path.find((w) => w.day === 30)?.bp).toBe(20); // 손댄 값 그대로
  });

  it('**안 손댄 날은 안 싣는다** — 반올림이 답을 2.9% 바꾼다 `[검증됨]`', () => {
    /* 화면은 안 손댄 칸에 직선 위 기본값(0.1bp 반올림)을 보여주지만, 그 값을
     * 페이로드에 넣으면 안 된다. 실측(3Y 페이 100억·180일):
     *
     *     목표      두 점 직선        정확 격자      0.1bp 반올림 격자
     *     +100    178,258,080     178,258,080       173,070,725  (−2.91%)
     *
     * 정확 격자는 두 점과 **원 단위까지 같다** — 격자 자체는 무해하고 반올림만이
     * 답을 바꾼다. 엔진에 "이 경로가 직선인가" 를 1e-9 로 재는 판정이 있어서,
     * 반올림된 점 하나가 시나리오를 다른 갈래로 보낸다. */
    const untouched = buildWaypoints({ ...DEFAULT_CASES.base, shockBp: 100 }, 180);
    expect(untouched).toEqual([
      { day: 0, bp: 0 },
      { day: 180, bp: 100 },
    ]);
    // 손댄 날만 사이에 낀다
    const one = buildWaypoints({ ...DEFAULT_CASES.base, shockBp: 100, waypoints: { 90: 80 } }, 180);
    expect(one).toEqual([
      { day: 0, bp: 0 },
      { day: 90, bp: 80 },
      { day: 180, bp: 100 },
    ]);
  });

  it('보여주는 값은 직선 위 기본값이다 — 읽히라고', () => {
    const c = { ...DEFAULT_CASES.base, shockBp: 100 };
    expect(shownWaypointBp(c, 30, 180)).toBe(16.7); // 0.1bp 반올림 (표시용)
    expect(shownWaypointBp({ ...c, waypoints: { 30: 20 } }, 30, 180)).toBe(20);
  });

  it('손댔는지는 **키의 존재**로 안다 — 값으로 추론하지 않는다', () => {
    /* "지금 직선 위에 있으니 안 손댄 것" 으로 치면, 우연히 직선에 놓인 편집이
     * 목표를 바꾸는 순간 지워진다 [v1 SIM2-2]. */
    const c = { ...DEFAULT_CASES.base, shockBp: 30, waypoints: { 30: 5 } }; // 직선값과 같다
    expect(buildWaypoints(c, 180).find((w) => w.day === 30)?.bp).toBe(5);
    expect(Object.keys(c.waypoints)).toEqual(['30']); // 그래도 손댄 것으로 남는다
  });

  it('클램프는 ±max(|목표| + 50, 100)', () => {
    expect(waypointClampMax(0)).toBe(100);
    expect(waypointClampMax(30)).toBe(100);
    expect(waypointClampMax(250)).toBe(300);
    const c = { ...DEFAULT_CASES.base, shockBp: 30, waypoints: { 30: 9999 } };
    expect(buildWaypoints(c, 180).find((w) => w.day === 30)?.bp).toBe(100);
  });

  it('기간이 줄면 격자 밖 편집은 **버린다**', () => {
    // 안 버리면 마감일이 지난 경유지를 그대로 물고 들어가 경로가 거짓이 된다.
    expect(pruneWaypoints({ 30: 5, 120: 20 }, 90)).toEqual({ 30: 5 });
  });

  it('페이로드의 customPath 가 그 경로다 — 앵커면 비율로 환산한다', () => {
    const sc: Scenario = {
      ...DEFAULT_SCENARIO,
      cases: { ...DEFAULT_SCENARIO.cases, base: { ...DEFAULT_CASES.base, waypoints: { 90: 25 } } },
    };
    const b = buildSimulateBody([leg()], sc, '2026-08-13', 'base')!;
    expect(b.customPath).toEqual(buildWaypoints(sc.cases.base, 180)); // 앵커 3Y = 항등
    expect(b.customPath.find((w) => w.day === 90)?.bp).toBe(25);
    expect(b.customPath).toHaveLength(3); // 0 · 손댄 90 · 180

    // 10Y 앵커 + 10Y 스프레드 10 → 전선 목표가 20 이므로 경로도 2/3 로 줄어든다
    const anchored: Scenario = {
      ...sc,
      anchorTenor: '10Y',
      cases: { ...sc.cases, base: { ...sc.cases.base, spread10y: 10 } },
    };
    const b2 = buildSimulateBody([leg()], anchored, '2026-08-13', 'base')!;
    expect(b2.baseShockBp).toBe(20);
    expect(b2.customPath.at(-1)?.bp).toBeCloseTo(20, 9);
    expect(b2.customPath.find((w) => w.day === 90)?.bp).toBeCloseTo((25 * 20) / 30, 9);
  });

  it('첫날 한 번에 는 경로를 비운다', () => {
    const sc: Scenario = { ...DEFAULT_SCENARIO, shape: 'step' };
    expect(buildSimulateBody([leg()], sc, '2026-08-13')!.customPath).toEqual([]);
  });

  it('미리보기와 엔진이 같은 규칙으로 경유지를 잇는다', () => {
    // 미리보기가 다른 보간을 쓰면 화면의 경로와 돌아간 경로가 다르다.
    const path = [
      { day: 0, bp: 0 },
      { day: 90, bp: 25 },
      { day: 180, bp: 30 },
    ];
    expect(lerpWaypoints(45, path)).toBe(12.5);
    expect(lerpWaypoints(135, path)).toBe(27.5);
    expect(lerpWaypoints(-5, path)).toBe(0); // 양 끝은 클램프
    expect(lerpWaypoints(999, path)).toBe(30);
  });
});

describe('다리별 par 덮어쓰기 [v1 트레이더 피드백 3, 2026-08-07]', () => {
  const l = (id: string, couponRate: number) => leg({ id, couponRate });

  it('안 건드리면 par 그대로', () => {
    const r = newRow();
    expect(effectiveRate(l('3Y#0', 3.84), r)).toBe(3.84);
    expect(applyRateOverrides([l('3Y#0', 3.84)], r)[0].couponRate).toBe(3.84);
    expect(hasRateOverride([l('3Y#0', 3.84)], r)).toBe(false);
  });

  it('덮어쓰면 **한 곳에서만** 얹는다 — 화면과 요청이 갈리지 않게', () => {
    const r = { ...newRow(), rateOverrides: { '3Y#0': 4.2 } };
    expect(effectiveRate(l('3Y#0', 3.84), r)).toBe(4.2);
    expect(applyRateOverrides([l('3Y#0', 3.84)], r)[0].couponRate).toBe(4.2);
    expect(hasRateOverride([l('3Y#0', 3.84)], r)).toBe(true);
  });

  it('다리별이다 — 3s10s 의 한 다리만 옮겨도 다른 다리는 par', () => {
    const r = { ...newRow(), rateOverrides: { '3Y-10Y#0': 4.2 } };
    const legs = applyRateOverrides([l('3Y-10Y#0', 4.0975), l('3Y-10Y#1', 3.84)], r);
    expect(legs.map((x) => x.couponRate)).toEqual([4.2, 3.84]);
  });

  it('되돌리면 필드 자체가 사라진다 — 빈 객체를 남기지 않는다', () => {
    /* 빈 객체가 남으면 저장분이 "덮어썼다가 되돌린 줄" 과 "한 번도 안 건드린 줄" 을
     * 구분 못 한 채 커진다. */
    const r = { ...newRow(), rateOverrides: { '3Y#0': 4.2 } };
    expect(setLegRate(r, '3Y#0', null).rateOverrides).toBeUndefined();
    expect(setLegRate(r, '3Y#0', 4.5).rateOverrides).toEqual({ '3Y#0': 4.5 });
  });

  it('상품을 바꾸면 비운다 — 남기면 다른 다리에 조용히 붙는다', () => {
    const s = body('src/sim/SimulationPage.tsx');
    // 종류 전환은 채권일 때 방향까지 함께 되돌리느라 여러 줄이 됐다(642c5c46
    // 포팅) — 비우는 사실 자체를 줄바꿈에 무관하게 본다.
    expect(s).toMatch(/seriesId: id,\s*rateOverrides: undefined/);
    expect(s).toMatch(/seriesId: v, rateOverrides: undefined/);
  });

  it('덮어쓴 줄은 **진입 MtM 이 0 이 아니라고 말한다**', () => {
    /* par 진입은 MtM 0 에서 출발하지만 옮긴 진입은 아니다 — 결과의 평가손익에
     * 경로가 만들지 않은 몫이 처음부터 섞여 있다. 그걸 모르면 숫자를 잘못 읽는다. */
    const s = src('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/진입 시점 평가손익이 0이 아니에요/);
  });
});

describe('숫자 칸은 타이핑을 막지 않는다 `[검증됨]` 2026-08-14', () => {
  it('타이핑 중에는 파싱하지 않는다 — 커밋은 blur/Enter', () => {
    /* 실측 결함: `onChange` 에서 바로 `Number()` 로 파싱하면 `"-"` 는 NaN → 0 이
     * 되고 `"4."` 는 4 가 되어 되쓰인다. **음수 목표를 칠 수 없었다.** 부호를 갖는
     * 칸이 이 화면의 절반이다. */
    const s = body('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/function NumField/);
    expect(s).toMatch(/onBlur=\{commit\}/);
    expect(s).toMatch(/if \(e\.key === 'Enter'\) commit\(\)/);
    // 숫자 칸에서 즉시 파싱하던 관용구가 남아 있지 않다
    expect(s).not.toMatch(/Number\(e\.target\.value\) \|\| 0/);
  });

  it('못 읽는 글자는 **되돌린다** — 0 으로 바꾸지 않는다', () => {
    // 0 으로 바꾸면 사람이 친 적 없는 값을 화면이 주장하게 된다.
    const s = body('src/sim/SimulationPage.tsx');
    expect(s).toMatch(/else setText\(shown\)/);
  });
});

describe('`TextCaption` 은 대문자 라벨이다 — 문장에 쓰지 않는다 `[검증됨]` 2026-08-14', () => {
  it('시뮬 화면의 산문은 `TextLegal` 이다', () => {
    /* 실측: CDS 의 caption 은 `text-transform: uppercase` 다. 한글은 안 바뀌어서
     * 오래 안 보였는데, 라틴 소문자가 들어가는 순간 드러난다 —
     * "금리를 par에서 옮겼어요" → "금리를 PAR에서", "bp · D+180" → "BP · D+180".
     * 문장과 단위에는 caps 라벨 스타일을 쓰면 안 된다. */
    for (const f of ['src/sim/SimulationPage.tsx', 'src/sim/CurvePreview.tsx', 'src/sim/ResultsWindow.tsx']) {
      expect(src(f)).not.toMatch(/TextCaption/);
    }
  });
});
