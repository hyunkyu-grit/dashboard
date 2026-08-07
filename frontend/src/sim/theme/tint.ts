/* 부호 틴트 — 히트맵 셀의 배경.
 *
 * 규칙 [OWNER, 2026-08-06]: **색은 부호만 말한다.** 크기는 농도가 말한다.
 * 그래서 양수는 --bw-up 계열, 음수는 --bw-down 계열이고, 두 색 사이에
 * 제3의 색조는 없다. 회색조로 인쇄해도 농도 순서가 그대로 남는다.
 *
 * ─ 한 셀에서 색은 한 채널만 쓴다 ─────────────────────────────────────────
 * 틴트가 칠해진 셀의 **텍스트는 잉크다.** 배경이 이미 부호를 말하고 있으므로
 * 숫자까지 같은 색조로 칠하면 사실이 중복될 뿐 아니라 글자가 배경에 먹힌다.
 * 첫 구현이 정확히 그랬고, 화면을 띄우자마자 라이트의 −530.9억이 파랑 위
 * 파랑이 되어 읽히지 않았다.
 *
 * 그때 상한을 낮추면 되는 줄 알았는데, 재보니 **어떤 농도에서도 안 된다**:
 * 같은 부호 틴트 위의 방향색 텍스트는 30%에서 3.0:1, 42%에서 2.5:1, 62%에서
 * 1.8:1이다. 4.5:1을 넘는 지점이 없다. 농도 조절 문제가 아니라 범주적 규칙이다.
 *
 * directionVar()는 **틴트가 없는 곳** 전용이다: 요약 행, 워터폴 라벨, 칩.
 * guards/tint-contrast.test.ts가 두 사실을 다 실측한다.
 *
 * 왜 color-mix를 문자열로 돌려주나: 혼합 비율이 셀마다 다르므로 Tailwind가
 * 만들어 둘 수 있는 클래스가 아니다. 런타임 인라인 스타일이 유일한 방법이고,
 * 브라우저가 토큰을 해석하므로 테마가 뒤집혀도 자동으로 따라온다 (캔버스와
 * 달리 DOM은 var()를 이해한다).
 */

/** 0이 아닌 값이 배경과 구별되지 않는 것을 막는 하한. 이 아래로는 "칠했지만
 * 안 보이는" 상태가 되어, 빈 칸과 작은 값이 같아 보인다. 그건 거짓말이다. */
export const MIN_MIX = 8;

/** 상한. 구속 조건은 **다크에서 잉크 대비**다 — 실측: 다크 62%에서 5.06:1,
 * 75%에서 3.99:1로 깨진다. 라이트는 75%에서도 4.89로 여유가 있다.
 * 55%면 다크에서 5.7:1 언저리라 토큰을 나중에 손봐도 하한이 남는다. */
export const MAX_MIX = 55;

/**
 * @param value  셀의 값. 0이면 틴트 없음(빈 배경).
 * @param scale  이 표에서 |값|의 기준 최댓값. 보통 열/표 전체의 max(|값|).
 *               0 이하이면 비교 대상이 없다는 뜻이라 틴트를 칠하지 않는다.
 */
export function tintFor(value: number, scale: number): string | undefined {
  if (!Number.isFinite(value) || value === 0) return undefined;
  if (!Number.isFinite(scale) || scale <= 0) return undefined;

  // 제곱근 스케일: 선형으로 잡으면 큰 값 하나가 나머지를 전부 옅은 회색으로
  // 눌러버려 표가 "한 칸만 있는" 것처럼 보인다.
  const frac = Math.min(1, Math.sqrt(Math.abs(value) / scale));
  const mix = Math.round(MIN_MIX + frac * (MAX_MIX - MIN_MIX));
  const hue = value > 0 ? "--bw-up" : "--bw-down";
  return `color-mix(in srgb, var(${hue}) ${mix}%, var(--bw-tile))`;
}

/** 방향색 자체 (텍스트용). **틴트가 칠해지지 않은 표면에서만 쓴다** — 위
 * 주석 참조.
 *
 * 0은 방향이 아니므로 잉크로 남는다. 0을 빨강이나 파랑으로 칠하면 있지도 않은
 * 부호를 주장하게 된다. */
export function directionVar(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "var(--bw-ink)";
  return value > 0 ? "var(--bw-up)" : "var(--bw-down)";
}
