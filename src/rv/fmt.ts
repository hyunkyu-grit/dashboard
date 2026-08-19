/* RV 화면의 수량 표기 — 한 벌만 둔다 (RvScatter·RankingTable 이 각자 들고 있던
 * `sig` 중복의 정리, 2026-08-19 크리틱 P3).
 *
 * 규칙 둘:
 * 1. 부호 있는 값은 + 를 명시한다 — 표의 이웃 행과 부호로 비교하는 화면이다.
 * 2. **반올림 후 0 은 부호가 없다** — `(-0.04).toFixed(1)` 은 "-0.0" 을 찍는데,
 *    0 은 방향이 아니다(theme/tint.ts 의 같은 판단). 실측: 랭킹 52·64위가
 *    "-0.0σ" 로 서 있었다.
 */

/** 부호 명시 표기. 반올림 결과가 0 이면 부호 없이 "0.0" 류로. */
export function sig(v: number, digits = 1): string {
  const s = v.toFixed(digits);
  if (Number(s) === 0) return (0).toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/** bp 수준 표기 — 소수 첫째 자리 하나로 통일 (리드아웃 `nice()` 와 표
 * `toFixed(1)` 이 같은 양을 188bp / 188.0 두 모양으로 찍던 이원화의 정리). */
export function bp1(v: number): string {
  return v.toFixed(1);
}
