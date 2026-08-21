// @vitest-environment jsdom
/* 일별 대사 스택의 구조 핀 [v1 OWNER, 2026-08-11 — "1일차 KRD, BP변화, PnL를 각각
 * 가로줄로 구성해서 쌓아서 80일치면 240개의 가로줄"].
 *
 * 그 요구는 문장 그대로 검증 가능하다: 하루 = `<tr>` 셋, 80일 = 240행. 여기에 스택이
 * 지켜야 하는 사실들을 더 못박는다 — 하루에 한 번인 것은 `rowSpan=3` · 전 테너 열
 * 복원 · Δbp 는 둘째 자리(정수 반올림이 하루 0.17bp 를 지운다) · 원 단위 그대로
 * (억/만 접기 금지) · 폭 == 트랙 합(재분배 0).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import { ReconStack, type ReconStackDay } from '../src/ui/window/ReconStack';
import { MAX_MIX, MIN_MIX, directionVar, tintFor } from '../src/theme/tint';

afterEach(cleanup);

const TENORS = ['3M', '6M', '1Y', '10Y'];

function day(i: number): ReconStackDay {
  return {
    date: `2026-03-${String((i % 28) + 1).padStart(2, '0')}`,
    title: `d${i}`,
    krd: { '3M': -28400, '6M': 387162, '1Y': 185827, '10Y': 0 },
    dbp: { '3M': 0.25, '6M': -0.5, '1Y': 1.0, '10Y': 0.75 },
    est: { '3M': -7100, '6M': 193581, '1Y': -185827, '10Y': 0 },
    estTotal: 654,
    valuation: -369066 - i,
    carry: 143836,
    rolldown: 368131,
    actual: 142901,
  };
}

describe('조달 열은 **있을 때만** 선다 [2026-08-21]', () => {
  /* 창이 하나가 되면서 이 판정이 한 번 무너졌다: `funding: r.funding ?? null` 로
   * 채웠더니 스왑만 있는 북에도 열이 서서 250줄이 전부 «—» 인 조달 칸이 생겼다.
   * 스왑에는 조달이라는 개념 자체가 없으므로 «0원이었다» 도 «모른다» 도 아니고
   * **그 질문이 없다** — `undefined` 가 그 뜻이고, null 은 다른 말이다. */
  it('필드가 없으면 꼬리는 다섯이다 (평가·캐리·롤다운·그날 손익 + 합계)', () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).not.toContain('조달');
    expect(container.querySelectorAll("tbody td[rowspan='3']")).toHaveLength(5);
  });

  it('전 행이 null 이면 열은 안 선다 — 250줄짜리 «—» 칸을 만들지 않는다', () => {
    /* 시뮬레이션 응답은 고정 모델을 지나 스왑만 있는 북에도 `funding: null` 을
     * 전 행에 싣는다. 판정이 «필드가 있나» 였을 때 그 표에 빈 조달 칸이 섰다. */
    const { container } = render(
      <ReconStack days={[{ ...day(0), funding: null }]} tenors={TENORS} />,
    );
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).not.toContain('조달');
  });

  it('숫자가 한 행이라도 있으면 선다 — 이월 앵커의 null 은 그 열에 딸린다', () => {
    const { container } = render(
      <ReconStack
        days={[{ ...day(0), funding: -1234 }, { ...day(1), funding: null }]}
        tenors={TENORS}
      />,
    );
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).toContain('조달');
  });

  it('값이 있으면 부호 그대로 — 서버가 이미 음수로 준다', () => {
    const { container } = render(
      <ReconStack days={[{ ...day(0), funding: -35_034_000 }]} tenors={TENORS} />,
    );
    expect(container.textContent).toContain('-35,034,000');
  });
});

