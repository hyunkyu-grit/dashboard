/* 3D 커브 표면의 기하 — 순수 모듈 (Lab, 2026-08-18).
 *
 * 좌표만 만든다. React 도 Canvas 도 payload 도 모른다 — 그래야 가드가 화면을
 * 띄우지 않고 투영·정렬·역산을 검사한다. 전작(`surfaceGeometry.ts`, 고정
 * 오블리크 floating horizon)은 [OWNER 2026-08-18 "회전 가능하게"]로 은퇴했고,
 * RISE/SKEW 실측 상수도 함께 갔다 — 가림을 페인터 정렬이 일반각에서 대신한다.
 *
 * ── 월드 좌표 ────────────────────────────────────────────────────────────────
 *   X  만기(년수). 실제 연수다 — 1~10Y 로 한정되면서 전작 등간격의 사유(3M~1Y
 *      다섯 노드 뭉침)가 사라졌고, PCHIP 은 연수 공간에서만 곡률이 맞는다.
 *   Z  시간. +Z 가 보는 쪽 = 최신 (NYT 이후의 관례 — 최신이 앞).
 *   Y  금리(도메인 정규화). 위가 높다.
 *
 * ── 카메라 ──────────────────────────────────────────────────────────────────
 * 직교 투영 + 요(yaw)만 돈다. 피치는 상수다: 위에서 내려다보는 각을 열면 그
 * 화면이 정확히 v1 에서 지워진 테너×날짜 히트맵이 된다. 원근이 아닌 이유는
 * 이 크기에서 얻는 게 없고, 페인터 정렬과 가드 산수가 단순해지기 때문이다.
 *
 * ── 페인터 정렬은 청크 단위다 ───────────────────────────────────────────────
 * 능선 사이 띠(주 1장)를 통째로 정렬하면 측면(요 90°) 근처에서 깨진다 — 띠
 * 하나가 깊이 전 범위를 가로지른다. 반대로 표본 쿼드 하나씩 정렬하면 프레임당
 * 경로가 ~1.5만 개다. 띠를 테너 방향 CHUNKS 조각으로 갈라 조각 중심 깊이로
 * 정렬하면 경로가 ~3천으로 줄고, 조각 폭(~1.1년)에서의 정렬 오차는 이 표면의
 * 기울기에서 픽셀로 드러나지 않는다.
 */

import { pchipSample } from './pchip';

export interface Pt2 {
  sx: number;
  sy: number;
  /** 보는 쪽으로의 거리 — 클수록 가깝다. 페인터는 오름차순으로 그린다. */
  depth: number;
}

/** 월드 축 길이 — 화면 비율의 원천. **시간축이 압도적 장축이다** — NYT 실측
 * (2026-08-18)에서 화면상 시간:테너 ≈ 3:1 이고, 첫 판의 1.3:1 정사각 덩어리가
 * "전혀 유사하지 않음"의 절반이었다. 긴 시간축은 주별 능선의 간격을 벌려
 * 톱니(골판지 질감)도 함께 줄인다. */
export const SPAN_X = 0.9;
export const SPAN_Z = 2.6;
export const SPAN_Y = 0.52;

/** 내려다보는 각의 **기본값** — 피치는 이제 두 번째 회전축이다(세로 드래그)
 * [OWNER 2026-08-18 — "왜 위아래로는 못 돌려?"]. 90° = 정확히 위에서 본
 * 테너×시간 평면도. 전작의 톱뷰 금지 판정은 오너가 명시적으로 뒤집었다
 * ("정확하게 위에서 보는 거 하나"). */
export const PITCH_DEG = 21;
export const PITCH_MIN = 2;
export const PITCH_MAX = 90;

/** 요 범위와 기본값. 정면(0°)~측면(90°)을 조금씩 넘는 데서 멈춘다 — 뒤로
 * 돌아가면 시간축이 거울상이 되어 읽기가 뒤집힌다. */
export const YAW_MIN = -30;
export const YAW_MAX = 120;
export const YAW_DEFAULT = 36;

/** 세 정거장 [OWNER 2026-08-18 — "정면, 기본, 측면을 교체하자"]:
 * 위에서 = 평면도, **시간이 가로(하단 축)** [OWNER — "시계열이 하단으로"] 라
 * 요 90 이다 · 오늘 커브 = 현재 시점의 일드커브 정면 · 시계열 = 옆에서 본
 * 레벨 역사. 더블클릭은 여전히 오블리크 기본각으로. */
