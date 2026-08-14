/* 커브 표면의 기하 — 순수 모듈 (Lab, 2026-08-14).
 *
 * 좌표만 만든다. React 도 SVG 도 payload 도 모른다 — 그래야
 * guards/yield-surface.test.ts 가 화면을 띄우지 않고 투영 자체를 검사한다.
 * `introCurves.ts` 가 같은 이유로 순수한 것과 같다.
 *
 * ── 작도법은 인트로에서 배운 것을 그대로 쓴다 ─────────────────────────────
 * 같은 리포의 인트로 커튼이 2026-08-14 에 같은 기하(X=만기, 깊이=시간,
 * Y=금리)를 실측으로 깎았고, 그 교훈 셋을 여기서 다시 발견하지 않는다.
 *
 *   1. **floating horizon** (1970년대). 먼 열부터 그리고 가까운 열이 자기
 *      아래를 페이지 색으로 채우며 덮는다. 가림이 곧 깊이 단서라 **흑백에서
 *      그대로 성립한다** (§5 monochrome-first).
 *   2. **밀도가 입체를 만든다.** 표본이 몇 개뿐이면 아무리 잘 배치해도 "선
 *      몇 개" 로 읽힌다. 인트로는 실측 9장 사이를 보간해 49슬라이스로 채웠다.
 *   3. **리브(테너 방향 격자)는 넣지 않는다.** 인트로가 두 번 넣어 보고 뺐다 —
 *      열의 세로 위치를 레벨이 정하므로 리브가 위아래로 튀어 면이 아니라
 *      그물이 된다.
 *
 * ── 사다리만 반대로 간다, 그리고 그것이 실측이다 ──────────────────────────
 * 인트로는 사다리를 **작게** 잡았다(RIDGE_RISE 0.58). 그 그림의 약속이
 * "10년치 레벨 레인지가 한 화면에" 라서, 사다리가 레벨을 이기면 2016년 1.2%
 * 커브가 2026년 4.1% 커브보다 위에 그려지는 것이 곧 실패였다.
 *
 * 이 화면의 약속은 다르다 — **커브 모양이 언제 어떻게 바뀌었나** 이고, 그러려면
 * 시간이 읽히는 축이어야 한다. 그리고 이 데이터에는 인트로가 안 겪은 문제가
 * 있다: **오늘 금리가 10년 레인지의 꼭대기 근처**(4.10% / 0.61~4.52%)라
 * 최신 커브가 맨 앞에 서면 그대로 **벽**이 되어 과거를 가린다.
 *
 * 실측했다(525 주별 능선, 실제 페이로드):
 *
 *     RISE   그린 능선  완전히 가린 능선   역전 능선 보임
 *     0.55      525      352 (67.0%)          —
 *     0.62      132       58 (43.9%)      26/40 (65%)
 *     0.70      132       43 (32.6%)      32/40 (80%)
 *
 * 그래서 **RISE 0.70** 이다. 더 올리면 금리 몫(SPAN)이 0.30 아래로 떨어져
 * 커브 모양 자체가 납작해진다 — 이 화면이 존재하는 이유가 그때 사라진다.
 *
 * 깊이 방향도 쟀다. 최신을 **뒤**에 두면 전체 가림은 32.6% → 14.4% 로 줄지만
 * 역전 에피소드 가시성은 80% → 75% 로 오히려 나빠지고, 도메인 관례(NYT
 * Upshot 2015 이후의 3-D yield curve, dqydj)와 어긋나며, 매일 보는 화면에서
 * 오늘이 제일 멀어진다. **최신이 앞이다.**
 *
 * 남은 32.6% 는 정보 손실이 아니라 **부분화소 적층**이다: 능선 132개가 상자
 * 높이의 0.70 을 나눠 쓰므로 한 능선의 몫이 2~3px 이다. 어느 날짜든 값은
 * 페이로드에서 hover 로 읽히고(그림이 아니라 데이터에서), 그것이 이 화면에
 * 단면 2D 가 붙어 있는 이유다.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Domain {
  min: number;
  max: number;
}

/** 맨 뒤 능선이 맨 앞보다 위로 밀리는 몫 — 상자 높이에 대한 비. 위 실측. */
export const RIDGE_RISE = 0.7;

/** 한 능선이 금리 범위에 쓰는 세로 몫. 0.30 아래로 내려가면 커브가 납작해진다. */
export const RIDGE_SPAN = 1 - RIDGE_RISE;

/** 맨 뒤가 오른쪽으로 밀리는 몫 — 오블리크 투영의 가로 성분. 0 이면
 * 리지라인(깊이 없음), 크면 아이소메트릭에 가까워진다. 인트로의 0.2 보다
 * 조금 큰 것은 이 화면이 축 라벨을 갖기 때문이다 — 뒤쪽 능선의 왼쪽 끝이
 * 앞쪽 능선에 덜 겹쳐야 연도 라벨이 설 자리가 난다. */
