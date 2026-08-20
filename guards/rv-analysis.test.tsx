// @vitest-environment jsdom
/* RV Analysis (rv2) 의 구조 핀 [트레이더 피드백 2026-08-18 + OWNER].
 *
 * 지키는 것: ① 명구("투자판단이 아니라 RV 랭킹이에요") — 랭킹 표·Score 히트맵
 * 둘 다 의무 ② 사분면 라벨은 **서술형**(명령형·매수·추천 금지) ③ 별·메달 금지
 * ④ 실행불가는 **속빈 마커**(지우지도, 채우지도 않는다) ⑤ "껍질" 과 "창 안
 * 승자" 는 딴 집합이라 딴 이름(PN-2) ⑥ 다이버징 틴트는 `tintFor(x − 50, 50)`
 * 소스 하나 ⑦ §16 — 프런트는 z·백분위·σ 를 재계산하지 않는다(서버 값 통과).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';

import { ThemeProvider } from '@coinbase/cds-web';

import { sauronTheme } from '../src/theme/sauronTheme';

import { RankingTable } from '../src/rv/RankingTable';
import { RvScatter } from '../src/rv/RvScatter';
import { ScoreHeat } from '../src/rv/ScoreHeat';
import { SectorLane } from '../src/rv/SectorLane';
import type { RvCreditItem, RvSector } from '../src/rv/api';

afterEach(cleanup);

const RV_DIR = path.join(__dirname, '..', 'src', 'rv');

function item(over: Partial<RvCreditItem>): RvCreditItem {
  return {
    sector: 'BD',
    sectorLabel: '은행채 AAA',
    base: 'KDB',
    baseLabel: '산금채 AAA',
    tenor: '3Y',
    years: 3.0,
    nowBp: 70.0,
    carryBp: 6.9,
    rollBp: 5.0,
    bufferBp: 11.9,
    trMonthBp: 8.4,
    pctLastWeek: 70.0,
    lastWeekBp: 69.2,
    spreadVolPct: 66.0,
    pct: 62.0,
    cheapBp: 4.0,
    zAbs: 0.8,
    zSector: -0.2,
    zCurve: 0.4,
    relRv: 0.32,
    score: 75.0,
    rank: 1,
    rankDelta: 2,
    shortable: true,
    shortVia: 'IRS·선물',
    seriesId: 'CRD-BD-3Y',
    ...over,
  };
}

const ITEMS: RvCreditItem[] = [
  item({}),
  // 왼쪽 아래 — 덜 벌고 평소보다 좁다. (2026-08-20: 만기 상한 3Y 라 5Y 는
  // 이 화면에 못 서므로 픽스처도 2.5Y 로 내렸다.)
  item({ sector: 'CB1', sectorLabel: '회사채 AAA', tenor: '2.5Y', years: 2.5,
    base: 'KDB', baseLabel: '산금채 AAA',
    shortable: false, shortVia: null, seriesId: 'CRD-CB1-2.5Y',
    relRv: -0.6, trMonthBp: 5.1, pctLastWeek: 22.0, score: 30.0, rank: 3,
    rankDelta: -1 }),
  // 오른쪽 위 — 많이 벌고 평소보다 넓다.
  item({ sector: 'OFB', sectorLabel: '캐피탈채 AA-', tenor: '1Y', years: 1.0,
    base: 'KDB', baseLabel: '산금채 AAA',
    shortable: false, shortVia: null, seriesId: 'CRD-OFB-1Y',
    relRv: 0.9, trMonthBp: 12.6, pctLastWeek: 91.0, score: 60.0, rank: 2,
    rankDelta: null }),
  // 백분위 미확정 — 좌표 없음. 산점에는 못 서고 표에는 — 로 선다.
  item({ sector: 'CARD', sectorLabel: '카드채 AA+', tenor: '2Y', years: 2.0,
    base: 'KDB', baseLabel: '산금채 AAA',
    shortVia: 'IRS', seriesId: 'CRD-CARD-2Y',
    pctLastWeek: null, lastWeekBp: null, spreadVolPct: null, relRv: null, score: null,
    rank: null, rankDelta: null }),
];

const noop = () => {};

/* CDS Tooltip(열 머리 설명)의 Popover 가 useTheme 을 요구한다 — 렌더는
 * ThemeProvider 아래에서. 앱과 같은 테마(providers.tsx의 그 구성). */
function rtl(ui: React.ReactElement) {
  return render(
    <ThemeProvider theme={sauronTheme} activeColorScheme="light">
      {ui}
    </ThemeProvider>,
  );
}

