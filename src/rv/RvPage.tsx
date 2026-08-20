'use client';

/* Strategy = RV Analysis — 세 구성 [OWNER].
 *
 *   A. 동일섹터 레인   만기 × Δy 격자 + 스왑점 목록 (결정 숫자)
 *   B. 동일테너 레인   섹터 × 만기 히트맵, 칸 = 스프레드 랭크 백분위
 *   C. 크레딧 RV       4구역 [트레이더 피드백 2026-08-18]: 랭킹 표 → Score
 *                      히트맵 → 사분면(상대 RV × Coverage) → 클릭 상세 2차트
 *
 * 숫자는 전부 서버가 끝낸다(§16, `/api/rv/analysis`) — 이 파일은 조건 바와
 * 카드의 배치, 그리고 틴트뿐이다. C 의 Score 는 **랭킹이지 투자판단이 아니다**
 * (명구 의무 — RankingTable·ScoreHeat) — 별점·메달·추천 문구는 없다.
 *
 * 조건 바는 **고정·불투명**이다 — 어떤 조건에서 나온 숫자인지(후보 수·H·조달·
 * 금통위·이력 창·가중·제외·소스별 as-of)가 카드보다 먼저 읽혀야 한다. 소스별
 * as-of 는 장식이 아니라 차단 사항(rv1 B-2): IRS 와 민평이 1영업일 갈라진 것이
 * 실측이고, 갈라진 날은 그렇다고 말해야 한다. H 는 **두 값이다** — 레인 A 6M
 * [OWNER 확정] / 크레딧 RV 3M [트레이더 출발값], 조건 바가 둘 다 말한다.
 * BEP 는 크레딧 스프레드 축이라 금리(듀레이션) 효과는 이 화면 밖이다 —
 * 각주 의무(원칙 ②).
 *
 * ── 배치: 2열 두 줄 [OWNER 2026-08-19 — 크리틱 후 "2열로 접기" 확정] ────────
 * [A 동일섹터 | B 동일테너] / [C 랭킹 | Score 히트맵 + 사분면]. 네 카드 세로
 * 나열은 1568 에서도 오른쪽 절반이 여백이었고 오너 실기기(2560)에서는 2/3 가
 * 빈다 — §8.13 "화면은 창을 채운다"의 적용. 좁아지면 flexWrap 으로 한 열로
 * 접힌다. (한때 세로 스크롤 페이지였으나 8차 IA 재구성으로 100vh 기둥에
 * 복귀했다 — 지금은 스크롤이 없고, 조건 바의 sticky 는 무해한 잔재다.)
 *
 * as-of 갈라짐 강조는 **색이 아니라 굵기+밑줄**(.sr-rv-asof-split)이다 —
 * 처음엔 .sr-up(방향색)이었는데 ① 이 바의 배경(--sr-page) 위에서 4.1:1 로
 * 기준 미달(DESIGN §3.2 "부호 있는 숫자는 카드 위에만"의 그 측정)이고
 * ② 같은 화면에서 빨강이 "상승"과 "경고"를 겸직하게 된다(크리틱 P1).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Select } from '@coinbase/cds-web/alpha/select';
import { Collapsible as CdsCollapsible } from '@coinbase/cds-web/collapsible';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { TextInput } from '@coinbase/cds-web/controls';
import { Button } from '@coinbase/cds-web/buttons';
import {
  Text,
  TextBody,
  TextCaption,
  TextDisplay3,
  TextLabel1,
  TextLabel2,
  TextLegal,
} from '@coinbase/cds-web/typography';
import {
  CartesianChart,
  Line,
  ReferenceLine,
  Scrubber,
  XAxis,
  YAxis,
} from '@coinbase/cds-web/visualizations/chart';

import { BacktestUnavailable } from '@/lib/api';
import { useFunding } from '@/state/funding';
import { ErrorState, LoadingState } from '@/ui/DataState';
import { ReadoutCard, ReadoutLevel, placeReadout } from '@/ui/ReadoutCard';
import { DROPDOWN_STYLES } from '@/ui/window/popup';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { useUrlState } from '@/ui/useUrlState';

import {
  fetchRv,
  fetchRvHistory,
  type RvCreditItem,
  type RvHistoryPayload,
  type RvPayload,
  type RvWindow,
} from './api';
import { bp1, sig } from './fmt';
import { RankingTable } from './RankingTable';
import { RvScatter } from './RvScatter';
import { ScoreHeat } from './ScoreHeat';
import { SectorLane } from './SectorLane';
import { TenorHeat } from './TenorHeat';

/** 금통위 Δbp 입력 — blur/Enter 커밋(시뮬 NumField 의 규율: onChange 즉시
 * 파싱은 "-" 를 0 으로 만든다). */
