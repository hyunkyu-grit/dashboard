/* 시뮬 차트에서 **커서가 짚은 값을 읽을 수 있다**.
 *
 * v1 패리티 레인 P1-2 (LANE-v1-parity-2026-08-20.md). v1 `sim/ui/HoverPanel.tsx`.
 *
 * 시뮬은 금리 경로를 설계하고 그 결과를 보는 화면인데, 세 차트 어디에도 커서
 * 리드아웃이 없었다 — "D+37 에 얼마" 를 읽을 길이 없었다. 백테스트의
 * `LinkedCharts` 에는 있었으니 문법은 이미 리포 안에 있었고, 시뮬만 못 받은
 * 것이다.
 *
 * ## 세 차트가 다 받아야 한다
 *
 *   커브형   테너 × 케이스별 금리
 *   시계열형 D+n × 케이스별 Δbp
 *   성분경로 D+n × 성분별 손익
 *
 * 하나만 빠져도 읽는 사람은 "이 화면은 되고 저 화면은 안 되네" 를 배운다.
 *
 * ## 눈과 귀 둘 다
 *
 * 카드는 보는 쪽, `Scrubber` 의 `accessibilityLabel` 은 듣는 쪽이다. 카드만
 * 두면 스크린리더에게 차트가 침묵하고, 라벨만 두면 눈으로 못 읽는다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const PREVIEW = 'src/sim/CurvePreview.tsx';
const RESULTS = 'src/sim/ResultsWindow.tsx';

describe('세 차트가 모두 커서를 받는다', () => {
  it('커브 미리보기의 두 차트가 스크러빙을 켠다', () => {
    const src = read(PREVIEW);
    /* **JSX prop 만** 센다 — 주석 안에도 같은 낱말이 있어서 문자열을 그냥 세면
     * 3이 나온다(실측). 줄 하나를 통째로 차지한 prop 만 잡는다. */
    expect(src.match(/^\s+enableScrubbing$/gm)?.length ?? 0).toBe(2);
    expect(src.match(/onScrubberPositionChange=\{setHoverIdx\}/g)?.length ?? 0).toBe(2);
  });

  it('성분 경로 차트도 켠다', () => {
    const src = read(RESULTS);
    expect(src).toMatch(/enableScrubbing/);
    expect(src).toMatch(/onScrubberPositionChange=\{setPathIdx\}/);
  });

  it('세 차트에 Scrubber 가 실제로 서 있다', () => {
    expect(read(PREVIEW).match(/<Scrubber/g)?.length ?? 0).toBe(2);
    expect(read(RESULTS).match(/<Scrubber/g)?.length ?? 0).toBe(1);
  });
});

describe('눈으로 읽는 카드', () => {
  it('세 차트가 백테스트와 같은 카드를 쓴다 — 자기 카드를 만들지 않는다', () => {
    for (const f of [PREVIEW, RESULTS]) {
      expect(read(f), f).toMatch(/from '@\/ui\/ReadoutCard'/);
      expect(read(f), f).toMatch(/<ReadoutCard/);
    }
  });

  it('카드가 그림 밖으로 나가지 않게 같은 클램프를 지난다', () => {
    /* 두 화면이 각자 클램프하면 CDS 가 눈금 폭을 바꾸는 날 갈린다.
     *
     * 2026-08-20 에 경로가 한 겹 깊어졌다: 표면이 `readoutLeft` 를 직접 부르는
     * 대신 `placeReadout`(상자의 CSS 변수에 이미 클램프된 값을 적는다)을
     * 지난다 — 커서를 따라가는 데 리렌더가 필요 없게 만든 변경이다. 명제는
     * 그대로이고 핀만 갱신했다(`readout-card-width` 가 그 둘이 같은 식임을 본다). */
    for (const f of [PREVIEW, RESULTS]) {
      expect(read(f), f).toMatch(/placeReadout\(/);
    }
  });

  it('카드가 기준으로 삼을 상자가 relative 다', () => {
    /* `.sr-plot` 이 아니면 카드가 페이지 기준으로 떠서 엉뚱한 곳에 선다. */
    for (const f of [PREVIEW, RESULTS]) {
      expect(read(f), f).toMatch(/className="sr-plot"/);
    }
    expect(read('src/theme/type.css')).toMatch(/\.sr-plot \{[^}]*position: relative/);
  });
});

describe('귀로 듣는 라벨', () => {
  it('세 스크러버가 전부 라벨 함수를 받는다 — 기본 문구에 맡기지 않는다', () => {
    expect(read(PREVIEW)).toMatch(/accessibilityLabel=\{curveScrubLabel\}/);
    expect(read(PREVIEW)).toMatch(/accessibilityLabel=\{timeScrubLabel\}/);
    expect(read(RESULTS)).toMatch(/accessibilityLabel=\{pathScrubLabel\}/);
  });
});

describe('이름이 한 곳에서 나온다', () => {
  it('케이스 이름은 SIM_CASES 가 원천이다 — 칩과 카드가 같은 말을 한다', () => {
    const src = read(PREVIEW);
    expect(src).toMatch(/const CASE_LABEL[\s\S]{0,120}SIM_CASES\.map/);
  });

  it('성분 이름은 워터폴·표와 같은 목록이다', () => {
    /* 세 곳이 각자 목록을 들면 하나만 고쳐지는 날이 온다. */
    const src = read(RESULTS);
    expect(src).toMatch(/const PATH_ROWS = \[\.\.\.SWAP_PARTS, \.\.\.BOND_PARTS\]/);
  });

  it('채권 성분은 북에 채권이 있을 때만 선다 — 카드에서도', () => {
    const src = read(RESULTS);
    expect(src).toMatch(/paths\.hasBond \|\| !BOND_SERIES\.has/);
  });
});
