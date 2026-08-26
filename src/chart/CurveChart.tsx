'use client';

/* 만기 커브 한 장 — 세 화면이 같이 쓴다 [2026-08-26 이관].
 *
 * 쓰는 곳: `ui/PreviewPane`(IRS 파 커브) · `sim/CurvePreview`(시나리오 커브) ·
 * `lab/scenario/ModelChart`(모형 커브). 셋이 각자 만들면 격자·축·여백·전일선
 * 색이 갈린다 — CLAUDE.md 「얼라인」 8.
 *
 * ── 가로축이 **진짜 만기 축**이다 ───────────────────────────────────────────
 * CDS 판은 `xAxis={{ data: curve.tenors }}` 였다. 그건 **범주 축**이라 3M 과
 * 1Y 사이 간격이 10Y 와 20Y 사이 간격과 같았다. 여기서는
 * `createYieldCurveChart` 를 쓰므로 자리가 **만기에 비례**한다.
 *
 * 그 차이는 눈에 보인다: 짧은 쪽(3M~1Y)이 눌리고 긴 쪽이 넓어진다. 만기 축의
 * 정석이고(그래서 라이브러리가 이 차트를 따로 둔다), 커브의 «기울기» 가 화면에서
 * 실제 기울기가 된다 — 범주 축에서는 3M~1Y 구간이 실제보다 9배 완만해 보였다.
 * [OWNER 2026-08-26 — "Yield Curve를 모델링해주는 라이트웨이트차트가 있을건데?"]
 *
 * ── 마디는 **직선**으로 잇는다 ──────────────────────────────────────────────
 * CDS 판 주석이 적어 둔 규칙 그대로다: 우리가 아는 것은 노드의 값뿐이라 노드
 * 사이를 지어내지 않는다. `LineSeries` 의 기본이 직선 세그먼트라 따로 끌
 * 손잡이가 없다 — 스플라인을 켜지 않는 것으로 지킨다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { LineSeries } from 'lightweight-charts';
import type { ISeriesApi, LineData, WhitespaceData } from 'lightweight-charts';

import type { LwPalette } from './palette';
import { tenorMonths } from './tenor';
import { TenorHorzScale, monthsToX } from './tenorScale';
import { useLwChart } from './useLwChart';

/** 양 끝 여백(√만기 축 단위). 3M~10Y 축이 대략 35~219 이라 4 면 두 칸 남짓이다. */
const EDGE_PAD = 4;

export type CurveLine = {
  id: string;
  /** `nodes` 와 **같은 길이**. `null` 은 그 만기에 값이 없다는 뜻이고 선이 끊긴다. */
  values: readonly (number | null)[];
  /** 색은 팔레트에서 고른다 — 문자열을 직접 주지 않는다(`guards/chart-palette`). */
  color: (p: LwPalette) => string;
  width?: 1 | 2;
};

