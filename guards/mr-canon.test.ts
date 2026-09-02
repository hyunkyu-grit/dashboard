/* MR 세 화면이 **Main·Backtest 와 같은 문법**으로 서 있는가 [OWNER 2026-09-02 —
 * "이제 디자인 구성도 Main이나 Backtest와 통일해주세요"].
 *
 * ## 이 파일이 지는 명제 넷
 *
 * **떠 있는 창은 같은 리듬이다.** 창 몸통은 `padding 2 · gap 2`(Backtest 창의
 * 그 값)이고 머리 부제는 `caption`(Backtest 「{asOf} 종가까지」와 같은 급)이다.
 * 같은 위계의 창 둘이 안쪽 여백부터 다르면 나란히 놓았을 때 그 사실이 먼저
 * 보인다(CLAUDE.md 얼라인 5).
 *
 * **상태 문구는 앱에 한 문법이다.** 안내·빈 상태는 `body` 뮤트, 오류는 `body` +
 * `.sr-up` — Backtest·Main 미리보기가 쓰는 그것이다. MR 은 셋 다 `legal` 맨
 * 잉크였고, 그래서 「실행하지 못했어요」가 각주처럼 조용히 서 있었다.
 *
 * **차트는 LINKED PAIR 의 결로 쌓인다.** 세로 스택 + 같은 `dates` +
 * `useStackedScales` + **x 라벨은 맨 위만**(`hideTimeAxis`) + 십자선 `syncIndex`
 * 동기. 같은 눈금을 세 번 그리면 그게 다른 축인 줄 읽힌다.
 *
 * **일별 대사는 창 바닥 서랍이다.** Backtest 가 대사를 서랍에 둔 근거가 트레이더
 * 피드백 5(«팝업창 하단에 열었다 닫았다 하는 탭» — `WindowDrawer.tsx` 머리)이고,
 * MR 도 같은 물건을 같은 자리에 둔다. 종전에는 거래 패널의 내용이 «바뀌는» 판이라
 * 목록과 대사를 같이 볼 수 없었다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

const root = path.resolve(import.meta.dirname, '..');
const src = (rel: string) => stripComments(fs.readFileSync(path.join(root, rel), 'utf8'));

const WINDOWS = ['src/mr/StrategyWindow.tsx', 'src/mr/BookWindow.tsx'] as const;

describe('떠 있는 창의 리듬은 Backtest 와 한 값이다', () => {
  it('창 몸통 = padding 2 · gap 2', () => {
    /* 기준을 코드에서 읽는다 — Backtest 가 바뀌면 이 시험이 그 사실을 먼저
       말해야지, 여기 박아 둔 수와 갈리면 안 된다. */
    const bt = src('src/backtest/BacktestWindow.tsx');
    expect(bt).toMatch(/<VStack gap=\{2\} padding=\{2\} width="100%">/);
    for (const f of WINDOWS) {
      expect(src(f), f).toMatch(/<VStack gap=\{2\} padding=\{2\} width="100%">/);
    }
  });

  it('창 머리 부제는 caption 뮤트 — legal 이 아니다', () => {
    for (const f of WINDOWS) {
      const code = src(f);
      const aside = code.slice(code.indexOf('aside={'), code.indexOf('onClose={onClose}'));
      expect(aside, f).toMatch(/font="caption"/);
      expect(aside, f).not.toMatch(/font="legal"/);
    }
  });
});

describe('상태 문구는 앱에 한 문법이다', () => {
  it('오류는 body + sr-up(Backtest 와 같은 것)', () => {
    const bt = src('src/backtest/BacktestWindow.tsx');
    expect(bt).toMatch(/실행하지 못했어요/);
    for (const f of WINDOWS) {
      const code = src(f);
      const i = code.indexOf('실행하지 못했어요');
      expect(i, f).toBeGreaterThan(0);
      /* 그 문장을 감싼 여는 태그를 뒤로 훑어 활자를 본다. */
      const open = code.lastIndexOf('<Text', i);
      const tag = code.slice(open, i);
      expect(tag, f).toMatch(/font="body"/);
      expect(tag, f).toMatch(/className="sr-up"/);
    }
  });

  it('안내·빈 상태·stale 은 body 뮤트', () => {
    for (const f of WINDOWS) {
      const code = src(f);
      const i = code.indexOf('설정이 실행과 달라요');
      expect(i, f).toBeGreaterThan(0);
      const tag = code.slice(code.lastIndexOf('<Text', i), i);
      expect(tag, f).toMatch(/font="body"/);
      expect(tag, f).toMatch(/color="fgMuted"/);
    }
  });
});