describe('명구 — 랭킹이지 투자판단이 아니다', () => {
  it('랭킹 표가 명구를 단다', () => {
    const { container } = rtl(<RankingTable hMonths={6} items={ITEMS} onSelect={noop} />);
    expect(container.textContent).toContain('투자판단이 아니라 RV 랭킹이에요');
  });

  it('Score 히트맵도 명구를 단다', () => {
    const { container } = render(<ScoreHeat items={ITEMS} onSelect={noop} />);
    expect(container.textContent).toContain('투자판단이 아니라 RV 랭킹이에요');
  });

  it('별·메달·추천 문구는 어디에도 없다', () => {
    for (const el of [
      rtl(<RankingTable hMonths={6} items={ITEMS} onSelect={noop} />),
      render(<ScoreHeat items={ITEMS} onSelect={noop} />),
      render(<RvScatter items={ITEMS} onSelect={noop} />),
    ]) {
      expect(el.container.textContent).not.toMatch(/[★☆🥇🥈🥉]|추천|베스트/);
    }
  });
});

describe('사분면 — 서술형, 명령형 금지', () => {
  it('네 라벨이 좌표의 뜻을 말한다 [OWNER 2026-08-19 — "싸고 버팀" 계열 교체]', () => {
    const { container } = render(<RvScatter items={ITEMS} onSelect={noop} />);
    for (const label of [
      '많이 벌고 · 평소보다 넓음',
      '많이 벌지만 · 평소보다 좁음',
      '덜 벌고 · 평소보다 넓음',
      '덜 벌고 · 평소보다 좁음',
    ]) {
      expect(container.textContent).toContain(label);
    }
  });

  it('매수·명령형 문구가 없다', () => {
    const { container } = render(<RvScatter items={ITEMS} onSelect={noop} />);
    expect(container.textContent).not.toMatch(/매수|매도하세요|사세요|파세요/);
  });

  it('점은 잉크 단일이고 헤지수단 표기는 없다 [OWNER — "명시 빼기"]', () => {
    const { container } = render(<RvScatter items={ITEMS} onSelect={noop} />);
    const dots = [...container.querySelectorAll('circle.sr-rv-dot')];
    // σ 미확정 1개는 좌표가 없어 못 선다 — 나머지 셋만.
    expect(dots).toHaveLength(3);
    // 점은 잉크 중립 단일 — 속빈(헤지 불가) 마커도 표기와 함께 은퇴했다:
    // 표기가 없으면 마커는 설명 불가한 수수께끼가 된다.
    for (const d of dots) expect(d.getAttribute('fill')).toBe('var(--color-fg)');
    expect(container.textContent).not.toContain('헤지수단');
    // 좌표에 못 선 항목은 숫자로 말한다 — 조용히 사라지지 않는다.
    expect(container.textContent).toContain('백분위 미확정 1개');
  });

  it('열 머리 넷은 뜻 설명 표식을 단다 — 사분면 두 축이 앞에 [OWNER 2026-08-20]', () => {
    const { container } = rtl(<RankingTable hMonths={6} items={ITEMS} onSelect={noop} />);
    const helps = [...container.querySelectorAll('.sr-rv-thhelp')].map((e) => e.textContent);
    expect(helps).toEqual(['한 달 수익', '지난주 백분위', '버퍼', '상대 RV']);
    // 헤지수단 표기는 표에서도 은퇴했다.
    expect(container.textContent).not.toContain('헤지수단');
  });

  it('비시각 요약은 svg 가 진다 — 점은 포인터 지름길이라 탭 정지가 아니다', () => {
    const { container } = render(<RvScatter items={ITEMS} onSelect={noop} />);
    const svg = container.querySelector('svg.sr-rv-scatter');
    expect(svg?.getAttribute('aria-label')).toMatch(
      /\d+개 중 \d+개가 중앙값보다 많이 벌고 평소보다 넓은/,
    );
    for (const d of container.querySelectorAll('circle.sr-rv-dot')) {
      expect(d.getAttribute('tabindex')).toBeNull();
    }
  });
});

