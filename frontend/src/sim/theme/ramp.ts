/* 램프 상수 — src/theme/tokens.css의 미러.
 *
 * CSS 커스텀 프로퍼티를 해석할 수 없는 소비자(캔버스에 묶이는 차트 옵션)를
 * 위한 숫자다. guards/ramp-sync.test.ts가 둘이 어긋나면 실패한다.
 * DOM/SVG 소비자는 계속 CSS var를 써야 한다.
 */

export type Theme = "light" | "dark";

/** 다계열 잉크 농도 — 성분을 색이 아니라 농도로 가른다 [OWNER, 2026-08-06:
 * 색은 부호만 말한다]. 다섯 단계인 이유는 Total Return 성분이 다섯이기
 * 때문이고, 다섯을 넘기면 회색조에서 서로 안 갈린다. */
export const SERIES_OPACITY: Record<Theme, readonly number[]> = {
  light: [1, 0.78, 0.58, 0.42, 0.3],
  dark: [1, 0.74, 0.55, 0.39, 0.27],
};

/** 선 굵기 — 테마 불변, **두 단계뿐이다.**
 *
 * 다섯 단계(2/1.6/1.3/1.1/1)로 시작했다가 화면에서 확인하고 접었다. 인접 차이가
 * 0.2~0.3px라 서브픽셀로 뭉개져 눈에 안 보이고, lightweight-charts의 LineWidth는
 * `1 | 2 | 3 | 4`라 소수를 받지도 않는다 — 차트에 꽂는 순간 타입 에러다.
 *
 * 굵기는 "이 선이 주인공인가"만 말한다. 다섯을 가르는 일은 농도가 진다.
 * tokens.css의 --bw-border / --bw-border-live 와 미러; ramp-sync가 어긋남에서 실패한다. */
export const SERIES_WIDTH: readonly (1 | 2 | 3 | 4)[] = [2, 1, 1, 1, 1];

/** 헤어라인 잉크 농도 — tokens.css의 --bw-border / --bw-border-live
 * color-mix 퍼센트를 미러. SVG가 수백 개의 그리드라인을 칠할 때 var() 조회를
 * 요소마다 지불하지 않으려고 여기 둔다. */
export const EDGE_OPACITY: Record<Theme, { base: number; live: number }> = {
  // 라이트 base는 **0.12로 되돌렸다** — 이식(2026-08-07) 때 --bw-border가
  // --bw-border의 별칭이 됐고, 그 값이 12%다.
  //
  // 여기 있던 값은 0.10이었다. 헤어라인을 Apple Fills 스케일의 한 칸(잉크
  // 4단계)으로 통일하려던 것인데, 이 미러가 가리키는 토큰이 더 이상 그
  // 스케일 위에 있지 않다. 호스트의 0.12는 측정된 값이고(§9, surface pass),
  // 미러는 토큰을 따라가는 쪽이지 토큰에게 값을 지시하는 쪽이 아니다.
  //
  // 다크는 양쪽이 이미 0.16/0.50으로 같았다 — 손대지 않았다.
  light: { base: 0.12, live: 0.4 },
  dark: { base: 0.16, live: 0.5 },
};
