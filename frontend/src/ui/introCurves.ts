/* 인트로 커튼이 그리는 것 — 지난 10년의 원화 IRS 파 커브 (DESIGN §14 「인트로」).
 *
 * 순수 모듈이다. 데이터와 경과 시간을 받아 좌표와 진행도를 돌려줄 뿐, React 도
 * canvas 도 motion 도 모른다. 그래야 guards/intro-curtain.test.ts 가 화면을
 * 띄우지 않고 타임라인 자체를 검사할 수 있다 — 이 리포에서 순수하게 떼어낸
 * timeAxis.ts / motion.ts 와 같은 이유다.
 *
 * ── 왜 박아 넣은 상수인가 ─────────────────────────────────────────────────
 * 커튼은 첫 fetch 가 끝나기 **전에** 그려진다. 그 시점에 이 앱이 가진 시장
 * 데이터는 0 이다. 그래서 아홉 장의 커브는 data/irsdata.xlsx 에서 뽑아 여기
 * 적어 둔 실측치다 — 13개 파 테너, 퍼센트, Infomax 내보내기의 그 순서 그대로.
 *
 * 스톡 영상 대신 이걸 쓰는 이유이기도 하다. 배경이 이 사이트가 무엇을 보는
 * 곳인지 말한다. 용량은 이 파일뿐이고, 색은 전부 테마 브릿지를 지나므로
 * 라이트/다크가 저절로 따라온다.
 *
 * ── 날짜를 고른 기준 ──────────────────────────────────────────────────────
 * 모양이 확연히 다른 날들. 2016 저금리의 평탄, 2018 상승, 2019 역전, 2020
 * 코로나 저점, 2021 스티프닝, 2023 인상 사이클 고점의 역전, 2024 고금리의
 * 완만한 역전, 2025 인하기 저점, 2026 현재의 가파른 우상향. 아홉 장을 겹쳐
 * 놓으면 10년 치 레벨 레인지가 한 화면에 들어온다.
 *
 * 이 목록은 굽기(데이터 갱신)와 무관하게 고정이다. 과거는 바뀌지 않고, 매일
 * 다시 뽑으면 커튼의 그림이 매일 달라져 「어제와 같은 화면」이 아니게 된다.
 * 마지막 장만 최신 근처를 가리키며, 그것도 손으로 갱신할 때만 움직인다.
 */

/* 이징은 ui/motion.ts 의 EASE_OUT 과 **같은 곡선**을 쓴다. 값을 여기 다시
 * 적지 않고 거기서 읽어 오는 것은, CSS 토큰과 TS 미러가 갈라졌던 전례
 * (§14 pass B)를 세 번째 자리에서 반복하지 않으려는 것이다. */
import { EASE_OUT } from "./motion";

/** Infomax IRS 내보내기의 13개 파 테너 — 시트 열 순서 그대로. */
export const INTRO_TENORS = [
  "6M",
  "9M",
  "1Y",
  "18M",
  "2Y",
  "3Y",
  "4Y",
  "5Y",
  "6Y",
  "7Y",
  "8Y",
  "9Y",
  "10Y",
] as const;

export interface IntroCurve {
  /** 원 자료의 영업일. 이 파일의 숫자가 어디서 왔는지 추적할 수 있게 남긴다. */
  iso: string;
  /** 화면에 뜨는 이름. 형식은 timeAxis.ts 의 월 라벨과 같다. */
  label: string;
  /** 13개 파 금리, 퍼센트. INTRO_TENORS 와 같은 순서. */
  rates: number[];
}