export const RIDGE_SKEW = 0.22;

/**
 * 능선 하나가 세로로 갖는 몫(px). **1 이다** [OWNER, 2026-08-14 —
 * "자연스럽게 사이사이에 보간하기"].
 *
 * 첫 판은 2.4 였고 **선 다발로 읽혔다**. 인트로 레인이 같은 지적을 먼저 받고
 * 같은 답을 냈다 — 표본이 성기면 아무리 잘 배치해도 "선 몇 개" 로 읽히고,
 * 3차원으로 읽히는 서피스 플롯은 예외 없이 표본 사이를 채운다. 픽셀당 한
 * 장이면 이웃 능선의 채움이 거의 완전히 겹쳐, 띠와 띠 사이의 빈틈이 사라지고
 * 하나의 지형이 된다.
 */
export const RIDGE_PITCH = 1;

/** 그릴 능선 한 장. `at` 은 **페이로드 열 좌표계의 소수 위치**다. */
export interface Slice {
  /** 열 좌표. 정수면 실측 열, 아니면 이웃 둘 사이의 보간이다. */
  at: number;
  /** 실측 열인가. */
  anchor: boolean;
}

/**
 * 그릴 능선들. 개수는 **데이터가 아니라 상자 높이가** 정한다 — 그리기 결정이지
 * 데이터 결정이 아니다(페이로드는 주별 그대로 남고 hover 는 전부를 짚는다).
 *
 * 열보다 촘촘하면 **사이를 보간해** 채우고, 성기면 사이를 건너뛴다. 어느
 * 쪽이든 같은 소수 좌표 하나로 처리되므로 상자 크기에 따라 두 코드 경로가
 * 갈리지 않는다.
 *
 * 지어낸 데이터인가 — 아니다. 서피스 플롯이 격자점 사이를 잇는 것과 같은
 * 일이고(NYT 의 3-D 일드커브도 표본 사이를 그렇게 잇는다), 골과 마루의 위치는
 * 전부 실측 열이 정한다. 보간이 만드는 것은 **면**이지 값이 아니다.
 *
 * 마지막(as-of)은 **반드시** 들어간다 — 앞에서부터 세면 상자 높이에 따라
 * 마지막 능선이 조용히 과거가 된다.
 */
export function slicesFor(columns: number, boxH: number): Slice[] {
  if (columns <= 0) return [];
  if (columns === 1) return [{ at: 0, anchor: true }];
  const ladder = boxH * RIDGE_RISE;
  const want = Math.max(2, Math.round(ladder / RIDGE_PITCH));
  const last = columns - 1;
  const out: Slice[] = [];
  for (let j = 0; j < want; j++) {
    const at = (j / (want - 1)) * last;
    out.push({ at, anchor: Number.isInteger(at) });
  }
  return out;
}

/** 슬라이스가 그릴 커브. 정수 위치면 그 열 그대로, 아니면 이웃 둘의 선형
 * 보간이다. **한쪽이 구멍이면 결과도 구멍이다** — 반대쪽 값으로 메우면 없는
 * 값을 그리게 되고, 그 절벽이 시장으로 읽힌다. */
export function curveAtSlice(
  z: (number | null)[][],
  at: number,
): (number | null)[] {
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const f = at - lo;
  return z.map((row) => {
    const a = row[lo];
    if (f === 0 || lo === hi) return a ?? null;
    const b = row[hi];
    if (a == null || b == null) return null;
    return a + (b - a) * f;
  });
}

/** 열 k 의 깊이. **0 = 맨 앞(최신), 1 = 맨 뒤(최고령)** — 인트로의 `depthOf`
 * 와 같은 방향이다. n 이 1 이면 깊이는 없다. */
export function depthOf(k: number, n: number): number {
  if (n <= 1) return 0;
  return (n - 1 - k) / (n - 1);
}

/** 전체 격자의 값 범위 + 여백. 열마다 축을 다시 잡으면 10년치 레벨 이동이
 * 사라지므로 **하나의 축**이다. 정책금리도 그려야 하면 범위에 넣는다 —
 * 안 넣으면 상자 밖에 그려지거나 테두리에 눌려 "최저와 같음" 으로 읽힌다
 * (CurveView 가 같은 이유로 같은 일을 한다). */