export function CurveChart({
  nodes,
  lines,
  height,
  onHoverIndex,
  tickFormat,
  precision = 2,
  accessibilityLabel,
  hoverLabel,
}: {
  /** 만기 이름들 — `3M`·`1Y`·`10Y`. 순서는 아무래도 좋다(안에서 정렬한다). */
  nodes: readonly string[];
  lines: readonly CurveLine[];
  height?: number;
  /** 커서가 문 노드의 **원래 인덱스**(`nodes` 기준). 벗어나면 `null`. */
  onHoverIndex?: (i: number | null) => void;
  /** 세로축 눈금 글자. */
  tickFormat?: (v: number) => string;
  precision?: number;
  accessibilityLabel: string;
  /**
   * 커서가 문 노드의 낭독 문장. CDS `Scrubber` 의 `accessibilityLabel` 자리다 —
   * 캔버스에는 읽을 DOM 이 없어서 문장을 `aria-live` 줄에 따로 세운다.
   * 안 주면 그 낭독이 **없어진다**(이관으로 조용히 잃기 쉬운 것).
   */
  hoverLabel?: (i: number) => string;
}) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  /* 축은 이 차트가 살아 있는 동안 **하나**다 — 매 렌더 새로 만들면 참조가
     바뀌어 차트가 통째로 다시 만들어진다. */
  const scaleRef = useRef<TenorHorzScale | null>(null);
  if (scaleRef.current === null) scaleRef.current = new TenorHorzScale();
  const scale = scaleRef.current;

  /* 만기를 월수로 바꾸고 **오름차순으로 세운다** — 라이브러리는 정렬된 데이터를
     요구하고, 안 그러면 조용히 틀린 자리에 그린다. 원래 인덱스를 같이 들고
     다녀야 리드아웃이 제 노드를 읽는다. */
  const order = useMemo(() => {
    const rows = nodes
      .map((id, i) => ({ i, m: tenorMonths(id), x: 0 }))
      .filter((r): r is { i: number; m: number; x: number } => r.m != null);
    rows.sort((a, b) => a.m - b.m);
    /* 두 만기가 같은 자리로 떨어지면 뒤엣것을 버린다 — 라이브러리는 같은 x 를
       두 번 받으면 조용히 하나만 그린다. 실제 어휘에서는 안 생기지만
       (3M->35 · 6M->49 · …), 규칙을 여기 적어 둔다. */
    const seen = new Set<number>();
    const out: { i: number; m: number; x: number }[] = [];
    for (const r of rows) {
      const x = monthsToX(r.m);
      if (seen.has(x)) continue;
      seen.add(x);
      out.push({ ...r, x });
    }
    return out;
  }, [nodes]);

  /**
   * 커서가 있는 자리에서 **가장 가까운 노드**의 원래 인덱스.
   *
   * 정확히 일치를 찾으면 안 된다: 노드 사이는 빈 점으로 촘촘히 메워져 있어서
   * (√만기 자리를 만드는 것이 그 빈 점들이다) 커서는 거의 항상 노드가 **아닌**
   * 자리에 선다. 실측 2026-08-26: 그렇게 뒀더니 크로스헤어는 뜨는데 리드아웃
   * 카드가 안 떴다. CDS `Scrubber` 는 늘 가장 가까운 노드로 붙었고, 이 화면의
   * 리드아웃은 그 성질 위에 서 있다.
   */
  const nearest = useMemo(() => {
    const xs = order.map((r) => r.x);
    return (x: number): number | null => {
      if (xs.length === 0) return null;
      let best = 0;
      for (let k = 1; k < xs.length; k++) {
        if (Math.abs(xs[k] - x) < Math.abs(xs[best] - x)) best = k;
      }
      return order[best].i;
    };
  }, [order]);

  const handle = useLwChart<number>('curve', el, { scale });

  const notify = useCallback(
    (i: number | null) => {
      setHover(i);
      onHoverIndex?.(i);
    },
    [onHoverIndex],
  );

  useEffect(() => {
    if (!handle || order.length === 0) return;
    const { chart, palette } = handle;

    /* 축에 «어느 자리가 진짜 만기인지» 를 알려 준다 — 눈금 글자와 가중치가
       거기서 나온다. `setData` **전에** 해야 첫 그리기부터 맞다. */
    scale.setNodes(order.map((r) => r.m));

    const made: ISeriesApi<'Line', number>[] = lines.map((ln) => {
      const s = chart.addSeries(LineSeries, {
        color: ln.color(palette),
        lineWidth: ln.width ?? 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
      });
      /* 노드 **사이를 빈 점으로 메운다.** 라이브러리의 가로축은 인덱스 간격이라,
         이 빈 점들이 곧 «자리» 다 — 이것이 없으면 노드가 등간격으로 서고 √만기
         축이 아무 일도 안 한 것이 된다(`tenorScale.ts` 머리 주석).
         값이 없는 만기도 같은 빈 점이 된다 — 빼 버리면 선이 이어져서 «그 만기에
         값이 있다» 고 거짓말한다(CDS 판의 `connectNulls={false}` 가 하던 일). */
      const valueAt = new Map<number, number | null>();
      for (const r of order) valueAt.set(r.x, ln.values[r.i] ?? null);

      const data: (LineData<number> | WhitespaceData<number>)[] = [];
      /* 양 끝에 빈 점을 조금 더 둔다 — `fixLeftEdge`/`fixRightEdge` 때문에 첫·끝
         노드가 축 모서리에 딱 붙어 점 표시가 반쯤 잘린다. CDS 판의
         `CHART_INSET{left:8,right:12}` 가 하던 일의 자리다. */
      const pad = EDGE_PAD;
      const lo = (order[0]?.x ?? 0) - pad;
      const hi = (order[order.length - 1]?.x ?? 0) + pad;
      for (let x = lo; x <= hi; x++) {
        const v = valueAt.get(x);
        data.push(v == null ? { time: x } : { time: x, value: v });
      }
      s.setData(data);
      return s;
    });

    chart.timeScale().fitContent();

    return () => {
      for (const s of made) chart.removeSeries(s);
    };
  }, [handle, lines, order, precision, scale]);

  /* 세로축 눈금 글자. 옵션이라 차트가 선 뒤에 따로 건다. */
  useEffect(() => {
    if (!handle || !tickFormat) return;
    handle.chart.applyOptions({ localization: { priceFormatter: tickFormat } });
  }, [handle, tickFormat]);

  useEffect(() => {
    if (!handle) return;
    const { chart } = handle;
    const onMove = (param: { time?: number }) => {
      const t = param.time;
      notify(t == null ? null : nearest(t));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [handle, nearest, notify]);

  return (
    <>
      <div
        ref={setEl}
        /* 캔버스에는 읽을 DOM 이 없다. 컨테이너가 그림 하나로 서고 이름을 진다 —
           CDS `accessibilityLabel` 이 하던 일의 자리다. */
        role="img"
        aria-label={accessibilityLabel}
        /* **폭은 `flexGrow` 로 받는다.** CDS `Box` 는 flex row 라(CLAUDE.md
           「얼라인」 7) 이 div 를 그냥 두면 **내용 폭 = 0** 이 된다 — 캔버스는
           안에서 절대 배치라 내용이 없다. 실측 2026-08-26: 부모 874px 에
           이 div 가 0px 이었고 차트가 통째로 안 보였다.
           `width:'100%'` 이 아니라 flex 인 이유: 블록 부모에서는 flex 속성이
           무시되어 어차피 100% 가 되고, flex 부모에서는 형제(리드아웃 카드)와
           안 다툰다. `minWidth:0` 이 없으면 flex 아이템의 최소 폭이 내용이라
           줄지 않는다. */
        style={{
          flexGrow: 1,
          flexBasis: 0,
          minWidth: 0,
          height: height != null ? height : '100%',
        }}
      />
      {/* 스크러버의 낭독을 대신하는 줄. 화면에는 없고 낭독기에만 있다. */}
      <span className="sr-a11y-only" aria-live="polite">
        {hoverLabel && hover != null ? hoverLabel(hover) : ''}
      </span>
    </>
  );
}
