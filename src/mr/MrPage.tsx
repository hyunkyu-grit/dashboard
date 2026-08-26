'use client';

/* Mean Reversion — BSS 전 테너 밴드 위치 랭킹 (Strategy 둘째 세입자, 2026-08-25).
 *
 * **측정이지 신호가 아니다.** 사전등록 검증(Desktop\bollinger-mr, 누적 108구성)이
 * 「볼린저 재진입」 신호 문법을 NO-GO 로 닫았고(REPORT.md), 이 화면은 그 결론
 * 위에 선다: 본드스왑 스프레드(국고 − IRS) 전 테너가 평소 밴드(SMA ± σ배수,
 * 룩백·폭은 근거 있는 선택지 — MR_WINDOWS·MR_KS) 대비 어디에 있는지를 재서
 * 늘어난 순서로 세울 뿐이다. 진입·청산·추천 문구는 없다 — Credit RV 의
 * 「랭킹이지 투자판단이 아니다」와 같은 명구 의무.
 *
 * **유니버스는 BSS 뿐이다** [OWNER 2026-08-25 — "일단 본드스왑만"]. 첫 판의
 * 비교군 12계열(선물·IRS)은 범위 오독이라 내려갔다 — 근거는 backend/app/mr.py.
 *
 * 숫자는 전부 서버가 끝낸다(§16, `/api/mr/board`) — 밴드·z·%B·상태 판정·정렬·
 * 순위까지. 이 파일은 조건 바와 카드 배치뿐이다.
 *
 * ── 배치: 조건 바 + [랭킹 표 | 상세] 2열, 페이지는 스크롤하지 않는다 ─────────
 * Main/Backtest 의 공간문법 그대로: 내용은 카드 안, 주인공(랭킹)이 남는 높이를
 * 받고, 세부(값+밴드 이력 차트)는 행 클릭 뒤 오른쪽 카드가 진다. 표 문법은
 * rv 의 것을 그대로 쓴다(.sr-rv-table 계열·순위 열 포함) — Strategy 두 세입자가
 * 같은 표를 두 문법으로 말하지 않는다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { Tooltip } from '@coinbase/cds-web/overlays';
import { Table, TableBody, TableCell, TableHeader, TableRow } from '@coinbase/cds-web/tables';
import { Text } from '@coinbase/cds-web/typography';

import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtDelta, fmtLevel, levelHeadText, levelHeadTitle, unitSuffix } from '@/lib/format';
import { ROW_H } from '@/table/rowHeight';
import { directionClass, directionGlyph, tintStyle, unsignedDelta } from '@/table/tint';
import { ErrorState, LoadingState } from '@/ui/DataState';
import { Stat, StatColumn } from '@/ui/Stat';
import { useUrlState } from '@/ui/useUrlState';

import {
  MR_KS,
  MR_WINDOWS,
  fetchMrBoard,
  fetchMrHistory,
  type MrBoard,
  type MrHistory,
  type MrParams,
  type MrRow,
  type MrState,
} from './api';
import { BandChart } from './BandChart';
import { StrategyWindow } from './StrategyWindow';

/** 조건 바 한 칸 — rv 의 Cond 와 같은 문법(새 코드라 shorthand 대신 Text). */
function Cond({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <HStack gap={0.5} alignItems="baseline">
      <Text font="caption" as="span" color="fgMuted" noWrap>
        {k}
      </Text>
      {/* 강조는 굵기+밑줄 — 색이 아니다(rv 의 as-of 대비·겸직 측정 그대로). */}
      <Text
        font="legal"
        as="span"
        tabularNumbers
        noWrap
        className={strong ? 'sr-rv-asof-split' : undefined}
      >
        {v}
      </Text>
    </HStack>
  );
}

/** 열 머리 뜻풀이 — rv 의 ThHelp 와 같은 기계(CDS Tooltip, hover+포커스). */
function ThHelp({ label, help }: { label: string; help: string }) {
  return (
    <Tooltip
      content={
        /* 폭은 아래 `maxWidth` prop 이 진다 — 근거는 rv `ThHelp` 의 주석. */
        <Text font="legal" as="span">
          {help}
        </Text>
      }
      maxWidth={280}
      placement="bottom"
    >
      <span className="sr-rv-thhelp" tabIndex={0}>
        {label}
      </span>
    </Tooltip>
  );
}