describe('두 격자 — 스왑 KRD · 채권 KRD [OWNER, 2026-08-21]', () => {
  /* 같은 "3Y" 라는 이름을 쓰지만 IRS 제로커브 노드와 민평 노드는 다른 위험이다.
   * 열쇠에 접두사가 붙어 오고, **화면에 적히는 것은 테너뿐**이다. */
  const GROUPS = [
    { label: '스왑 KRD', cols: [{ key: 'S:3M', label: '3M' }, { key: 'S:10Y', label: '10Y' }] },
    { label: '채권 KRD', cols: [{ key: 'B:3M', label: '3M' }, { key: 'B:3Y', label: '3Y' }] },
  ];
  const KEYS = ['S:3M', 'S:10Y', 'B:3M', 'B:3Y'];
  const mixed: ReconStackDay = {
    date: '2026-03-02',
    krd: { 'S:3M': -28400, 'S:10Y': 387162, 'B:3M': 1000, 'B:3Y': -2000 },
    dbp: { 'S:3M': 0.25, 'S:10Y': -0.5, 'B:3M': 1.0, 'B:3Y': 0.75 },
    est: { 'S:3M': -7100, 'S:10Y': 193581, 'B:3M': -1000, 'B:3Y': 1500 },
    estTotal: 654,
    valuation: -369066,
    carry: 143836,
    rolldown: 368131,
    funding: -1234,
    actual: 142901,
  };

  it('머리가 한 줄 더 서고 각 그룹이 자기 열 수만큼 걸친다', () => {
    const { container } = render(
      <ReconStack days={[mixed]} tenors={KEYS} groups={GROUPS} />,
    );
    expect(container.querySelectorAll('thead tr')).toHaveLength(2);
    const spans = [...container.querySelectorAll('thead tr:first-child th[colspan]')];
    expect(spans.map((th) => [th.textContent, th.getAttribute('colspan')])).toEqual([
      ['스왑 KRD', '2'],
      ['채권 KRD', '2'],
    ]);
  });

  it('접두사는 화면에 안 샌다 — 열 이름은 테너뿐이다', () => {
    const { container } = render(
      <ReconStack days={[mixed]} tenors={KEYS} groups={GROUPS} />,
    );
    expect(container.textContent).not.toMatch(/S:|B:/);
    const heads = [...container.querySelectorAll('thead tr:last-child th')].map(
      (h) => h.textContent,
    );
    expect(heads.filter((h) => h === '3M')).toHaveLength(2); // 양쪽에 하나씩
  });

  it('값은 **열쇠**로 읽는다 — 라벨이 겹쳐도 안 섞인다', () => {
    const { container } = render(
      <ReconStack days={[mixed]} tenors={KEYS} groups={GROUPS} />,
    );
    expect(container.textContent).toContain('-28,400');   // S:3M
    expect(container.textContent).toContain('1,000');     // B:3M
  });

  it('그룹이 하나뿐이면 머리를 안 세우되 열쇠는 그대로 쓴다', () => {
    const one = [GROUPS[0]];
    const { container } = render(
      <ReconStack days={[mixed]} tenors={['S:3M', 'S:10Y']} groups={one} />,
    );
    expect(container.querySelectorAll('thead tr')).toHaveLength(1);
    expect(container.textContent).not.toMatch(/S:/);
    expect(container.textContent).toContain('-28,400');
  });
});

describe('하루 = 가로줄 셋', () => {
  it('80일이면 정확히 240개의 <tr> 이 쌓인다', () => {
    const days = Array.from({ length: 80 }, (_, i) => day(i));
    const { container } = render(<ReconStack days={days} tenors={TENORS} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(240);
  });

  it('날짜와 하루 요약 넷은 하루에 한 번, rowSpan=3', () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const spanned = [...container.querySelectorAll("tbody td[rowspan='3']")];
    expect(spanned).toHaveLength(5); // 날짜 1 + 평가·캐리·롤다운·그날 손익 4
    const texts = spanned.map((el) => el.textContent);
    expect(texts.some((t) => t?.includes('03-01'))).toBe(true);
    expect(texts.some((t) => t?.includes('+368,131'))).toBe(true); // 롤다운
  });

  it('전 기간 KRD 0 인 테너 열도 그대로 선다 [v1 OWNER, 2026-08-12]', () => {
    // "물리적으로 잘린 테너들도 복원" — 0 인 열을 숨기던 구 폭 규율은 은퇴했다.
    // 리스크가 없다는 사실도 대사의 일부다.
    const { container, queryByText } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const headers = [...container.querySelectorAll('thead th')].map((h) => h.textContent);
    expect(headers).toContain('10Y'); // 이 픽스처에서 KRD 가 전 기간 0
    expect(headers).toContain('6M');
    expect(queryByText(/숨겼어요/)).toBeNull();
  });

  it('Δbp 줄은 둘째 자리 소수를 그대로 보인다', () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    expect(container.textContent).toContain('0.25');
    expect(container.textContent).toContain('-0.50');
  });

  it('돈은 **원 단위 그대로** — 억/만으로 접지 않는다 [v1 OWNER, 2026-08-10]', () => {
    /* 자릿수가 곧 판단이다. 24,141 이 "2만원" 이면 시스템의 24,141 과 맞는지
     * 말할 수 없다. 제품의 다른 모든 화면과 반대인 유일한 표다. */
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    expect(container.textContent).toContain('+143,836'); // 캐리
    expect(container.textContent).toContain('-369,066'); // 평가
    expect(container.textContent).not.toMatch(/억|만원/);
  });

  it('이월 앵커 블록도 세 줄이고 나머지는 —', () => {
    // 마지막 날의 종가 KRD 만 싣고 Δbp·손익·요약은 전부 null — 아직 오지 않은
    // 날의 손익을 0 이라고 말하지 않는다(공란 정책).
    const anchor: ReconStackDay = {
      date: '2026-03-04',
      title: '2026-03-04 · 다음 영업일로 들고 가는 이월 리스크',
      krd: { '3M': -28400, '6M': 387162, '1Y': 185827, '10Y': 0 },
      dbp: {},
      est: {},
      estTotal: null,
      valuation: null,
      carry: null,
      rolldown: null,
      actual: null,
    };
    const { container } = render(<ReconStack days={[day(0), anchor]} tenors={TENORS} />);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(6);
    expect(container.textContent).toContain('387,162'); // 이월 리스크는 보인다
    const dashes = [...container.querySelectorAll("tbody td[rowspan='3']")].filter(
      (el) => el.textContent === '—',
    );
    expect(dashes.length).toBe(4);
  });
});

