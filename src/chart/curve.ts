/* 아이들 커브 — 아무 행도 고르지 않았을 때 미리보기 pane 이 그리는 것.
 *
 * **IRS 파 커브, 모든 탭에서 같은 것** [v1 OWNER, pass M]. 탭마다 다른 커브를
 * 그리던 시절이 있었고(포워드 탭엔 1YF 사다리, 스프레드 탭엔 2점 스프레드 커브)
 * 되돌렸다: 커브 보기가 이 제품의 1순위이고 "커브" 는 IRS 파 커브다. 나머지는 옆
 * 표가 이미 숫자로 찍고 있는 것을 알아보는 데 시간이 걸리는 모양으로 다시 말한
 * 것이었고, 탭에 따라 주제가 바뀌는 pane 은 기억할 것이 하나 더 늘어나는 일이다.
 *
 * 선은 둘뿐이다 — **데이터 일자와 전일**. 여섯 기준 전부를 겹치는 것은 확대 뷰의
 * 몫이고, 여기서는 "오늘 커브가 어제와 어떻게 다른가" 하나만 답한다.
 *
 * 값은 만들지 않는다(§16): 레벨은 `summary.outrights[].now`, 전일은 같은 행의
 * `basisValues.d1` 이다. 둘 다 백엔드가 이미 낸 것이고 표의 숫자와 같은 출처다.
 */

import type { WallSummary } from "@/lib/api";

export interface IdleCurve {
  /** 노드 라벨, 스펙 순서 그대로(짧은 끝 → 긴 끝). */
  tenors: string[];
  /** 데이터 일자의 파 금리(%), 값이 없는 노드는 null. */
  now: (number | null)[];
  /** 전일 같은 노드, 없으면 null. */
  prev: (number | null)[];
  /** 전일 대비 변화(bp). **여기서 빼지 않는다** — `now − prev` 는 이미 반올림된
   * 두 수의 차라 표의 숫자와 어긋날 수 있고, §16 이 금지하는 바로 그것이다.
   * 백엔드가 낸 `deltas.d1` 을 그대로 싣는다(표의 어제 열과 같은 값). */
  changeBp: (number | null)[];
  /** 노드별 52주 통계 — 커서 리드아웃 카드가 읽는다.
   *
   * v1 도 커브 툴팁에 같은 세 줄을 싣는다(`ui/CurveView.tsx`: 레벨 · 52주 최고 ·
   * 최저 · 평균 · 당일 변화, 히스토리 차트와 **같은 카드**). 값은 요약이 이미
   * 주는 `range1y` 라 여기서 계산하는 것이 없다 — §16 그대로다. 창은 최근
   * 252영업일이고, 그 이유는 `lib/api.ts::SeriesSummary.range1y` 에 적혀 있다. */
  high: (number | null)[];
  low: (number | null)[];
  avg: (number | null)[];
  /** 데이터 일자 — 화면이 "언제 것인가" 를 말할 수 있도록. */
  asof: string;
  /** 전일이 어느 날짜였나. 없으면 undefined(그 선을 안 그린다). */
  prevDate?: string;
}

/** 콜금리는 커브에서 뺀다.
 *
 * 1D 는 **하루짜리 픽싱이지 스왑 노드가 아니다**(`theta.py` 도 같은 이유로 1D 를
 * 다리에서 제외한다). x 를 등간격으로 놓는 커브에서 1/365년 노드를 6M 옆에 세우면
 * 40bp 짜리 낙차가 만기 한 칸으로 보이고, 그건 커브의 모양이 아니라 눈금의
 * 사고다. 3M(=CD91)은 남는다 — 그건 이 커브의 짧은 끝 그 자체다(`dataset.py`).
 */
const NOT_A_CURVE_NODE = new Set(["1D"]);

/**
 * 요약 페이로드에서 아이들 커브를 만든다. 아무 노드에도 값이 없으면 `null` —
 * 빈 축만 그리느니 안 그리는 게 낫다.
 *
 * 노드는 **아웃라이트 전부**(1D 제외)이고 순서는 백엔드가 준 `sortKey` 다.
 * `displayTenors` 를 쓰지 않는 이유는 실측이다: 그 목록은 8개(6M…10Y)뿐이라
 * 커브의 짧은 끝(3M)과 보간 노드(4Y·6Y…9Y)가 통째로 빠진다. 그건 벽면 표의 표시
 * 집합이지 커브가 아니다. 순서를 배열 순서로 믿지 않는 것도 같은 이유 — 계산
 * 순서이지 만기 순서라는 보장이 없고, 커브에서 순서가 틀리면 다른 커브다.
 */
export function idleCurve(summary: WallSummary | undefined): IdleCurve | null {
  if (!summary) return null;
  const nodes = summary.outrights
    .filter((o) => !NOT_A_CURVE_NODE.has(o.id))
    .slice()
    .sort((a, b) => (a.sortKey?.[0] ?? 0) - (b.sortKey?.[0] ?? 0));
  if (nodes.length === 0) return null;

  const tenors = nodes.map((o) => o.id);
  const now = nodes.map((o) => o.now ?? null);
  if (now.every((v) => v == null)) return null;

  const prev = nodes.map((o) => o.basisValues?.d1 ?? null);
  const changeBp = nodes.map((o) => o.deltas?.d1 ?? null);
  return {
    tenors,
    now,
    prev,
    changeBp,
    high: nodes.map((o) => o.range1y?.max ?? null),
    low: nodes.map((o) => o.range1y?.min ?? null),
    avg: nodes.map((o) => o.range1y?.avg ?? null),
    asof: summary.asof,
    prevDate: summary.basisDates?.d1 ?? undefined,
  };
}
