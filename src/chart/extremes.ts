/* **그려진 조각**의 고·저 — 시리즈의 것이 아니라 창의 성질.
 *
 * v1 패리티 레인 P1-1 (LANE-v1-parity-2026-08-20.md).
 *
 * ## 52주 통계와 다른 질문에 답한다
 *
 * 리드아웃의 52주 고/저는 서버가 구운 **고정 창**이다(`range1y`). 이쪽은
 * "지금 내 앞의 그림에서 극값이 어디냐" 라서 그려진 조각에서 클라이언트가 낸다.
 * 그래서 확대하면 따라 움직인다. 페이로드에 넣을 수 없는 이유도 그것이다 —
 * 페이로드 필드는 모든 독자에게 같은 하나의 창을 구워 주는 것이고, 그건
 * 뷰포트 성질의 정반대다.
 *
 * ## 한 번 스캔, 두 소비자
 *
 * 차트의 y 도메인과 표시할 점이 **둘 다 이 결과에서** 나온다. "이게 최고" 라고
 * 찍은 점이 도메인이 늘어난 값과 다를 수 없다 — 두 곳에서 각자 스캔하면
 * 언젠가 갈린다. `zoom.ts` 머리글이 약속한 "하류가 조각의 순수 함수" 가 이것이다.
 *
 * ## 동점 규칙은 **하나**여야 한다
 *
 * v1 은 두 자리에서 서로 다른 규칙을 골랐고 그 차이를 명시했다. v2 도 그대로
 * 간다 — 어느 쪽이든 되지만, 정해 두지 않으면 두 화면이 다른 날을 가리킨다.
 *
 *     **가장 최근** 것이 이긴다.
 *
 * 이유: 이 값이 붙는 자리가 "지금 보고 있는 그림" 이고, 같은 극값을 두 번
 * 찍었다면 읽는 사람이 궁금한 것은 **마지막으로 거기 있었던 때**다. 스캔이
 * `>=`/`<=` 를 쓰는 것이 그 규칙의 전부다.
 */

export interface WindowExtremes {
  /** 창 안에서의 인덱스 — 표식이 앉을 자리. */
  hiIdx: number;
  loIdx: number;
  hi: number;
  lo: number;
}

/** 그려진 값들의 고·저와 그 자리. 그릴 것이 없으면 null.
 *
 * `null` 값(휴장 등)은 건너뛴다 — 0 으로 읽으면 없는 바닥을 만든다. 유한한
 * 값이 하나도 없으면 극값이라는 개념이 없으므로 null 이다. */
export function windowExtremes(values: (number | null | undefined)[]): WindowExtremes | null {
  let hiIdx = -1;
  let loIdx = -1;
  let hi = -Infinity;
  let lo = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    // `>=` / `<=` — 동점이면 가장 최근 것이 이긴다(위 주석).
    if (v >= hi) {
      hi = v;
      hiIdx = i;
    }
    if (v <= lo) {
      lo = v;
      loIdx = i;
    }
  }
  if (hiIdx < 0 || loIdx < 0) return null;
  return { hiIdx, loIdx, hi, lo };
}

/** 차트 y 도메인. **극값과 같은 결과에서** 나온다 — 그래야 "이게 최고" 로 찍은
 * 점이 도메인의 천장과 같은 값이다.
 *
 * `pad` 는 위아래 여유의 비율(0.05 = 5%). 평평한 창(고 === 저)은 폭이 0 이라
 * 비율 여유가 0 이 되므로 절대값으로 벌린다 — 안 그러면 선이 축에 눌린다. */
export function yDomain(e: WindowExtremes, pad = 0.05): { min: number; max: number } {
  const span = e.hi - e.lo;
  const room = span > 0 ? span * pad : Math.max(Math.abs(e.hi) * pad, 0.5);
  return { min: e.lo - room, max: e.hi + room };
}
