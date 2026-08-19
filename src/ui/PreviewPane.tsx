'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import {
  TextBody,
  TextCaption,
  TextDisplay3,
  TextLabel1,
  TextLabel2,
  TextTitle3,
} from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  PeriodSelector,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { CD_SERIES_ID, type PolicyStep } from '@/lib/api';
import { fmtDelta, fmtLevel, unitSuffix } from '@/lib/format';
import { API_BASE } from '@/lib/staticPaths';
import { type IdleCurve } from '@/chart/curve';
import { alignByDate, policyByDate, referenceMode } from '@/chart/references';
import { panRange, sliceRange, zoomRange, type ViewRange } from '@/chart/zoom';
import type { Row } from '@/table/rows';

import { useFillHeight } from './useFillHeight';

import {
  READOUT_CARD_W,
  READOUT_LABEL,
  ReadoutCard,
  ReadoutChange,
  ReadoutLevel,
} from './ReadoutCard';

/** `d` = 그날의 전일 대비 변화. **백엔드가 낸다**(`derive.py::series_history`) —
 * 브라우저는 시계열을 차분하지 않는다(§16). 카드의 「당일 변화」가 이 값이다. */
type Point = { t: string; v: number; d?: number | null };

/** 52주 통계. 이것도 서버 것이다 — 최근 252관측 창이고, 차트가 보여주는 구간과
 * **무관하게** 고정이다. v1 이 여기에 남긴 근거: 10년 창은 2020~21 레짐 단절을
 * 가로질러 모든 레벨을 99~100분위에 못박았다. 구간을 좁히거나 넓히면 카드가
 * 표의 52주 열과 다른 말을 하게 된다. */
type SeriesStats = { min: number | null; max: number | null; avg: number | null };

/** 카드가 그림 밖으로 나가지 않게 하는 클램프.
 *
 * v1 은 노드의 x 로 스냅했지만(`x(hIdx) + 10`), 그건 v1 이 자기 SVG 를 직접 그려서
 * 그 좌표를 알고 있었기 때문이다. CDS 는 그리는 쪽이라 축 라벨 폭까지 포함한
 * 내부 기하를 우리에게 주지 않는다 — 그 계산을 여기서 다시 하면 두 벌이 되고,
 * 두 벌은 CDS 가 눈금 폭을 바꾸는 날 어긋난다. 그래서 **커서의 x 를 그대로** 쓴다.
 * 카드가 읽는 값은 CDS 가 준 인덱스라 여전히 노드에 스냅돼 있다. */
function clampLeft(x: number, boxW: number): number {
  return Math.min(Math.max(boxW - READOUT_CARD_W - 8, 0), Math.max(0, x + 12));
}

/**
 * The instrument detail pane, rebuilt against coinbase.com/price/* [OWNER
 * 2026-08-13: "나머지는 코인베이스 스타일 … 정말 정말 코인베이스처럼"].
 *
 * ── Why this is CDS components and not a hand-drawn SVG ─────────────────────
 * The reference page's chart was taken apart on 2026-08-13 and turned out to be
 * CDS itself: its axis labels resolve `var(--color-fgMuted)`, and the area fill
 * is the exact composition CDS's `LineChart` emits for `areaType="dotted"` —
 *
 *     <mask> <path d={area} fill="url(#pattern)"/> </mask>   pattern = 4×4, circle r=1
 *     <path d={area} fill="url(#gradient)" mask="url(#mask)"/>  gradient = hue, α 0→1
 *     <path d={line} stroke={hue} stroke-width="2" linecap/linejoin="round"/>
 *
 * So the faithful way to look like Coinbase is not to imitate that markup, it is
 * to call the component that produces it. Hand-rolling it would also give up
 * scrubbing, which the reference has and which a rates reader needs more than a
 * crypto one.
 *
 * ── What replaced lightweight-charts, and the rule that changed ─────────────
 * The previous pane drew an INK line, on the stated rule that "a line has no
 * sign". That rule is retired here, deliberately: a line drawn OVER A PERIOD
 * does have a sign — its net change — and that is precisely what the reference
 * encodes, colouring line, fill and the active period pill with it. The
 * refinement is that the sign belongs to THE SPAN THE LINE DRAWS, not to today:
 * colouring a one-year line by today's move paints a year of rises blue because
 * the last print ticked down.
 */

/* 축과 기준선 시리즈의 id. 문자열을 여러 군데 적으면 한 군데만 고쳐지는 날이
 * 오고, 그때 시리즈는 존재하지 않는 축을 가리키며 조용히 기본 축으로 떨어진다.
 *
 * ── x 축에는 일부러 id 를 주지 않는다 (실측 2026-08-14) ─────────────────────
 * 축에 이름을 붙이면 **시리즈도 그 이름을 가리켜야 한다.** CDS 는 시리즈의
 * `xAxisId ?? DEFAULT_AXIS_ID` 로 스케일을 찾는데(`CartesianChart.js:214`),
 * 축 설정에만 `id: 'date'` 를 주고 시리즈에 `xAxisId` 를 안 달면 조회가 빗나가고
 * `Line` 이 `if (!xScale || !yScale || !path) return` 으로 **아무 말 없이 사라진다**
 * (`Line.js:113`). 축과 눈금은 멀쩡히 그려지므로 "선만 안 나오는 차트" 가 되고,
 * 콘솔에는 한 줄도 안 남는다. x 축은 하나뿐이니 이름이 필요 없다. */
const MAIN_AXIS = 'main';
const PCT_AXIS = 'pct';
const CD_LINE = 'CD91';
const BASE_LINE = 'BASE';

/* 주봉·월봉(캔들 모드)이 여기 살았다가 **오너 지시로 제거됐다** [OWNER
 * 2026-08-18 — "주봉 월봉 없애도 될 거 같고"]. 백엔드의 `interval=w|m` 라우트와
 * `derive.py::ohlc_buckets` 는 남는다(v1 과 바이트 대사 유지·`/chart` 하니스가
 * 여전히 쓴다). 되살릴 일이 생기면 그 세션의 함정 셋을 함께 가져올 것:
 * 구간 days 는 영업일이라 봉 수로 환산해야 하고(1Y 주봉 = 52봉), 꼬리는 안
 * 그려지는 시리즈로 y 도메인에 넣어야 하고, 캔들 레이어는 이름 있는 축을
 * `yAxisId` 로 가리켜야 한다(셋 다 조용히 틀린다). */

