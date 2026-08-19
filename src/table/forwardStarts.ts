/* 포워드 시작점 — 목록과 해석. 컴포넌트 밖에 있는 이유는 DOM 없이 검증하기
 * 위해서다(`orderRows` 와 같은 이유).
 *
 * 시작점은 21개이고(`forwards.py::START_POINTS`) 표는 시작-우선으로 정렬돼
 * 있으므로, 목록은 **행에서** 나온다. 상수 배열을 하나 더 두면 백엔드가 시작점을
 * 바꾼 날 조용히 어긋나고, 어긋난 쪽을 고르면 빈 표가 나온다. */

import type { Group, Row } from "./rows";

/** 행이 실제로 존재하는 시작점, 표에 나오는 순서 그대로(= 오름차순). */
export function startPoints(rows: Row[]): string[] {
  const seen: string[] = [];
  for (const r of rows) {
    if (r.group === "forward" && r.startLabel && !seen.includes(r.startLabel)) {
      seen.push(r.startLabel);
    }
  }
  return seen;
}

/**
 * URL 의 `?fs=` 를 실제로 적용할 값으로 바꾼다.
 *
 * 두 경우에 **필터를 버린다**:
 *   - 포워드 탭이 아닐 때 — 다른 탭의 행에는 시작점이 없으니 적용하면 표가 통째로
 *     비고, 읽는 사람에게는 데이터가 없는 것과 구분되지 않는다.
 *   - 이 데이터에 없는 시작점일 때(`?fs=7Y`, 오래된 링크) — 같은 이유다.
 *
 * 즉 필터는 **결과가 비지 않을 때만** 산다. 빈 표는 사실을 말하는 게 아니라
 * 고장으로 읽힌다.
 */
export function resolveStart(
  param: string | undefined,
  starts: string[],
  group: Group,
): string | undefined {
  if (group !== "forward") return undefined;
  if (!param || !starts.includes(param)) return undefined;
  return param;
}

/** 탭의 행 + 시작점 필터. 한 군데서 같이 거르는 이유는 둘이 서로를 전제하기
 * 때문이다 — 시작점은 포워드 탭에서만 의미가 있다. */
export function rowsFor(rows: Row[], group: Group, start?: string): Row[] {
  return rows.filter(
    (r) => r.group === group && (start === undefined || r.startLabel === start),
  );
}