describe('차트는 LINKED PAIR 의 결로 쌓인다', () => {
  it('패널은 풀폭이다 — flexBasis 50% 의 «한 줄에 둘» 주장이 사라졌다', () => {
    const parts = src('src/mr/parts.tsx');
    expect(parts).not.toMatch(/flexBasis="50%"/);
    expect(parts).toMatch(/<VStack gap=\{0\.5\} width="100%" minWidth=\{0\}>/);
  });

  it('x 라벨은 맨 위 차트만 진다 — 나머지는 hideTimeAxis', () => {
    for (const f of WINDOWS) {
      const code = src(f);
      const charts = code.split('<TimeChart').length - 1;
      const hidden = code.split('hideTimeAxis').length - 1;
      /* 차트가 둘 이상이면 정확히 «맨 위 하나»만 축을 진다. */
      expect(charts, f).toBeGreaterThan(1);
      expect(hidden, f).toBe(charts - 1);
    }
  });

  it('십자선은 형제 차트에 동기된다(syncIndex)', () => {
    for (const f of WINDOWS) {
      expect(src(f), f).toMatch(/syncIndex=\{idx && idx\.chart !== '/);
    }
  });

  it('캔버스가 못 하는 말을 hoverLabel 이 한다 — 차트마다', () => {
    /* CLAUDE.md 규칙 7: «읽을 DOM 이 없다 → hoverLabel → aria-live 줄이 진다».
       Main 미리보기 `scrubLabel` 이 그 판례다. */
    for (const f of WINDOWS) {
      const code = src(f);
      const charts = code.split('<TimeChart').length - 1;
      const labels = code.split('hoverLabel=').length - 1;
      expect(labels, f).toBe(charts);
    }
  });

  it('차트 높이는 Backtest 의 두 급(200/140)이다', () => {
    for (const f of WINDOWS) {
      const code = src(f);
      expect(code, f).toMatch(/const CHART_H = 200;/);
      expect(code, f).toMatch(/const CHART_H_SUB = 140;/);
    }
  });
});

describe('일별 대사는 창 바닥 서랍이다', () => {
  it('전략 실험 창이 FloatingWindow 의 drawer 로 대사를 낸다', () => {
    const code = src('src/mr/StrategyWindow.tsx');
    expect(code).toMatch(/drawer=\{\[/);
    expect(code).toMatch(/label: '일별 대사'/);
    /* 왜 비었는지를 그 자리에서 말한다(서랍의 규율). */
    expect(code).toMatch(/unavailable:/);
  });

  it('거래 줄을 누르면 서랍이 펴진다 — 「눌렀는데 아무 일도」가 없게', () => {
    const code = src('src/mr/StrategyWindow.tsx');
    expect(code).toMatch(/setOpenTrade\(tradeKey\(t\)\);\s*setDrawerOpen\(true\);/);
    /* 실행하면 닫는다 — 딴 실행의 대사를 펴 놓고 있으면 그 표가 거짓이다. */
    expect(code).toMatch(/setOpenTrade\(null\);\s*setDrawerOpen\(false\);/);
  });

  it('서랍 펼침은 제어 prop 으로 지나간다 — 부품을 복제하지 않았다', () => {
    /* `WindowDrawer` 는 기본이 «자기 상태»다(백테스트 판). 밖에서 쥐는 판만
       옵셔널로 더했다 — 두 벌을 만들면 서랍이 둘이 된다(얼라인 8). */
    const drawer = src('src/ui/window/WindowDrawer.tsx');
    expect(drawer).toMatch(/open\?: boolean/);
    expect(drawer).toMatch(/onOpenChange\?: \(open: boolean\) => void/);
    expect(drawer).toMatch(/const open = openProp \?\? openSelf/);
    const fw = src('src/ui/window/FloatingWindow.tsx');
    expect(fw).toMatch(/drawerOpen\?: boolean/);
  });
});

describe('머리 주석이 화면과 같은 말을 한다', () => {
  it('차트 라이브러리를 CDS CartesianChart 라고 적지 않는다', () => {
    /* 15차트가 lightweight-charts 로 옮겨 간 뒤(CLAUDE.md 규칙 7) 그 문장은
       거짓이다 — 이 리포는 «판단은 그 파일의 머리 주석이 한다» 라서 거짓
       주석은 그 자체로 결함이다(2026-09-02 감사가 잡았다). */
    for (const f of ['src/mr/StrategyWindow.tsx', 'src/mr/BandChart.tsx']) {
      const head = fs.readFileSync(path.join(root, f), 'utf8').slice(0, 4000);
      expect(head, f).not.toMatch(/차트는 lightweight-charts 가 아니라 CDS/);
      expect(head, f).not.toMatch(/같은 기계다: CDS `CartesianChart`/);
    }
  });

  it('배치를 2×2 라고 주장하지 않는다 — 세로 스택이 정본이다', () => {
    for (const f of WINDOWS) {
      const raw = fs.readFileSync(path.join(root, f), 'utf8');
      expect(raw, f).not.toMatch(/2×2 패널 — 원본 결과 그리드의 배치/);
      expect(raw, f).not.toMatch(/flexBasis: 50%` 인데, 간격까지 더하면/);
    }
  });
});
