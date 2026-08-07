/**
 * 숫자 표기. krw-fi-pms의 lib/format.ts에서 이 화면이 실제로 쓰는 것만 가져왔다
 * (원본은 일곱 화면이 나눠 쓰던 열 개 남짓이었다).
 *
 * 원 단위는 표기하지 않는다: 억/만 아래 자릿수는 이 화면의 어떤 판단도 바꾸지
 * 않으면서 자릿수만 늘린다.
 */

const GROUPED = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** 차트 축·표의 원화 표기: ≥1억 → "N.N억", ≥1만 → "N만", 그 아래는 그냥 자릿수.
 *
 * 만 단위가 있는 이유: 손익 축은 1e4~1e8 구간에 살고, 억으로만 찍으면 눈금이
 * 전부 "0.0억"으로 뭉갠다. */
export function formatKrwAxis(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e8) return `${(value / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${GROUPED.format(Math.round(value / 1e4))}만`;
  return GROUPED.format(Math.round(value));
}

/** 부호를 명시한 원화 표기 ("+3.2억", "−450만").
 *
 * 손익 표면은 전부 이쪽이다. 양수 앞의 +가 없으면 독자가 부호를 색에만 의존해서
 * 읽게 되고, 색은 흑백 인쇄와 색각 이상에서 사라진다.
 *
 * 음수 부호는 U+2212(−)가 아니라 ASCII 하이픈이다. Malgun Gothic에 U+2212
 * 글리프가 없어서 두부(􏿽)로 렌더링된다 — 실제로 겪었다. */
export function formatKrwAxisSigned(value: number): string {
  return value > 0 ? `+${formatKrwAxis(value)}` : formatKrwAxis(value);
}

/** bp 표기. 소수 둘째 자리까지 — 그 아래는 이 화면의 어떤 결정도 안 바꾼다. */
export function formatBp(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}bp`;
}

/** 퍼센트 표기 (금리). 소수 둘째 자리. */
export function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(2)}%`;
}