describe('범례는 사방 고정 [v1 OWNER, 2026-08-12 2차]', () => {
  it('헤더 행은 top, 날짜·구분은 left, 요약 다섯은 right', () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const ths = [...container.querySelectorAll('thead th')] as HTMLElement[];
    expect(ths.every((th) => th.className.includes('sr-recon-th'))).toBe(true);
    /* 13px 헤더의 `ch` ≠ 14px 트랙의 `ch` — 헤더 좌표는 전부 환산해서 넘긴다.
     * jsdom 의 CSSOM 이 `calc(Nch * 14 / 13)` 을 접어 직렬화하므로 환산된 값으로
     * 단언한다. */
    expect(ths[0].style.left).toBe('0px'); // 날짜
    expect(ths[1].style.left).toMatch(/calc\(7\.53\d*ch\)/); // 구분 = 7ch·14/13
    const tail = ths.slice(-5);
    expect(tail.map((th) => th.style.right)).toEqual([
      expect.stringMatching(/calc\(47\.38\d*ch\)/), // 합계   = 44ch·14/13
      expect.stringMatching(/calc\(35\.53\d*ch\)/), // 평가   = 33ch·14/13
      expect.stringMatching(/calc\(23\.69\d*ch\)/), // 캐리   = 22ch·14/13
      expect.stringMatching(/calc\(11\.84\d*ch\)/), // 롤다운 = 11ch·14/13
      '0px',
    ]);
    // 본문의 rowSpan 셀도 고정 + **불투명 배경** — 밑을 지나는 히트맵이 비치면 안 된다.
    const spanned = [...container.querySelectorAll("tbody td[rowspan='3']")] as HTMLElement[];
    for (const td of spanned) expect(td.className).toContain('sr-recon-stick');
  });

  it('표 폭 == 트랙 합 — 재분배가 0 이라야 오프셋이 자로 맞는다', () => {
    /* `table-layout: fixed` 는 표 폭과 `<col>` 합이 다르면 차이를 트랙에
     * 재분배한다(v1 실측 11ch → 91.7px 압축). 그러면 `ch` 로 적은 sticky
     * 오프셋과 실제 트랙 경계가 어긋나 고정 열 사이로 밑이 샌다. */
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const table = container.querySelector('table') as HTMLElement;
    const cols = [...container.querySelectorAll('col')] as HTMLElement[];
    expect(cols).toHaveLength(2 + TENORS.length + 5);
    /* CSSOM 이 상수항을 접는다: 날짜 7 + 구분 5 + 꼬리 5×11 = **67ch**, 그리고
       테너 트랙은 개수 × 폭으로 남는다. 접힌 값으로 단언하는 편이 낫다 — 소스의
       수식이 아니라 브라우저가 실제로 쓰는 폭을 재는 것이다. */
    expect(table.style.width).toMatch(/calc\(67ch \+ 4 \* \(calc\(\d+ch \+ 8px\)\)\)/);
  });
});

describe('날짜 정렬 토글 [v1 OWNER, 2026-08-11]', () => {
  const three = [day(0), day(1), day(2)]; // 03-01 → 03-03, 오름차순 입력

  const firstDate = (c: HTMLElement) => c.querySelector("tbody td[rowspan='3']")?.textContent;

  it('기본 asc 는 오래된 날짜가 위, desc 는 최신이 위', () => {
    const a = render(<ReconStack days={three} tenors={TENORS} />);
    expect(firstDate(a.container)).toContain('03-01');
    cleanup();
    const b = render(<ReconStack days={three} tenors={TENORS} defaultOrder="desc" />);
    expect(firstDate(b.container)).toContain('03-03');
  });

  it('날짜 헤더를 누르면 방향이 뒤집히고 화살표가 따라온다', () => {
    const { container, getByRole } = render(<ReconStack days={three} tenors={TENORS} />);
    const btn = getByRole('button', { name: /날짜/ });
    expect(btn.textContent).toContain('↑');
    fireEvent.click(btn);
    expect(firstDate(container)).toContain('03-03');
    expect(btn.textContent).toContain('↓');
  });
});