export const PRESETS: { id: string; label: string; yaw: number; pitch: number }[] = [
  { id: 'top', label: '위에서', yaw: 90, pitch: PITCH_MAX },
  /* 정면·측면의 피치 10° — 4° 는 층이 완전히 겹쳐 띠 죽이 된다(실측). 살짝
   * 내려다봐야 과거가 뒤로 물러나며 오늘 커브·시계열이 앞에 선다. */
  { id: 'front', label: '오늘 커브', yaw: 0, pitch: 10 },
  { id: 'side', label: '시계열', yaw: 90, pitch: 10 },
];

export const clampYaw = (y: number): number =>
  Math.min(YAW_MAX, Math.max(YAW_MIN, y));

export const clampPitch = (p: number): number =>
  Math.min(PITCH_MAX, Math.max(PITCH_MIN, p));

const RAD = Math.PI / 180;
const SIN_P = Math.sin(PITCH_DEG * RAD);
const COS_P = Math.cos(PITCH_DEG * RAD);

/** 원근의 세기 — 카메라 거리(월드 단위). 작을수록 가까운 것이 크게 부푼다.
 * NYT 의 "작동감" 절반이 이 부풂이다 [OWNER 2026-08-18 — "생긴거나 작동감은
 * 비슷하게"]. 직교(∞)는 회전해도 종이가 도는 느낌이었다. SPAN_Z 와 같이
 * 움직여야 한다 — |zv| 최대가 SPAN_Z/2 라, 거리가 그에 못 미치면 가까운
 * 조각이 무한대로 부푼다. */
export const PERSP = 3.4;

/** 단위 좌표(x01·y01·z01 ∈ [0,1]) → 투영, cos/sin 을 밖에서 받는 판.
 *
 * 핫루프용이다: 한 프레임이 능선 수백 장 × 표본 수십 개 = 수만 점을 던지는데,
 * 점마다 cos/sin 을 다시 계산하는 것이 첫 판의 "너무 느린데"의 한 축이었다
 * (실측 2026-08-18). 요는 프레임 안에서 상수다 — 트리그는 프레임당 한 번. */
export function projectFast(
  x01: number,
  y01: number,
  z01: number,
  cosYaw: number,
  sinYaw: number,
  sinPitch: number = SIN_P,
  cosPitch: number = COS_P,
): Pt2 {
  const X = (x01 - 0.5) * SPAN_X;
  const Z = (z01 - 0.5) * SPAN_Z;
  const Y = y01 * SPAN_Y;
  const xv = X * cosYaw + Z * sinYaw;
  const zv = -X * sinYaw + Z * cosYaw;
  /* 보는 쪽으로의 거리는 피치까지 돈 뒤의 것이다 — 위에서 보면(90°) 높이가
   * 곧 가까움이다. 원근도 이 거리로 나눠야 톱뷰에서 산이 어색하게 안 부푼다. */
  const zview = zv * cosPitch + Y * sinPitch;
  const k = PERSP / (PERSP - zview);
  return { sx: xv * k, sy: (zv * sinPitch - Y * cosPitch) * k, depth: zview };
}

/** 편의 판 — 라벨·축처럼 몇 번 안 부르는 자리용. 핫루프는 projectFast. */
export function project(
  x01: number,
  y01: number,
  z01: number,
  yawDeg: number,
  pitchDeg: number = PITCH_DEG,
): Pt2 {
  return projectFast(
    x01,
    y01,
    z01,
    Math.cos(yawDeg * RAD),
    Math.sin(yawDeg * RAD),
    Math.sin(pitchDeg * RAD),
    Math.cos(pitchDeg * RAD),
  );
}

/** 투영이 차지하는 사각 — 화면 맞춤의 분모. 표면은 상자의 볼록 껍질 안에
 * 있으므로 여덟 꼭짓점이면 충분하다.
 *
 * **현재 요 하나로 맞춘다** (yawMin == yawMax 로 호출). 첫 판은 요 전 범위의
 * 합집합으로 한 번 맞췄는데 — 숨쉬기가 없는 대신 — 정면(0°)이 대각(45°) 폭의
 * 1/3 로 쪼그라들었다(실측 2026-08-18). 회전하며 크기가 조금 숨쉬는 쪽이
 * 정면·측면 정거장이 제 크기로 서는 것보다 싸다 — NYT 도 정거장마다 줌이
 * 다르다. */
