/* 미리보기 차트의 **제자리 확대** [v1 OWNER 2026-08-04 — "크게보기 버튼을 안
 * 눌러도 이 창에서 그냥 확대하고 축소하고"].
 *
 * 상태는 값 하나다: **그려지는 인덱스 구간**, 또는 전체를 뜻하는 `null`. 하류의
 * 모든 것(고저, y 도메인, 날짜 라벨, 기준선 정렬, 리드아웃 카드)이 이미 «그려지는
 * 조각» 의 순수 함수라, 확대는 «조각을 고르는 일» 로 끝난다.
 *
 * 여기는 인덱스 공간뿐이다. 픽셀은 컴포넌트의 일이다 — 그래야 이 규칙들이 DOM
 * 없이 검증된다.
 */

export interface ViewRange {
  /** 보이는 첫 점의 인덱스(포함) */
  i0: number;
  /** 보이는 마지막 점의 인덱스(포함) */
  i1: number;
}

/** 이보다 좁히지 않는다. 열 점 아래로 가면 선은 몇 개의 선분이 되고, 커서가
 * 데이터보다 빨리 움직인다. */
export const MIN_SPAN = 10;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * 앵커를 중심으로 확대한다. `anchorFrac` 은 커서가 지금 창의 어디에 있는지(0..1),
 * `factor` 는 폭의 배율(<1 확대, >1 축소).
 *
 * **커서 아래의 날짜가 커서 아래에 남는다** — 이게 이 함수의 계약이다. 가운데를
 * 기준으로 확대하면 보려던 지점이 화면 밖으로 밀려난다.
 *
 * 다 축소되면 `null` 을 돌려준다. "끝까지 축소함" 과 "한 번도 확대 안 함" 은 같은
 * 상태여야 한다 — 둘로 두면 리셋이 두 가지 뜻을 갖는다.
 */
export function zoomRange(
  cur: ViewRange | null,
  len: number,
  anchorFrac: number,
  factor: number,
): ViewRange | null {
  if (len < 2) return null;
  const base = cur ?? { i0: 0, i1: len - 1 };
  const span = base.i1 - base.i0 + 1;
  const nextSpan = clamp(Math.round(span * factor), Math.min(MIN_SPAN, len), len);
  if (nextSpan >= len) return null;
  const frac = clamp(anchorFrac, 0, 1);
  // 앵커의 인덱스를, 새 창에서도 같은 비율 자리에 붙잡아 둔다.
  const anchor = base.i0 + frac * (span - 1);
  const i0 = clamp(Math.round(anchor - frac * (nextSpan - 1)), 0, len - nextSpan);
  return { i0, i1: i0 + nextSpan - 1 };
}

/** 부호 있는 인덱스 델타만큼 민다(양수 = 최근 쪽). 창의 폭은 안 바뀌고 데이터의
 * 양 끝에서 멈춘다. `null` 이 들어오면 `null` 이 나온다 — 전체 구간은 밀 데가 없다. */
export function panRange(
  cur: ViewRange | null,
  len: number,
  deltaIdx: number,
): ViewRange | null {
  if (!cur) return null;
  const span = cur.i1 - cur.i0 + 1;
  const i0 = clamp(Math.round(cur.i0 + deltaIdx), 0, Math.max(0, len - span));
  return { i0, i1: i0 + span - 1 };
}

/** 구간을 잘라낸다. `null` 이면 통째로 — 자르는 자리가 한 곳뿐이어야 점·봉·
 * 기준선이 같은 창을 말한다. */
export function sliceRange<T>(items: T[], range: ViewRange | null): T[] {
  if (!range) return items;
  return items.slice(range.i0, range.i1 + 1);
}