describe('랭크와 Δ — 서버 값 통과 [OWNER 2026-08-19]', () => {
  it('순서는 서버 rank 그대로이고 Δ 는 ▲▼로, 어제 없던 항목은 공란이다', () => {
    const { container } = rtl(<RankingTable hMonths={6} items={ITEMS} onSelect={noop} />);
    const firstCells = [...container.querySelectorAll('tbody tr')].map(
      (tr) => tr.querySelector('td')?.textContent,
    );
    // rank 1(BD 3Y) → 2(OFB 6M) → 3(CB1 5Y) → 랭크 없음(—) 순.
    expect(firstCells).toEqual(['1', '2', '3', '—']);
    expect(container.textContent).toContain('▲2'); // BD 3Y 올라옴
    expect(container.textContent).toContain('▼1'); // CB1 2.5Y 내려감
    // 글리프는 소리로도 뜻이어야 한다 — "black up-pointing triangle" 금지.
    const up = [...container.querySelectorAll('[role="img"]')].find(
      (el) => el.textContent === '▲2',
    );
    expect(up?.getAttribute('aria-label')).toBe('2계단 올라옴');
    // 어제 없던 OFB 6M 의 Δ 칸은 비어 있다 — 0 과 "모름"은 딴 사실이다.
    const ofbRow = [...container.querySelectorAll('tbody tr')].find((tr) =>
      tr.textContent?.includes('캐피탈채'),
    );
    expect(ofbRow?.querySelectorAll('td')[1]?.textContent).toBe('');
  });
});

describe('표 의미론 — 여는 것은 버튼, 행은 행', () => {
  it('랭킹 표: tr 에 role 이 없고, 종목 칸의 실제 <button> 이 키보드 경로다', () => {
    const { container } = rtl(<RankingTable hMonths={6} items={ITEMS} onSelect={noop} />);
    for (const tr of container.querySelectorAll('tbody tr')) {
      expect(tr.getAttribute('role')).toBeNull(); // role="button" 은 표 탐색을 부순다
      expect(tr.getAttribute('tabindex')).toBeNull();
    }
    const btns = [...container.querySelectorAll('tbody button.sr-rv-linkbtn')];
    expect(btns).toHaveLength(ITEMS.length);
    expect(btns[0]?.getAttribute('aria-label')).toContain('이력 단면 열기');
  });

  it('히트맵 칸 버튼은 tabIndex=-1 — 같은 목적지의 포인터 지름길이다', () => {
    const { container } = render(<ScoreHeat items={ITEMS} onSelect={noop} />);
    const btns = [...container.querySelectorAll('button.sr-rv-cellbtn')];
    expect(btns.length).toBeGreaterThan(0);
    for (const b of btns) expect(b.getAttribute('tabindex')).toBe('-1');
  });
});