export function projectedBounds(
  yawMin: number = YAW_MIN,
  yawMax: number = YAW_MAX,
  pitchDeg: number = PITCH_DEG,
): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  // 원근에서는 직선 모서리의 상이 살짝 휘므로 꼭짓점만으로는 부족하다 —
  // 모서리를 몇 점씩 표본해서 잰다.
  for (let yaw = yawMin; yaw <= yawMax; yaw += 3) {
    for (const x of [0, 0.5, 1]) {
      for (const y of [0, 1]) {
        for (const z of [0, 0.25, 0.5, 0.75, 1]) {
          const p = project(x, y, z, yaw, pitchDeg);
          if (p.sx < minX) minX = p.sx;
          if (p.sx > maxX) maxX = p.sx;
          if (p.sy < minY) minY = p.sy;
          if (p.sy > maxY) maxY = p.sy;
        }
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

export interface Fit {
  scaleX: number;
  scaleY: number;
  ox: number;
  oy: number;
}

/** 투영 사각 → 캔버스 사각. 기본은 등방 — 축마다 달리 늘리면 회전 중에 표면이
 * 출렁인다.
 *
 * `anisotropy`(0..1)는 평면도용이다: 정확히 위에서 보면(피치 90°) 테너 0.9 :
 * 시간 2.6 비율 그대로는 화면의 좁은 기둥이 된다(실측) — 히트맵이 원래 그렇듯
 * 축별로 채운다. 70°→90° 사이에서 0→1 로 밀어 넣으면 전환이 튀지 않는다. */
export function fitTransform(
  box: { w: number; h: number },
  pad: number,
  bounds = projectedBounds(),
  anisotropy = 0,
): Fit {
  const bw = bounds.maxX - bounds.minX;
  const bh = bounds.maxY - bounds.minY;
  const iso = Math.min((box.w - pad * 2) / bw, (box.h - pad * 2) / bh);
  const axX = (box.w - pad * 2) / bw;
  const axY = (box.h - pad * 2) / bh;
  const t = Math.min(1, Math.max(0, anisotropy));
  const scaleX = iso + (axX - iso) * t;
  const scaleY = iso + (axY - iso) * t;
  return {
    scaleX,
    scaleY,
    ox: pad + ((box.w - pad * 2) - bw * scaleX) / 2 - bounds.minX * scaleX,
    oy: pad + ((box.h - pad * 2) - bh * scaleY) / 2 - bounds.minY * scaleY,
  };
}

export const toScreen = (p: Pt2, f: Fit): { x: number; y: number } => ({
  x: p.sx * f.scaleX + f.ox,
  y: p.sy * f.scaleY + f.oy,
});

/* 페인터 정렬(`paintOrder`)은 여기 살았다가 **WebGL 이행과 함께 은퇴했다**
 * [OWNER 2026-08-18 — "깔끔한 방식으로"]. 가림은 이제 깊이 버퍼가 지고,
 * Canvas 2D 페인터의 조각·정렬·LOD 는 전부 필요가 없어졌다. */

/**
 * 능선들을 표본 격자 위로 (PCHIP). 반환 [ridge][sample], 구멍은 null.
 *
 * 노드가 빠진 날은 **연속 구간별로** 잇는다 — 구멍 너머로 보간하면 없는 값을
 * 그리고 그 절벽이 시장으로 읽힌다 (전작 `curveAtSlice` 의 같은 규칙).
 */
export function sampleRidges(
  tenorYears: number[],
  z: (number | null)[][],
  qs: number[],
): (number | null)[][] {
  const ridgeCount = z.length ? z[0].length : 0;
  const out: (number | null)[][] = [];
  for (let r = 0; r < ridgeCount; r++) {
    const row: (number | null)[] = new Array(qs.length).fill(null);
    // 연속 non-null 노드 런마다 따로 보간한다.
    let i = 0;
    while (i < tenorYears.length) {
      if (z[i][r] == null) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < tenorYears.length && z[j + 1][r] != null) j++;
      const xs = tenorYears.slice(i, j + 1);
      const ys = xs.map((_, k) => z[i + k][r] as number);
      const seg = pchipSample(xs, ys, qs);
      for (let q = 0; q < qs.length; q++) if (seg[q] != null) row[q] = seg[q];
      i = j + 1;
    }
    out.push(row);
  }
  return out;
}

/**
 * 그리기 전용 시간축 평활 (이항 5탭 [1,4,6,4,1]/16, 이웃이 구멍이면 가중
 * 재정규화).
 *
 * 능선 간 진폭이 화면에서 골판지 질감을 만든다 — 3탭(±1일)으로는 일별 튐이
 * 실루엣 톱니로 남아 "쌓인 판" 질감의 한 축이었다(실측 2026-08-19, [OWNER —
 * "커브 못생김" 정비]). ±2일 이항 창은 볼록 결합이라 창 안 [min,max] 를
 * 벗어나지 않는다. 값이 아니라 **면**을 위한 것이므로 hover·단면·수치는
 * 절대 이 배열을 읽지 않는다.
 *
 * **마지막 능선(as-of)은 평활하지 않는다** — 오늘 커브는 굵은 잉크로 강조되는
 * 데이터 진술이라, 여기에 어제가 섞이면 화면이 오늘 아닌 값을 오늘이라 적는다.
 */
export function smoothRidges(rows: (number | null)[][]): (number | null)[][] {
  const R = rows.length;
  const W = [1, 4, 6, 4, 1];
  return rows.map((row, r) => {
    if (r === R - 1) return row.slice();
    return row.map((v, c) => {
      if (v == null) return null;
      let acc = 0;
      let w = 0;
      for (let k = -2; k <= 2; k++) {
        const rr = r + k;
        if (rr < 0 || rr >= R) continue;
        const nv = rows[rr][c];
        if (nv == null) continue;
        acc += nv * W[k + 2];
        w += W[k + 2];
      }
      return acc / w;
    });
  });
}

/** 기준테너 **등간격** 축 [OWNER 2026-08-19 — "기준테너별로 간격은 통일"].
 *
 * 화면의 X 는 실연수 비례가 아니라 **노드 인덱스 공간**이다 — 1Y·1.5Y 사이와
 * 5Y·10Y 사이가 같은 폭. 실연수 비례는 5~10Y 스트레치가 축의 절반을 먹어
 * 어색했고(오너 판정), 노드 사이 공간이 넓어 짚기도 어려웠다. 단, **값의
 * 보간(PCHIP)은 여전히 연수 공간**이다 — 곡률은 연수에서만 맞는다(§설계).
 * 이 사상은 그리기 좌표만 바꾼다: 이웃 노드 사이 선형, 단조, 왕복 일관. */
export function tenorAxis(years: number[]): {
  toAxis: (y: number) => number;
  toYears: (a: number) => number;
} {
  const T = years.length;
  if (T < 2) {
    return { toAxis: () => 0.5, toYears: () => years[0] ?? 0 };
  }
  const toAxis = (y: number): number => {
    if (y <= years[0]) return 0;
    if (y >= years[T - 1]) return 1;
    let i = 0;
    while (i < T - 2 && years[i + 1] < y) i++;
    const frac = (y - years[i]) / (years[i + 1] - years[i] || 1);
    return (i + frac) / (T - 1);
  };
  const toYears = (a: number): number => {
    const s = Math.min(1, Math.max(0, a)) * (T - 1);
    const i = Math.min(T - 2, Math.floor(s));
    const frac = s - i;
    return years[i] + frac * (years[i + 1] - years[i]);
  };
  return { toAxis, toYears };
}

/** 테너 표본 격자 — [minYears, maxYears] 균등. 표본 수는 그리기 결정이다. */
export function sampleGrid(minYears: number, maxYears: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(minYears + ((maxYears - minYears) * i) / (n - 1));
  return out;
}

/** 값 도메인 — 풀 하나에 축 하나. 능선마다 다시 잡으면 10년치 레벨 이동이
 * 사라진다(전작 `domainOf` 의 같은 이유). 기준금리도 그려야 하면 넣는다. */
export function domainOf(
  z: (number | null)[][],
  extra: (number | null | undefined)[] = [],
): { min: number; max: number } {
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

/**
 * hover — 투영된 실측 노드 중 화면 최근접. 전작의 역투영은 테너 오프셋이 깊이
 * 축으로 새어 화면의 ~70%가 최고령으로 포화했다(2026-08-18 실측, 9지점 전부
 * 2016-01-07). 역산 대신 **정방향으로 다 그려 보고 가까운 것을 고른다** —
 * 노드가 수천 개라 계산은 사소하고, 어떤 요에서도 성립한다.
 */
export interface NodePick {
  ridge: number;
  tenor: number;
  d2: number;
}

export function nearestNode(
  nodes: { x: number; y: number; ridge: number; tenor: number }[],
  px: number,
  py: number,
  maxDist: number,
): NodePick | null {
  let best: NodePick | null = null;
  const cap = maxDist * maxDist;
  for (const n of nodes) {
    const dx = n.x - px;
    const dy = n.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 <= cap && (best == null || d2 < best.d2)) {
      best = { ridge: n.ridge, tenor: n.tenor, d2 };
    }
  }
  return best;
}