/** data/irsdata.xlsx, MID종가. 손으로 옮긴 실측치 — 계산된 값이 아니다. */
export const INTRO_CURVES: IntroCurve[] = [
  {
    iso: "2016-07-01",
    label: "2016년 7월",
    rates: [1.295, 1.2525, 1.225, 1.1975, 1.1725, 1.155, 1.16, 1.165, 1.1825, 1.195, 1.21, 1.23, 1.2475],
  },
  {
    iso: "2018-01-02",
    label: "2018년 1월",
    rates: [1.6975, 1.7475, 1.815, 1.9075, 1.9775, 2.0525, 2.09, 2.1275, 2.1475, 2.1625, 2.1775, 2.195, 2.2125],
  },
  {
    iso: "2019-07-01",
    label: "2019년 7월",
    rates: [1.695, 1.64, 1.59, 1.535, 1.485, 1.45, 1.43, 1.4225, 1.4175, 1.415, 1.4225, 1.4325, 1.445],
  },
  {
    iso: "2020-07-01",
    label: "2020년 7월",
    rates: [0.7675, 0.77, 0.7725, 0.795, 0.8125, 0.845, 0.8725, 0.89, 0.9025, 0.92, 0.93, 0.9575, 0.9725],
  },
  {
    iso: "2021-07-01",
    label: "2021년 7월",
    rates: [0.8325, 0.9375, 1.045, 1.1875, 1.3275, 1.49, 1.595, 1.6575, 1.695, 1.725, 1.745, 1.775, 1.785],
  },
  {
    iso: "2023-01-02",
    label: "2023년 1월",
    rates: [4.0, 3.9975, 3.98, 3.9325, 3.8375, 3.745, 3.7025, 3.6525, 3.61, 3.58, 3.5675, 3.5425, 3.5425],
  },
  {
    iso: "2024-07-01",
    label: "2024년 7월",
    rates: [3.5275, 3.47, 3.42, 3.34, 3.285, 3.225, 3.2, 3.185, 3.1775, 3.18, 3.1875, 3.1875, 3.195],
  },
  {
    iso: "2025-07-01",
    label: "2025년 7월",
    rates: [2.505, 2.475, 2.4375, 2.4025, 2.39, 2.4025, 2.4425, 2.4725, 2.5025, 2.5325, 2.5575, 2.5825, 2.605],
  },
  {
    iso: "2026-08-12",
    label: "2026년 8월",
    rates: [3.14, 3.295, 3.45, 3.63, 3.72, 3.8325, 3.8975, 3.95, 3.9875, 4.0225, 4.0475, 4.065, 4.085],
  },
];

/** 밝은 선이 출발하는 자리 — 가장 최근 커브. 피어난 뒤 여기서 과거로 걸어간다. */
export const NEWEST = INTRO_CURVES.length - 1;

/* ── 타임라인 ───────────────────────────────────────────────────────────────
 * §14 의 세 지속시간(120/220/160ms)은 **크롬의 상태 변화** 문법이다. 여기 값은
 * 그 문법이 아니라 한 장의 그림이 그려지는 속도라 따로 산다 — 토큰을 늘리지
 * 않는 이유이고, guards/motion-tokens.test.ts 가 세는 `--bw-motion-*` 도
 * 그대로 셋이다. 커튼이 §14 를 쓰는 곳은 딱 하나, 걷힐 때의 EXIT 다.
 *
 * 피어남 전체 길이 = 8×62 + 480 = 976ms. INTRO_MIN_MS 를 그보다 조금 길게 잡아
 * 부채가 다 펴지기 전에 커튼이 걷히는 일이 없게 한다. */

/** 이웃한 두 커브가 그려지기 시작하는 간격. */
export const BLOOM_STAGGER_MS = 62;
/** 커브 한 장이 왼쪽 끝에서 오른쪽 끝까지 그려지는 데 걸리는 시간. */
export const BLOOM_DRAW_MS = 480;
/** 아홉 장이 모두 다 그려지는 시각. */
export const BLOOM_END_MS =
  (INTRO_CURVES.length - 1) * BLOOM_STAGGER_MS + BLOOM_DRAW_MS;
/** 한 장에서 다음 장으로 넘어가는 데 걸리는 시간. */
export const MORPH_TRAVEL_MS = 900;
/** 도착한 커브 위에 머무는 시간 — 날짜를 읽을 틈. */
export const MORPH_HOLD_MS = 260;

