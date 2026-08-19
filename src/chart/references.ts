/* CD 91일 + 기준금리 — 모든 %-단위 차트가 지고 다니는 두 기준선
 * [OWNER, 2026-07-31: "CD와 기준금리는 항상 같이 그린다"].
 *
 * 한 지시이지 두 개가 아니다. CD 는 모든 원화 IRS 호가가 맞물리는 변동 다리이고,
 * 기준금리는 그 CD 가 따라가는 것이다. 그래서 금리는 **둘 다에 대해 읽거나 둘 다
 * 없이 읽는다.** v1 이 처음에 기준금리만 그렸다가 되돌린 근거가 그것이다 — "3M
 * 노드가 곧 CD 니까 이미 화면에 있다" 는 스무 개 차트 중 하나에만 맞는 말이었다.
 *
 * ── v2 가 v1 과 다른 점, 그리고 같은 점 ─────────────────────────────────────
 * v1 은 SVG 를 직접 그려서 계단을 폴리라인으로 만들었다. v2 는 CDS `LineChart` 를
 * 부르고, 그 시리즈는 **x 인덱스마다 값 하나**를 받는다. 그래서 이 모듈은 세그먼트가
 * 아니라 축 길이만큼의 배열을 낸다. 계단은 `curve: 'stepAfter'` 가 그린다.
 * 규칙은 v1 것 그대로다:
 *
 *   각진 모서리. 정책금리는 평평하다가 뛴다. 두 결정 사이를 사선으로 이으면 시행된
 *   적 없는 금리를, 시행된 적 없는 날에 그리는 것이다. → `stepAfter`.
 *
 *   `through` 를 절대 넘지 않는다. 워크북이 금통위를 지나 갱신되지 않았으면 백엔드가
 *   스텝을 거기서 끊는다(`backend/app/policy.py`). 축 끝까지 늘이는 것이 바로 그
 *   bound 가 막으려는 실패이고, 그렇게 그려도 화면은 멀쩡해 보인다. → 그 뒤는 null.
 *
 *   **위치가 아니라 날짜로 맞춘다.** 서로 다른 두 시리즈의 150점 프리뷰는 각자
 *   솎아지므로 i 번째가 같은 날이 아니다. 그냥 zip 하면 다른 주의 CD 레벨을 이번 주
 *   금리 옆에 그리게 된다 — 그럴듯해 보이고 그냥 틀린 차트다.
 *
 *   한 단위에 축 하나. %-차트에서 셋은 같은 y 축을 쓴다(CDS 가 도메인을 합쳐준다).
 *   bp 차트는 §referenceMode 참조.
 */

import type { PolicyStep, Unit } from "@/lib/api";

/** 투영 대상은 **날짜 축**이면 된다. `HistoryPoint[]` 로 받지 않는 이유: 주봉/월봉
 * 캔들도 같은 기준선을 지고, 캔들에는 `v` 가 없다. 이 함수들이 만지는 필드는
 * `t` 뿐이다. */
export type DateAxis = readonly { t: string }[];

/** `iso` 이상인 첫 인덱스, 없으면 길이. */
function indexAtOrAfter(axis: DateAxis, iso: string): number {
  let lo = 0;
  let hi = axis.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (axis[mid].t < iso) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 다른 시리즈를 이 축의 날짜에 얹는다. 값은 **그 날짜 이하의 마지막 관측**이고,
 * 시리즈가 시작되기 전 구간은 `null` 이다.
 *
 * 앞으로 끌고 가는(carry-forward) 이유: CD 는 매일 고시되는 픽싱이라 다음 고시
 * 전까지 그 값이 유효하다. 반대로 **뒤로는 절대 안 끌어온다** — 아직 없던 값을
 * 그리는 것이므로. 축이 시리즈보다 촘촘하든 성기든 결과가 같다.
 */
export function alignByDate(
  axis: DateAxis,
  points: readonly { t: string; v: number }[],
): (number | null)[] {
  const out: (number | null)[] = new Array(axis.length).fill(null);
  let j = 0;
  let held: number | null = null;
  for (let i = 0; i < axis.length; i++) {
    while (j < points.length && points[j].t <= axis[i].t) {
      held = points[j].v;
      j++;
    }
    out[i] = held;
  }
  return out;
}

/**
 * 기준금리를 축 위에 얹는다 — 그 날짜에 **시행 중이던** 금리.
 *
 * `null` 인 자리가 둘 있고 둘 다 의도적이다:
 *   - 첫 결정보다 앞선 구간: 그 시점에 뭐였는지 이 페이로드가 말해주지 않는다.
 *   - `through` 이후: 백엔드가 보증을 끊은 자리다.
 * 둘 다 `connectNulls` 를 켜면 안 되는 이유이기도 하다 — 이으면 없는 구간을
 * 직선으로 메운다.
 */
export function policyByDate(
  axis: DateAxis,
  policy: PolicyStep | undefined,
): (number | null)[] {
  const out: (number | null)[] = new Array(axis.length).fill(null);
  if (!policy || !policy.steps.length || axis.length === 0) return out;

  // 마지막으로 그릴 수 있는 인덱스: `through` 이하의 가장 최근 점.
  const k = indexAtOrAfter(axis, policy.through);
  const end = k < axis.length && axis[k].t === policy.through ? k : k - 1;
  if (end < 0) return out;

  let j = 0;
  let held: number | null = null;
  for (let i = 0; i <= end; i++) {
    while (j < policy.steps.length && policy.steps[j].date <= axis[i].t) {
      held = policy.steps[j].rate;
      j++;
    }
    out[i] = held;
  }
  return out;
}

/**
 * 이 단위의 차트가 기준선을 어떻게 지는가.
 *
 *   `shared`  %-단위. 셋이 **같은 축**을 쓰고 CDS 가 도메인을 합친다. 같은 단위를
 *             두 스케일로 비교하는 것보다 축 하나가 낫다 — 축이 둘이면 3.4% 와
 *             2.9% 가 같은 높이에 그려질 수 있고, 그건 비교가 아니라 착시다.
 *   `own`     bp(스프레드·플라이)·ratio(변동성)·가격(선물). 단위가 달라 축을 공유할
 *             수 없으므로 기준선은 **자기 %축**을 왼쪽에 단다
 *             [OWNER, 2026-08-03 / 좌측 2026-08-14].
 *
 * `none` 은 없다. 한때 있었고, 그 근거("CDS 는 보조축이 없다")가 틀렸다:
 * `LineChart` 의 `yAxis` 가 단수인 것은 그 **래퍼**의 편의일 뿐이고, 한 겹 아래
 * `CartesianChart` 는 `yAxis` 를 배열로 받고 시리즈가 `yAxisId` 로 축을 고른다
 * (`utils/chart.d.ts` 의 `Series.yAxisId`, `CartesianChart.d.ts:37`). 리베이스나
 * 클리핑 같은 대체안을 검토할 필요도 없었다 — 그냥 축을 하나 더 그리면 된다.
 */
export function referenceMode(unit: Unit): "shared" | "own" {
  return unit === "%" ? "shared" : "own";
}
