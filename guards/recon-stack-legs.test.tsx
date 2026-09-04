import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReconStack, type ReconStackDay, type ReconStackLeg } from '@/ui/window/ReconStack';

/* 실가격 대사표가 **다리마다 선다** [OWNER 2026-09-04 — 「국고매수랑 IRS Pay가
 * 별개로 뜨게 해줘」].
 *
 * 하루가 세 줄에서 **일곱 줄**이 됐다: 다리마다 KRD·Δbp·손익 셋씩, 그리고 합계
 * 한 줄. 날짜 칸이 일곱을 덮고 다리 칸이 셋씩 덮는데, 머리와 몸통이 각자 셀을
 * 세는 구조라 한쪽만 어긋나면 **tsc 는 통과하고 표만 무너진다**(`mr-recon-day`
 * 가드의 그 근거와 같다).
 *
 * 값이 닫히는지는 `backend/tests/test_mr_legrecon.py::TestTwoLegRecon` 이
 * 라우트를 타고 잰다 — 이 파일은 «격자» 만 본다.
 *
 * 두 다리의 열이 **어긋난다**는 것도 여기서 잰다: 민평엔 2.5Y 가 있고 IRS 엔
 * 4Y 가 있어, 표의 열은 합집합이고 없는 칸은 빈칸(—)이다. 한쪽 목록만 쓰면
 * 다른 다리의 숫자가 통째로 사라지는데 그건 화면에 에러로 안 나온다. */

const BOND: ReconStackLeg = {
  name: '국고',
  krd: { '2.5Y': 4_030, '7Y': 976_460 },
  dbp: { '2.5Y': 0.8, '7Y': 0.3 },
  est: { '2.5Y': -3_224, '7Y': -292_938 },
  estTotal: -296_162,
  valuation: -300_000,
  residual: -3_838,
  carry: 57_155,
  rolldown: 17_530,
  funding: -34_455,
  actual: -259_770,
};

const SWAP: ReconStackLeg = {
  name: 'IRS',
  krd: { '4Y': -400, '7Y': -1_003_434 },
  dbp: { '4Y': 0.6, '7Y': 0.1 },
  est: { '4Y': 240, '7Y': 100_343 },
  estTotal: 100_583,
  valuation: 99_000,
  residual: -1_583,
  carry: 16_315,
  rolldown: -15_565,
  funding: null,
  actual: 99_750,
};

const DAY: ReconStackDay = {
  date: '2020-03-30',
  krd: {},
  dbp: {},
  est: {},
  /* 행 수준의 `estTotal`·`residual` 은 **은퇴한 스프레드 자**의 값이다(서버가
     백테스트·시뮬을 위해 아직 싣는다). 다리 합(-296,162 + 100,583 = -195,579,
     잔차 -3,838 + -1,583 = -5,421)과 **일부러 다르게** 둬서, 합계 줄이 이 값을
     그대로 그리면 아래 시험이 잡게 한다. */
  estTotal: -111_111,
  valuation: -201_000,
  residual: -89_889,
  carry: 73_470,
  rolldown: 1_965,
  funding: -34_455,
  actual: -160_020,
  legs: [BOND, SWAP],
};

function draw(days: ReconStackDay[], tenors: string[]) {
  const { container } = render(<ReconStack days={days} tenors={tenors} />);
  return container;
}

const TENORS = ['2.5Y', '4Y', '7Y'];