function BpField({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const shown = String(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  if (!editing && text !== shown) setText(shown);
  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) onCommit(n);
    else setText(shown);
  };
  return (
    <Box width={76}>
      {/* fontSize legal(13) — 컨트롤 값 13px 규칙(popup.ts 의 근거).
          height 32 — 앱의 행 컨트롤 등고(`guards/control-parity.test.ts`).
          이 입력만 있는 줄에서는 지금 어긋난 것이 없지만, CDS `size="s"` 기본값
          38 을 남겨 두면 옆에 Select 나 알약이 서는 날 그 행만 6px 벌어진다. */}
      <TextInput
        size="s"
        fontSize="legal"
        height={32}
        accessibilityLabel="금통위 변동(bp)"
        suffix="bp"
        value={text}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </Box>
  );
}

function Cond({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <HStack gap={0.5} alignItems="baseline">
      <TextCaption as="span" color="fgMuted" noWrap>
        {k}
      </TextCaption>
      {/* 강조는 굵기+밑줄 — 색이 아니다(모듈 주석의 as-of 대비·겸직 측정). */}
      <TextLegal as="span" tabularNumbers noWrap className={strong ? 'sr-rv-asof-split' : undefined}>
        {v}
      </TextLegal>
    </HStack>
  );
}

/** ±σ 밴드를 두른 소형 차트 하나 — 창 평균과 평균±σ 가 `ReferenceLine`(dataY)
 * 으로 선다. 통계는 서버 것 그대로(§16) — 여기서 평균을 다시 내지 않는다.
 *
 * 커서 리드아웃은 Main·Backtest 의 그 카드다 [OWNER 2026-08-19] — CDS
 * `Scrubber` 가 인덱스를 주고(`onScrubberPositionChange`), 공용 `ReadoutCard`
 * 가 커서 옆에 뜬다(PreviewPane 의 배선 그대로). */
