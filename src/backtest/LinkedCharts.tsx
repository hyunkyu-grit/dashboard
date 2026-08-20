'use client';

/* 백테스트의 차트 한 쌍 — 종목 차트 + **픽셀 정렬된** 누적 손익 [v1 OWNER
 * 재피드백, 2026-08-04 — "PL은 밑에 그려지되 … far left가 진입일, far right가
 * 청산일로 해서 … 완전히 수직적으로 얼라인"].
 *
 * v1 `ui/BacktestPnlCharts.tsx`(손 SVG)의 CDS 재구현이다. 정렬은 조정이 아니라
 * **구성**이다: 두 차트가 같은 날짜 배열을 x 도메인으로 받고(문자열 xAxis →
 * 인덱스 도메인, `[0, n-1]` 선형), 같은 inset 을 쓴다 — 한 날짜의 x 가 위아래서
 * 픽셀까지 같다. 십자선은 CDS `ReferenceLine`(dataX = 인덱스)로 **반대쪽
 * 차트에** 선다: 스크러버가 짚는 쪽은 CDS 자신의 세로선이 이미 있다.
 *
 * 손익 값은 서버의 발행점을 **찾아 쓸 뿐** 계산하지 않는다(§16): 각 날짜의
 * 돈은 그 날짜 이전 가장 최근 발행점의 누적 손익이고(전진 워크), `당일`(d)은
 * 서버가 발행점마다 전영업일을 따로 평가해 실어 준 1영업일 변화다.
 *
 * 0선은 항상 프레임 안이다 — 승패의 경계라, 자기 축 위·아래로 통째로 떠 있는
 * 손익 차트는 한눈에 읽히지 않는다. `ReferenceLine`(dataY=0)이 그 선이다.
 *
 * 리드아웃은 공용 `ReadoutCard` 가 아니라 **돈 카드**다(v1 의 같은 결정 —
 * 그 카드는 `fmtLevel`/`fmtDelta` 를 소유해서 수량 문법이 하나로 남는 물건이고,
 * 이 축은 `fmtKrw` 의 억/만이다. 다른 수량, 다른 카드).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { TextCaption, TextLabel2 } from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  ReferenceLine,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { alignByDate, policyByDate, referenceMode } from '@/chart/references';
import type { PolicyStep, Unit } from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw } from '@/lib/krw';
import { loadCd, RefKey } from '@/ui/PreviewPane';
import { readoutLeft } from '@/ui/ReadoutCard';

/** `PnlSeries` — v1 과 같은 구조 프롭. IRS 북(`BacktestResult`)과 현금채권
 * (`CashBondBacktest`)이 둘 다 이 모양을 만족하고, 차트는 그 둘의 차이를 알
 * 필요가 없다. 이 네 필드가 사라지면 타입이 먼저 말한다. */
export interface PnlSeries {
  from: string;
  to: string;
  pnl: number;
  points: { t: string; pnl: number; d: number | null }[];
}

const INSET = { top: 12, right: 12, bottom: 8, left: 8 };
const TOP_AXIS = 'level';
const BOT_AXIS = 'pnl';
/** 기준선 두 개 — 미리보기 pane 과 같은 낱말 [OWNER 2026-07-31: "CD와
 * 기준금리는 항상 같이 그린다" + 2026-08-19: "백테스트에 CD금리는 같이"].
 * %-종목은 같은 축, bp-종목은 왼쪽 %축(`referenceMode`). */
const CD_LINE = 'CD91';
const BASE_LINE = 'BASE';
const PCT_AXIS = 'pct';

/** 날짜별 누적 손익 — 서버 발행점의 **전진 워크**(찾기, 계산 아님 §16).
 * 각 날짜의 돈은 그 날짜 이전(포함) 가장 최근 발행점의 누적이고, 발행점보다
 * 앞선 날짜는 0(진입 전 = 아직 아무 일도 없다). 두 배열 다 날짜 오름차순. */