/** 상태 문장 — 판정이지 행동이 아니다. */
function stateText(s: MrState): string {
  if (s.kind === 'below') return `하단 밖 ${s.days}일째`;
  if (s.kind === 'above') return `상단 밖 ${s.days}일째`;
  if (s.kind === 'reentry-low') return `하단 재진입 ${s.days}일째`;
  if (s.kind === 'reentry-high') return `상단 재진입 ${s.days}일째`;
  return '밴드 안';
}

const MINUS = '−';

/** z 표기 — 부호 명시, 반올림 후 0 은 부호 없이(rv fmt 의 규칙 그대로). */
function fmtZ(z: number | null): string {
  if (z == null) return '—';
  const s = Math.abs(z).toFixed(2);
  if (Number(s) === 0) return '0.00σ';
  return z > 0 ? `+${s}σ` : `${MINUS}${s}σ`;
}

/** 히어로의 전일 변화 — Main 미리보기 히어로의 그 문법: 방향 글리프 + 부호
 * 있는 변화 + 방향색 글자(PreviewPane 의 `↗ +4.3bp`). */
function HeroDelta({ d, unit }: { d: number; unit: string }) {
  return (
    <span className={directionClass(d)}>
      {directionGlyph(d) || '→'} {fmtDelta(d, unit as Unit)}
      {unitSuffix(unit as Unit)}
    </span>
  );
}

/** 밴드 위치 트랙 — Main 52주 「위치」 열의 그 부품(sr-track). 숫자(%B)는
 * title 로 물러나고 그림이 말한다: 하단↔상단 트랙 위의 지금 자리. 밖이면
 * 끝에 붙는다(클램프) — 상태 열이 «밖 n일째» 로 그 사실을 말한다. */
function BandTrack({ pctB }: { pctB: number | null }) {
  if (pctB == null) {
    return (
      <Text font="label2" as="span" color="fgMuted" noWrap>
        —
      </Text>
    );
  }
  const pos = Math.max(0, Math.min(100, pctB));
  return (
    /* sr-track 은 폭 없는 블록이라(Main 에선 sr-range 격자가 폭을 줌) 여기선
       고정폭 상자가 트랙 길이를 진다 — 없으면 2px 짜리 점으로 접힌다(실측). */
    <Box as="span" width={72} display="block">
      <span className="sr-track" title={`밴드 하단↔상단의 ${Math.round(pctB)}% 지점 (%B)`}>
        <span className="sr-track-mark" style={{ left: `${pos}%` }} />
      </span>
    </Box>
  );
}