describe('표기 — fmt 한 벌', () => {
  it('반올림 후 0 은 부호가 없다 — "-0.0σ" 를 찍지 않는다', async () => {
    const { sig } = await import('../src/rv/fmt');
    expect(sig(-0.04)).toBe('0.0');
    expect(sig(-0.001, 2)).toBe('0.00');
    expect(sig(0.06)).toBe('+0.1');
    expect(sig(-0.06)).toBe('-0.1');
  });

  it('sig 정의는 fmt.ts 한 곳뿐이다', () => {
    for (const f of fs.readdirSync(RV_DIR)) {
      if (f === 'fmt.ts') continue;
      const src = fs.readFileSync(path.join(RV_DIR, f), 'utf8');
      expect(src, `${f} 에 사설 sig 정의`).not.toMatch(/function sig\(/);
    }
  });
});

describe('껍질 ≠ 창 안 승자 (PN-2)', () => {
  const sector: RvSector = {
    id: 'SHEET',
    label: '특은채',
    candidates: [
      // 껍질에는 있으나 창 안 승자가 아닌 후보 — 앵커의 6M 이 이 모양이다.
      { tenor: '6M', years: 0.5, dur: 0, carryBp: 9.5, rollBp: 0, reinvBp: 0,
        reinvDays: 0, trBp: 9.5,
        bepBp: null, maturityHold: true, inHull: true, winFrom: null, winTo: null,
        tr: [9.5, 9.5, 9.5], pathTr: [], pathDy: [] },
      { tenor: '3Y', years: 3.0, dur: 2.6, carryBp: 46.2, rollBp: 22.8, reinvBp: 0,
        reinvDays: 0, trBp: 69.0,
        bepBp: 29.1, maturityHold: false, inHull: true, winFrom: -50, winTo: 13,
        tr: [120.0, 69.0, 10.0], pathTr: [], pathDy: [] },
    ],
    swapPoints: [{ from: '3Y', to: '9M', dyBp: 13.0 }],
    filtered: 0,
  };

  it('껍질 ◆ 마커는 은퇴했고(무표) 1등 구간 열은 선다 [OWNER 2026-08-19 — "없애도 될 듯"]', () => {
    const { container } = render(
      <SectorLane sector={sector} dys={[-50, 0, 50]} hMonths={6} />,
    );
    // inHull 이 와도 아무 표시도 안 남는다 — 계약(inHull)은 잔존, 표시만 은퇴.
    expect(container.querySelector('.sr-rv-hull')).toBeNull();
    expect(container.textContent).not.toContain('◆');
    expect(container.textContent).toContain('1등 구간');
    // 창 안 1등이 없는 6M 줄의 1등 구간은 — 다.
    const rows = [...container.querySelectorAll('tbody tr')];
    const row6m = rows.find((r) => r.textContent?.includes('6M'));
    expect(row6m?.textContent).toContain('—');
  });

  it('1등 구간은 격자 위 테두리 띠로도 선다 [OWNER 2026-08-19 — "테이블 자체적으로"]', () => {
    const { container } = render(
      <SectorLane sector={sector} dys={[-50, 0, 50]} hMonths={6} />,
    );
    const rows = [...container.querySelectorAll('tbody tr')];
    const row3y = rows.find((r) => r.textContent?.includes('3Y'))!;
    // winFrom −50 .. winTo +13 → 격자 −50, 0 두 칸이 띠(시작·끝 닫힘), +50 은 밖.
    const cells = [...row3y.querySelectorAll('td.sr-rv-win')];
    expect(cells).toHaveLength(2);
    expect(cells[0]?.className).toContain('sr-rv-win-start');
    expect(cells[1]?.className).toContain('sr-rv-win-end');
    // 승자 없는 6M 줄에는 띠가 없다.
    const row6m = rows.find((r) => r.textContent?.includes('6M'))!;
    expect(row6m.querySelector('td.sr-rv-win')).toBeNull();
  });
});

describe('틴트·재계산 소스 핀', () => {
  it('다이버징 틴트는 tintFor(x − 50, 50) 하나다 — 레인 B 와 Score', () => {
    const tenorHeat = fs.readFileSync(path.join(RV_DIR, 'TenorHeat.tsx'), 'utf8');
    expect(tenorHeat).toContain('tintFor(pctOf(c) - 50, 50)');
    const scoreHeat = fs.readFileSync(path.join(RV_DIR, 'ScoreHeat.tsx'), 'utf8');
    expect(scoreHeat).toContain('tintFor(p.score - 50, 50)');
    const ranking = fs.readFileSync(path.join(RV_DIR, 'RankingTable.tsx'), 'utf8');
    expect(ranking).toContain('tintFor(p.score - 50, 50)');
  });

  it('§16 — 프런트는 z·백분위·σ 를 재계산하지 않는다', () => {
    /* 서버 값 통과의 소스 핀: 표준편차·평균 계산의 재료(sqrt·reduce)가 rv
     * 컴포넌트에 없어야 한다. 화면 좌표 변환(min/max/abs)은 허용이다. */
    for (const f of fs.readdirSync(RV_DIR)) {
      const src = fs.readFileSync(path.join(RV_DIR, f), 'utf8');
      expect(src, `${f} 에 재계산 흔적`).not.toMatch(/Math\.sqrt|\.reduce\(/);
    }
  });

  it('랭킹 열 머리는 sticky·불투명이다 — 74행 스크롤이 머리를 지우면 안 된다', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'theme', 'type.css'), 'utf8',
    );
    const th = css.match(/\.sr-rv-th \{[^}]*\}/)?.[0] ?? '';
    expect(th).toContain('position: sticky');
    expect(th).toContain('background: var(--sr-card)');
    // 채움 기하 — absolute 패턴이어야 표 내용이 행 높이를 밀어올리지 않는다
    // (2차 크리틱: 캡 상수판은 카드 하단 366px 이 죽은 여백이었다).
    expect(css).toMatch(/\.sr-rv-rank-fill \{[^}]*position: relative/);
    expect(css).toMatch(/\.sr-rv-rank-scroll \{[^}]*position: absolute/);
    expect(css).toMatch(/\.sr-rv-rank-scroll \{[^}]*overflow: auto/);
    // 표는 카드 폭을 채운다 [OWNER "꽉 채우기"].
    expect(css).toMatch(/\.sr-rv-table \{[^}]*width: 100%/);
  });

  it('브라우저 크롬도 스킴을 따른다 — 다크의 흰 스크롤바 회귀 금지', () => {
    const css = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'theme', 'direction.css'), 'utf8',
    );
    expect(css).toMatch(/\[data-sr-scheme='dark'\] \{\s*color-scheme: dark/);
    expect(css).toMatch(/\[data-sr-scheme='light'\] \{\s*color-scheme: light/);
  });

  it('as-of 강조는 색이 아니다 — 방향색은 이 바의 배경 위에서 기준 미달', () => {
    const rvPage = fs.readFileSync(path.join(RV_DIR, 'RvPage.tsx'), 'utf8');
    expect(rvPage).toContain('sr-rv-asof-split');
    // Cond 의 강조가 .sr-up(방향색)으로 돌아가면 4.1:1 미달이 재발한다.
    expect(rvPage).not.toMatch(/strong \? 'sr-up'/);
  });
});