/** 그림 둘레의 여백. 두 차트가 **같은 값**을 쓴다 — 하나만 고치면 커브와 히스토리가
 * 서로 다른 여백을 지고, 그 둘은 나란히 서는 화면이 아니라 같은 자리를 번갈아 쓰는
 * 화면이라 차이가 어긋남으로 보인다.
 *
 * `right` 12 · `bottom` 8 은 실측해서 올린 값이다(2026-08-14). 예전 값
 * (`right: 8, bottom: 0`)에서 오른쪽 y 눈금이 SVG 오른쪽 끝에 **딱 붙었다** —
 * 라벨 오른쪽 2529px, SVG 오른쪽 2529px, 여백 0. CDS 가 축 폭을 따로 잡아주므로
 * 잘리지는 않았지만 여백이 0 이면 폰트나 자릿수가 조금만 바뀌어도 잘린다. */
const CHART_INSET = { top: 16, right: 12, bottom: 8, left: 8 };

/** The spans offered, and how many trailing points each keeps. `null` = all. */
const SPANS = [
  { key: '1M', label: '1M', days: 22 },
  { key: '3M', label: '3M', days: 66 },
  { key: '6M', label: '6M', days: 132 },
  { key: '1Y', label: '1Y', days: 260 },
  { key: 'ALL', label: '전체', days: null },
] as const;

type SpanKey = (typeof SPANS)[number]['key'];

/** `PeriodSelector` takes `{id,label}` tabs. Derived from SPANS rather than
 * typed twice, so a span cannot exist in one list and not the other. */
const SPAN_TABS = SPANS.map((s) => ({ id: s.key as string, label: s.label }));