export function domainOf(
  z: (number | null)[][],
  extra: (number | null | undefined)[] = [],
): Domain {
  let lo = Infinity;
  let hi = -Infinity;
  for (const row of z) {
    for (const v of row) {
      if (v == null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  for (const v of extra) {
    if (v == null) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { min: 0, max: 1 };
  const pad = (hi - lo) * 0.06 || 0.05;
  return { min: lo - pad, max: hi + pad };
}

/** 능선 하나의 왼쪽 끝 x 와 폭 — 라벨과 바닥 격자가 같은 산수를 두 번 하지
 * 않도록 꺼내 둔다. */
export function ridgeSpanX(box: Box, depth: number): { left: number; w: number } {
  return {
    left: box.x + depth * box.w * RIDGE_SKEW,
    w: box.w * (1 - RIDGE_SKEW),
  };
}

/** 테너 i 의 x. 등간격이다 — 실제 연수 간격이 아니다. 이 앱의 커브 타일이
 * 이미 그렇게 그리고(`CurveView`: `i / (nodes.length - 1)`), 연수로 잡으면
 * 3M~1Y 다섯 노드가 축의 앞 10% 안에 뭉친다. */
export function tenorX(box: Box, depth: number, i: number, n: number): number {
  const { left, w } = ridgeSpanX(box, depth);
  return n <= 1 ? left : left + (w * i) / (n - 1);
}

/** 금리 → 세로 위치. 깊이 사다리 + 그 열 안에서의 금리 높이. */
export function rateY(box: Box, depth: number, rate: number, d: Domain): number {
  const span = d.max - d.min || 1;
  const raised =
    depth * RIDGE_RISE + ((rate - d.min) / span) * RIDGE_SPAN;
  return box.y + box.h * (1 - raised);
}

/** 능선의 바닥(그 열의 금리 0 자리) — floating horizon 의 채움이 닿는 선. */
export function ridgeBaseY(box: Box, depth: number): number {
  return box.y + box.h * (1 - depth * RIDGE_RISE);
}

/** 커브 한 장을 능선 위의 점들로. null 은 **구멍으로 남는다** — 0 으로 채우면
 * 표면에 절벽이 생기고 그것이 시장으로 읽힌다. */
export function ridgePoints(
  values: (number | null)[],
  box: Box,
  depth: number,
  d: Domain,
): (Point | null)[] {
  return values.map((v, i) =>
    v == null
      ? null
      : { x: tenorX(box, depth, i, values.length), y: rateY(box, depth, v, d) },
  );
}

/** 점들을 SVG polyline 문자열로. 구멍에서 끊긴 조각들을 돌려준다 — 하나로
 * 이어 붙이면 없는 값을 가로지르는 선이 그려진다. */
export function segments(points: (Point | null)[]): string[] {
  const out: string[] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (p) run.push(p);
    else {
      if (run.length > 1) out.push(run.map((q) => `${q.x},${q.y}`).join(" "));
      run = [];
    }
  }
  if (run.length > 1) out.push(run.map((q) => `${q.x},${q.y}`).join(" "));
  return out;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * 커서가 가리키는 **깊이**(0 = 최신/맨 앞, 1 = 최고령/맨 뒤).
 *
 * 오블리크 투영에서 깊이가 화면에 그리는 방향은 벡터
 * `(SKEW·w, −RISE·h)` 하나다 — 뒤로 갈수록 오른쪽으로, 그리고 위로. 그래서
 * 커서를 그 축에 **정사영**하면 깊이가 나온다. x 만 쓰면(스큐 띠) 세로로
 * 움직이는 손이 무시되고, y 만 쓰면(사다리) 금리 높이와 섞인다. 둘을 같이
 * 쓰는 것이 이 투영의 정직한 역이다.
 *
 * 완벽하지는 않다 — 한 화면 점은 원래 3D 공간의 한 **직선**에 대응하므로
 * (Wilke, "Don't go 3D"), 어떤 역도 추정이다. 그래서 짚은 날짜를 화면에
 * 적고, 값은 그림이 아니라 페이로드에서 읽는다.
 */
export function depthAtPoint(box: Box, px: number, py: number): number {
  const dx = box.w * RIDGE_SKEW;
  const dy = box.h * RIDGE_RISE;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  // 앞 능선의 바닥(왼쪽 끝)이 원점이다.
  const ox = px - box.x;
  const oy = box.y + box.h - py;
  return clamp01((ox * dx + oy * dy) / len2);
}

/** 커서가 가리키는 그린 능선의 순번 (0 = 맨 뒤/최고령, n-1 = 맨 앞/최신). */
export function ridgeAtPoint(box: Box, px: number, py: number, n: number): number {
  if (n <= 1) return 0;
  const k = Math.round((1 - depthAtPoint(box, px, py)) * (n - 1));
  return Math.max(0, Math.min(n - 1, k));
}

/** 커서가 가리키는 테너 순번. 깊이를 먼저 풀고, 그 능선의 스큐 띠 안에서
 * 되돌린다 — 뒤쪽 능선일수록 오른쪽으로 밀려 있기 때문이다. */
export function tenorAtPoint(
  box: Box,
  px: number,
  py: number,
  tenors: number,
): number {
  if (tenors <= 1) return 0;
  const { left, w } = ridgeSpanX(box, depthAtPoint(box, px, py));
  const i = Math.round(((px - left) / (w || 1)) * (tenors - 1));
  return Math.max(0, Math.min(tenors - 1, i));
}
