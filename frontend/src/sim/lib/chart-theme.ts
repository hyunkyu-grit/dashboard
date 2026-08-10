"use client";

/**
 * 차트가 캔버스에 넘길 색을 한곳에서 만든다.
 *
 * 캔버스는 CSS 변수를 해석하지 못한다 — 날 `var(...)`를 넘기면 예외 없이 아무것도
 * 안 칠한다. 그래서 여기서 theme/bridge의 DOM 프로브로 실제 색 문자열을 뽑고,
 * 결과는 assertNoCssVars를 통과한 것만 내보낸다.
 *
 * 색 규율 (docs/DESIGN.md):
 *  - 성분 5개는 **색조가 아니라 잉크 농도**로 가른다. 부호가 오가는 선을 부호색
 *    으로 칠하면 색이 거짓말을 한다(채권평가는 부호가 바뀐다).
 *  - 굵기는 두 단계뿐 — 주인공인가 아닌가. LineWidth 타입이 1|2|3|4라
 *    소수는 애초에 못 넣는다.
 *  - 방향색은 **부호가 고정된 표면**에서만 쓴다: 워터폴 막대, 요약 숫자.
 */

import {
  assertNoCssVars,
  resolveCaseColor,
  resolveDirection,
  resolveInk,
  resolveLine,
  resolveTheme,
  withAlpha,
} from "@/sim/theme/bridge";
import { currentTheme } from "@/sim/theme/bridge";
import { EDGE_OPACITY, SERIES_OPACITY, SERIES_WIDTH } from "@/sim/theme/ramp";
import type { CaseId } from "@/sim/types/simulation-port";

export interface SimChartTheme {
  background: string;
  ink: string;
  /** 축 눈금·라벨 */
  axis: string;
  /** 그리드선 */
  grid: string;
  /** y=0 기준선 — 부호를 읽는 앵커라 그리드보다 진하다 */
  zeroLine: string;
  /** 차트 선 (사우론 --bw-line 계보). **기준선** 전용이다 —
   * "지금 시장이 이렇다"를 말하는 선.
   * 2026-08-07 에 하락 파랑을 떠나 액센트 전경으로 옮겼다. 선은 부호가 없어
   * 방향색과 같은 색을 쓰던 것이 §9 가 감수하던 비용이었는데, 액센트가
   * 돌아오면서 그 충돌 자체가 없어졌다. 이 이름은 색이 아니라 역할이다. */
  line: string;
  /** 성분 선: 잉크 농도 램프 */
  seriesColors: string[];
  seriesWidths: readonly (1 | 2 | 3 | 4)[];
  /** 방향색 — 부호가 고정된 표면 전용 */
  up: string;
  down: string;
  /** 방향색의 옅은 채움 (막대 몸통) */
  upFill: string;
  downFill: string;
  /** 시나리오 케이스 색 [OWNER, 2026-08-10] — tokens.css --bw-case-* */
  case: Record<CaseId, string>;
}

/** 서버 렌더용 자리표시자.
 *
 * `"use client"` 컴포넌트도 Next는 서버에서 **프리렌더한다.** 거기엔 document가
 * 없어서 브릿지의 DOM 프로브가 던진다 — 실제로 이 화면이 그렇게 깨졌다.
 *
 * 서버에서는 아무것도 칠하지 않는다(차트는 ResizeObserver가 크기를 줄 때까지
 * 비어 있고, 그건 클라이언트에서만 일어난다). 그래서 이 값들은 화면에 도달하지
 * 못하며, 첫 클라이언트 렌더가 실제 색으로 갈아친다.
 *
 * 색을 지어내지 않고 전부 투명으로 둔다: 만에 하나 이 값이 화면에 닿으면
 * **아무것도 안 보이는** 편이 그럴듯한 가짜 색으로 보이는 것보다 낫다 —
 * 전자는 버그로 읽히고 후자는 데이터로 읽힌다. */
const SSR_PLACEHOLDER: SimChartTheme = {
  background: "transparent",
  ink: "transparent",
  axis: "transparent",
  grid: "transparent",
  zeroLine: "transparent",
  line: "transparent",
  seriesColors: ["transparent", "transparent", "transparent", "transparent", "transparent"],
  seriesWidths: SERIES_WIDTH,
  up: "transparent",
  down: "transparent",
  upFill: "transparent",
  downFill: "transparent",
  case: { base: "transparent", bull: "transparent", bear: "transparent", crisis: "transparent" },
};

export function getSimChartTheme(): SimChartTheme {
  if (typeof document === "undefined") return SSR_PLACEHOLDER;
  const theme = currentTheme();
  const surfaces = resolveTheme();
  const ink = resolveInk();
  const edge = EDGE_OPACITY[theme];
  const up = resolveDirection(true);
  const down = resolveDirection(false);

  const out: SimChartTheme = {
    background: surfaces.tile,
    ink,
    line: resolveLine(),
    axis: withAlpha(ink, 0.5),
    grid: withAlpha(ink, edge.base),
    // 그리드의 두 배 남짓. 0선은 다른 가로선과 같은 무게로 보이면 안 된다 —
    // 그 선이 손익의 부호를 가른다.
    zeroLine: withAlpha(ink, edge.live),
    seriesColors: SERIES_OPACITY[theme].map((o) => withAlpha(ink, o)),
    seriesWidths: SERIES_WIDTH,
    up,
    down,
    upFill: withAlpha(up, 0.22),
    downFill: withAlpha(down, 0.22),
    case: {
      base: resolveCaseColor("base"),
      bull: resolveCaseColor("bull"),
      bear: resolveCaseColor("bear"),
      crisis: resolveCaseColor("crisis"),
    },
  };

  assertNoCssVars(out, "simChartTheme");
  return out;
}

/** D+n을 차트 시간축의 UTC 타임스탬프로. 기준일이 비었거나 파싱 불가면
 * 고정 원점으로 떨어진다 — 차트가 사라지는 것보다 축이 틀린 편이 낫고,
 * 축이 틀리면 눈에 보인다. */
export function dayToTime(baseDate: string, day: number): number {
  const baseMs = baseDate && !Number.isNaN(Date.parse(baseDate)) ? Date.parse(baseDate) : Date.UTC(2025, 0, 1);
  return Math.floor(baseMs / 1000) + day * 86400;
}
