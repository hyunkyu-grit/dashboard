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
import { Text } from '@coinbase/cds-web/typography';

import type { Unit } from '@/lib/api';
import { BacktestUnavailable } from '@/lib/api';
import { fmtDelta, fmtLevel, unitSuffix } from '@/lib/format';
import { ErrorState, LoadingState } from '@/ui/DataState';
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
        <Text font="legal" as="span" className="sr-rv-tiptext">
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

/** 전일 변화 한 칸 — 부호 있는 변화만 방향색을 가진다(ReadoutCard 의 규칙). */
function DeltaCell({ d, unit }: { d: number; unit: string }) {
  const cls = d > 0 ? 'sr-up' : d < 0 ? 'sr-down' : undefined;
  return (
    <span className={cls}>
      {fmtDelta(d, unit as Unit)}
      {unitSuffix(unit as Unit)}
    </span>
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
          {/* 순서는 언제 → 무엇으로(rv 의 판단). BSS 는 두 다리가 한 inner
              join 이라 as-of 도 하나다 — 첫 판의 소스별 갈림 표기는 은퇴했다. */}
          <Cond k="as-of" v={board.asof.bss ?? '—'} />
          <Cond k="정의" v="국고 − IRS" />
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
                className="sr-rv-pillbtn"
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
                className="sr-rv-pillbtn"
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
              BSS 전 테너 — 밴드 위치 랭킹
            </Text>
          </HStack>
          <VStack gap={0.75} width="100%" minHeight={0} flexGrow={1}>
            <div className="sr-rv-rank-fill">
              <div className="sr-rv-rank-scroll">
                <table className="sr-rv-table sr-rv-divided">
                  <thead>
                    <tr>
                      {/* 순위 열 — rv 랭킹 표와 같은 문법 [OWNER 2026-08-25]. */}
                      <th className="sr-rv-th">순위</th>
                      <th className="sr-rv-th sr-rv-left">테너</th>
                      <th className="sr-rv-th">값</th>
                      <th className="sr-rv-th">전일</th>
                      <th className="sr-rv-th">
                        {/* 창을 상수로 적으면 컨트롤을 바꾼 날 화면이 거짓말을
                            한다(rv 「버퍼 3개월」 실측의 같은 자리). */}
                        <ThHelp
                          label="늘어남"
                          help={`지금 값이 ${bandWindow}일 평균에서 σ 몇 개만큼 떨어져 있는지예요. 이 표의 정렬 축이에요.`}
                        />
                      </th>
                      <th className="sr-rv-th">
                        <ThHelp
                          label="%B"
                          help="밴드 안 위치예요. 0 이 하단, 100 이 상단이고 밖이면 범위를 벗어나요."
                        />
                      </th>
                      <th className="sr-rv-th sr-rv-left">
                        <ThHelp
                          label="상태"
                          help="밴드 밖이면 며칠째인지, 안으로 돌아왔으면 며칠째인지예요."
                        />
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr
                        key={r.id}
                        className="sr-rv-row"
                        data-on={r.id === sel.id || undefined}
                        onClick={() => setSelId(r.id)}
                      >
                        <td className="sr-rv-td">{r.rank}</td>
                        <td className="sr-rv-td sr-rv-left">
                          {/* 행 의미론은 표, 여는 것은 버튼(rv 의 a11y 규칙). */}
                          <button
                            type="button"
                            className="sr-rv-linkbtn"
                            aria-label={`${r.label} 이력 보기`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelId(r.id);
                            }}
                          >
                            <span className="sr-rv-name">{r.label}</span>
                          </button>
                        </td>
                        <td className="sr-rv-td">
                          {fmtLevel(r.v, r.unit as Unit)}
                          {unitSuffix(r.unit as Unit)}
                        </td>
                        <td className="sr-rv-td">
                          <DeltaCell d={r.d1} unit={r.dUnit} />
                        </td>
                        <td className="sr-rv-td">{fmtZ(r.z)}</td>
                        <td className="sr-rv-td">{r.pctB == null ? '—' : r.pctB.toFixed(0)}</td>
                        <td className="sr-rv-td sr-rv-left">{stateText(r.state)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                국고 − IRS
              </Text>
            </HStack>
            <Text font="caption" as="span" color="fgMuted" noWrap>
              {sel.asof}
            </Text>
          </HStack>
          <VStack gap={1.5} paddingX={2} paddingBottom={2} width="100%" flexGrow={1} minHeight={0}>
            {/* 큰 건 제목이 아니라 숫자다(공간문법). */}
            <HStack gap={2} alignItems="baseline" flexWrap="wrap">
              <Text font="display3" as="span" tabularNumbers>
                {fmtLevel(sel.v, sel.unit as Unit)}
                {unitSuffix(sel.unit as Unit)}
              </Text>
              <Text font="body" as="span" tabularNumbers>
                <DeltaCell d={sel.d1} unit={sel.dUnit} />
              </Text>
            </HStack>
            <HStack gap={3} alignItems="baseline" flexWrap="wrap">
              <Cond k="늘어남" v={fmtZ(sel.z)} />
              <Cond k="%B" v={sel.pctB == null ? '—' : sel.pctB.toFixed(0)} />
              <Cond
                k="밴드 전폭"
                v={
                  sel.width == null
                    ? '—'
                    : `${fmtLevel(sel.width, sel.dUnit as Unit)}${unitSuffix(sel.dUnit as Unit)}`
                }
              />
              <Cond k="상태" v={stateText(sel.state)} />
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
          </VStack>
        </VStack>
      </HStack>
    </VStack>
  );
}