export function MrPage() {
  const [board, setBoard] = useState<MrBoard>();
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selId, setSelId] = useState<string>();
  const [histories, setHistories] = useState<Record<string, MrHistory>>({});
  const [histErr, setHistErr] = useState<string>();
  /* 전략 실험 창 [OWNER 2026-08-25] — 세부는 클릭 뒤 창이 진다(백테스트 문법). */
  const [stratOpen, setStratOpen] = useState(false);

  /* 룩백·밴드 폭 — URL 상태(rv 의 이력 창과 같은 문법: 기본값은 주소에 안
     적는다). 모르는 값은 기본으로 떨어진다(딥링크 게이트). 선택지 근거는
     서버(mr.py) 주석과 열 머리 툴팁이 진다. */
  const [mwParam, setMwParam] = useUrlState('mw');
  const [mkParam, setMkParam] = useUrlState('mk');
  const bandWindow = (MR_WINDOWS as readonly number[]).includes(Number(mwParam))
    ? Number(mwParam)
    : MR_WINDOWS[0];
  const bandK = (MR_KS as readonly number[]).includes(Number(mkParam))
    ? Number(mkParam)
    : 2.0;
  const params = useMemo<MrParams>(
    () => ({ window: bandWindow, k: bandK }),
    [bandWindow, bandK],
  );

  /* 딥링크 경합 가드 — 마운트 직후 URL 훅이 아직 기본값일 때의 fetch 와 실제
     파라미터의 fetch 가 경주한다(라이브 실측 2026-08-25: mw=252 링크가 20일
     보드를 그렸다). 늦게 온 옛 응답이 이기지 못하게 순번으로 버린다. */
  const loadSeq = useRef(0);
  const load = useCallback(() => {
    const my = ++loadSeq.current;
    setError(undefined);
    setUnavailable(false);
    setRefreshing(true);
    fetchMrBoard(params)
      .then((b) => {
        if (loadSeq.current === my) setBoard(b);
      })
      .catch((e: unknown) => {
        if (loadSeq.current !== my) return;
        if (e instanceof BacktestUnavailable) setUnavailable(true);
        else setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (loadSeq.current === my) setRefreshing(false);
      });
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  /* 파라미터가 바뀌면 밴드도 바뀐다 — 옛 창의 이력 캐시는 통째로 무효다. */
  useEffect(() => {
    setHistories({});
    setHistErr(undefined);
  }, [params]);

  /* 레벨 열 머리가 이름할 날짜. 두 소스가 갈리면 하루를 못 고르므로 null 로
     보내 `levelHeadText` 의 폴백(「현재」)에 맡긴다 — 조건 바가 소스별 날짜를
     이미 말하고 있다. */
  const headAsof =
    board && board.asof.bss === board.asof.fut ? board.asof.bss : null;
  const rows = board?.rows ?? [];
  const sel: MrRow | undefined = rows.find((r) => r.id === selId) ?? rows[0];
  const selHist = sel ? histories[sel.id] : undefined;

  useEffect(() => {
    const id = sel?.id;
    if (!id || histories[id]) return;
    let dead = false;
    setHistErr(undefined);
    fetchMrHistory(id, params)
      .then((h) => {
        if (!dead) setHistories((prev) => ({ ...prev, [id]: h }));
      })
      .catch((e: unknown) => {
        if (!dead) setHistErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      dead = true;
    };
  }, [sel?.id, histories, params]);

  if (unavailable) {
    return (
      <ErrorState
        what="Mean Reversion"
        detail="실행 중인 백엔드(:8200)가 필요해요 — BSS·선물이 SQL 에만 있어서 미리 구워둘 수가 없어요."
        onRetry={load}
        retrying={refreshing}
      />
    );
  }
  if (error) {
    return <ErrorState what="Mean Reversion" detail={error} onRetry={load} retrying={refreshing} />;
  }
  if (!board || !sel) {
    return <LoadingState what="Mean Reversion" />;
  }

  return (
    <VStack gap={1.5} width="100%" flexGrow={1} minHeight={0}>
      {/* ── 조건 바 — 어떤 밴드에서 나온 숫자인지가 카드보다 먼저 읽힌다 ──── */}
      <VStack className="sr-rv-bar" flexShrink={0} gap={0.5} width="100%">
        <HStack gap={2} alignItems="center" flexWrap="wrap">
          {/* 순서는 언제 → 무엇으로(rv 의 판단). 소스가 둘이라 as-of 도 둘이고,
              갈라진 날은 굵기+밑줄이 그 사실을 말한다(rv B-2). 계열 정의는
              행의 서브라인이 진다 — 혼합 유니버스에서 바 한 칸으로는 거짓말이
              된다. */}
          <Cond
            k="민평·IRS"
            v={board.asof.bss ?? '—'}
            strong={board.asof.bss !== board.asof.fut}
          />
          <Cond
            k="선물"
            v={board.asof.fut ?? '—'}
            strong={board.asof.bss !== board.asof.fut}
          />
          {/* 룩백·밴드 폭 선택지 [OWNER 2026-08-25 — "보통 사용하는 값들을
              선택지로"]. 알약은 rv 설정의 그 컨트롤, 근거는 라벨 툴팁이 진다. */}
          <HStack gap={0.5} alignItems="center">
            <ThHelp
              label="룩백"
              help="20일은 볼린저 밴드의 관례 기본값이에요. 60·120·252일은 채권 RV 리서치가 흔히 쓰는 분기·반기·1년 창이에요."
            />
            {MR_WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                className="sr-pillbtn"
                data-on={bandWindow === w || undefined}
                aria-pressed={bandWindow === w}
                onClick={() => setMwParam(w === MR_WINDOWS[0] ? undefined : String(w))}
              >
                {w}일
              </button>
            ))}
          </HStack>
          <HStack gap={0.5} alignItems="center">
            <ThHelp
              label="밴드 폭"
              help="2σ가 볼린저 기본이에요. 1.5σ는 벗어남을 민감하게, 2.5σ는 보수적으로 잡는 문헌의 통상 변형이에요."
            />
            {MR_KS.map((kk) => (
              <button
                key={kk}
                type="button"
                className="sr-pillbtn"
                data-on={bandK === kk || undefined}
                aria-pressed={bandK === kk}
                onClick={() => setMkParam(kk === 2.0 ? undefined : String(kk))}
              >
                {`${kk}σ`}
              </button>
            ))}
          </HStack>
          <Cond k="재진입 표기" v={`${board.params.recentN}영업일`} />
          {refreshing ? (
            <Text font="legal" as="span" color="fgMuted" noWrap>
              갱신 중…
            </Text>
          ) : null}
          <Box style={{ marginLeft: 'auto' }}>
            {/* 명구 의무 — Credit RV 와 같은 문법. */}
            <Text font="legal" as="span" color="fgMuted" noWrap>
              늘어남을 재는 화면이에요 — 투자판단이 아니에요.
            </Text>
          </Box>
        </HStack>
        {board.asof.bss !== board.asof.fut ? (
          <Text font="legal" as="span" color="fgMuted">
            두 소스의 종가 날짜가 달라요 — 각 행은 자기 소스의 날짜 기준이에요.
          </Text>
        ) : null}
        {board.excluded.length > 0 ? (
          /* 못 읽은 테너 — 조용히 빼지 않는다(rv 의 exclusions 문법). */
          <Text font="legal" as="span" color="fgMuted">
            {board.excluded.map((x) => `${x.label}: ${x.reason}`).join(' · ')}
          </Text>
        ) : null}
      </VStack>

      {/* ── 2열: 보드가 주인공, 상세가 나머지를 받는다 ───────────────────── */}
      <HStack gap={2} alignItems="stretch" width="100%" flexGrow={1} minHeight={0}>
        <VStack
          className="sr-card"
          flexBasis={820}
          flexGrow={0}
          flexShrink={1}
          maxWidth={820}
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
            <Text font="label1" as="h2" noWrap>
              밴드 위치 랭킹
            </Text>
          </HStack>
          {/* 표는 Main/Backtest 의 그 방언이다 [OWNER 2026-08-25 — "값, 전일,
              늘어남 이런것도 전부 기준을 Backtest 에 맞춰서"]: CDS Table ·
              60px 행 · 이름은 label1 + legal 2줄 스택 · 숫자는 label2 tabular
              우측 · **전일은 틴트 셀**(배경 = 방향 워시, 글자 = 방향색, 부호는
              ↗↘ 글리프가 지고 숫자는 무부호 — `table/tint.ts` 그대로) ·
              위치는 트랙(코인베이스 52주 «위치» 의 그 부품). 첫 판의 rv 방언
              (.sr-rv-table)은 Strategy 이웃이지 Main 형제가 아니었다. */}
          <VStack gap={0} width="100%" minHeight={0} flexGrow={1}>
            <div className="sr-rv-rank-fill">
              <div className="sr-rv-rank-scroll">
                <Table bordered={false}>
                  {/* 머리는 스크롤을 따라온다 — Main 의 `<TableHeader sticky>`
                      그대로. 13행이 스크롤하는 표에서 「어느 열이 늘어남이었지」를
                      기억으로 들게 하지 않는다 [감사 2026-08-25]. */}
                  <TableHeader sticky>
                    <TableRow>
                      <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                        <Text font="caption" as="span" color="fgMuted">순위</Text>
                      </TableCell>
                      <TableCell as="th" scope="col">
                        <Text font="caption" as="span" color="fgMuted">계열</Text>
                      </TableCell>
                      {/* 레벨 열 머리는 **날짜**다(levelHeadText) — Main·Backtest·
                          매트릭스가 다 그렇다. 「값」 같은 낱말은 그 열이 어느 날
                          종가인지를 안 말한다. 두 소스 as-of 가 갈린 날은 이
                          함수의 문서화된 폴백(「현재」)으로 떨어지고, 조건 바가
                          어느 소스가 언제인지 말한다. */}
                      <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                        <Text font="caption" as="span" color="fgMuted" title={levelHeadTitle(headAsof)}>
                          {levelHeadText(headAsof)}
                        </Text>
                      </TableCell>
                      {/* 변화 열 이름도 형제 것이다 — BASIS_LABEL 의 `1D`. */}
                      <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                        <Text font="caption" as="span" color="fgMuted">1D</Text>
                      </TableCell>
                      <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                        {/* 창을 상수로 적으면 컨트롤을 바꾼 날 화면이 거짓말을
                            한다(rv 「버퍼 3개월」 실측의 같은 자리). */}
                        <ThHelp
                          label="늘어남"
                          help={`지금 값이 ${bandWindow}일 평균에서 σ 몇 개만큼 떨어져 있는지예요. 이 표의 정렬 축이에요.`}
                        />
                      </TableCell>
                      <TableCell as="th" scope="col" className="sr-num" justifyContent="flex-end">
                        <ThHelp
                          label="위치"
                          help="밴드 하단↔상단 트랙 위의 지금 자리예요. 밖이면 끝에 붙고, 상태 열이 며칠째인지 말해요."
                        />
                      </TableCell>
                      <TableCell as="th" scope="col">
                        <ThHelp
                          label="상태"
                          help="밴드 밖이면 며칠째인지, 안으로 돌아왔으면 며칠째인지예요."
                        />
                      </TableCell>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow
                        key={r.id}
                        tabIndex={0}
                        /* Main 의 선택 문법 그대로 — aria-current 가 곧 핀 채움
                           (`tr[aria-current='true']` 의 --sr-control). */
                        aria-current={r.id === sel.id ? 'true' : undefined}
                        style={{ height: ROW_H, cursor: 'pointer' }}
                        onClick={() => setSelId(r.id)}
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setSelId(r.id);
                          }
                        }}
                      >
                        <TableCell className="sr-num" justifyContent="flex-end">
                          <Text font="label2" as="span" tabularNumbers noWrap>
                            {r.rank}
                          </Text>
                        </TableCell>
                        <TableCell>
                          {/* 이름 + 정의 — Main 의 2줄 스택(label1/legal) 그대로.
                              국고−IRS 와 선물내재가 한 표에 섞이므로 숫자 옆의
                              «무엇인지» 는 서브라인이 진다. */}
                          <VStack as="span" className="sr-name-stack">
                            <Text font="label1" as="span" noWrap>
                              {r.label}
                            </Text>
                            <Text font="legal" as="span" color="fgMuted" noWrap>
                              {r.defn}
                            </Text>
                          </VStack>
                        </TableCell>
                        <TableCell className="sr-num" justifyContent="flex-end">
                          <Text font="label2" as="span" tabularNumbers noWrap>
                            {fmtLevel(r.v, r.unit as Unit)}
                          </Text>
                        </TableCell>
                        {/* 전일 = Main 변화 셀: 틴트 워시 + 방향색 글자 + 글리프,
                            숫자는 무부호(tabular 정렬 — 부호 폭이 흔든다). */}
                        <TableCell
                          className="sr-num"
                          justifyContent="flex-end"
                          style={tintStyle(r.d1)}
                        >
                          <Text
                            font="label2"
                            as="span"
                            tabularNumbers
                            noWrap
                            className={directionClass(r.d1)}
                          >
                            {directionGlyph(r.d1)}
                            {directionGlyph(r.d1) ? ' ' : ''}
                            {unsignedDelta(fmtDelta(r.d1, r.dUnit as Unit))}
                          </Text>
                        </TableCell>
                        <TableCell className="sr-num" justifyContent="flex-end">
                          <Text font="label2" as="span" tabularNumbers noWrap>
                            {fmtZ(r.z)}
                          </Text>
                        </TableCell>
                        <TableCell className="sr-num" justifyContent="flex-end">
                          <BandTrack pctB={r.pctB} />
                        </TableCell>
                        <TableCell>
                          <Text font="label2" as="span" color="fgMuted" noWrap>
                            {stateText(r.state)}
                          </Text>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </VStack>
        </VStack>

        {/* ── 상세 — 선택 계열의 큰 숫자와 값+밴드 이력 ────────────────────── */}
        <VStack className="sr-card" flexGrow={1} flexShrink={1} minWidth={0} minHeight={0}>
          <HStack
            alignItems="baseline"
            justifyContent="space-between"
            gap={1}
            paddingX={2}
            paddingTop={1.5}
            paddingBottom={0.5}
          >
            <HStack gap={1} alignItems="baseline">
              <Text font="label1" as="h2" noWrap>
                {sel.label}
              </Text>
              <Text font="caption" as="span" color="fgMuted" noWrap>
                {sel.defn}
              </Text>
            </HStack>
            <HStack gap={1} alignItems="center">
              <Text font="caption" as="span" color="fgMuted" noWrap>
                {sel.asof}
              </Text>
              {/* rv 「상세 분석」 자리의 문법 — 세부(전략 재현)는 버튼 뒤 창. */}
              <button
                type="button"
                className="sr-pillbtn"
                data-on={stratOpen || undefined}
                aria-pressed={stratOpen}
                onClick={() => setStratOpen((v) => !v)}
              >
                전략 실험
              </button>
            </HStack>
          </HStack>
          <VStack gap={1.5} paddingX={2} paddingBottom={2} width="100%" flexGrow={1} minHeight={0}>
            {/* 큰 건 제목이 아니라 숫자다(공간문법). */}
            <HStack gap={2} alignItems="baseline" flexWrap="wrap">
              <Text font="display3" as="span" tabularNumbers>
                {fmtLevel(sel.v, sel.unit as Unit)}
                {unitSuffix(sel.unit as Unit)}
              </Text>
              <Text font="body" as="span" tabularNumbers>
                <HeroDelta d={sel.d1} unit={sel.dUnit} />
              </Text>
            </HStack>
            {selHist ? (
              <BandChart history={selHist} />
            ) : histErr ? (
              <Text font="legal" as="span" color="fgMuted">
                이력을 불러오지 못했어요 — {histErr}
              </Text>
            ) : (
              <Text font="legal" as="span" color="fgMuted">
                이력을 불러오는 중이에요…
              </Text>
            )}
            {/* 사실 줄은 **차트 아래**, 그리고 이 앱의 유일한 스트립 문법이다
                (`ui/Stat.tsx` — 그 파일 머리가 코인베이스 가격 페이지·토스증권
                종목 머리 실측을 적어 두었다). Main 미리보기의 「이 구간 · 변화 ·
                52주」와 같은 자리·같은 부품. 방향색은 안 쓴다 — z 는 방향이
                아니라 자리다. */}
            <HStack className="sr-stats" alignItems="stretch" width="100%">
              <StatColumn title="밴드">
                <Stat label="늘어남" value={fmtZ(sel.z)} />
                <Stat label="%B" value={sel.pctB == null ? '—' : sel.pctB.toFixed(0)} />
                <Stat
                  label="전폭"
                  value={
                    sel.width == null
                      ? '—'
                      : `${fmtLevel(sel.width, sel.dUnit as Unit)}${unitSuffix(sel.dUnit as Unit)}`
                  }
                />
              </StatColumn>
              <StatColumn title="지금">
                <Stat label="상태" value={stateText(sel.state)} />
                <Stat label="종가" value={sel.asof} />
              </StatColumn>
            </HStack>
          </VStack>
        </VStack>
      </HStack>

      {stratOpen ? (
        <StrategyWindow id={sel.id} label={sel.label} onClose={() => setStratOpen(false)} />
      ) : null}
    </VStack>
  );
}
