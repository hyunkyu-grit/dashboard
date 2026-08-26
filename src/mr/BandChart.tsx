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

import { TimeChart, type TimeLine } from '@/chart/TimeChart';
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

  /* 주선 = 구간 방향색(hue), 보조선(밴드·중심)은 뮤트 — Main 미리보기의 종목 선 +
     기준선 위계 그대로. **밴드가 먼저** = 아래에 깔린다.
     캔버스에는 불투명도 손잡이가 없어 색 자체를 흐리게 만든다(`palette.dim`). */
  const lines: TimeLine[] = [
    { id: 'up', values: up, color: (p) => p.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'lo', values: lo, color: (p) => p.dim('var(--color-fgMuted)', 45), width: 1 },
    { id: 'ma', values: ma, color: (p) => p.dim('var(--color-fgMuted)', 70), width: 1 },
    /* 점선 면 — Main 미리보기 종목 선의 그 채움(areaType="dotted"). */
    { id: 'v', values: v, color: (p) => p.resolve(hue), area: 'dots' },
  ];

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
      <TimeChart
        height={240}
        accessibilityLabel={`${history.label} 값과 밴드 이력`}
        dates={dates}
        lines={lines}
        onHoverIndex={setIdx}
        hoverLabel={() => `${history.label} 이력 짚기`}
      />
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