function BandChart({
  title,
  dates,
  values,
  stats,
}: {
  title: string;
  dates: string[];
  values: (number | null)[];
  stats: { now: number | null; mean: number | null; sd: number | null };
}) {
  const [idx, setIdx] = useState<number | null>(null);
  return (
    <VStack gap={0.25} width="100%">
      <TextLabel2 as="span">{title}</TextLabel2>
      <Box
        className="sr-plot"
        width="100%"
        /* 자리는 상자의 CSS 변수 — 상태가 아니다(`placeReadout` 머리글). */
        onMouseMove={(e: React.MouseEvent<HTMLDivElement>) => {
          placeReadout(e.currentTarget, e.clientX);
        }}
        onMouseLeave={() => setIdx(null)}
      >
        <CartesianChart
          enableScrubbing
          onScrubberPositionChange={(i) => setIdx(i ?? null)}
          animate={false}
          height={180}
          accessibilityLabel={title}
          inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
          series={[{ id: 'v', data: values, yAxisId: 'y' }]}
          xAxis={{ data: dates }}
          yAxis={[{ id: 'y' }]}
        >
          <XAxis showGrid={false} />
          <YAxis axisId="y" position="right" showGrid={false} />
          {/* ±σ 밴드 — 창 평균(가운데)과 평균±σ. 도메인 밖이면 안 보일 뿐
              무해하다(LinkedCharts 의 같은 판단). */}
          {stats.mean != null ? <ReferenceLine dataY={stats.mean} yAxisId="y" /> : null}
          {stats.mean != null && stats.sd != null ? (
            <ReferenceLine dataY={stats.mean + stats.sd} yAxisId="y" />
          ) : null}
          {stats.mean != null && stats.sd != null ? (
            <ReferenceLine dataY={stats.mean - stats.sd} yAxisId="y" />
          ) : null}
          <Line seriesId="v" curve="linear" connectNulls={false} />
          <Scrubber accessibilityLabel={`${title} 스크러버`} />
        </CartesianChart>
        {idx != null && values[idx] != null ? (
          <ReadoutCard title={dates[idx]}>
            <ReadoutLevel k="값" v={values[idx]} unit="bp" />
            <ReadoutLevel k="창 평균" v={stats.mean} unit="bp" />
            <ReadoutLevel k="σ" v={stats.sd} unit="bp" />
          </ReadoutCard>
        ) : null}
      </Box>
      <TextLegal as="span" color="fgMuted">
        지금 {stats.now != null ? stats.now.toFixed(1) : '—'}bp · 창 평균{' '}
        {stats.mean != null ? stats.mean.toFixed(1) : '—'}bp · σ{' '}
        {stats.sd != null ? stats.sd.toFixed(1) : '—'}bp예요.
      </TextLegal>
    </VStack>
  );
}

/** 이력 창의 머리 요약 한 칸 — Backtest 창의 Field 문법(라벨 뮤트 위,
 * 값 등폭 아래). 문장으로 잇던 숫자들을 칸으로 세운 것 [OWNER 2026-08-19 —
 * "이력창도 전반적으로 정돈"]: 값이 여섯이면 문장은 세 줄이 되고, 세 줄이 된
 * 문장에서 BEP 하나를 다시 찾게 된다. `Text`(토큰 직접)인 것은 CLAUDE.md 의
 * "새 코드에서 shorthand 추가 금지" 때문이고, caption/label2 토큰이라 기존
 * Field 와 픽셀이 같다. */
function Stat({ k, v }: { k: string; v: string }) {
  return (
    <VStack gap={0.25}>
      <Text as="span" font="caption" color="fgMuted" noWrap>
        {k}
      </Text>
      <Text as="span" font="label2" tabularNumbers noWrap>
        {v}
      </Text>
    </VStack>
  );
}

/** 클릭 상세 — `/api/rv/history` 의 두 소형 차트: 스프레드 이력과 섹터 상대
 * (같은 테너 횡단면 평균 대비) 이력, 각각 ±σ 밴드. */
