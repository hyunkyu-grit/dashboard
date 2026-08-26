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

import { useCallback, useEffect, useMemo, useState } from 'react';

import { LineSeries } from 'lightweight-charts';
import type { ISeriesApi, LineData, WhitespaceData } from 'lightweight-charts';

import type { LwPalette } from './palette';
import { monthsLabel, tenorMonths } from './tenor';
import { useLwChart } from './useLwChart';

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

  /* 만기를 월수로 바꾸고 **오름차순으로 세운다** — 라이브러리는 정렬된 데이터를
     요구하고, 안 그러면 조용히 틀린 자리에 그린다. 원래 인덱스를 같이 들고
     다녀야 리드아웃이 제 노드를 읽는다. */
  const order = useMemo(() => {
    const rows = nodes
      .map((id, i) => ({ i, m: tenorMonths(id) }))
      .filter((r): r is { i: number; m: number } => r.m != null);
    rows.sort((a, b) => a.m - b.m);
    return rows;
  }, [nodes]);

  /** 월수 -> 원래 인덱스. 크로스헤어가 주는 것은 월수뿐이다. */
  const byMonth = useMemo(() => new Map(order.map((r) => [r.m, r.i])), [order]);

  const lastMonth = order.length ? order[order.length - 1].m : 120;
  const handle = useLwChart<number>('curve', el, {
    formatTime: monthsLabel,
    /* 데이터가 짧으면 그만큼만 본다 — 기본 120(10년)으로 두면 5Y 커브가 화면
       왼쪽 절반에 몰린다. */
    minimumTimeRange: lastMonth,
  });

  const notify = useCallback(
    (i: number | null) => {
      setHover(i);
      onHoverIndex?.(i);
    },
    [onHoverIndex],
  );

  useEffect(() => {
    if (!handle) return;
    const { chart, palette } = handle;

    const made: ISeriesApi<'Line', number>[] = lines.map((ln) => {
      const s = chart.addSeries(LineSeries, {
        color: ln.color(palette),
        lineWidth: ln.width ?? 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: true,
        priceFormat: { type: 'price', precision, minMove: 10 ** -precision },
      });
      /* 값이 없는 만기는 **whitespace** 로 넣는다 — 빼 버리면 선이 이어져
         버려서 «그 만기에 값이 있다» 고 거짓말한다(CDS 판의 `connectNulls={false}`
         가 하던 일). */
      const data: (LineData<number> | WhitespaceData<number>)[] = order.map((r) => {
        const v = ln.values[r.i];
        return v == null ? { time: r.m } : { time: r.m, value: v };
      });
      s.setData(data);
      return s;
    });

    chart.timeScale().fitContent();

    return () => {
      for (const s of made) chart.removeSeries(s);
    };
  }, [handle, lines, order, precision]);

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
      notify(t == null ? null : (byMonth.get(t) ?? null));
    };
    chart.subscribeCrosshairMove(onMove);
    return () => chart.unsubscribeCrosshairMove(onMove);
  }, [handle, byMonth, notify]);

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
