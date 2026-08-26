/* v1 패리티 레인 P2 의 남은 셋.
 *
 * (LANE-v1-parity-2026-08-20.md) 나머지 P2 항목은 대조해 보니 이미 덮여
 * 있거나 v2 가 **의도적으로 다르게** 간 것이었다. 그 판정을 여기 적어 둔다 —
 * 다음 사람이 "이건 왜 안 했지" 하고 되짚지 않게:
 *
 *   candle-mode      **오너가 제거 지시** [2026-08-18 — "주봉 월봉 없애도"].
 *                    v2 에 그 기능이 없는 것이 맞다.
 *   readout-parity   `readout-card` 가 카드의 계약을 덮는다. v1 의 "팝업이
 *                    미리보기의 모든 줄을 렌더" 는 v2 에 별도 팝업이 없어
 *                    성립하지 않는다 — pane 자체가 그 카드다.
 *   failure-visible  v2 는 에러 상태에 **버튼을 안 단다** [OWNER]. v1 의
 *                    "토스트 아닌 버튼" 과 정반대이고, `error-boundary` 가
 *                    그 결정을 이미 핀하고 있다.
 *   sort-key/reorder `row-order` 로 갔다.
 *   freshness        `freshness` 로 갔다.
 *   guard-hygiene    `guard-hygiene` + `_source` 로 갔다.
 *   date-labels      CDS 가 축 라벨을 그린다. 사다리 규칙을 우리가 정할지는
 *                    **오너 결정 대기**(레인 문서 P2 표).
 *   backtest-back    `backtest-book` 이 북의 계약을, `floating-window` 가 창의
 *                    URL 수명을 덮는다.
 *
 * 남은 셋만 여기 있다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { stripComments } from './_source';

const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('52주 칸은 읽는 칸이다 — 누르는 칸이 아니다', () => {
  const table = () => stripComments(read('src/table/InstrumentTable.tsx'));

  it('정렬은 변화 열에만 걸린다 — 52주·위치는 정렬 슬롯에 안 들어간다', () => {
    /* 헤더가 눌리는 것처럼 보이면 읽는 사람은 누른다. 아무 일도 안 일어나면
     * 그때부터 그 표의 다른 헤더도 안 믿는다. */
    const src = read('src/table/columns.ts');
    expect(src).toMatch(/Neither 52주 nor 위치 is sortable/);
  });

  it('52주 칸에 방향 색·틴트가 없다', () => {
    /* 이 칸은 수준의 자리를 말하지 방향을 말하지 않는다. 빨강/파랑이 들어오면
     * 상승·하락을 주장하는 것처럼 읽힌다. */
    const src = table();
    const cell = src.slice(src.indexOf('rangeText(row.rangeHigh'), src.indexOf('RangeTrack now='));
    expect(cell).not.toMatch(/tintStyle|directionClass|--sr-up|--sr-down/);
  });

  it('트랙의 잉크는 방향색이 아니다', () => {
    const css = read('src/theme/type.css');
    const block = css.slice(css.indexOf('.sr-track-mark'), css.indexOf('.sr-track-mark') + 260);
    expect(block).not.toMatch(/--sr-up|--sr-down/);
  });
});

describe('가로로 스크롤되는 영역은 자기를 클립하지 않는다', () => {
  /* 잘린 채로 스크롤도 안 되면 그 뒤의 내용은 **존재하지 않는 것이 된다**.
   * 화면은 멀쩡해 보이고, 읽는 사람은 열이 그것뿐인 줄 안다. */

  it('넓은 표면들이 스크롤 컨테이너 안에 있다', () => {
    /* v2 에서 가로로 넘치는 것은 RV 의 세 표면이다(점수 히트맵·섹터 레인·
     * 테너 히트맵). 세 곳이 같은 클래스를 쓰므로 규칙이 한 벌이다. */
    const css = read('src/theme/type.css');
    expect(css).toMatch(/\.sr-rv-scroll \{[^}]*overflow-x: auto/);
    for (const f of ['src/rv/ScoreHeat.tsx', 'src/rv/SectorLane.tsx', 'src/rv/TenorHeat.tsx']) {
      expect(read(f), f).toMatch(/className="sr-rv-scroll"/);
    }
  });

  it('overflow-x: hidden 으로 스스로를 자르는 표면이 없다', () => {
    const css = stripComments(read('src/theme/type.css'));
    const offenders = [...css.matchAll(/([.#][\w-]+)\s*\{[^}]*overflow-x:\s*hidden/g)].map(
      (m) => m[1],
    );
    expect(offenders).toEqual([]);
  });

  it('고정 열은 sticky 다 — 스크롤해도 어느 행인지 잃지 않는다', () => {
    const css = read('src/theme/type.css');
    expect(css).toMatch(/position: sticky/);
  });
});

describe('핀은 조용하다', () => {
  it('핀 상태가 평범한 state 다 — 제스처나 모션 트리거가 아니다', () => {
    /* v1 은 핀할 때 오른쪽 pane 이 애니메이션하면서 유령 프레임을 남겼다.
     * v2 는 URL/state 로만 바뀐다. */
    const page = stripComments(read('src/app/page.tsx'));
    expect(page).not.toMatch(/AnimatePresence[\s\S]{0,200}pin/i);
  });

  it('미리보기 pane 이 진입 애니메이션을 켜지 않는다', () => {
    /* 행을 훑으면 pane 이 매번 다시 마운트된다 — 거기 애니메이션이 붙으면
     * 폴리시가 아니라 스트로브다(그 판단이 PreviewPane 주석에 있다). */
    expect(read('src/ui/PreviewPane.tsx')).not.toMatch(/animate=\{true\}/);
  });
});