describe('다리별 대사표의 격자', () => {
  it('하루가 일곱 줄이다 — 다리마다 셋, 그리고 합계', () => {
    const rows = [...draw([DAY], TENORS).querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(7);
  });

  it('날짜는 일곱을 덮고 다리는 셋씩 덮는다', () => {
    const c = draw([DAY], TENORS);
    const spans = [...c.querySelectorAll('tbody td[rowspan]')].map((td) =>
      Number(td.getAttribute('rowspan')),
    );
    expect(spans).toContain(7); // 날짜 칸
    expect(spans.filter((n) => n === 3).length).toBeGreaterThanOrEqual(2); // 다리 칸 둘
  });

  it('다리 이름과 합계가 왼쪽 범례에 선다', () => {
    const c = draw([DAY], TENORS);
    const text = [...c.querySelectorAll('tbody .sr-recon-kind')].map((n) => n.textContent);
    expect(text).toContain('국고');
    expect(text).toContain('IRS');
    expect(text).toContain('합계');
  });

  it('머리에 다리 열이 서고, 머리와 몸통의 셀 수가 맞는다', () => {
    const c = draw([DAY], TENORS);
    const head = [...c.querySelectorAll('thead tr')].at(-1)!;
    expect([...head.querySelectorAll('th')].map((n) => n.textContent)).toContain('다리');
    // 머리의 칸 수 = 몸통 첫 줄의 칸 수(첫 줄은 날짜·다리·구분을 다 낸다).
    const first = c.querySelector('tbody tr')!;
    expect(first.querySelectorAll('td').length).toBe(head.querySelectorAll('th').length);
    // `<colgroup>` 트랙도 같은 수여야 sticky 오프셋이 자로 맞는다.
    expect(c.querySelectorAll('colgroup col').length).toBe(
      head.querySelectorAll('th').length,
    );
  });

  it('한 다리에만 있는 열은 다른 다리에서 빈칸이다', () => {
    const c = draw([DAY], TENORS);
    const rows = [...c.querySelectorAll('tbody tr')];
    // 국고 KRD 줄: 2.5Y 는 숫자, 4Y 는 —
    const bondKrd = [...rows[0].querySelectorAll('td.sr-recon-center')].map(
      (n) => n.textContent,
    );
    expect(bondKrd).toEqual(['4,030', '—', '976,460']);
    // IRS KRD 줄(넷째): 4Y 는 숫자, 2.5Y 는 —
    const swapKrd = [...rows[3].querySelectorAll('td.sr-recon-center')].map(
      (n) => n.textContent,
    );
    expect(swapKrd).toEqual(['—', '-400', '-1,003,434']);
  });

  it('합계 줄의 테너 칸은 비어 있다 — 두 커브의 KRD 는 못 더한다', () => {
    const rows = [...draw([DAY], TENORS).querySelectorAll('tbody tr')];
    const sum = [...rows[6].querySelectorAll('td.sr-recon-center')].map((n) => n.textContent);
    expect(sum).toEqual(['—', '—', '—']);
  });

  /* 이 표가 되풀이해 깨진 자리 — `left` 의 `ch` 와 `<colgroup>` 트랙이 어긋나면
     고정 열 사이로 밑 내용이 샌다(모듈 머리의 실측). 다리 열이 하나 늘면서
     구분 열의 오프셋이 밀렸으므로, 누적 폭과 오프셋이 **같은 수**인지 잰다. */
  it('고정 열의 오프셋이 colgroup 트랙의 누적과 같다', () => {
    const c = draw([DAY], TENORS);
    const widths = [...c.querySelectorAll('colgroup col')]
      .slice(0, 3)
      .map((n) => (n as HTMLElement).style.width);
    expect(widths).toEqual(['7ch', '5ch', '5ch']); // 날짜 · 다리 · 구분

    const first = c.querySelector('tbody tr')!;
    const lefts = [...first.querySelectorAll('td.sr-recon-stick')].map(
      (n) => (n as HTMLElement).style.left,
    );
    // 0 · 날짜폭 · 날짜폭+다리폭 — 트랙 누적과 한 자로 맞는다.
    expect(lefts).toEqual(['0px', '7ch', '12ch']);

    /* 머리는 13px 이라 같은 자리를 가리키려면 환산한다(`headCh`) — `ch` 는 그
       요소 **자신의** 폰트에서 '0' 의 진행폭이기 때문이다. jsdom 이 `calc()` 을
       미리 접으므로 문자열이 아니라 **수**로 잰다: 14/13 배가 그 환산이다. */
    const head = [...c.querySelectorAll('thead tr')].at(-1)!;
    const headLefts = [...head.querySelectorAll('th.sr-recon-pin')].map((n) =>
      Number.parseFloat((n as HTMLElement).style.left.replace(/[^0-9.]/g, '')),
    );
    expect(headLefts[0]).toBe(0);
    expect(headLefts[1]).toBeCloseTo((7 * 14) / 13, 3);
    expect(headLefts[2]).toBeCloseTo((12 * 14) / 13, 3);
  });

  /* 표의 **마지막 줄**이다 — 다음 영업일로 들고 가는 이월 리스크. KRD 만 있고
     돈 필드는 전부 null 이다(공란 정책: 아직 오지 않은 날의 손익을 0 이라고
     말하지 않는다). 다리 모드에서도 같은 규약이어야 한다. */
  it('이월 앵커도 일곱 줄로 서고 돈 칸은 전부 빈칸이다', () => {
    const blank = (name: string, krd: Record<string, number>) => ({
      name, krd, dbp: {}, est: {},
      estTotal: null, actual: null, valuation: null,
      carry: null, rolldown: null, funding: null, residual: null,
    });
    const anchor: ReconStackDay = {
      date: '2020-04-10',
      krd: {}, dbp: {}, est: {},
      estTotal: null, actual: null, valuation: null,
      carry: null, rolldown: null, funding: null, residual: null,
      legs: [blank('국고', { '7Y': 970_000 }), blank('IRS', { '7Y': -998_000 })],
    };
    const c = draw([DAY, anchor], TENORS);
    const rows = [...c.querySelectorAll('tbody tr')];
    expect(rows).toHaveLength(14); // 하루 일곱 × 둘
    // 앵커의 합계 줄(마지막)은 돈 칸이 전부 «—» 다.
    const money = [...rows[13].querySelectorAll('td.sr-recon-right')].map(
      (n) => n.textContent,
    );
    expect(money.every((t) => t === '—')).toBe(true);
    // 그런데 KRD 는 서 있다 — 이월 리스크는 사실이다.
    expect(rows[7].textContent).toContain('970,000');
  });

  /* 표 밑 각주가 주장하는 항등이다 — 「잔차 = 평가 − 추정(합계)」. 합계 줄이
     행 수준의 옛 값을 그대로 그리면 그 줄에서만 항등이 깨지는데, DOM 구조는
     멀쩡해서 다른 가드가 못 잡는다(실측 2026-09-04 스크린샷이 잡았다). */
  it('합계 줄의 추정·잔차는 다리에서 온다 — 옛 스프레드 자가 아니다', () => {
    const rows = [...draw([DAY], TENORS).querySelectorAll('tbody tr')];
    const money = [...rows[6].querySelectorAll('td.sr-recon-right')].map(
      (n) => n.textContent,
    );
    // [합계(추정), 평가, 잔차, 캐리, 롤다운, 조달, 그날 손익]
    expect(money[0]).toBe('-195,579'); // 다리 추정의 합 (행 수준 -111,111 아님)
    expect(money[2]).toBe('-5,421'); //  다리 잔차의 합 (행 수준 -89,889 아님)
    // 그리고 그 셋이 실제로 닫힌다.
    const n = (t: string | null) => Number((t ?? '').replace(/[+,]/g, ''));
    expect(n(money[1]) - n(money[0])).toBe(n(money[2]));
  });

  it('다리가 없으면 종전 그대로 하루 세 줄이다', () => {
    const plain: ReconStackDay = { ...DAY, legs: undefined, krd: { '7Y': 1 }, dbp: { '7Y': 1 }, est: { '7Y': -1 } };
    const c = draw([plain], TENORS);
    expect([...c.querySelectorAll('tbody tr')]).toHaveLength(3);
    const head = [...c.querySelectorAll('thead tr')].at(-1)!;
    expect([...head.querySelectorAll('th')].map((n) => n.textContent)).not.toContain('다리');
  });
});
