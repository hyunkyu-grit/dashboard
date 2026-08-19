/* PCHIP — 모노톤 큐빅 보간 (Fritsch–Carlson, 1980). 순수 모듈 (Lab, 2026-08-18).
 *
 * 3D 표면의 테너축이 이걸 쓴다. natural cubic 이 아닌 이유는 실측이다
 * [2026-08-18, sim_portfolio 전 이력]: natural cubic 은 실제 커브의 노드 사이에서
 * **없는 금리를 최대 6.95bp 지어냈고**(CB1 2022-03-29; KTB 5.26bp·IRS 3.35bp),
 * 0.1bp 넘게 지어낸 날이 전체의 36~58% 였다. PCHIP 은 구간 양끝 노드값의
 * [min, max] 를 구조적으로 벗어나지 않는다 — 그 성질을 가드가 무작위 데이터로
 * 검사한다.
 *
 * **그리기 전용이다.** 화면에 숫자로 나가는 값은 전부 실측 노드에서 읽는다 —
 * 보간값이 수치로 나가는 순간 §16(브라우저는 값을 만들지 않는다)이 깨진다.
 */

/** 각 노드에서의 접선 기울기. xs 는 오름차순, 길이 ≥ 2. */
export function pchipSlopes(xs: number[], ys: number[]): number[] {
  const n = xs.length;
  const h: number[] = [];
  const delta: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(xs[i + 1] - xs[i]);
    delta.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  }
  const m = new Array<number>(n).fill(0);
  if (n === 2) {
    m[0] = m[1] = delta[0];
    return m;
  }
  for (let i = 1; i < n - 1; i++) {
    // 부호가 다르거나 어느 쪽이 평평하면 국소 극값 — 기울기 0 이 오버슈트를 막는다.
    if (delta[i - 1] * delta[i] <= 0) {
      m[i] = 0;
    } else {
      // 가중 조화 평균 (Fritsch–Carlson) — 짧은 구간의 기울기가 더 무겁다.
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }
  // 끝점: 한쪽 치우친 3점 공식 + 단조 클램프 (scipy PchipInterpolator 와 같은 규칙).
  m[0] = endSlope(h[0], h[1], delta[0], delta[1]);
  m[n - 1] = endSlope(h[n - 2], h[n - 3], delta[n - 2], delta[n - 3]);
  return m;
}

function endSlope(h0: number, h1: number, d0: number, d1: number): number {
  let m = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
  if (m * d0 <= 0) m = 0;
  else if (d0 * d1 < 0 && Math.abs(m) > 3 * Math.abs(d0)) m = 3 * d0;
  return m;
}

/** 질의점 q 에서의 값. q 는 [xs[0], xs[n-1]] 안이어야 한다 — 외삽하지 않는다:
 * 표면의 x 범위가 곧 노드 범위이고, 바깥을 그리면 없는 만기를 그리는 것이다. */
export function pchipAt(xs: number[], ys: number[], m: number[], q: number): number {
  let i = xs.length - 2;
  for (let k = 0; k < xs.length - 1; k++) {
    if (q <= xs[k + 1]) {
      i = k;
      break;
    }
  }
  const h = xs[i + 1] - xs[i];
  const t = (q - xs[i]) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    ys[i] * (2 * t3 - 3 * t2 + 1) +
    m[i] * h * (t3 - 2 * t2 + t) +
    ys[i + 1] * (-2 * t3 + 3 * t2) +
    m[i + 1] * h * (t3 - t2)
  );
}

/** 노드 (xs, ys) 를 질의 격자 qs 위로. 노드가 하나면 상수, 둘이면 직선과 같다.
 * qs 가 노드 범위 밖이면 null — 구멍은 구멍으로 남는다. */
export function pchipSample(
  xs: number[],
  ys: number[],
  qs: number[],
): (number | null)[] {
  if (xs.length === 0) return qs.map(() => null);
  if (xs.length === 1) return qs.map((q) => (q === xs[0] ? ys[0] : null));
  const m = pchipSlopes(xs, ys);
  const lo = xs[0];
  const hi = xs[xs.length - 1];
  return qs.map((q) => (q < lo || q > hi ? null : pchipAt(xs, ys, m, q)));
}