export function pnlAtDates(
  dates: string[],
  published: { t: string; pnl: number }[],
): number[] {
  const out: number[] = [];
  let j = -1;
  for (const t of dates) {
    while (j + 1 < published.length && published[j + 1].t <= t) j++;
    out.push(j >= 0 ? published[j].pnl : 0);
  }
  return out;
}


/** 돈 두 줄 — 누적과 당일. 방향색은 값의 부호. */
function MoneyRow({ k, v }: { k: string; v: number | null }) {
  return (
    <HStack justifyContent="space-between" gap={1}>
      <TextCaption as="span" color="fgMuted" noWrap>
        {k}
      </TextCaption>
      <TextLabel2
        as="span"
        tabularNumbers
        noWrap
        className={v == null ? undefined : v > 0 ? 'sr-up' : v < 0 ? 'sr-down' : undefined}
      >
        {v == null ? '—' : fmtKrw(v)}
      </TextLabel2>
    </HStack>
  );
}

export function LinkedCharts({
  points,
  unit,
  seriesColor,
  result,
  marks,
  policy,
}: {
  /** 종목 차트가 그리는 창 — 진입(첫 점)부터 청산(끝 점)까지, 서버 발행점. */
  points: { t: string; v: number }[];
  unit: Unit;
  /** 종목 선의 색. 안 주면 잉크. */
  seriesColor?: string;
  result: PnlSeries;
  /** 진입·청산 표시 — 세로 기준선과 라벨. 날짜는 on-or-after 로 인덱스가 된다. */
  marks?: { date: string; label: string }[];
  /** 기준금리 스텝 — 화면의 성질이라 받는다(미리보기 pane 과 같은 규칙).
   * 없으면 그 선만 빠진다. */
  policy?: PolicyStep;
}) {
  /* 커서가 짚은 점 — 어느 차트가 짚었는지도 함께. 십자선은 반대쪽에만 선다. */
  const [hover, setHover] = useState<{ i: number; src: 'top' | 'bottom' }>();
  const [hoverX, setHoverX] = useState(0);

  /* CD 91일 — `PreviewPane.loadCd` 의 모듈 캐시를 그대로 쓴다(한 페이지에서 두
   * 번 받지 않는다). 실패는 null: 기준선이 없다고 백테스트가 안 보일 이유는
   * 없고, 범례가 없는 것으로 그 사실을 말한다. */
  const [cd, setCd] = useState<{ t: string; v: number }[] | null>(null);
  useEffect(() => {
    let on = true;
    void loadCd().then((p) => {
      if (on) setCd(p);
    });
    return () => {
      on = false;
    };
  }, []);

  const dates = useMemo(() => points.map((p) => p.t), [points]);

  const pnlVals = useMemo(() => pnlAtDates(dates, result.points), [dates, result.points]);

  /* 기준선을 종목 창의 날짜에 얹는다 — 미리보기와 같은 정렬 규칙(`alignByDate`:
   * 날짜로 맞추고, 시작 전은 null, 뒤로는 안 끌어온다). */
  const mode = referenceMode(unit);
  const refs = useMemo(() => {
    const cdLine = cd ? alignByDate(points, cd) : null;
    const policyLine = policyByDate(points, policy);
    const has = (a: (number | null)[] | null) => !!a && a.some((v) => v != null);
    if (!has(cdLine) && !has(policyLine)) return null;
    return { cd: has(cdLine) ? cdLine : null, policy: has(policyLine) ? policyLine : null };
  }, [points, cd, policy]);
  const pctAxis = refs != null && mode === 'own';
  const refAxis = pctAxis ? PCT_AXIS : TOP_AXIS;

  const markIdx = useMemo(
    () =>
      (marks ?? [])
        .map((m) => ({ ...m, i: points.findIndex((p) => p.t >= m.date) }))
        .filter((m) => m.i >= 0),
    [marks, points],
  );

  const onMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setHoverX(readoutLeft(e.clientX - r.left, r.width));
  }, []);
  const leave = useCallback(() => setHover(undefined), []);

  const hp =
    hover && hover.i >= 0 && hover.i < points.length
      ? {
          t: points[hover.i].t,
          v: points[hover.i].v,
          // 그 날짜 이전 가장 최근 발행점 — 카드의 누적·당일이 읽는 것
          pt: [...result.points].reverse().find((p) => p.t <= points[hover.i].t) ?? null,
        }
      : null;

  if (points.length < 2) return null;
  const up = result.pnl >= 0;

  return (
    <VStack gap={0} width="100%" onMouseMove={onMove} onMouseLeave={leave}>
      {/* ── 종목 차트 ─────────────────────────────────────────────────────── */}
      <Box className="sr-plot" width="100%">
        <CartesianChart
          animate={false}
          height={200}
          accessibilityLabel="종목 추이 (진입부터 청산까지)"
          inset={INSET}
          enableScrubbing
          onScrubberPositionChange={(i: number | undefined) =>
            setHover(i == null ? undefined : { i, src: 'top' })
          }
          series={[
            {
              id: 'level',
              data: points.map((p) => p.v),
              ...(seriesColor ? { color: seriesColor } : {}),
              yAxisId: TOP_AXIS,
            },
            /* 기준선 둘 — 같은 위계의 두 색(미리보기 pane 의 판정 그대로,
               `direction.css` 토큰). 색을 시리즈에 두는 이유도 같다: 선과
               스크러버 구슬이 한 곳에서 갈린다. */
            ...(refs?.cd
              ? [{ id: CD_LINE, data: refs.cd, color: 'var(--sr-ref-cd)', yAxisId: refAxis }]
              : []),
            ...(refs?.policy
              ? [{ id: BASE_LINE, data: refs.policy, color: 'var(--sr-ref-policy)', yAxisId: refAxis }]
              : []),
          ]}
          xAxis={{ data: dates }}
          yAxis={pctAxis ? [{ id: TOP_AXIS }, { id: PCT_AXIS }] : [{ id: TOP_AXIS }]}
        >
          <XAxis showGrid={false} />
          <YAxis
            axisId={TOP_AXIS}
            position="right"
            showGrid={false}
            tickLabelFormatter={(v) => fmtLevel(v, unit)}
          />
          {/* bp-종목일 때만 서는 왼쪽 %축 — 기준선의 축. 빈 축은 선언하지
              않는다(눈금만 그리고 폭을 먹는다). */}
          {pctAxis ? (
            <YAxis
              axisId={PCT_AXIS}
              position="left"
              showGrid={false}
              tickLabelFormatter={(v) => fmtLevel(v, '%')}
            />
          ) : null}
          <Line seriesId="level" curve="linear" connectNulls={false} />
          {/* 기준선은 종목 선보다 얇게, 색 하나로만 구분(같은 지각적 무게).
              기준금리는 stepAfter — 정책금리는 평평하다가 뛴다. 끊긴 구간은
              모르는 구간이라 connectNulls 를 끈다. */}
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
          {markIdx.map((m) => (
            <ReferenceLine key={`${m.label}-${m.i}`} dataX={m.i} label={m.label} />
          ))}
          {hover?.src === 'bottom' ? <ReferenceLine dataX={hover.i} /> : null}
          <Scrubber
            accessibilityLabel="종목 추이 짚기"
            seriesIds={[
              'level',
              ...(refs?.cd ? [CD_LINE] : []),
              ...(refs?.policy ? [BASE_LINE] : []),
            ]}
          />
        </CartesianChart>
      </Box>

      {/* 기준선 범례 — 실제로 그려진 것만 이름을 얻는다(미리보기와 같은 규칙:
          범례가 없다 = 기준선이 없다). */}
      {refs ? (
        <HStack gap={2} paddingX={2} flexWrap="wrap">
          {refs.cd ? <RefKey label="CD 91일" opacity={0.9} color="var(--sr-ref-cd)" /> : null}
          {refs.policy ? (
            <RefKey label="기준금리" opacity={0.9} color="var(--sr-ref-policy)" />
          ) : null}
        </HStack>
      ) : null}

      {/* ── 누적 손익 — 같은 날짜 배열, 같은 inset = 픽셀 정렬 ─────────────── */}
      <Box className="sr-plot" width="100%">
        <CartesianChart
          animate={false}
          height={140}
          accessibilityLabel="누적 손익 (위 차트와 같은 구간)"
          inset={INSET}
          enableScrubbing
          onScrubberPositionChange={(i: number | undefined) =>
            setHover(i == null ? undefined : { i, src: 'bottom' })
          }
          series={[
            {
              id: 'pnl',
              data: pnlVals,
              color: up ? 'var(--sr-up)' : 'var(--sr-down)',
              yAxisId: BOT_AXIS,
            },
          ]}
          xAxis={{ data: dates }}
          yAxis={[{ id: BOT_AXIS }]}
        >
          {/* x 라벨은 위 차트가 진다 — 두 벌이면 같은 날짜가 두 줄로 선다. */}
          <YAxis
            axisId={BOT_AXIS}
            position="right"
            showGrid={false}
            tickLabelFormatter={(v) => fmtKrw(v)}
          />
          {/* 0선 — 승패의 경계는 항상 프레임 안이다. CDS 는 시리즈 범위로
              도메인을 잡으므로, 0 을 스치게 하는 안 그려지는 시리즈까지는
              필요 없다: ReferenceLine 은 도메인 밖이면 안 보일 뿐 무해하다. */}
          <ReferenceLine dataY={0} yAxisId={BOT_AXIS} />
          <Line seriesId="pnl" curve="linear" showArea connectNulls={false} />
          {hover?.src === 'top' ? <ReferenceLine dataX={hover.i} /> : null}
          <Scrubber accessibilityLabel="누적 손익 짚기" seriesIds={['pnl']} />
        </CartesianChart>
        {/* 돈 카드 — 날짜 · 레벨 · 누적 · 당일. `당일` 은 늘 1영업일이다(서버가
            발행점마다 전영업일을 따로 평가한다) — 점이 며칠씩 떨어져 그려져도. */}
        {hp ? (
          <VStack className="sr-readout" style={{ left: hoverX }} aria-hidden="true">
            <TextLabel2 as="span" noWrap>
              {hp.t}
            </TextLabel2>
            <Box className="sr-readout-rows">
              <HStack justifyContent="space-between" gap={1}>
                <TextCaption as="span" color="fgMuted" noWrap>
                  레벨
                </TextCaption>
                <TextLabel2 as="span" tabularNumbers noWrap>
                  {fmtLevel(hp.v, unit)}
                  {unitSuffix(unit)}
                </TextLabel2>
              </HStack>
              {/* CD 91일 — 그려진 선이 있을 때만(미리보기 카드와 같은 규칙:
                  없는 선의 값을 카드가 읽는 일은 없다). */}
              {refs?.cd && hover && refs.cd[hover.i] != null ? (
                <HStack justifyContent="space-between" gap={1}>
                  <TextCaption as="span" color="fgMuted" noWrap>
                    CD 91일
                  </TextCaption>
                  <TextLabel2 as="span" tabularNumbers noWrap>
                    {fmtLevel(refs.cd[hover.i] as number, '%')}
                    {unitSuffix('%')}
                  </TextLabel2>
                </HStack>
              ) : null}
              <MoneyRow k="누적" v={hp.pt?.pnl ?? null} />
              <MoneyRow k="당일" v={hp.pt?.d ?? null} />
            </Box>
          </VStack>
        ) : null}
      </Box>
    </VStack>
  );
}
