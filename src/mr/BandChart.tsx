'use client';

/* 값 + 밴드(중심선·상단·하단) 이력 차트 — Mean Reversion 상세 카드.
 *
 * RvPage 의 소형 차트와 같은 기계다: CDS `CartesianChart` + `Scrubber`,
 * 커서 리드아웃은 공용 `ReadoutCard`. 밴드가 상수가 아니라 **구르는 선**이라
 * `ReferenceLine`(dataY 상수) 대신 시리즈 셋으로 선다. 밴드 선은 값보다
 * 흐리게(strokeWidth·strokeOpacity) — 색을 더 시키지 않는다(LinkedCharts 의
 * 기준선 판단: 같은 지각적 무게 문제).
 *
 * 숫자는 서버 것 그대로(§16) — 여기서 밴드를 다시 내지 않는다.
 */

import { useState } from 'react';

import { Box } from '@coinbase/cds-web/layout';
import {
  CartesianChart,
  Line,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import type { Unit } from '@/lib/api';
import { ReadoutCard, ReadoutLevel, placeReadout } from '@/ui/ReadoutCard';

import type { MrHistory } from './api';

export function BandChart({ history }: { history: MrHistory }) {
  const [idx, setIdx] = useState<number | null>(null);
  const dates = history.points.map((p) => p.t);
  const v = history.points.map((p) => p.v);
  const ma = history.points.map((p) => p.ma);
  const up = history.points.map((p) => p.up);
  const lo = history.points.map((p) => p.lo);
  const cur = idx != null ? history.points[idx] : undefined;
  const unit = history.unit as Unit;
  /* 주선 색 = **보이는 구간의 순변화 방향** — Main 미리보기(PreviewPane)의
     그 규칙이다. 잉크로 칠했던 판은 시뮬 시나리오 커브의 문법을 잘못 가져온
     것이었다 [OWNER 2026-08-25 — "진짜 Backtest 랑 Main 을 참고한 게 맞는지"]. */
  const net = v.length > 1 ? v[v.length - 1]! - v[0]! : 0;
  const hue = net === 0 ? 'var(--color-fgMuted)' : net > 0 ? 'var(--sr-up)' : 'var(--sr-down)';

  return (
    <Box
      className="sr-plot"
      width="100%"
      /* 카드 자리는 상자의 CSS 변수 — 상태가 아니다(`placeReadout` 머리글). */
      onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => {
        placeReadout(e.currentTarget, e.clientX);
      }}
      onMouseLeave={() => setIdx(null)}
    >
      <CartesianChart
        enableScrubbing
        onScrubberPositionChange={(i) => setIdx(i ?? null)}
        animate={false}
        height={240}
        accessibilityLabel={`${history.label} 값과 밴드 이력`}
        /* Main 미리보기와 같은 여백(PreviewPane CHART_INSET) — 여백이 다르면
           나란히 선 두 화면이 어긋나 보인다. */
        inset={{ top: 16, right: 12, bottom: 8, left: 8 }}
        /* 주선 = 구간 방향색(hue), 보조선(밴드·중심)은 뮤트 — Main 미리보기의
           종목 선 + 기준선 위계 그대로. */
        series={[
          { id: 'v', data: v, color: hue, yAxisId: 'y' },
          { id: 'ma', data: ma, color: 'var(--color-fgMuted)', yAxisId: 'y' },
          { id: 'up', data: up, color: 'var(--color-fgMuted)', yAxisId: 'y' },
          { id: 'lo', data: lo, color: 'var(--color-fgMuted)', yAxisId: 'y' },
        ]}
        xAxis={{ data: dates }}
        yAxis={[{ id: 'y' }]}
      >
        <XAxis showGrid={false} />
        <YAxis axisId="y" position="right" showGrid={false} />
        {/* 밴드 먼저, 값 마지막 — 값 선이 밴드 위에 선다. */}
        <Line seriesId="up" strokeWidth={1} strokeOpacity={0.45} connectNulls={false} />
        <Line seriesId="lo" strokeWidth={1} strokeOpacity={0.45} connectNulls={false} />
        <Line seriesId="ma" strokeWidth={1.5} strokeOpacity={0.7} connectNulls={false} />
        {/* 점선 면 — Main 미리보기 종목 선의 그 채움(areaType="dotted"). */}
        <Line seriesId="v" curve="linear" showArea areaType="dotted" connectNulls={false} />
        <Scrubber accessibilityLabel={`${history.label} 이력 짚기`} seriesIds={['v']} />
      </CartesianChart>
      {cur ? (
        <ReadoutCard title={cur.t}>
          <ReadoutLevel k="값" v={cur.v} unit={unit} />
          <ReadoutLevel k="중심선" v={cur.ma} unit={unit} />
          <ReadoutLevel k="상단" v={cur.up} unit={unit} />
          <ReadoutLevel k="하단" v={cur.lo} unit={unit} />
        </ReadoutCard>
      ) : null}
    </Box>
  );
}