async function loadSeries(
  row: Row,
): Promise<{ unit: string; points: Point[]; stats: SeriesStats | null }> {
  // Swap rows have a stage-2 history route; universe rows have their own; cash-bond
  // rows a third (민평은 SQL 전용이라 라이브만 있다). Three routes, one shape — the
  // pane does not care which produced it (`derive.series_history` 가 셋 다 만든다).
  const url =
    row.group === 'cashbond' || row.group === 'asw'
      ? `${API_BASE}/api/cashbond/series/${encodeURIComponent(row.id)}`
      : row.seriesId
        ? `${API_BASE}/api/series/${encodeURIComponent(row.seriesId)}?res=full`
        : `${API_BASE}/api/universe/series/${encodeURIComponent(row.id)}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { unit?: string; points?: Point[]; stats?: SeriesStats | null };
  /* `stats` 는 예전부터 이 응답 안에 있었다 — 프런트가 버리고 있었을 뿐이다.
     카드가 52주 세 줄을 이걸로 찍는다(v1 과 같은 출처). */
  return { unit: j.unit ?? row.unit, points: j.points ?? [], stats: j.stats ?? null };
}

/** One label-over-value pair, the reference's stat unit. The label is the quiet
 * one: small, muted, and never competing with the number it names. */
function Stat({ label, value, tone }: { label: string; value: string; tone?: 'up' | 'down' }) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <TextCaption as="span" color="fgMuted" noWrap>
        {label}
      </TextCaption>
      <TextBody
        as="span"
        tabularNumbers
        noWrap
        className={tone === 'up' ? 'sr-up' : tone === 'down' ? 'sr-down' : undefined}
      >
        {value}
      </TextBody>
    </VStack>
  );
}

/** One entry of the reference legend: the line as it is drawn, then its name.
 * The swatch carries the same colour and opacity the series does, so the legend
 * is a SAMPLE of the chart — and the label wears the line's colour too
 * (Finviz/네이버가 MA 범례에 하는 그대로). 점선 견본은 없다: 둘 다 실선이고
 * 구분은 색이 진다 [OWNER 2026-08-18, 3차 확정 — `direction.css`]. */
export function RefKey({
  label,
  opacity,
  color,
}: {
  label: string;
  opacity: number;
  /** 선이 그려진 색. 안 주면 잉크 계열(아이들 커브의 오늘/전일). */
  color?: string;
}) {
  return (
    <HStack gap={0.5} alignItems="center">
      <span
        aria-hidden
        style={{
          width: 14,
          height: 0,
          borderTop: `2px solid ${color ?? 'var(--color-fgMuted)'}`,
          opacity,
        }}
      />
      {color ? (
        <TextCaption as="span" noWrap style={{ color }}>
          {label}
        </TextCaption>
      ) : (
        <TextCaption as="span" color="fgMuted" noWrap>
          {label}
        </TextCaption>
      )}
    </HStack>
  );
}

/** 세 통계 묶음 — 본문에서도, 확대 창의 서랍에서도 **이것 하나**를 그린다.
 * 두 벌이면 한쪽에만 열이 붙거나 단위가 갈리고, 그때 두 화면이 같은 종목을
 * 놓고 다른 말을 하게 된다. */
function StatColumns({
  row,
  view,
  u,
}: {
  row: Row;
  view: { hi: number; lo: number; win: unknown[] } | null;
  u: string;
}) {
  return (
    <HStack className="sr-stats" flexWrap="wrap">
      <StatColumn title="이 구간">
        <Stat label="최고" value={view ? fmtLevel(view.hi, row.unit) + u : '—'} />
        <Stat label="최저" value={view ? fmtLevel(view.lo, row.unit) + u : '—'} />
        <Stat label="영업일" value={view ? `${view.win.length}일` : '—'} />
      </StatColumn>

      <StatColumn title="변화">
        <Stat
          label="전일"
          value={fmtDelta(row.changes.d1, row.unit) + u}
          tone={row.changes.d1 == null ? undefined : row.changes.d1 > 0 ? 'up' : 'down'}
        />
        <Stat
          label="MTD"
          value={fmtDelta(row.changes.mtd, row.unit) + u}
          tone={row.changes.mtd == null ? undefined : row.changes.mtd > 0 ? 'up' : 'down'}
        />
        <Stat
          label="YTD"
          value={fmtDelta(row.changes.ytd, row.unit) + u}
          tone={row.changes.ytd == null ? undefined : row.changes.ytd > 0 ? 'up' : 'down'}
        />
      </StatColumn>

      <StatColumn title="52주">
        <Stat label="고점" value={fmtLevel(row.rangeHigh, row.unit) + u} />
        <Stat label="저점" value={fmtLevel(row.rangeLow, row.unit) + u} />
        <Stat label="평균" value={fmtLevel(row.rangeAvg, row.unit) + u} />
        <Stat label="위치" value={row.pct == null ? '—' : `${Math.round(row.pct)}%`} />
      </StatColumn>
    </HStack>
  );
}

/** A stat column under the chart. The reference divides these with a vertical
 * hairline rather than a gap, which is what makes three lists read as one block
 * instead of three floating groups. */
function StatColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <VStack gap={1.5} paddingX={2} paddingY={2} flexGrow={1} minWidth={0} className="sr-statcol">
      <TextTitle3 as="h3">{title}</TextTitle3>
      <HStack gap={3} flexWrap="wrap">
        {children}
      </HStack>
    </VStack>
  );
}

/**
 * CD 91일 — 한 번만 가져온다.
 *
 * 행마다 다시 부르면 hover 로 표를 가로지를 때마다 2,600점짜리 히스토리를 다시
 * 받는다. CD 는 종목이 아니라 **화면 전체의 기준**이라 한 번 받아서 모두가 쓴다.
 * 실패는 `null` 로 삼킨다 — 기준선이 없다고 종목 차트가 안 나올 이유는 없고,
 * 화면은 범례가 없는 것으로 그 사실을 말한다.
 *
 * 실측 2026-08-14: 페이지 로드에 1회. 다섯 행을 hover 로 훑으면 요청이 하나 더
 * 느는데 그건 이 캐시가 샌 게 아니라 **3M 행 자신의 히스토리**다 — 3M 노드가 곧
 * CD 91일이라 URL 이 같다(`lib/api.ts::CD_SERIES_ID`).
 */
let cdPromise: Promise<Point[] | null> | null = null;
/** exported: 백테스트 창의 `LinkedCharts` 도 같은 캐시를 쓴다 — CD 는 화면
 * 전체의 기준이라 두 번 받을 이유가 없다. */
export function loadCd(): Promise<Point[] | null> {
  cdPromise ??= (async () => {
    try {
      const r = await fetch(`${API_BASE}/api/series/${CD_SERIES_ID}?res=full`);
      if (!r.ok) return null;
      const j = (await r.json()) as { points?: Point[] };
      return j.points ?? null;
    } catch {
      return null;
    }
  })();
  return cdPromise;
}

export function PreviewPane({
  row,
  policy,
  curve,
  onEnlarge,
  onOpenBacktest,
  chartOnly,
  statsOnly,
  fill,
  height = 320,
}: {
  row?: Row;
  /** 아무 행도 안 고른 상태에서 그릴 IRS 파 커브(`chart/curve.ts`). 행이 아니라
   * 화면의 성질이라 pane 이 스스로 만들지 않고 받는다. */
  curve?: IdleCurve;
  /** 기준금리 스텝. 표 전체에 하나이고 `WallSummary` 가 실어 온다. 없으면 그
   * 선만 빠진다 — 없는 것을 지어내지 않는다. */
  policy?: PolicyStep;
  /** 확대 창을 여는 손잡이. 없으면 버튼이 안 나온다 — 창 **안에서** 이 pane 을
   * 다시 그릴 때가 그렇다(창 안에 확대 버튼이 또 있으면 자기를 연다). */
  onEnlarge?: () => void;
  /** 차트 클릭 = 백테스트 [v1 계약, OWNER 2026-08-18 복원]. 두 번째 인자는
   * **커서가 짚고 있던 날짜** — 그 날이 진입일이 된다(v1 의 `btf` 그대로).
   * 안 주면 차트가 안 눌린다: 전체탭 오버뷰(v1 에서도 안 열림)와 확대 창
   * (창 위에 창)이 그 경우다. */
  onOpenBacktest?: (row: Row, from?: string) => void;
  /* 확대 창이 이 pane 을 **두 조각으로 나눠 쓴다**: 본문에는 차트를, 서랍에는
   * 통계를. 컴포넌트를 둘로 쪼개는 대신 두 플래그를 둔 이유는 히어로·구간
   * 선택·기준선·통계가 전부 같은 `view` 하나에서 나오기 때문이다 — 쪼개면 그
   * 계산이 두 벌이 되고, 두 벌은 언젠가 서로 다른 구간을 말한다. */
  chartOnly?: boolean;
  statsOnly?: boolean;
  /** 차트가 **남는 높이를 전부** 쓴다 — `height` 대신.
   *
   * 부르는 쪽이 「카드 높이 − 상수」로 차트 높이를 정하던 자리다. 그 상수가 89px
   * 모자랐고(실측 2026-08-14: 히어로 128 + 범례 22 + 통계 115 = 265, 상수는 176),
   * 통계 3열이 카드 밖으로 88px 밀려 `.sr-card` 의 `overflow: hidden` 에 잘렸다.
   * 셋 다 고정 높이가 아니라서 — 범례는 기준선이 있을 때만 서고 통계는 폭에 따라
   * 접힌다 — 어떤 상수를 넣어도 어떤 화면에서는 틀린다. 그래서 **재서 쓴다.**
   *
   * 확대 창과 오버뷰 열은 이 모드를 안 쓴다: 창은 자기 본문 높이를 알고, 오버뷰
   * 차트는 고정 200 이 규칙이다 [v1 OWNER]. */
  fill?: boolean;
  height?: number;
}) {
  const [data, setData] = useState<{ unit: string; points: Point[]; stats: SeriesStats | null }>();
  const [cd, setCd] = useState<Point[] | null>(null);
  const [error, setError] = useState<string>();
  const [span, setSpan] = useState<SpanKey>('1Y');

  /* 커서가 짚은 점. 인덱스는 **CDS 가 준다**(`onScrubberPositionChange`) — 그쪽이
   * 축 스케일을 가진 쪽이라, 우리가 픽셀에서 인덱스를 되계산하면 두 벌이 된다.
   * x 는 카드를 놓을 자리일 뿐이라 커서에서 바로 읽는다. */
  const [hoverIdx, setHoverIdx] = useState<number>();
  const [hoverX, setHoverX] = useState(0);

  /* 그림에 남은 세로. `fill` 일 때만 쓴다 — 아닐 때는 `height` 가 답이고, 이 값은
   * 재도 무해하다(콜백 ref 는 붙는 그 순간 재므로 데이터보다 늦게 생기는 요소도
   * 잡는다. 그 함정은 `ui/useFillHeight.ts` 에 적혀 있다). */
  const [plotRef, plotH] = useFillHeight(height);
  const chartH = fill ? plotH : height;

  const onPlotMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHoverX(clampLeft(e.clientX - r.left, r.width));
  }, []);
  const onPlotLeave = useCallback(() => setHoverIdx(undefined), []);

  /* ── 제자리 확대 [v1 OWNER 2026-08-04] ──────────────────────────────────────
   * 휠로 확대·축소, **Shift+휠**로 좌우 이동. 끌기가 아닌 이유는 CDS 스크러버가
   * 포인터 이동을 이미 쓰고 있어서다 — 끌면 확대인지 값 읽기인지 화면이 모른다.
   * 페이지가 스크롤하지 않으므로(100vh 기둥) 휠을 가져가도 잃는 동작이 없다. */
  const [zoom, setZoom] = useState<ViewRange | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadCd().then((p) => {
      if (!cancelled) setCd(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setData(undefined);
    setError(undefined);
    if (!row) return;
    let cancelled = false;
    void (async () => {
      try {
        const d = await loadSeries(row);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [row]);

  const days = SPANS.find((s) => s.key === span)?.days ?? null;

  /* The window the chart actually draws, and everything read off it. Kept in one
   * memo so the line's sign, the hero's change and the range readout can never
   * describe different windows — the defect that makes a chart argue with its
   * own caption. */
  const view = useMemo(() => {
    const pts = data?.points ?? [];
    /* 두 겹의 자르기 — **구간**(기간 알약)이 먼저, 그 안에서 **확대**가 다음.
       순서가 중요하다: 확대는 지금 보고 있는 구간 위의 조작이라, 1M 에서 확대해
       두고 1Y 로 넓히면 그 확대는 뜻을 잃는다(그래서 구간이 바뀌면 초기화한다). */
    const span = days == null ? pts : pts.slice(-days);
    const win = sliceRange(span, zoom);
    if (win.length === 0) return null;
    const first = win[0].v;
    const last = win[win.length - 1].v;
    let hi = -Infinity;
    let lo = Infinity;
    for (const p of win) {
      if (p.v > hi) hi = p.v;
      if (p.v < lo) lo = p.v;
    }
    /* `spanLen` 은 확대 계산이 기준으로 삼는 **모수**다 — 지금 보이는 조각이
       아니라 구간 전체의 길이. 이게 없으면 확대할수록 모수가 줄어서 축소가
       전체로 돌아오지 못한다. */
    return { win, first, last, hi, lo, net: last - first, spanLen: span.length };
  }, [data, days, zoom]);

  /* THE sign of this chart. `--sr-up` / `--sr-down` are read as CSS variables
   * rather than passed as tokens because CDS resolves a series `color` straight
   * into an SVG attribute, and the two direction hues are v2's, not CDS's. */
  const dir = view == null || view.net === 0 ? null : view.net > 0 ? 'up' : 'down';
  const hue =
    dir == null ? 'var(--color-fgMuted)' : dir === 'up' ? 'var(--sr-up)' : 'var(--sr-down)';

  /* 커서 아래의 점. 구간을 바꾸면 `view.win` 이 통째로 갈리므로 **인덱스가 남아
   * 있어도 버린다** — 범위 밖 인덱스로 카드를 그리면 있지도 않은 날짜의 값을
   * 지어내는 셈이고, v1 도 같은 자리에 같은 가드를 뒀다. `i` 를 같이 실어 보내는
   * 이유는 CD 기준선이 **같은 인덱스**로 정렬돼 있어서다(`alignByDate`). */
  const hoverPoint = useMemo(() => {
    if (!view || hoverIdx == null || hoverIdx < 0 || hoverIdx >= view.win.length) return null;
    const p = view.win[hoverIdx];
    return { i: hoverIdx, t: p.t, v: p.v, d: p.d ?? null };
  }, [view, hoverIdx]);

  /* 52주 세 줄의 출처. 스왑 라우트는 `stats` 를 싣고(252관측) 유니버스 라우트는
     안 싣는다. 없을 때 **행의 값**으로 떨어지는데 그 둘은 같은 백엔드 함수
     (`annual_stats`)에서 나오므로 카드가 표의 52주 열과 다른 말을 할 수 없다. */
  const stats52 = {
    max: data?.stats?.max ?? row?.rangeHigh ?? null,
    min: data?.stats?.min ?? row?.rangeLow ?? null,
    avg: data?.stats?.avg ?? row?.rangeAvg ?? null,
  };

  /* 확대는 **지금 보고 있는 것** 위의 조작이라, 보고 있는 것이 갈리면 초기화한다.
     남겨두면 다른 종목·다른 구간·다른 종류의 인덱스 구간을 그대로 적용하게 되고,
     그건 있지도 않은 날짜 범위를 그리는 일이다. */
  useEffect(() => {
    setZoom(null);
  }, [row, span]);

  /* 휠은 **네이티브로** 단다. React 17 부터 `wheel`·`touchstart`·`touchmove` 는
     루트에 **passive** 로 붙어서, `onWheel` 안의 `preventDefault()` 는 아무 일도
     하지 않고 경고만 남긴다. 여기서는 그걸 막아야 한다 — 안 그러면 확대하려던
     휠이 창 본문(`.sr-window-body`)까지 같이 스크롤한다. */
  const plotEl = useRef<HTMLElement | null>(null);
  const setPlotEl = useCallback(
    (node: HTMLElement | null) => {
      plotEl.current = node;
      if (fill) plotRef(node);
    },
    [fill, plotRef],
  );

  const onWheel = useCallback(
    (e: WheelEvent) => {
      const len = view?.spanLen ?? 0;
      if (len < 2) return;
      e.preventDefault();
      const host = plotEl.current;
      if (!host) return;
      const r = host.getBoundingClientRect();
      if (e.shiftKey) {
        // 이동: 한 번에 보이는 폭의 10% 씩. 폭에 비례해야 확대 정도와 무관하게
        // 같은 "한 칸" 느낌이 난다.
        const visible = zoom ? zoom.i1 - zoom.i0 + 1 : len;
        const step = Math.max(1, Math.round(visible * 0.1));
        setZoom((z) => panRange(z, len, e.deltaY > 0 ? step : -step));
        return;
      }
      /* 앵커는 **커서의 x** 다 — 그 자리의 날짜가 그 자리에 남는다. 가운데
         기준으로 확대하면 보려던 지점이 화면 밖으로 밀려난다. */
      const frac = r.width > 0 ? (e.clientX - r.left) / r.width : 0.5;
      setZoom((z) => zoomRange(z, len, frac, e.deltaY > 0 ? 1.25 : 0.8));
    },
    [view?.spanLen, zoom],
  );

  useEffect(() => {
    const host = plotEl.current;
    if (!host) return;
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const unit = data?.unit ?? row?.unit ?? '%';
  const fmtY = useCallback((v: number) => fmtLevel(v, unit as Row['unit']), [unit]);

  /* 기준선 두 개. 종목 선과 **같은 x 날짜 위에** 얹는다(`alignByDate`). 어느 축에
   * 실릴지는 단위가 정한다 — `chart/references.ts::referenceMode`. */
  const mode = referenceMode(unit as Row['unit']);
  const refs = useMemo(() => {
    if (!view) return null;
    const cdLine = cd ? alignByDate(view.win, cd) : null;
    const policyLine = policyByDate(view.win, policy);
    const has = (a: (number | null)[] | null) => !!a && a.some((v) => v != null);
    if (!has(cdLine) && !has(policyLine)) return null;
    return { cd: has(cdLine) ? cdLine : null, policy: has(policyLine) ? policyLine : null };
  }, [view, cd, policy]);

  /** 보조 %축을 그리는가 — 기준선이 있고, 그것이 종목과 **다른 단위**일 때만. */
  const pctAxis = refs != null && mode === 'own';


  /* 차트가 먹는 시리즈. `yAxisId` 가 축을 고른다: 같은 단위면 셋 다 종목 축,
   * 다른 단위면 기준선 둘만 왼쪽 %축으로 간다. */
  const chartSeries = useMemo(() => {
    if (!view) return [];
    const refAxis = pctAxis ? PCT_AXIS : MAIN_AXIS;
    return [
      { id: row?.id ?? 'series', data: view.win.map((p) => p.v), color: hue, yAxisId: MAIN_AXIS },
      /* 두 기준선은 **같은 위계의 두 색**이다 [OWNER 2026-08-18, 3차 확정 —
         네이버 MA 방식]. 색·판정 이력은 `theme/direction.css` 의 토큰 주석에
         있다. 시리즈의 `color` 에 두는 이유: `Line` 의 기본 stroke 도 스크러버
         구슬도 여기서 색을 읽으므로, 선과 구슬이 한 곳에서 갈린다. */
      ...(refs?.cd
        ? [{ id: CD_LINE, data: refs.cd, color: 'var(--sr-ref-cd)', yAxisId: refAxis }]
        : []),
      ...(refs?.policy
        ? [{ id: BASE_LINE, data: refs.policy, color: 'var(--sr-ref-policy)', yAxisId: refAxis }]
        : []),
    ];
  }, [view, refs, pctAxis, hue, row?.id]);

  /* 축 설정. 두 번째 축은 **있을 때만** 선언한다 — 빈 축은 눈금을 그리고 폭을
   * 먹으면서 아무것도 말하지 않는다. */
  const yAxes = useMemo(
    () => (pctAxis ? [{ id: MAIN_AXIS }, { id: PCT_AXIS }] : [{ id: MAIN_AXIS }]),
    [pctAxis],
  );

  /** 왼쪽 축의 눈금은 언제나 % — 그게 이 축의 존재 이유다. */
  const fmtPct = useCallback((v: number) => fmtLevel(v, '%'), []);

  const scrubLabel = useCallback(
    (i: number) => {
      const p = view?.win[i];
      return p
        ? `${p.t} ${fmtLevel(p.v, unit as Row['unit'])}${unitSuffix(unit as Row['unit'])}`
        : '';
    },
    [view, unit],
  );

  /** 커브 노드의 리드아웃 — 만기, 오늘, 그리고 전일 대비 bp.
   *
   * 변화는 **백엔드 값**(`deltas.d1`)이지 여기서 뺀 값이 아니다. 화면에 있는 두
   * 레벨을 빼면 이미 반올림된 수의 차라 표의 어제 열과 어긋날 수 있고, 그건
   * §16 이 막는 실패다. */
  const curveScrubLabel = useCallback(
    (i: number) => {
      if (!curve) return '';
      const t = curve.tenors[i];
      const n = curve.now[i];
      const d = curve.changeBp[i];
      if (n == null) return `${t} —`;
      const head = `${t} ${fmtLevel(n, '%')}%`;
      return d == null ? head : `${head} (${fmtDelta(d, 'bp')}bp)`;
    },
    [curve],
  );

  /* ── 아무것도 안 고른 상태 = **IRS 파 커브** ────────────────────────────────
     빈 pane 에 "행을 고르세요" 라고 적어두는 대신 커브를 그린다. 커브 보기가 이
     제품의 1순위이고, 그건 탭과 무관하게 같은 커브다 [v1 OWNER, pass M].
     선은 둘 — 데이터 일자와 전일. 노드에 커서를 대면 스크러버가 그 노드를 읽는다.
     커브가 아예 없으면(요약 미도착) 그때는 안내 문구로 돌아간다. */
  if (!row) {
    if (!curve) {
      return (
        <VStack gap={0.5} paddingY={2}>
          <TextLabel2 as="span" color="fgMuted">
            행을 고르면 그 종목의 history 가 여기 그려져요.
          </TextLabel2>
        </VStack>
      );
    }
    /* 다른 커브에서 넘어온 인덱스는 **버린다**. pane 이 행과 커브를 오갈 때
       인덱스는 남아 있는데 가리키는 배열이 바뀌므로, 범위를 벗어난 인덱스로
       카드를 그리면 없는 만기의 값을 지어내게 된다(v1 도 같은 자리에서 같은
       가드를 둔다 — "stale until the next mouse move"). */
    const curveIdx =
      hoverIdx != null && hoverIdx >= 0 && hoverIdx < curve.tenors.length ? hoverIdx : null;
    /* `fill` 이면 이 열이 카드의 남는 높이를 전부 받는다. `minHeight={0}` 이 없으면
       flex 아이템의 기본 최소 높이가 자기 내용이라 줄지 않고, 그러면 안쪽 차트가
       카드를 넘어 자란다. */
    return (
      <VStack gap={0} width="100%" flexGrow={fill ? 1 : undefined} minHeight={0}>
        <VStack gap={0.5} paddingX={2} paddingTop={2} paddingBottom={1.5}>
          <TextLabel1 as="span" color="fgMuted" noWrap>
            IRS 커브
          </TextLabel1>
          <TextCaption as="span" color="fgMuted" noWrap>
            {curve.asof}
            {curve.prevDate ? ` · 전일 ${curve.prevDate}` : ''}
          </TextCaption>
        </VStack>
        <Box
          ref={fill ? plotRef : undefined}
          className="sr-plot"
          paddingX={1}
          flexGrow={fill ? 1 : undefined}
          flexBasis={fill ? 0 : undefined}
          minHeight={0}
          onMouseMove={onPlotMove}
          onMouseLeave={onPlotLeave}
        >
          <CartesianChart
            enableScrubbing
            onScrubberPositionChange={setHoverIdx}
            animate={false}
            height={chartH}
            accessibilityLabel={`IRS 파 커브, ${curve.tenors.length}개 노드`}
            inset={CHART_INSET}
            series={[
              /* 전일이 먼저 = 아래에 깔린다. 오늘 커브가 위에 와야 한다. */
              /* `yAxisId` 를 빼먹으면 축 이름과 조회가 어긋나 선이 조용히
                 사라진다 — 이 파일 위쪽 x 축 주석과 같은 함정이고, 이 커브를
                 처음 붙일 때 실제로 한 번 더 밟았다. */
              ...(curve.prev.some((v) => v != null)
                ? [{ id: 'PREV', data: curve.prev, color: 'var(--color-fgMuted)', yAxisId: MAIN_AXIS }]
                : []),
              { id: 'NOW', data: curve.now, color: 'var(--color-fg)', yAxisId: MAIN_AXIS },
            ]}
            xAxis={{ data: curve.tenors }}
            yAxis={[{ id: MAIN_AXIS }]}
          >
            <XAxis showGrid={false} />
            <YAxis axisId={MAIN_AXIS} position="right" showGrid={false} tickLabelFormatter={fmtPct} />
            {/* `curve="linear"` — CDS 기본은 `bump` 스플라인이고, 그건 노드
                사이를 **지어낸다**. 우리가 아는 것은 노드의 값뿐이라 마디를
                직선으로 잇는다(v1 도 직선 세그먼트다). 곡선이 예뻐 보이는 대신
                존재하지 않는 만기의 금리를 그리는 거래는 하지 않는다. */}
            {curve.prev.some((v) => v != null) ? (
              <Line
                seriesId="PREV"
                curve="linear"
                strokeWidth={1}
                strokeOpacity={0.5}
                connectNulls={false}
              />
            ) : null}
            <Line seriesId="NOW" curve="linear" connectNulls={false} />
            <Scrubber accessibilityLabel={curveScrubLabel} />
          </CartesianChart>
          {/* 노드의 리드아웃 — 히스토리 차트와 **같은 카드**다. 만기가 날짜
              자리에 오고 나머지 다섯 줄은 같다(v1 `ui/CurveView.tsx` 와 동일). */}
          {curveIdx != null ? (
            <ReadoutCard title={curve.tenors[curveIdx]} left={hoverX}>
              <ReadoutLevel k={READOUT_LABEL.level} v={curve.now[curveIdx]} unit="%" />
              <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={curve.high[curveIdx]} unit="%" />
              <ReadoutLevel k={READOUT_LABEL.rangeLow} v={curve.low[curveIdx]} unit="%" />
              <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={curve.avg[curveIdx]} unit="%" />
              <ReadoutChange
                k={READOUT_LABEL.dailyChange}
                v={curve.changeBp[curveIdx]}
                unit="bp"
              />
            </ReadoutCard>
          ) : null}
        </Box>
        <HStack gap={2} paddingX={2} paddingBottom={1} flexWrap="wrap">
          <RefKey label={curve.asof} opacity={1} />
          {curve.prev.some((v) => v != null) ? <RefKey label="전일" opacity={0.5} /> : null}
        </HStack>
      </VStack>
    );
  }

  const u = unitSuffix(row.unit);

  /* 서랍 모드 — 통계만. 히어로와 차트는 창 본문이 이미 그리고 있고, 서랍에서
   * 한 번 더 그리면 같은 차트가 한 창에 둘이 된다. */
  if (statsOnly) {
    return (
      <StatColumns row={row} view={view} u={u} />
    );
  }

  return (
    <VStack gap={0} width="100%" flexGrow={fill ? 1 : undefined} minHeight={0}>
      {/* ── hero ─────────────────────────────────────────────────────────────
          The reference puts the name small and the NUMBER large: the biggest
          thing on the page is the value, not the title of the page. */}
      <VStack gap={1.5} paddingX={2} paddingTop={2} paddingBottom={1.5}>
        <HStack justifyContent="space-between" alignItems="center" gap={2} flexWrap="wrap">
          {/* 확대 창 안에서는 이름을 창 제목이 진다 — 같은 낱말이 두 줄
              간격으로 두 번 서 있었다(전체 앱 크리틱 "확대 창 제목 중복").
              자리를 빈 span 으로 지키는 이유: 이 줄은 space-between 이라
              이름이 빠지면 기간 셀렉터가 왼쪽 끝으로 이사한다. */}
          {chartOnly ? (
            <span aria-hidden="true" />
          ) : (
            <TextLabel1 as="span" color="fgMuted" noWrap>
              {row.label}
            </TextLabel1>
          )}

          {/* CDS's own control for exactly this [OWNER 2026-08-13: CDS 컴포넌트만].
              `PeriodSelector` is a `SegmentedTabs` tuned for chart periods —
              transparent ground, a wash on the active tab, keyboard handling and
              the sliding indicator all included. The hand-rolled pill row it
              replaced had to reimplement each of those.

              The active tab still takes the CHART'S SIGN, which is the
              reference's trick — the control agrees with the picture. That is
              the one thing CDS cannot know, so it is set through a class on the
              root and read off `currentColor`. */}
          <HStack gap={1} alignItems="center">
            <Box className="sr-spans" data-dir={dir ?? 'flat'}>
              <PeriodSelector
                tabs={SPAN_TABS}
                activeTab={SPAN_TABS.find((t) => t.id === span) ?? null}
                onChange={(t) => t && setSpan(t.id as SpanKey)}
              />
            </Box>
            {/* 확대 — 떠 있는 창(레인 3)의 **첫 세입자**. 기구만 만들고 아무도
                안 살면 브라우저에서 검증할 방법이 없고, 그러면 레인 4·5 가 그
                위에 올라앉는 날 처음으로 시험받는다. 이 창은 그 자체로도 쓸모가
                있다: 같은 차트를 크게, 그리고 자리를 잡아두고 본다. */}
            {/* 확대 중일 때만 나오는 되돌리기 — 그리고 이제 **유일한** 되돌리기다
                (더블클릭 리셋은 차트 클릭 = 백테스트 복원과 함께 내렸다). */}
            {zoom ? (
              <button type="button" className="sr-enlarge" onClick={() => setZoom(null)}>
                구간 전체
              </button>
            ) : null}
            {onEnlarge ? (
              <button type="button" className="sr-enlarge" onClick={onEnlarge}>
                확대
              </button>
            ) : null}
          </HStack>
        </HStack>

        <HStack gap={1.5} alignItems="baseline" flexWrap="wrap">
          <TextDisplay3 as="span" tabularNumbers noWrap>
            {fmtLevel(row.now, row.unit)}
            {u ? (
              <Box as="span" className="sr-hero-unit">
                {u}
              </Box>
            ) : null}
          </TextDisplay3>
          {view ? (
            <TextBody
              as="span"
              tabularNumbers
              noWrap
              className={dir === 'up' ? 'sr-up' : dir === 'down' ? 'sr-down' : 'sr-flat'}
            >
              {dir === 'up' ? '↗' : dir === 'down' ? '↘' : '→'} {fmtDelta(view.net, row.unit)}
              {u}{' '}
              {/* 확대 중이면 이 변화는 **보이는 창**의 변화지 「1Y」의 변화가
                  아니다. 구간 이름을 그대로 두면 숫자와 라벨이 다른 기간을
                  말하게 되고, 그건 이 pane 이 처음부터 막으려던 실패다. */}
              <Box as="span" className="sr-hero-span">
                {zoom ? `${view.win[0].t} ~ ${view.win[view.win.length - 1].t}` : SPANS.find((s) => s.key === span)?.label}
              </Box>
            </TextBody>
          ) : null}
        </HStack>
      </VStack>

      {/* ── chart ────────────────────────────────────────────────────────────
          Reference chrome, matched: no gridlines, y labels on the RIGHT, the
          dotted area under the line, and a scrubber. */}
      {/* `flexBasis={0}` 이 없으면 **되먹임이 생긴다**: 상자가 자기 내용(차트)에서
          기본 크기를 잡는데 그 차트의 높이가 방금 잰 상자 높이라, 잴 때마다 조금씩
          자란다. 기본 크기를 0 으로 못박으면 상자는 «남는 만큼» 만 갖고, 차트는
          그걸 채우기만 한다. 표 카드가 창을 넘어 자라던 것과 같은 규칙이다. */}
      <Box
        ref={setPlotEl}
        className="sr-plot"
        paddingX={1}
        flexGrow={fill ? 1 : undefined}
        flexBasis={fill ? 0 : undefined}
        /* 고정 높이 모드에서는 **눌리지 않는다** [실측 2026-08-18]. 안의 CDS
           차트가 고정 픽셀(chartH)이라 상자를 눌러도 그림은 안 줄고 아래로
           비어져 나오기만 한다 — Main 오버뷰에서 상자가 173px 로 눌리자 차트
           하단 27px(날짜 줄)이 범례 밑으로 새어 **글자가 글자 위에** 겹쳤다.
           눌림이 필요하면(fill) 차트도 잰 값을 따라 주니 shrink 를 허용한다. */
        flexShrink={fill ? undefined : 0}
        minHeight={0}
        onMouseMove={onPlotMove}
        onMouseLeave={onPlotLeave}
        /* ── 차트 클릭 = 백테스트 [v1 계약 복원, OWNER 2026-08-18] ──────────
           v1 은 차트 블록 전체가 role="button" 이었고, 클릭하면 그 행 +
           **커서가 짚고 있던 날짜**로 백테스트가 열렸다. 짚은 날이 곧 진입일
           이다 — 차트에서 "저 날 들어갔으면" 을 보다가 누르는 것이 이 진입의
           전부다.

           더블클릭 확대-리셋은 이 복원에서 **내렸다**: 첫 클릭이 창을 여는
           순간 더블클릭은 도달 불가능한 조작이 된다. 되돌리기는 확대 중에만
           나타나는 「구간 전체」 버튼이 이미 지고 있다. */
        role={onOpenBacktest && row ? 'button' : undefined}
        tabIndex={onOpenBacktest && row ? 0 : undefined}
        aria-label={onOpenBacktest && row ? `${row.label} 백테스트 열기` : undefined}
        style={onOpenBacktest && row ? { cursor: 'pointer' } : undefined}
        onClick={
          onOpenBacktest && row ? () => onOpenBacktest(row, hoverPoint?.t) : undefined
        }
        onKeyDown={
          onOpenBacktest && row
            ? (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpenBacktest(row, hoverPoint?.t);
                }
              }
            : undefined
        }
      >
        {error ? (
          <TextLabel2 as="span" className="sr-up">
            history 를 불러오지 못했어요 — {error}
          </TextLabel2>
        ) : view ? (
          /* `LineChart` 가 아니라 `CartesianChart` 인 이유는 **축이 둘일 수 있어서**다.
             `LineChart` 는 편의 래퍼이고 y축 설정을 하나만 만든다(LineChart.js:92) —
             그래서 bp 차트의 보조 %축이 "CDS 로는 안 된다" 로 잘못 기록돼 있었다.
             한 겹 내려오면 `yAxis` 는 배열이고 시리즈는 `yAxisId` 로 축을 고른다.
             아래 자식들은 `LineChart` 가 원래 대신 그려주던 것 그대로다. */
          <CartesianChart
            enableScrubbing
            onScrubberPositionChange={setHoverIdx}
            height={chartH}
            accessibilityLabel={`${row.label} ${SPANS.find((s) => s.key === span)?.label} 추이, ${view.win.length}개 점`}
            inset={CHART_INSET}
            /* No reveal animation.
             *
             * The enter transition is a clip-path growing from zero width. On a
             * page you land on once that reads as polish; here the pane re-mounts
             * on every row click, so a desk scanning twenty instruments would
             * watch the same line draw itself twenty times. That is motion
             * carrying no information, and it delays the number the reader came
             * for. The reference animates because it is a destination; this pane
             * is not one.
             *
             * CLOSED 2026-08-14, and hover settled it. The pane now follows the
             * POINTER: crossing the table re-mounts this chart every 120ms-plus-
             * a-fetch. A reveal animation there would not read as polish, it
             * would strobe. Do not re-open it without a reason that survives
             * hover. */
            animate={false}
            series={chartSeries}
            xAxis={{ data: view.win.map((p) => p.t) }}
            yAxis={yAxes}
          >
            <XAxis showGrid={false} />
            {/* 종목 축은 오른쪽 — 레퍼런스(coinbase.com/price/*)의 자리다. */}
            <YAxis axisId={MAIN_AXIS} position="right" showGrid={false} tickLabelFormatter={fmtY} />
            {/* 보조 %축은 **왼쪽** [OWNER 2026-08-14]. bp 차트에서만 존재하고,
                기준선 둘이 이 축을 쓴다. 눈금이 muted 인 이유는 이게 종목의 축이
                아니라 배경의 축이기 때문이다 — 읽는 사람이 어느 숫자가 어느 선의
                것인지 헷갈리면 안 된다. */}
            {pctAxis ? (
              <YAxis
                axisId={PCT_AXIS}
                position="left"
                showGrid={false}
                /* 눈금 글자만 흐리게. `color` prop 은 축에 없고(타입 확인),
                   `styles.tickLabel` 이 CDS 가 주는 자리다. */
                styles={{ tickLabel: { opacity: 0.65 } }}
                tickLabelFormatter={fmtPct}
              />
            ) : null}
            <Line
              seriesId={row.id}
              showArea
              areaType="dotted"
              connectNulls={false}
            />
            {/* 기준선은 종목 선 뒤에 선다: 채움 없고, 종목 선(2px)보다 얇게.
                **둘이 똑같이 그려진다** — 같은 굵기, 같은 불투명도. 다른 것은
                **색 하나**다(호박/보라, 같은 지각적 무게 — `direction.css`).
                기준금리는 `stepAfter` — 정책금리는 평평하다가 뛴다. 둘 다
                `connectNulls` 를 끈다(끊긴 구간은 모르는 구간이다). */}
            {refs?.cd ? (
              <Line seriesId={CD_LINE} strokeWidth={1.5} strokeOpacity={0.9} connectNulls={false} />
            ) : null}
            {refs?.policy ? (
              <Line
                seriesId={BASE_LINE}
                curve="stepAfter"
                strokeWidth={1.5}
                strokeOpacity={0.9}
                connectNulls={false}
              />
            ) : null}
            {/* 선 끝 가격 칩(price line 라벨)이 여기 살았다가 오너 지시로
                내렸다 [OWNER 2026-08-18 — "굳이 선 끝에 가격 칩은 안 넣어줘도
                될듯"]. 칩이 축 눈금·날짜 라벨과 겹치던 것도 함께 사라졌다.
                이름은 색 범례가, 값은 리드아웃 카드(hover)가 진다. */}
            {/* 스크러버가 짚는 시리즈를 **명시**한다. 기본값은 `series` 전부라
                (`Scrubber.js:74`) 캔들의 꼬리 시리즈 둘에도 구슬이 찍힌다 — 안
                그려진 선 위에 점 두 개가 뜨는 셈이다. 여기 나열된 것만 찍는다. */}
            <Scrubber
              accessibilityLabel={scrubLabel}
              seriesIds={[
                row.id,
                ...(refs?.cd ? [CD_LINE] : []),
                ...(refs?.policy ? [BASE_LINE] : []),
              ]}
            />
          </CartesianChart>
        ) : (
          <Box height={chartH} />
        )}
        {/* 커서 아래 점의 리드아웃 [OWNER 2026-08-14: "패널에서는 날짜, 레벨,
            52주 최고·최저·평균, CD91 금리가 나와야 함"].

            52주 세 줄은 **이 구간의 통계가 아니다** — 서버가 낸 최근 252관측이고,
            1M 으로 좁혀도 안 바뀐다(v1 과 같은 규칙). 차트가 보여주는 구간의
            고저는 히어로 밑 「이 구간」 열이 따로 말한다.
            CD 91일은 **그려진 선이 있을 때만** 나온다 — 없는 선의 값을 카드가
            읽는 일은 없다(범례가 지는 규칙과 같다). */}
        {hoverPoint ? (
          <ReadoutCard title={hoverPoint.t} left={hoverX}>
            <ReadoutLevel k={READOUT_LABEL.level} v={hoverPoint.v} unit={row.unit} />
            <ReadoutLevel k={READOUT_LABEL.rangeHigh} v={stats52.max} unit={row.unit} />
            <ReadoutLevel k={READOUT_LABEL.rangeLow} v={stats52.min} unit={row.unit} />
            <ReadoutLevel k={READOUT_LABEL.rangeAvg} v={stats52.avg} unit={row.unit} />
            {refs?.cd ? (
              <ReadoutLevel k={READOUT_LABEL.cd91} v={refs.cd[hoverPoint.i]} unit="%" />
            ) : null}
            <ReadoutChange
              k={READOUT_LABEL.dailyChange}
              v={hoverPoint.d}
              unit={row.unit}
            />
          </ReadoutCard>
        ) : null}
      </Box>

      {/* ── 기준선 범례 ───────────────────────────────────────────────────────
          한 줄, 그리고 **실제로 그려진 것만** 이름을 얻는다. 늘 두 이름을 찍으면
          CD 를 못 받아온 날 화면이 없는 선을 가리킨다. 범례가 없다 = 기준선이
          없다, 이고 그건 bp·ratio 차트에서 정상이다(`referenceMode`). */}
      {refs ? (
        <HStack gap={2} paddingX={2} paddingBottom={1} flexWrap="wrap">
          {/* 같은 위계 = 색만 다르고 나머지 취급은 전부 같다. */}
          {refs.cd ? <RefKey label="CD 91일" opacity={0.9} color="var(--sr-ref-cd)" /> : null}
          {refs.policy ? (
            <RefKey label="기준금리" opacity={0.9} color="var(--sr-ref-policy)" />
          ) : null}
        </HStack>
      ) : null}

      {/* ── stat columns ─────────────────────────────────────────────────────
          `chartOnly` 면 통째로 빠진다 — 확대 창이 이걸 서랍에 따로 그린다. */}
      {chartOnly ? null : (
      <>
      {/* ─────────────────────────────────────────────────────────────────────
          Three groups divided by vertical hairlines, as the reference divides
          Trading Insights / Market Stats / Performance. */}
      <StatColumns row={row} view={view} u={u} />
      </>
      )}
    </VStack>
  );
}