/**
 * 커튼이 최소한 떠 있는 시간. **인트로 길이를 바꿀 곳은 여기 하나다.**
 *
 * BLOOM_END_MS(976ms)보다 짧게 잡으면 그리다 만 그림에서 커튼이 걷히므로
 * 아래여서는 안 된다 — guards/intro-curtain.test.ts 가 그 부등식을 지킨다.
 *
 * 데이터가 이보다 늦게 오면 커튼은 데이터를 기다린다. 즉 시작이 늦어지는 몫은
 * 최대 이 값이고, 걷히는 160ms 동안 뒤의 앱은 이미 조작 가능하다. 로컬 백엔드
 * 첫 응답이 약 220ms 이므로 실제로는 대개 이 값이 곧 인트로의 길이가 된다.
 * 짧게 하려면 이 숫자만 내리고, 아예 끄려면 App.tsx 에서 커튼을 뺀다.
 */
export const INTRO_MIN_MS = 1000;

/**
 * 커튼이 **데이터와 무관하게** 반드시 걷히는 시각.
 *
 * 왜 있는가 — 실측으로 찾았다. 백엔드가 닿지 않는 빌드로 재현해 보니
 * `isError` 가 뜨기까지 **82초**가 걸렸다(react-query 가 6번 재시도하며 벌린
 * 간격이고, 이 리포의 docs/diagnostics/failure-modes.md 가 적어 둔 "24초에도
 * 81초에도 여전히 로딩" 과 같은 자리다). 커튼 자체는 그때 정확히 걷혔지만,
 * 그 82초 동안 화면 전체가 덮여 있었다 — 커튼이 없을 때는 최소한 셸과
 * 사이드바는 살아 있었으니, 그대로 두면 이 인트로가 **실패를 더 나쁘게 만드는**
 * 셈이다.
 *
 * 그래서 커튼의 계약은 "첫 순간을 덮는다" 가 아니라 **"첫 순간을 덮고, 무슨 일이
 * 있어도 나간다"** 이다. 이 시각이 지나면 뒤의 앱이 자기 대기 화면이든 실패
 * 화면이든 스스로 말하게 둔다. 그게 원래 그 화면들의 일이다.
 *
 * 4초인 이유: 흔한 경로(정적 트리·로컬 백엔드 220ms)에서는 절대 닿지 않고,
 * 닿는다면 이미 "무언가 잘못됐다" 는 뜻이라 그림보다 앱을 보여 줄 때다.
 */
export const INTRO_MAX_MS = 4000;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/* ── 이징 — cubic-bezier(0.32, 0.72, 0, 1), 제품의 그 하나뿐인 곡선 ────────── */

/** 베지어 한 축의 값. P0=(0,0), P3=(1,1) 이므로 제어점 둘만 받는다. */
function bezierAxis(t: number, c1: number, c2: number): number {
  const u = 1 - t;
  return 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t;
}

/**
 * EASE_OUT 을 진행도에 적용한다. x(t)=p 를 이분법으로 풀고 y(t) 를 돌려준다 —
 * 24회면 배정도에서 더 좁힐 것이 없고, 뉴턴법과 달리 도함수가 0 인 구간
 * (이 곡선은 x2=0 이라 끝에서 그렇다) 에서 발산하지 않는다.
 */
export function easeOut(p: number): number {
  const x = clamp01(p);
  if (x === 0 || x === 1) return x;
  const [x1, y1, x2, y2] = EASE_OUT;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (bezierAxis(mid, x1, x2) < x) lo = mid;
    else hi = mid;
  }
  return bezierAxis((lo + hi) / 2, y1, y2);
}

/* ── 세로 범위 ─────────────────────────────────────────────────────────────
 * 아홉 장이 **같은 축**을 쓴다. 장마다 축을 다시 잡으면 2020년의 0.77% 와
 * 2023년의 4.0% 가 같은 높이에 그려져 10년치 레벨 이동이 사라진다 — 이 그림이
 * 보여 주려는 것이 바로 그 이동이다. */
