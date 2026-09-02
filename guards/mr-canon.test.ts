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

describe('칸 폭은 실측이고 죽은 폭이 없다', () => {
  /* 얼라인 7 의 「컨트롤은 제 상자를 채운다」 판. 브라우저 실측(2026-09-02):
     상자 사이 빈틈은 6px(묶음 안)·24px(묶음 사이)로 Backtest 와 같은 문법인데,
     상자 안 **죽은 폭**이 0~27.8px 로 흩어져 «보이는» 간격이 제각각이었다.
     비용 칸은 반대로 −15.3px, 즉 상자보다 내용이 넓어 이웃 칸(명목)을 침범했다.
     실측값으로 조인 뒤 죽은 폭이 0.7~1.8px 로 수렴했다(σ 셋은 예외 — 아래). */
  const knob = src('src/mr/KnobBar.tsx');
  const knobRaw = fs.readFileSync(path.join(root, 'src/mr/KnobBar.tsx'), 'utf8');

  it('세그먼트는 제 상자를 채운다 — 폭을 손으로 맞추는 대신 구조로', () => {
    /* CDS Tabs 기본은 fit-content 라 상자와 컨트롤 사이에 죽은 폭이 남는다.
       `fill`(→ equalWidth)이 그것을 0 으로 만든다 — 얼라인 7 이 Select 에
       DROPDOWN_STYLES 로 막아 둔 그 실패의 세그먼트 판(실측 2026-09-02:
       5.1~27.8px → 0). Backtest 방향 칸은 고정폭 상자가 아니라 켜지 않는다. */
    const cc = src('src/ui/ControlCard.tsx');
    expect(cc).toContain('equalWidth={fill}');
    /* MR 에 남은 세그먼트는 **진입 규칙 하나**다 — 실전 규칙 다섯은
       2026-09-02 에 화면에서 내렸다(아래 시험). 남은 것은 채운다. */
    expect((knob.match(/<Segmented\s+fill/g) || []).length).toBe(1);
    /* Backtest 방향 칸은 자기 줄에 살아서 켜면 줄 전체로 늘어난다 — 안 켠다. */
    expect(src('src/backtest/BacktestWindow.tsx')).not.toMatch(/<Segmented\s+fill/);
  });

  it('실전 규칙 다섯은 화면에 없다 — 내린 근거가 주석에 남아 있다', () => {
    /* [OWNER 2026-09-02 — "실전 규칙 다섯은 일단 없애서 기억만 해두는 걸로"].
       긴 표본에서 기각된 노브다(§긴 표본 판정 ①). **엔진은 그대로**이므로
       계약과 기본값은 살아 있어야 하고, 화면에서 고르는 손잡이만 없다. */
    for (const label of ['타임스탑 (일)', '레짐 필터', '비용 모델', '역신호 청산', '미청산 계상']) {
      expect(knob, label).not.toContain(`label="${label}"`);
    }
    /* 되살릴 자리와 이유가 주석에 있다. */
    expect(knobRaw).toMatch(/화면에서 내렸다/);
    expect(knobRaw).toMatch(/엔진은 그대로다/);
    /* 계약·기본값은 안 건드렸다 — 서버가 받는 노브는 그대로다. */
    const api = src('src/mr/api.ts');
    for (const k of ['timeStop', 'regime', 'costModel', 'reverseExit', 'countOpen']) {
      expect(api, k).toMatch(new RegExp(`${k}:`));
    }
  });

  it('비용 칸은 알약 셋 + 자유 입력을 담는다 — 종전 196 은 15.3px 모자랐다', () => {
    /* 220 = 211.3 + 자유 입력이 56→64 로 커진 8. 자유 입력 폭의 근거는 그 칸
       주석에 있다(글자 자리 22px 로는 자기 화면의 프리셋 0.05 가 안 들어갔다). */
    expect(knob).toContain('<Box width={220}>');
    /* 주석이 그 산술을 «정정으로» 적고 있어야 한다 — 종전 값을 지우면 왜
       212 인지가 다시 근거 없는 수가 된다(이 리포는 정정 이력을 주석에 남긴다). */
    expect(knobRaw).toMatch(/종전 주석은 「196 = 알약 셋/);
    expect(knobRaw).toMatch(/219\.3px/);
  });

  it('σ 칸은 **각자 제 내용 폭**이다 — 공통 폭 상수는 은퇴했다', () => {
    /* [OWNER 2026-09-02 — "칸안에서 빈 부분 축약해서 깔끔하게"]. 종전에는 셋이
       `SIGMA_W` 하나를 공유해 죽은 폭 11.7·9.2px 를 남겼다(알약 라벨의 자릿수가
       「1.5」와 「0」으로 달라서다). 실측 잉크 127.4·116.3·118.8 → 128·117·120. */
    expect(knob).not.toContain('SIGMA_W');
    for (const w of ['128', '117', '120']) {
      expect(knob, `σ width ${w}`).toContain(`width={${w}}`);
    }
  });

  it('폭 수치에 실측 근거가 붙어 있다 — 말줄임 금지 §3', () => {
    expect(knobRaw).toMatch(/실측/);
    expect(knobRaw).toMatch(/2026-09-02/);
  });
});

describe('가로 간격은 앱에 한 값이다 — 12px 동간격', () => {
  /* [OWNER 2026-09-02 — "가로 근접성 리듬 폐기하고 그냥 동간격으로 배치하기"].
     종전에는 묶음 안 6 · 묶음 사이 24(`.sr-fgroup`)로 덩어리를 만들었고, 조건
     바는 또 4/16 이라 리듬이 두 벌이었다. 어느 것이 정본인지 어느 파일도 말하지
     않았고, 상자 안 죽은 폭에 흔들려 선언(6/24)과 화면(여덟 가지)이 달랐다. */
  it('`.sr-fgroup` 은 앱 어디에도 안 쓰인다', () => {
    const files = ['src/backtest/BacktestWindow.tsx', 'src/mr/KnobBar.tsx', 'src/mr/MrPage.tsx',
      'src/rv/RvPage.tsx', 'src/sim/SimulationPage.tsx'];
    for (const f of files) {
      expect(src(f), f).not.toContain("className=\"sr-fgroup\"");
      expect(src(f), f).not.toContain("'sr-fgroup'");
    }
    /* CSS 규칙도 없다 — 은퇴 근거만 주석으로 남는다. */
    const css = fs.readFileSync(path.join(root, 'src/theme/type.css'), 'utf8');
    expect(css).not.toMatch(/^\.sr-fgroup \{/m);
    expect(css).toMatch(/`\.sr-fgroup` 은퇴/);
  });

  it('컨트롤 행은 어디서나 gap 1.5(12px)다', () => {
    const rows: [string, RegExp][] = [
      ['src/backtest/BacktestWindow.tsx', /<HStack gap=\{1\.5\} alignItems="flex-end" flexWrap="wrap">/],
      ['src/mr/KnobBar.tsx', /<HStack gap=\{1\.5\} alignItems="flex-end" flexWrap="wrap">/],
      ['src/mr/MrPage.tsx', /<HStack gap=\{1\.5\} alignItems="center" flexWrap="wrap">/],
      ['src/rv/RvPage.tsx', /<HStack gap=\{1\.5\} alignItems="center" flexWrap="wrap">/],
      ['src/sim/SimulationPage.tsx', /<HStack gap=\{1\.5\} alignItems="flex-end"/],
    ];
    for (const [f, re] of rows) expect(src(f), f).toMatch(re);
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