describe('한 셀에서 색은 한 채널만 [v1 OWNER, 2026-08-06]', () => {
  it('틴트는 부호만 말하고 크기는 농도가 말한다', () => {
    expect(tintFor(0, 100)).toBeUndefined(); // 0 은 방향이 아니다
    expect(tintFor(5, 0)).toBeUndefined(); // 비교 대상이 없으면 안 칠한다
    expect(tintFor(10, 100)).toContain('--sr-up');
    expect(tintFor(-10, 100)).toContain('--sr-down');
    // 제곱근 스케일 — 선형이면 큰 값 하나가 나머지를 전부 옅은 회색으로 누른다
    const small = Number(/\s(\d+)%/.exec(tintFor(1, 100)!)![1]);
    const big = Number(/\s(\d+)%/.exec(tintFor(100, 100)!)![1]);
    expect(small).toBeGreaterThanOrEqual(MIN_MIX);
    expect(big).toBe(MAX_MIX);
    expect(small).toBeLessThan(big);
  });

  it('KRD 셀은 배경만, Δbp·손익 셀은 글자만 색을 진다', () => {
    const { container } = render(<ReconStack days={[day(0)]} tenors={TENORS} />);
    const rows = [...container.querySelectorAll('tbody tr')] as HTMLElement[];
    const tenorCells = (tr: HTMLElement) =>
      ([...tr.querySelectorAll('td')] as HTMLElement[]).filter((td) =>
        td.className.includes('sr-recon-center'),
      );
    /* 틴트 위의 방향색 글자는 **어떤 농도에서도** 4.5:1 을 못 넘는다(v1 실측:
     * 30%→3.0, 42%→2.5, 62%→1.8). 농도 조절 문제가 아니라 범주적 규칙이다. */
    for (const td of tenorCells(rows[0])) {
      if (td.style.background) expect(td.style.color).toBe('');
    }
    for (const td of tenorCells(rows[1])) expect(td.style.background).toBe('');
  });

  it('틴트 문자열에 색 리터럴이 없다 — 토큰만 섞는다', () => {
    const src = fs.readFileSync(path.resolve(import.meta.dirname, '../src/theme/tint.ts'), 'utf8');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(directionVar(0)).toBe('var(--color-fg)'); // 0 은 방향이 아니다
  });
});

describe('두 창이 같은 표를 쓴다 [트레이더 피드백 5 — "둘 다에 존재"]', () => {
  it('백테스트·시뮬 창이 같은 컴포넌트를 임포트한다', () => {
    // 껍데기가 두 벌이면 "둘 다에 존재한다" 가 곧 거짓이 된다(WindowDrawer 전례).
    for (const f of ['src/backtest/BacktestWindow.tsx', 'src/sim/ResultsWindow.tsx']) {
      const src = fs.readFileSync(path.resolve(import.meta.dirname, '..', f), 'utf8');
      expect(src).toMatch(/from '@\/ui\/window\/ReconStack'/);
    }
  });

  it('어댑터는 이름만 바꾼다 — 두 번째 정의를 만들지 않는다', () => {
    /* 백테스트 쪽 어댑터는 창 밖으로 나왔다 [2026-08-21] — `src/backtest/recon.ts`.
       조달 칸의 판단이 창 안에 있어서 가드가 못 닿았고, 그 사이에 한 번 조용히
       틀렸다(그 파일의 머리글). 시뮬 쪽은 아직 창 안이다. */
    const bt = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/backtest/recon.ts'),
      'utf8',
    );
    const sim = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/sim/ResultsWindow.tsx'),
      'utf8',
    );
    // 어느 어댑터에도 산술이 없다(합·차·곱). 서버가 낸 값을 그대로 옮긴다.
    const body = (s: string, fn: string) => s.slice(s.indexOf(fn), s.indexOf(fn) + 700);
    expect(body(bt, 'function backtestDays')).not.toMatch(/[+*/-]\s*r\./);
    expect(body(sim, 'function simDays')).not.toMatch(/[+*/-]\s*r\./);
  });

  it('기본 정렬이 반대다 — 이력은 최신이 위, 미래 경로는 D+0 이 위', () => {
    const bt = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/backtest/BacktestWindow.tsx'),
      'utf8',
    );
    const sim = fs.readFileSync(
      path.resolve(import.meta.dirname, '../src/sim/ResultsWindow.tsx'),
      'utf8',
    );
    expect(bt).toMatch(/defaultOrder="desc"/);
    expect(sim).toMatch(/defaultOrder="asc"/);
  });
});