const ALL_RATES = INTRO_CURVES.flatMap((c) => c.rates);
const RAW_MIN = Math.min(...ALL_RATES);
const RAW_MAX = Math.max(...ALL_RATES);
/** 위아래로 조금 띄운다 — 최저·최고 커브가 화면 테두리에 붙지 않게. */
const PAD = (RAW_MAX - RAW_MIN) * 0.12;
export const DOMAIN = { min: RAW_MIN - PAD, max: RAW_MAX + PAD };

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

/**
 * 파 금리 13개를 상자 안의 점 13개로. X 는 **등간격** — 실제 연수 간격이
 * 아니다. 이 앱의 커브 타일이 이미 그렇게 그리고(§6 「9 nodes, EQUAL spacing」),
 * 짧은 쪽이 뭉쳐 보이지 않는다.
 */
export function polyline(rates: number[], box: Box): Point[] {
  const span = DOMAIN.max - DOMAIN.min;
  const last = rates.length - 1;
  return rates.map((r, i) => ({
    x: box.x + (box.w * i) / last,
    y: box.y + box.h * (1 - (r - DOMAIN.min) / span),
  }));
}

/**
 * 폴리라인을 왼쪽에서부터 `frac` 만큼만. 마지막 구간은 잘라 이어 붙이므로
 * 선의 끝이 마디에서 마디로 튀지 않고 이어져 나간다.
 */
export function revealed(points: Point[], frac: number): Point[] {
  const f = clamp01(frac);
  if (f <= 0) return [];
  if (f >= 1) return points;
  const segments = points.length - 1;
  const cut = f * segments;
  const whole = Math.floor(cut);
  const out = points.slice(0, whole + 1);
  const rest = cut - whole;
  if (rest > 0 && whole < segments) {
    const a = points[whole];
    const b = points[whole + 1];
    out.push({ x: a.x + (b.x - a.x) * rest, y: a.y + (b.y - a.y) * rest });
  }
  return out;
}

/** 커브 i 가 지금 얼마나 그려졌는가. 0 이면 아직 안 나왔고 1 이면 다 나왔다. */
export function bloomAt(elapsedMs: number, index: number): number {
  return easeOut((elapsedMs - index * BLOOM_STAGGER_MS) / BLOOM_DRAW_MS);
}

export interface BrightState {
  /** 지금 그려야 할 13개 금리 — 두 키프레임 사이면 보간값. */
  rates: number[];
  /** 지금 읽히는 날짜. 이동 중에는 절반을 넘긴 쪽을 가리킨다. */
  label: string;
  /** 피어나는 중이라면 0..1, 다 피었으면 1. */
  reveal: number;
}

/**
 * 밝은 선의 상태.
 *
 * 부채가 다 펴질 때까지는 가장 최근 커브가 나머지와 **함께** 그려진다. 다
 * 펴지고 한 박자 쉰 뒤, 거기서 과거로 한 장씩 걸어간다 — 2026 → 2025 → …
 * → 2016 → 다시 2026. 되감기 방향인 것은 화면이 「오늘」에서 출발해야 지금
 * 뒤에서 로딩되고 있는 것과 이어지기 때문이다.
 */
export function brightAt(elapsedMs: number): BrightState {
  const n = INTRO_CURVES.length;
  const settled = elapsedMs - BLOOM_END_MS - MORPH_HOLD_MS;
  if (settled <= 0) {
    return {
      rates: INTRO_CURVES[NEWEST].rates,
      label: INTRO_CURVES[NEWEST].label,
      reveal: bloomAt(elapsedMs, NEWEST),
    };
  }
  const cycle = MORPH_TRAVEL_MS + MORPH_HOLD_MS;
  const hop = Math.floor(settled / cycle);
  const within = settled - hop * cycle;
  const travel = easeOut(within / MORPH_TRAVEL_MS);
  const from = INTRO_CURVES[(NEWEST - (hop % n) + n) % n];
  const to = INTRO_CURVES[(NEWEST - ((hop + 1) % n) + n) % n];
  return {
    rates: from.rates.map((r, i) => r + (to.rates[i] - r) * travel),
    label: travel < 0.5 ? from.label : to.label,
    reveal: 1,
  };
}