function DrillWindow({
  point,
  window,
  onClose,
}: {
  point: RvCreditItem;
  window: RvWindow;
  onClose: () => void;
}) {
  const [data, setData] = useState<RvHistoryPayload>();
  const [err, setErr] = useState<string>();
  useEffect(() => {
    let live = true;
    setData(undefined);
    setErr(undefined);
    fetchRvHistory({ sector: point.sector, tenor: point.tenor, window })
      .then((j) => {
        if (live) setData(j);
      })
      .catch((e: unknown) => {
        if (live) setErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [point.sector, point.tenor, window]);

  return (
    <FloatingWindow
      windowKey="rv"
      title={`${point.sectorLabel} ${point.tenor} 이력`}
      aside={
        /* TextCaption 은 uppercase 라 "bp"가 "BP"로 선다 — 단위가 든 문장은
           TextLegal (§8.9, 이 리포가 이미 밟은 함정). */
        <TextLegal as="span" color="fgMuted" noWrap>
          국고 대비 · bp · {window === '52w' ? '52주' : '전체 이력'}
        </TextLegal>
      }
      onClose={onClose}
    >
      <VStack gap={1.5} padding={2} width="100%">
        {/* 머리 요약 — 창을 연 이유의 숫자들이 칸으로 먼저 선다(랭킹 표의
            열 순서 그대로: 지금 → 버퍼 → BEP → 상대 RV). 문장 두 줄에 흩어져
            있던 것의 재조판 [OWNER 2026-08-19 — "이력창 정돈"]. */}
        <HStack gap={3} flexWrap="wrap">
          <Stat k="지금" v={`${bp1(point.nowBp)}bp`} />
          <Stat
            k="버퍼"
            v={`${sig(point.bufferBp)}bp${
              point.coverage != null ? ` (${point.coverage.toFixed(1)}σ)` : ''
            }`}
          />
          <Stat k="BEP" v={`${bp1(point.bepSpreadBp)}bp`} />
          {point.relRv != null ? <Stat k="상대 RV" v={`${sig(point.relRv, 2)}σ`} /> : null}
          <Stat k="캐리 + 롤" v={`${sig(point.carryBp)} + ${sig(point.rollBp)}bp`} />
          {point.covPct != null ? (
            <Stat k="Coverage 백분위" v={`${point.covPct.toFixed(0)}%`} />
          ) : null}
        </HStack>
        {err ? (
          <TextBody as="p" color="fgMuted">
            이력을 읽지 못했어요 — {err}
          </TextBody>
        ) : !data ? (
          <TextCaption as="span" color="fgMuted">
            불러오는 중이에요…
          </TextCaption>
        ) : data.points.length < 2 ? (
          <TextCaption as="span" color="fgMuted">
            그릴 이력이 없어요.
          </TextCaption>
        ) : (
          <>
            <BandChart
              title="스프레드 — 국고 대비"
              dates={data.points.map((p) => p.t)}
              values={data.points.map((p) => p.s)}
              stats={data.spread}
            />
            <BandChart
              title="섹터 상대 — 같은 테너 횡단면 평균 대비"
              dates={data.points.map((p) => p.t)}
              values={data.points.map((p) => p.rel)}
              stats={data.rel}
            />
          </>
        )}
        {/* 상대 RV 의 성분 분해 — 포인터 툴팁에만 두면 키보드 사용자가 못 본다
            (크리틱 Alex/Sam). 상시 채널은 이 창이 진다. 합성값 자체는 위 머리
            요약이 이미 말했으므로 여기는 성분과 범례만 남는다. */}
        <TextLegal as="span" color="fgMuted">
          {point.relRv != null
            ? `상대 RV = 절대 z ${point.zAbs ?? '—'} · 섹터 z ${point.zSector ?? '—'} · 커브 z ${
                point.zCurve ?? '—'
              } (가중 40/40/20) — `
            : ''}
          차트의 가는 선은 창 평균과 ±1σ예요.
        </TextLegal>
      </VStack>
    </FloatingWindow>
  );
}

export function RvPage() {
  const [funding] = useFunding();
  /* 화면 상태는 URL — 섹터(rs)와 이력 창(rw). 얕은 히스토리(useUrlState 규칙). */
  const [sectorParam, setSectorParam] = useUrlState('rs');
  const [windowParam, setWindowParam] = useUrlState('rw');
  const window: RvWindow = windowParam === 'all' ? 'all' : '52w';

  /** 금통위 오버라이드 — 달력의 남은 회의를 서버가 미리 채워 준다(기본 0)
   * [OWNER]. 날짜별 bp, ±100bp 클램프(손이 미끄러진 2500bp 가 조용히 계산되는
   * 것을 막는다 — funding.spread_bp 의 같은 판단). */
  const [mpc, setMpc] = useState<Record<string, number>>({});
  const [mpcOpen, setMpcOpen] = useState(false);
  const mpcEncoded = useMemo(
    () =>
      Object.entries(mpc)
        .filter(([, bp]) => bp !== 0)
        .map(([d, bp]) => `${d}:${bp}`)
        .join(';'),
    [mpc],
  );

  const [data, setData] = useState<RvPayload>();
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [drill, setDrill] = useState<RvCreditItem | null>(null);
  /* 표 행 hover ↔ 사분면 점 강조 연동(Backtest 의 행↔미리보기 문법). */
  const [hovered, setHovered] = useState<RvCreditItem | null>(null);
  /* 커브 레인(동일섹터·동일테너·Score 히트맵) — 세부는 버튼 뒤 창으로
     [OWNER — "중요한 정보를 앞으로, 세부는 인터랙션 이후에"]. */
  const [lanesOpen, setLanesOpen] = useState(false);

  const load = useCallback(() => {
    setError(undefined);
    setUnavailable(false);
    setRefreshing(true);
    fetchRv({ window, basis: funding.basis, spreadBp: funding.spreadBp, mpc: mpcEncoded })
      .then(setData)
      .catch((e: unknown) => {
        if (e instanceof BacktestUnavailable) setUnavailable(true);
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setRefreshing(false));
  }, [window, funding.basis, funding.spreadBp, mpcEncoded]);

  useEffect(() => {
    load();
  }, [load]);

  const sector = useMemo(() => {
    if (!data) return undefined;
    return data.sectors.find((s) => s.id === sectorParam) ?? data.sectors[0];
  }, [data, sectorParam]);

  /* 오늘의 한 줄 — 서버 랭크 1위 [OWNER 2026-08-19 문구: "지금 XX가 가장
   * 매력적"]. 근거(Score·버퍼·순위변동)가 같은 줄에 붙고, 누르면 이력 창. */
  const top = useMemo(
    () => data?.credit.items.find((i) => i.rank === 1) ?? null,
    [data],
  );

  /* 실패·대기는 공용 상태 컴포넌트로 — 손 문장 셋이 리포의 ErrorState(재시도
   * 버튼)·LoadingState 와 딴 모양으로 서 있던 것의 정리(크리틱·CDS 점검). */
  if (unavailable) {
    return (
      <ErrorState
        what="RV 분석"
        detail="실행 중인 백엔드(:8200)가 필요해요 — 민평이 SQL 에만 있어서 미리 구워둘 수가 없어요."
        onRetry={load}
        retrying={refreshing}
      />
    );
  }
  if (error) {
    return <ErrorState what="RV 분석" detail={error} onRetry={load} retrying={refreshing} />;
  }
  if (!data || !sector) {
    return <LoadingState what="RV 분석" />;
  }

  const asofSplit = data.asof.irs != null && data.asof.irs !== data.asof.creditMatrix;

  return (
    /* 페이지는 **스크롤하지 않는다** — Backtest 와 같은 100vh 기둥 [OWNER
       2026-08-19 — "스크롤해야 하는 불편"]. 주인공(랭킹)이 남는 높이를 다 받고,
       세부는 클릭(이력 창)과 버튼(커브 레인 창) 뒤에 있다. */
    <VStack gap={1.5} width="100%" flexGrow={1} minHeight={0} className="sr-rv-root">
      {/* ── 조건 바 — 고정·불투명·**한 줄** ────────────────────────────────
          sticky 는 조건 요약(Cond 행)과 as-of 차단 문구까지다. 각주·제외·
          금통위는 바로 아래 **흐름**에 서서 위에서는 읽히고 스크롤하면 비켜난다
          — 2차 크리틱 실측: 각주까지 sticky 면 바가 107~250px 이 되어 행 20~74
          를 읽는 자세에서 랭킹 열 머리를 통째로 덮었다. */}
      <VStack className="sr-rv-bar" flexShrink={0} gap={0.5} width="100%">
        <HStack gap={2} alignItems="center" flexWrap="wrap">
          {/* 첫 화면은 필요한 정보만 [OWNER 2026-08-19] — 후보·H·조달·as-of
              다섯 사실만 상시이고, 조작(이력 창·금통위)과 세부(가중)는 우측 끝
              **설정** 하나로 접힌다.

              순서는 **언제 → 무엇으로** [OWNER 2026-08-19, 선택지 컨펌]: 소스별
              as-of 가 맨 앞이다. 다섯이 같은 무게로 서 있으면 읽는 사람이 매번
              날짜를 찾아 훑는데, 이 화면에서 가장 먼저 확인해야 하는 사실이
              그것이다(두 소스가 갈라진 날은 숫자의 뜻이 달라진다 — 아래 차단
              문구가 존재하는 이유). 계산 조건(H·조달)은 그 뒤로 물러난다.
              접거나 숨기지 않는다 — 다섯 다 상시라는 규칙은 그대로다. */}
          {/* 소스별 as-of — 갈라진 날은 강조까지 한다(rv1 B-2). */}
          <Cond k="민평" v={data.asof.creditMatrix} strong={asofSplit} />
          <Cond k="IRS" v={data.asof.irs ?? '—'} strong={asofSplit} />
          <Cond k="후보" v={`${data.candidates}개`} />
          {/* H 는 두 값이다 — 레인 A [OWNER 6M] / 크레딧 RV [트레이더 3M]. */}
          <Cond k="H" v={`같은 섹터끼리 ${data.hMonths}개월 · 크레딧 ${data.credit.hMonths}개월`} />
          <Cond k="조달" v={data.funding.label} />
          {window === 'all' ? <Cond k="이력 창" v="전체(2020~)" /> : null}
          {mpcEncoded ? <Cond k="금통위" v="조정 중" /> : null}
          {/* 창·금통위 재조회 동안 옛 숫자가 서 있다 — 그 사실을 바가 말한다. */}
          {refreshing ? (
            <TextLegal as="span" color="fgMuted" noWrap>
              갱신 중…
            </TextLegal>
          ) : null}
          <Box style={{ marginLeft: 'auto' }}>
            <button
              type="button"
              className="sr-rv-pillbtn"
              data-on={mpcOpen || undefined}
              aria-expanded={mpcOpen}
              onClick={() => setMpcOpen((v) => !v)}
            >
              설정
            </button>
          </Box>
        </HStack>
        {asofSplit ? (
          /* 차단 사항이라 이 문구만은 sticky 에 남는다 — 갈라진 날의 숫자를
             각주 없이 읽게 두면 안 된다(rv1 B-2). */
          <TextLegal as="span" color="fgMuted">
            두 소스의 종가 날짜가 달라요 — 스프레드·자산스왑 숫자는 민평 날짜
            기준이에요.
          </TextLegal>
        ) : null}
        {/* 설정 펼침 — 이력 창·금통위·가중이 여기 산다 [OWNER — "우측 맨 끝
            Setting 하나로"]. 몸통은 CDS Collapsible. */}
        <CdsCollapsible collapsed={!mpcOpen}>
          <VStack gap={1} paddingY={0.5}>
            <HStack gap={0.5} alignItems="center" flexWrap="wrap">
              <TextCaption as="span" color="fgMuted" noWrap>
                이력 창
              </TextCaption>
              <button
                type="button"
                className="sr-rv-pillbtn"
                data-on={window === '52w' || undefined}
                aria-pressed={window === '52w'}
                onClick={() => setWindowParam(undefined)}
              >
                52주
              </button>
              <button
                type="button"
                className="sr-rv-pillbtn"
                data-on={window === 'all' || undefined}
                aria-pressed={window === 'all'}
                onClick={() => setWindowParam('all')}
              >
                전체
              </button>
              {/* 상대 RV 가중 — 서버 노출값 그대로(출발값). */}
              <Cond
                k="가중"
                v={`절대 ${Math.round(data.credit.weights.abs * 100)} / 섹터 ${Math.round(
                  data.credit.weights.sector * 100,
                )} / 커브 ${Math.round(data.credit.weights.curve * 100)}`}
              />
            </HStack>
            <HStack gap={1.5} flexWrap="wrap" alignItems="flex-end">
              <TextCaption as="span" color="fgMuted" noWrap>
                금통위
              </TextCaption>
              {data.meetings.map((m) => (
                /* 캡션과 입력칸이 같은 폭(76)이어야 쌍으로 읽힌다. */
                <VStack key={m.date} gap={0.25} width={76}>
                  <TextCaption as="span" color="fgMuted" noWrap>
                    {m.date}
                  </TextCaption>
                  <BpField
                    value={mpc[m.date] ?? 0}
                    onCommit={(v) =>
                      setMpc((prev) => ({ ...prev, [m.date]: Math.max(-100, Math.min(100, v)) }))
                    }
                  />
                </VStack>
              ))}
              {/* 되돌리기 한 방 — 회의 셋을 하나씩 0 으로 치게 하지 않는다. */}
              {mpcEncoded ? (
                <Button size="s" variant="secondary" onClick={() => setMpc({})}>
                  전부 0으로
                </Button>
              ) : null}
            </HStack>
          </VStack>
        </CdsCollapsible>
      </VStack>

      {/* ── 히어로 — Main 의 그 문법이다(PreviewPane: "이름은 작게, **값은
          크게**"). 이 화면의 값은 숫자가 아니라 오늘의 1위 종목이라, 종목명이
          TextDisplay3 로 선다 [OWNER 2026-08-19 — "한 줄인데 눈에 안 띔"].
          메타(Score·버퍼·순위변동)는 히어로 옆 뮤트 — Main 히어로의 변화
          배지 자리다. */}
      {top ? (
        <VStack flexShrink={0} gap={0} width="100%">
          <TextLabel1 as="span" color="fgMuted" noWrap>
            지금 가장 매력적이에요
          </TextLabel1>
          <HStack gap={1.5} alignItems="baseline" flexWrap="wrap">
            <button
              type="button"
              className="sr-rv-linkbtn"
              aria-label={`${top.sectorLabel} ${top.tenor} 이력 단면 열기`}
              onClick={() => setDrill(top)}
            >
              <TextDisplay3 as="span" noWrap>
                {top.sectorLabel} {top.tenor}
              </TextDisplay3>
            </button>
            <TextBody as="span" color="fgMuted" tabularNumbers noWrap>
              Score {top.score?.toFixed(0)} · 버퍼 {sig(top.bufferBp)}bp
              {top.coverage != null ? ` (${top.coverage.toFixed(1)}σ)` : ''}
              {top.rankDelta != null
                ? top.rankDelta === 0
                  ? ' · 순위변동 없음'
                  : ` · ${top.rankDelta > 0 ? '▲' : '▼'}${Math.abs(top.rankDelta)}`
                : ''}
            </TextBody>
          </HStack>
        </VStack>
      ) : null}

      {/* ── 본 화면: [랭킹(주인공) | 사분면(미리보기)] — Backtest 의 표+미리보기
          문법 그대로 [OWNER — "위계를 살려 중요한 정보를 앞으로"]. 표 카드의
          basis 980 은 Backtest 표 카드의 그 규율(page.tsx 의 산술)이고,
          미리보기가 나머지를 받는다. 세부 셋(동일섹터·동일테너·Score 히트맵)은
          머리의 "커브 레인" 버튼이 여는 창 — Backtest 의 백테스트 버튼 자리다. */}
      <HStack gap={2} alignItems="stretch" width="100%" flexGrow={1} minHeight={0}>
        <VStack
          className="sr-card"
          flexBasis={980}
          flexGrow={0}
          flexShrink={1}
          maxWidth={980}
          minHeight={0}
        >
          <HStack
            alignItems="center"
            justifyContent="space-between"
            gap={1}
            paddingX={2}
            paddingTop={1.5}
            paddingBottom={0.5}
          >
            <TextLabel1 as="h2" noWrap>
              크레딧 RV — 랭킹
            </TextLabel1>
            {/* 카드 머리의 컨트롤은 Main pill 크기(32px)다 — CDS Button(s,
                36px)은 14px 제목 옆에서 위계를 눌렀다. */}
            {/* "커브 레인" → "상세 분석" [OWNER 2026-08-19 — 어휘 순화 컨펌]. */}
            <button
              type="button"
              className="sr-rv-pillbtn"
              data-fill="true"
              onClick={() => setLanesOpen(true)}
            >
              상세 분석
            </button>
          </HStack>
          <RankingTable
            items={data.credit.items}
            onSelect={setDrill}
            onHover={setHovered}
            highlightId={hovered?.seriesId ?? null}
            exclusions={data.credit.exclusions}
          />
        </VStack>

        {/* 미리보기 — 사분면이 표의 hover 를 따라온다(PreviewPane 문법). */}
        <VStack className="sr-card" flexGrow={1} flexShrink={1} minWidth={420} minHeight={0}>
          <VStack gap={0.25} paddingX={2} paddingTop={1.5} paddingBottom={0.5}>
            <TextLabel1 as="h2" noWrap>
              크레딧 RV — 사분면
            </TextLabel1>
            <TextLegal as="span" color="fgMuted" noWrap>
              민평 {data.asof.creditMatrix} · {window === '52w' ? '52주' : '전체 이력'} 창
            </TextLegal>
          </VStack>
          <RvScatter
            items={data.credit.items}
            onSelect={setDrill}
            highlightId={hovered?.seriesId ?? null}
            onHover={setHovered}
          />
        </VStack>
      </HStack>

      {/* ── 커브 레인 — 세부 셋을 담는 창(세부는 인터랙션 뒤). ───────────────── */}
      {lanesOpen ? (
        <FloatingWindow
          windowKey="rvlanes"
          title="상세 분석"
          width={1180}
          aside={
            <TextLegal as="span" color="fgMuted" noWrap>
              같은 섹터끼리 · 같은 만기끼리 · Score
            </TextLegal>
          }
          onClose={() => setLanesOpen(false)}
        >
          <VStack gap={1} width="100%" paddingY={1}>
            <HStack
              alignItems="center"
              justifyContent="space-between"
              gap={1}
              paddingX={2}
              paddingTop={0.5}
            >
              <TextLabel1 as="h3" noWrap>
                같은 섹터끼리 — 만기 × Δy 총수익
              </TextLabel1>
              <Box width={160}>
                {/* font legal(13) — 컨트롤 값 13px 규칙(popup.ts 의 근거). */}
                <Select
                  size="s"
                  font="legal"
                  styles={DROPDOWN_STYLES}
                  accessibilityLabel="섹터"
                  value={sector.id}
                  onChange={(v) => v && setSectorParam(v === data.sectors[0].id ? undefined : v)}
                  options={data.sectors.map((s) => ({ value: s.id, label: s.label }))}
                />
              </Box>
            </HStack>
            <SectorLane sector={sector} dys={data.dys} hMonths={data.hMonths} />

            <VStack paddingX={2} paddingTop={0.5}>
              <TextLabel1 as="h3" noWrap>
                같은 만기끼리 — 스프레드 백분위
              </TextLabel1>
            </VStack>
            <TenorHeat heat={data.heat} window={window} items={data.credit.items} onSelect={setDrill} />

            <VStack paddingX={2} paddingTop={0.5}>
              <TextLabel1 as="h3" noWrap>
                크레딧 RV — Score 히트맵
              </TextLabel1>
            </VStack>
            <ScoreHeat items={data.credit.items} onSelect={setDrill} />
          </VStack>
        </FloatingWindow>
      ) : null}

      {drill ? <DrillWindow point={drill} window={window} onClose={() => setDrill(null)} /> : null}
    </VStack>
  );
}
