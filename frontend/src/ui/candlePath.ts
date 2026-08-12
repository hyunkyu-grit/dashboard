/* 캔들 몸통과 꼬리의 SVG 경로 [OWNER, 2026-08-13].
 *
 * **막대 하나에 요소 하나가 아니다.** 10년 주봉이 553개고 열이 셋이니 소박하게
 * 그리면 `<rect>` + `<line>` 이 3,300개 붙는다. 방향별로 몸통 경로 하나, 꼬리
 * 경로 하나 — 차트당 요소 넷이다. 선 모드가 폴리라인 하나인 것과 같은 규율이고,
 * 색이 네 조합뿐이라 더 쪼갤 이유도 없다(상승/하락 × 몸통/꼬리).
 *
 * 순수 함수인 것은 게이트를 위해서다. 픽셀을 만드는 규칙 — 몸통 최소 높이,
 * 꼬리가 몸통 뒤로 지나가는 것, 폭이 간격보다 넓어지지 않는 것 — 은 눈으로
 * 보면 "대충 맞아 보이는" 종류라 `guards/candle-mode.test.ts` 가 숫자로 잡는다.
 *
 * 좌표는 호출부의 `x(i)`/`y(v)` 를 그대로 받는다. 이 모듈은 스케일을 모른다.
 */

import type { OhlcBar } from "@/lib/api";

/** 한 방향(상승 또는 하락)이 그리는 두 경로. */
export interface CandleGeometry {
  /** 몸통 — 채운다. 빈 문자열이면 그릴 것이 없다. */
  bodies: string;
  /** 꼬리 — 선으로 긋는다. */
  wicks: string;
}

export interface CandlePaths {
  /** 종가 ≥ 시가 — 상승 빨강 (§9). */
  up: CandleGeometry;
  /** 종가 < 시가 — 하락 파랑. */
  down: CandleGeometry;
}

/** 몸통이 이보다 얇아지지 않는다. 시가 = 종가인 봉(도지)은 높이 0 이라
 * 그리지 않으면 그 날이 화면에서 사라진다 — 없는 날과 안 움직인 날은 다르다. */
export const MIN_BODY_H = 1;

/** 몸통 폭: 간격의 이만큼. 1 이면 봉끼리 붙어 한 덩어리가 되고, 너무 작으면
 * 실오라기가 된다. */
const WIDTH_RATIO = 0.62;

/** 아무리 성글어도 이보다 넓어지지 않는다 — 확대 끝까지 간 서너 봉이 화면을
 * 가로지르는 블록이 되는 것을 막는다. */
const MAX_BODY_W = 14;

/** 봉 하나의 몸통 폭(px). 간격은 이웃한 두 x 의 거리다. */
export function bodyWidth(step: number): number {
  return Math.max(1, Math.min(MAX_BODY_W, step * WIDTH_RATIO));
}

/** 방향별 몸통·꼬리 경로.
 *
 * 꼬리는 고가에서 저가까지 **한 번에** 긋는다 — 몸통 위/아래로 나눠 긋지 않는
 * 것은 몸통이 불투명하게 덮으므로 결과가 같고, 경로가 절반이기 때문이다.
 */
export function candlePaths(
  bars: readonly OhlcBar[],
  x: (i: number) => number,
  y: (v: number) => number,
  width: number,
): CandlePaths {
  const out: CandlePaths = {
    up: { bodies: "", wicks: "" },
    down: { bodies: "", wicks: "" },
  };
  const upBody: string[] = [];
  const upWick: string[] = [];
  const downBody: string[] = [];
  const downWick: string[] = [];
  const half = width / 2;

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const cx = x(i);
    const x0 = (cx - half).toFixed(1);
    const x1 = (cx + half).toFixed(1);
    const yo = y(b.o);
    const yc = y(b.c);
    // y grows downward, so the TOP of the body is the smaller y
    const top = Math.min(yo, yc);
    const bottom = Math.max(top + MIN_BODY_H, Math.max(yo, yc));
    const body = `M${x0},${top.toFixed(1)}H${x1}V${bottom.toFixed(1)}H${x0}Z`;
    const wick = `M${cx.toFixed(1)},${y(b.h).toFixed(1)}V${y(b.l).toFixed(1)}`;
    // 시가 = 종가 인 봉은 상승으로 친다 — 한쪽으로 정하기만 하면 되고, 국내
    // 관행이 보합을 빨강 쪽에 두는 것과 같다.
    if (b.c >= b.o) {
      upBody.push(body);
      upWick.push(wick);
    } else {
      downBody.push(body);
      downWick.push(wick);
    }
  }

  out.up.bodies = upBody.join("");
  out.up.wicks = upWick.join("");
  out.down.bodies = downBody.join("");
  out.down.wicks = downWick.join("");
  return out;
}
