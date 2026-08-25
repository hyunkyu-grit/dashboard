'use client';

/* 백테스트 창 — "그때 들어갔으면 지금 얼마였을까".
 *
 * 레인 3 의 `FloatingWindow` 위에 산다. 모달이 아니라 **떠 있는 창**인 이유는
 * v1 이 적어둔 그대로다: 백테스트는 읽는 사람이 그 주위에서 앱을 계속 쓰는
 * 작업대다(레벨 확인하고, 행 고정하고, 확대해 보고). 모달이면 그 하나하나가
 * 창을 부수고 다시 짓는 일이 된다.
 *
 * ── 이 화면이 지고 있는 규칙 ───────────────────────────────────────────────
 *
 * **스스로 실행되지 않는다.** 사람이 실행을 누른다. 백테스트는 누군가 던지는
 * 질문이지 날짜를 타이핑하는 중에 일어나는 일이 아니고, 한 번이 서버에서 하루
 * 단위 전면 재평가다.
 *
 * **북이지 한 거래가 아니다.** 줄마다 종목·방향·규모·진입·청산이 따로 논다.
 *
 * **한 북에 스왑과 현금채권이 같이 선다** [OWNER, 2026-08-21 — "현금채권이랑
 * 스왑을 섞어서 백테스팅"]. 종전에는 창이 둘이었고 엔진도 둘이었다. 창을 합친
 * 이유는 질문이 하나이기 때문이다 — "이 북이 얼마였나" 에 두 답이 있으면 그건
 * 두 북이다. 산술은 그대로 두 엔진이 한다(`backend/app/mixedbook.py`): 여기서
 * 새로 계산하는 것은 없고, 창은 줄마다 붙어 오는 `kind` 를 읽어 그린다.
 *
 * **헤드라인은 북 합계이고 차트는 그 선 하나만 그린다.** 포지션별로는 선이
 * 아니라 숫자를 준다 — 한 축에 서너 개 곡선은 아무도 안 읽고, "어느 게 벌었나"
 * 는 숫자 한 열이 더 빨리 답한다.
 *
 * **라이브 백엔드 전용.** 다른 화면은 구운 JSON 을 읽지만 이 답은 읽는 사람이
 * 고른 입력에 달렸다. 백엔드가 없으면 빈 차트를 그리는 대신 그렇다고 말한다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { Select } from '@coinbase/cds-web/alpha/select';
import { Button } from '@coinbase/cds-web/buttons';
import { TextInput } from '@coinbase/cds-web/controls';
import { Box, HStack, VStack } from '@coinbase/cds-web/layout';
import { SegmentedTabs } from '@coinbase/cds-web/tabs';
import {
  TextBody,
  TextCaption,
  TextDisplay3,
  TextLabel1,
  TextLabel2,
  TextLegal,
} from '@coinbase/cds-web/typography';
import { CartesianChart, Line, XAxis, YAxis } from '@coinbase/cds-web/visualizations/chart';

import {
  BacktestUnavailable,
  fetchBacktest,
  fetchCashBondSeries,
  isBondKind,
  runErrorMessage,
  type BacktestPosition,
  type BacktestResult,
  type BookKind,
  type CashBondRow,
  type PolicyStep,
  type Unit,
} from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { seriesUrl } from '@/lib/staticPaths';
import { fmtKrw, fmtKrwFromMan, splitCashBondKrw, splitKrw } from '@/lib/krw';
import { useFunding } from '@/state/funding';
import type { Row } from '@/table/rows';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { DROPDOWN_STYLES } from '@/ui/window/popup';
import { ReconStack } from '@/ui/window/ReconStack';

import { LinkedCharts } from './LinkedCharts';
import { backtestDays, bondReconNote, reconNote, reconPair } from './recon';
import {
  bookKindOf,
  decodeBook,
  defaultEntry,
  directionLabel,
  encodeBook,
  isBondRow,
  isSwapBookable,
  loadBacktestMemory,
  MAX_POSITIONS,
  newRow,
  runnable,
  saveBacktestMemory,
  type BookRow,
} from './book';

const MEMORY_KEY = 'backtest';
const AXIS = 'pnl';
const EOK = 1e8;

/** 줄의 종류. 스왑 셋(아웃라이트·스프레드·플라이)을 하나로 묶은 이유는 그
 * 목록이 이미 한 드롭다운이기 때문이다 — 여기서 다시 가르면 고르는 걸음만
 * 늘고 얻는 것이 없다. 채권 둘은 **종목군과 만기를 따로** 고르므로 갈린다. */
const KIND_ORDER: BookKind[] = ['swap', 'cashbond', 'assetswap'];
const KIND_LABEL: Record<BookKind, string> = {
  swap: '스왑',
  cashbond: '현금채권',
  assetswap: '자산스왑',
};

/**
 * 진입일 이후 첫 관측 — **실행 전에 보여줄 진입 레벨** [v1 OWNER 피드백,
 * 2026-08-04: "진입 레벨은 실행 전에도 보여야"].
 *
 * 서버가 진입일을 스냅하는 규칙과 같아야 한다(그 날짜 이후 첫 영업일). 두 규칙이
 * 다르면 한 날짜에 **두 개의 진입 레벨**이 화면에 뜬다.
 */
export function pointOnOrAfter(
  points: { t: string; v: number }[] | undefined,
  iso: string,
): { t: string; v: number } | null {
  if (!points || !iso) return null;
  for (const p of points) if (p.t >= iso) return p;
  return null;
}

/* 종목별 히스토리는 **풀 해상도**로 받는다. 150점 프리뷰는 진입일을 3주 반
 * 단위로 스냅해서, 확신에 찬 틀린 레벨을 찍는다. 창이 열려 있는 동안 id 당 한
 * 번만 받는다(미리보기 pane 과 같은 경로라 서버 캐시도 같이 탄다).
 *
 * 채권 id 는 **다른 경로**다(민평은 SQL 에만 있다). 캐시가 하나인 이유는 id 가
 * 하나이기 때문이다 — `CB:KTB:3Y` 는 어느 경로로 왔든 같은 계열이다. */
const seriesCache = new Map<string, Promise<{ t: string; v: number }[] | null>>();
function loadSeriesPoints(id: string): Promise<{ t: string; v: number }[] | null> {
  let hit = seriesCache.get(id);
  if (!hit) {
    hit = (async () => {
      try {
        if (isBondKind(bookKindOf(id))) {
          const s = await fetchCashBondSeries(id);
          return s.points;
        }
        const r = await fetch(seriesUrl(id, 'full'));
        if (!r.ok) return null;
        const j = (await r.json()) as { points?: { t: string; v: number }[] };
        return j.points ?? null;
      } catch {
        return null;
      }
    })();
    seriesCache.set(id, hit);
  }
  return hit;
}

/** 서버가 실제로 가격한 다리로 만든 문장. 실행 뒤에는 추론할 이유가 없다 —
 * 서버의 답을 읽는 것이 두 쪽이 어긋날 자리를 하나 줄인다. */
function legsSentence(p: BacktestPosition): string {
  const say = (side: string) => (side === 'pay' ? '페이' : '리시브');
  const legs = p.legs;
  if (legs.length === 0) return '';
  if (legs.length === 1) return say(legs[0].side);
  const [head, ...rest] = legs;
  const body = `${head.tenor} ${say(head.side)}${legs.length === 3 ? '×2' : ''} · ${rest
    .map((l) => l.tenor)
    .join('/')} ${say(rest[0].side)}`;
  if (legs.length === 2) return `${head.side === 'pay' ? '스티프너' : '플래트너'} (${body})`;
  return body;
}

/**
 * 북 전체의 분해 — **표시 정밀도에서 합계와 맞도록**.
 *
 * 서버가 포지션마다 낸 평가·롤다운을 더하고, 캐리는 합계에서 뺀 값으로 낸다.
 * 셋을 각자 반올림했더니 화면에서 1만원이 어긋났다(실측 2026-08-14: 세 항목
 * 합 −6,127 vs 헤드라인 −6,128). 이 셋은 합계의 **구성**이라, 읽는 사람이 더해서
 * 헤드라인이 안 나오면 그건 화면이 틀린 것이다.
 *
 * 조달 칸은 **채권 줄이 있을 때만** 선다. 스왑만 있는 북에 조달 0 을 적으면
 * "조달이 0원이었다" 로 읽히는데, 스왑에는 그 개념 자체가 없다.
 */
function decompose(result: BacktestResult) {
  let valuation = 0;
  let rolldown = 0;
  let startup = 0;
  let funding = 0;
  let hasFunding = false;
  for (const p of result.positions) {
    valuation += p.valuation;
    rolldown += p.rolldown ?? 0;
    // 개시(거래일→발효일 한 밤)는 평가에 접는다 [OWNER, 2026-08-14].
    startup += p.startup ?? 0;
    if (p.funding != null) {
      funding += p.funding;
      hasFunding = true;
    }
  }
  if (!hasFunding) return { ...splitKrw(result.pnl, valuation, rolldown, startup), uFund: null };
  return splitCashBondKrw(result.pnl, valuation, rolldown, funding, startup);
}

/** 크기(노셔널·DV01)는 **부호가 없다**. `fmtKrw` 는 부호 있는 돈을 위한 것이라
 * 늘 `+`/`−` 를 붙이는데, 250억이라는 크기에 `+` 가 붙으면 그게 손익처럼 읽힌다.
 * 부호가 뜻을 지는 자리(손익·분해)와 크기만 있는 자리를 문법으로 가른다. */
function mag(v: number): string {
  return fmtKrw(Math.abs(v)).replace(/^\+/, '');
}

/** 3분해의 한 항목 — 이름은 muted, 값은 부호색. */
function Part({ label, u }: { label: string; u: number }) {
  return (
    <HStack gap={0.5} alignItems="baseline">
      <TextCaption as="span" color="fgMuted" noWrap>
        {label}
      </TextCaption>
      <TextLabel2
        as="span"
        tabularNumbers
        noWrap
        className={u > 0 ? 'sr-up' : u < 0 ? 'sr-down' : undefined}
      >
        {fmtKrwFromMan(u)}
      </TextLabel2>
    </HStack>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <VStack gap={0.25} minWidth={0}>
      <TextCaption as="span" color="fgMuted" noWrap>
        {label}
      </TextCaption>
      {children}
    </VStack>
  );
}

/** 배타 선택은 CDS `SegmentedTabs` 다 [OWNER 2026-08-13 §5.4] — 시뮬레이션의
 * 같은 래퍼와 같은 근거(그 파일의 주석: `SegmentedControl` 은 deprecated). */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const tabs = options.map((o) => ({ id: o.value, label: o.label }));
  return (
    <SegmentedTabs
      accessibilityLabel={label}
      tabs={tabs}
      activeTab={tabs.find((t) => t.id === value) ?? null}
      onChange={(t) => t && onChange(t.id)}
    />
  );
}

export function BacktestWindow({
  rows,
  cashbondRows,
  cashbondTypes,
  cashbondAsOf,
  cashbondFrom,
  asOf,
  book,
  setBook,
  onClose,
  policy,
}: {
  /** IRS 표의 행들 — 스왑 종목 목록의 출처다. 담을 수 있는 것만 고른다. */
  rows: Row[];
  /** 현금채권·자산스왑 행 전부 — 채권 줄의 종목군·만기 목록의 출처다.
   * 백엔드가 못 닿았으면 빈 배열이고, 그때는 종류 목록에서 채권이 빠진다. */
  cashbondRows: CashBondRow[];
  cashbondTypes: { id: string; label: string }[];
  /** 민평 일자 — 채권 줄의 날짜 상한. IRS 일자와 하루씩 다를 수 있다. */
  cashbondAsOf: string;
  /** 민평 시작일 — 채권 줄 진입일의 바닥이자 기본값(1년 전)의 바닥. */
  cashbondFrom: string;
  /** 데이터 일자 — 새 줄의 기본 진입일이자 청산 미기재의 뜻("데이터 끝까지"). */
  asOf: string;
  book: BookRow[];
  setBook: (next: BookRow[]) => void;
  onClose: () => void;
  /** 기준금리 스텝 — 차트의 기준선이 진다(`LinkedCharts`). 화면의 성질이라
   * 창이 스스로 가져오지 않고 받는다(미리보기 pane 과 같은 규칙). */
  policy?: PolicyStep;
}) {
  /* 조달은 Setting 이 정한 값을 그대로 싣는다 [OWNER — "Cash Bond 전용"].
   * 서버는 채권 줄이 있을 때만 읽는다. */
  const [funding] = useFunding();

  const [result, setResult] = useState<BacktestResult | undefined>(
    () => loadBacktestMemory(MEMORY_KEY).result as BacktestResult | undefined,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  /* 북에 있는 종목들의 히스토리 — 진입 레벨을 실행 **전에** 보여주기 위한 것. */
  const [points, setPoints] = useState<Record<string, { t: string; v: number }[]>>({});

  useEffect(() => {
    let live = true;
    for (const id of new Set(book.map((r) => r.id).filter(Boolean))) {
      if (points[id]) continue;
      void loadSeriesPoints(id).then((p) => {
        if (live && p) setPoints((prev) => (prev[id] ? prev : { ...prev, [id]: p }));
      });
    }
    return () => {
      live = false;
    };
  }, [book, points]);

  /* 북이 바뀔 때마다 기억한다. 읽는 사람이 창을 닫는 그 순간의 북이 남는다. */
  useEffect(() => {
    saveBacktestMemory(MEMORY_KEY, { book });
  }, [book]);

  const swapOptions = useMemo(
    () => rows.filter(isSwapBookable).map((r) => ({ value: r.id, label: r.label })),
    [rows],
  );

  /** 채권 행을 id 로 찾는 표 — 만기 목록과 단위가 여기서 나온다. */
  const bondById = useMemo(
    () => new Map(cashbondRows.map((r) => [r.id, r])),
    [cashbondRows],
  );

  /** 그 종류에 실제로 행이 있는 종목군만. 자산스왑은 만기가 좁아 종목군도 좁다. */
  const bondTypesFor = useCallback(
    (kind: BookKind) => {
      const want = kind === 'assetswap' ? 'ASW' : 'CB';
      return cashbondTypes.filter((t) =>
        cashbondRows.some((r) => r.kind === want && r.bondType === t.id),
      );
    },
    [cashbondTypes, cashbondRows],
  );

  /** 고를 수 있는 종류. 민평을 못 읽었으면 채권이 아예 안 뜬다 — 고를 수는
   * 있는데 실행이 안 되는 칸을 두지 않는다(이 리포의 claim-vs-behaviour 규칙). */
  const kinds = useMemo(
    () =>
      KIND_ORDER.filter(
        (k) => k === 'swap' || cashbondRows.some((r) => r.kind === (k === 'assetswap' ? 'ASW' : 'CB')),
      ),
    [cashbondRows],
  );

  const run = useCallback(async () => {
    const rs = runnable(book);
    if (rs.length === 0) return;
    setRunning(true);
    setError(undefined);
    setUnavailable(false);
    try {
      const r = await fetchBacktest(rs, funding);
      setResult(r);
      saveBacktestMemory(MEMORY_KEY, { result: r });
    } catch (e) {
      if (e instanceof BacktestUnavailable) setUnavailable(true);
      else setError(runErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [book, funding]);

  const patch = (key: string, next: Partial<BookRow>) =>
    setBook(book.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** 종류를 바꾼다. **방향은 되돌리고 진입일은 그 상품의 기본으로 옮긴다** —
   * 숏 스프레드를 들고 있다가 현금채권을 고르면 방향 칸이 사라지면서 −1 이
   * 남는데, 서버는 그걸 거절하므로 안 보이는 값 때문에 줄이 죽는다 (시뮬레이션이
   * 같은 함정을 v1 642c5c46 에서 겪었다). 진입일은 채권이 캐리를 쌓아야 읽히는
   * 화면이라 며칠짜리 기본값이 늘 "거의 0" 을 보여 준다. */
  const switchKind = (key: string, kind: BookKind) => {
    const cur = book.find((r) => r.key === key);
    if (!cur) return;
    /* **적어 둔 날짜는 지킨다.** 종류를 바꾼다고 읽는 사람이 고른 진입일이
       사라지면 그건 다른 질문이 된다. 손대는 자리는 둘뿐이다: 채권은 민평이
       2020년부터라 그 앞을 바닥으로 걷어 올리고(안 그러면 서버가 조용히
       스냅한다), 빈 칸에는 그 상품의 기본을 심는다. */
    const keep = (id: string) => {
      const base = cur.entry || defaultEntry(id, asOf, cashbondAsOf, cashbondFrom);
      return isBondRow({ id }) && base < cashbondFrom ? cashbondFrom : base;
    };
    if (kind === 'swap') {
      /* 스왑으로 옮길 때의 기본은 **10Y** 다 — 목록의 첫 줄이 아니라. 이 창의
         종목 목록은 모니터의 행 순서를 그대로 따르므로 첫 줄이 `1D`(콜금리)인데,
         «스왑» 을 골랐더니 하룻밤짜리가 서는 것은 아무도 뜻한 바가 아니다.
         `newRow` 의 폴백과 같은 값이다(그쪽도 '10Y'). */
      const id =
        swapOptions.find((o) => o.value === '10Y')?.value ?? swapOptions[0]?.value ?? '10Y';
      patch(key, { id, direction: 1, entry: keep(id) });
      return;
    }
    const want = kind === 'assetswap' ? 'ASW' : 'CB';
    const curType = bondById.get(cur.id)?.bondType;
    const pool = cashbondRows.filter((r) => r.kind === want);
    const next = pool.find((r) => r.bondType === curType) ?? pool[0];
    if (!next) return;
    /* 방향을 **되돌린다** — 숏 스프레드를 들고 있다가 채권을 고르면 방향 칸이
       사라지면서 −1 이 남는데, 서버는 그걸 거절하므로 안 보이는 값 때문에 줄이
       죽는다 (시뮬레이션이 v1 642c5c46 에서 같은 함정을 겪었다). */
    patch(key, { id: next.id, direction: 1, entry: keep(next.id) });
  };

  /** 종목군을 바꿀 때 만기를 되도록 지킨다. 못 지키면 **가장 긴 것**으로
   * 떨어진다 — 통안채는 3년까지고 자산스왑은 양쪽에 있는 만기에만 서므로,
   * 없는 조합을 고르면 칸이 비는 대신 그 종목군이 실제로 갖는 끝으로 간다. */
  const switchBondType = (key: string, bondType: string) => {
    const id = book.find((r) => r.key === key)?.id ?? '';
    const cur = bondById.get(id);
    /* 행 목록에 없는 id 도 있다 — 손으로 만든 URL, 또는 민평이 아직 안 온 첫
       프레임. 그때도 **고른 것은 먹어야 한다**: 종류는 id 접두사가 말해 주므로
       그 종류의 그 종목군에서 가장 긴 만기로 간다(아래 폴백과 같은 규칙). */
    const wantKind = cur?.kind ?? (bookKindOf(id) === 'assetswap' ? 'ASW' : 'CB');
    const same = cashbondRows.filter((r) => r.kind === wantKind && r.bondType === bondType);
    const next = same.find((r) => r.tenor === cur?.tenor) ?? same[same.length - 1];
    if (next) patch(key, { id: next.id });
  };

  const parts = result ? decompose(result) : null;
  const hasBond = book.some(isBondRow);

  return (
    <FloatingWindow
      windowKey="backtest"
      title="백테스트"
      /* 1020 — 북 한 줄의 산술. 방향이 세그먼트로 **자기 줄에 내려간 뒤**
         (아래 그 자리의 주석) 첫 줄은 종류 132 + 종목 160 + 만기 92 + 규모 88 +
         날짜 128×2 + 레벨 96 = 824 + gap 6×12 + ✕ 로 여유가 있다. 폭을 안 줄인
         이유는 답 쪽(포지션별 줄·대사 서랍)이 이 폭을 쓰고 있어서다. */
      width={1020}
      aside={
        <TextCaption as="span" color="fgMuted" noWrap>
          {asOf} 종가까지
        </TextCaption>
      }
      onClose={onClose}
      drawer={[
        {
          id: 'recon',
          label: '일별 대사',
          /* 표 둘 [OWNER, 2026-08-25 — 엔진 단위 분리]: 스왑 표는 IRS 달력,
             채권 표는 민평 달력 위에 각자 선다. 병합판이 떨구던 날(한쪽만 쉰
             날 + 다음 날)이 없어져 각 표의 세로합이 자기 기간 3분해와 닫힌다.
             둘 다 설 때만 머리로 어느 달력의 표인지 말한다. */
          content: (() => {
            const pair = reconPair(result?.recon);
            if (!pair.swap && !pair.bond) return null;
            const both = Boolean(pair.swap && pair.bond);
            return (
              <VStack gap={1} width="100%">
                {pair.swap ? (
                  <VStack gap={0.5} width="100%">
                    {both ? (
                      <TextCaption as="span" color="fgMuted">
                        스왑 대사 — IRS 달력
                      </TextCaption>
                    ) : null}
                    <ReconStack
                      days={backtestDays(pair.swap)}
                      tenors={pair.swap.tenors}
                      defaultOrder="desc"
                      note={reconNote(pair.swap)}
                      maxHeight={both ? '15vh' : undefined}
                    />
                  </VStack>
                ) : null}
                {pair.bond ? (
                  <VStack gap={0.5} width="100%">
                    {both ? (
                      <TextCaption as="span" color="fgMuted">
                        채권 대사 — 민평 달력
                      </TextCaption>
                    ) : null}
                    <ReconStack
                      days={backtestDays(pair.bond)}
                      tenors={pair.bond.tenors}
                      defaultOrder="desc"
                      note={bondReconNote(pair.bond)}
                      maxHeight={both ? '15vh' : undefined}
                    />
                  </VStack>
                ) : null}
              </VStack>
            );
          })(),
          unavailable: result
            ? '이 실행에는 대사가 없어요 — 예전 세션에서 복원한 결과예요.'
            : '실행하면 하루씩 대사가 서요 — 시작 KRD, 그날 Δbp, 그 곱(추정), 그리고 실제 손익의 평가/롤다운/캐리 분해예요.',
        },
      ]}
    >
      <VStack gap={2} padding={2} width="100%">
        {/* ── 북 ───────────────────────────────────────────────────────────── */}
        <VStack gap={1} width="100%">
          {book.map((r) => {
            const kind = bookKindOf(r.id);
            const bond = isBondKind(kind);
            const bondRow = bond ? bondById.get(r.id) : undefined;
            const tenors = bondRow
              ? cashbondRows.filter(
                  (x) => x.kind === bondRow.kind && x.bondType === bondRow.bondType,
                )
              : [];
            const unit: Unit = bondRow?.unit ?? (r.id.includes('-') ? 'bp' : '%');
            const maxDate = bond ? cashbondAsOf : asOf;
            return (
              <VStack key={r.key} gap={0.5} width="100%">
                <HStack gap={1.5} alignItems="flex-end" flexWrap="wrap">
                  {/* 종류 140 — 가장 긴 라벨 "현금채권" 이 13px legal 로 ~52px 이고
                      CDS 컨트롤의 크롬(좌우 패딩 + 셰브론)이 82px 을 먹는다(이 창의
                      다른 칸들과 같은 실측 산술). 132 이던 시절 그 합(134)이 상자보다
                      2px 컸다 — 자기 주석의 산술이 이미 어긋나 있었다
                      [OWNER 2026-08-25 말줄임 금지]. */}
                  <Box width={140}>
                    <Field label="종류">
                      {/* font legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거). */}
                      <Select
                        size="s"
                        font="legal"
                        styles={DROPDOWN_STYLES}
                        accessibilityLabel="종류"
                        value={kind}
                        onChange={(v) => v && switchKind(r.key, v as BookKind)}
                        /* **이 줄이 무엇인지는 언제나 적힌다.** 민평을 못 읽은
                           날(SQL 이 죽었거나 아직 안 붙은 날) 채권 종류가 목록에서
                           빠지는데, URL 에 담아 온 채권 줄이 그때 값 없는 빈 칸으로
                           선다 — 읽는 사람은 «이게 뭐였더라» 를 묻게 된다. 고를 수
                           없는 것과 무엇인지 모르는 것은 다르다. */
                        options={(kinds.includes(kind) ? kinds : [...kinds, kind]).map((k) => ({
                          value: k,
                          label: KIND_LABEL[k],
                        }))}
                      />
                    </Field>
                  </Box>
                  {/* 160 → 168 [OWNER 2026-08-25 말줄임 금지]: 최장 «캐피탈채
                      AA-» ≈ 76px + 크롬 82 = 158 — 2px 모자라 잘렸다. 같은
                      라벨에 BondTypeFilter 는 200 을 준다(다른 크롬). */}
                  <Box width={168}>
                    <Field label="종목">
                      <Select
                        size="s"
                        font="legal"
                        styles={DROPDOWN_STYLES}
                        accessibilityLabel="종목"
                        value={bond ? (bondRow?.bondType ?? '') : r.id}
                        onChange={(v) =>
                          v && (bond ? switchBondType(r.key, v) : patch(r.key, { id: v }))
                        }
                        options={
                          bond
                            ? bondTypesFor(kind).map((t) => ({ value: t.id, label: t.label }))
                            : swapOptions
                        }
                      />
                    </Field>
                  </Box>
                  {/* 만기 칸은 채권에만 선다 [OWNER — "Cash Bond에서는 종목, 테너로"].
                      스왑은 종목 이름이 이미 만기를 말한다(3s10s 의 두 다리). */}
                  {bond ? (
                    /* 92 → 116 [OWNER 2026-08-25 말줄임 금지]: 크롬 82 를 빼면
                       글자 자리가 10px 라 «10Y»·«1.5Y» 도 잘렸다. */
                    <Box width={116}>
                      <Field label="만기">
                        <Select
                          size="s"
                          font="legal"
                          styles={DROPDOWN_STYLES}
                          accessibilityLabel="만기"
                          value={r.id}
                          onChange={(v) => v && patch(r.key, { id: v })}
                          options={tenors.map((x) => ({ value: x.id, label: x.tenor }))}
                        />
                      </Field>
                    </Box>
                  ) : null}
                  <Box width={88}>
                    <Field label="규모 (억)">
                      {/* fontSize legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거).
                          height 32 — 이 행의 등고. 13px 패스가 `Select` 는
                          `font="legal"` 로 상자까지 39→32 로 줄였지만 `TextInput` 은
                          `fontSize` 라 글자만 줄고 상자는 CDS `size="s"` 기본값(38)에
                          남았다(HANDOFF.md 8.21 의 실측). */}
                      <TextInput
                        size="s"
                        fontSize="legal"
                        height={32}
                        accessibilityLabel="규모(억)"
                        value={String(r.eok)}
                        onChange={(e) => patch(r.key, { eok: Number(e.target.value) || 0 })}
                      />
                    </Field>
                  </Box>
                  <Box width={128}>
                    <Field label="진입일">
                      {/* 네이티브 date — CDS `DateInput` 은 마스크 텍스트라 ISO 를
                          직접 다루지 않고, 이 제품의 날짜는 화면 전체가 ISO 다
                          (표 헤더·신선도 칩·대사). 여기서만 다른 문법을 쓰면 같은
                          날짜가 두 모양으로 존재한다. */}
                      <input
                        className="sr-date"
                        type="date"
                        value={r.entry}
                        min={bond ? cashbondFrom : undefined}
                        max={maxDate}
                        onChange={(e) => patch(r.key, { entry: e.target.value })}
                        aria-label="진입일"
                      />
                    </Field>
                  </Box>
                  <Box width={128}>
                    <Field label="청산일">
                      <input
                        className="sr-date"
                        type="date"
                        value={r.exit}
                        min={r.entry}
                        max={maxDate}
                        onChange={(e) => patch(r.key, { exit: e.target.value })}
                        aria-label="청산일 (비우면 데이터 끝까지)"
                      />
                    </Field>
                  </Box>
                  {/* 진입 레벨 — 실행 전에도. 타이핑한 날짜가 **실제로 어느 레벨에
                      꽂히는지**가 실행을 누르기 전에 읽혀야 한다. 그 날짜에 관측이
                      없으면(휴일·데이터 끝 이후) 서버가 스냅할 그 날의 값을 그대로
                      보여준다 — 규칙이 하나여야 두 개의 진입 레벨이 안 생긴다. */}
                  <Box width={96}>
                    <Field label="진입 레벨">
                      {/* 컨트롤이 아닌 값도 컨트롤과 같은 32px 상자에 담는다.
                          이 행은 `alignItems="flex-end"` 라 바닥이 정렬되는데, 그
                          규칙에서는 **블록 높이가 곧 라벨 높이**다: 값이 맨살
                          글자(20px)면 블록이 38 이 되어 라벨만 형제보다 12px 아래로
                          내려앉았다(실측 2026-08-19). */}
                      <HStack height={32} alignItems="center">
                        <TextLabel2 as="span" tabularNumbers noWrap>
                          {(() => {
                            const p = pointOnOrAfter(points[r.id], r.entry);
                            if (!p) return '—';
                            return `${fmtLevel(p.v, unit)}${unitSuffix(unit)}`;
                          })()}
                        </TextLabel2>
                      </HStack>
                    </Field>
                  </Box>
                  <button
                    type="button"
                    className="sr-window-close"
                    onClick={() => setBook(book.filter((x) => x.key !== r.key))}
                    aria-label="줄 삭제"
                  >
                    ✕
                  </button>
                </HStack>
                {/* 방향은 **자기 줄의 세그먼트**다 [2026-08-21, 시뮬레이션의 같은
                    자리와 같은 판단]. 드롭다운이던 시절 이 칸은 264px 였다 — 가장
                    긴 문장 "스티프너 (1.5Y 페이 · 6M 리시브)" 를 안 자르려는 폭이고
                    [OWNER 2026-08-19 — "… 처럼 생략되는 것도 별로"], 종류 칸이
                    들어오면서 한 줄에 다 세우면 창이 1164px 가 돼야 했다. 선택지가
                    둘뿐인 컨트롤에 그만한 가로를 주는 대신 세로 한 줄을 쓴다.

                    **채권에는 방향 칸이 없다** — 살 수만 있다 [OWNER, 2026-08-14].
                    비활성 세그먼트를 놓아 두는 대신 칸을 안 그린다: 못 고르는
                    컨트롤은 "왜 안 눌리지" 를 묻게 한다. */}
                {bond ? null : (
                  <Segmented
                    label="방향"
                    value={String(r.direction) as '1' | '-1'}
                    options={[
                      { value: '1', label: directionLabel(r.id, 1) },
                      { value: '-1', label: directionLabel(r.id, -1) },
                    ]}
                    onChange={(v) => patch(r.key, { direction: v === '-1' ? -1 : 1 })}
                  />
                )}
              </VStack>
            );
          })}

          <HStack gap={1} alignItems="center" flexWrap="wrap">
            <Button
              variant="secondary"
              size="s"
              disabled={book.length >= MAX_POSITIONS}
              onClick={() => {
                /* 새 줄은 **바로 위 줄을 닮는다** — 같은 상품을 다른 날짜로
                   두 번 재는 것이 이 화면의 흔한 걸음이다. 진입일 기본은
                   그 상품이 정한다(`defaultEntry`): 채권에 오늘을 심으면 캐리가
                   하루도 안 쌓여 늘 «거의 0» 이 뜬다. */
                const id = book.at(-1)?.id ?? '10Y';
                setBook([
                  ...book,
                  newRow(id, defaultEntry(id, asOf, cashbondAsOf, cashbondFrom)),
                ]);
              }}
            >
              줄 추가
            </Button>
            {/* 실행은 사람이 누른다 — 이 화면의 규칙 중 하나다. */}
            <Button size="s" onClick={() => void run()} disabled={running || runnable(book).length === 0}>
              {running ? '계산 중…' : '실행'}
            </Button>
            {book.length >= MAX_POSITIONS ? (
              <TextCaption as="span" color="fgMuted">
                한 창에 {MAX_POSITIONS}줄까지예요.
              </TextCaption>
            ) : null}
            {/* 조달은 채권 줄이 있을 때만 말한다 — 스왑에는 그 개념이 없다.
                TextCaption 은 uppercase 라 "+10bp (Setting)" 이 "+10BP (SETTING)"
                이 된다(v1 실측 함정). 문장·단위는 TextLegal 이 진다. */}
            {hasBond ? (
              <TextLegal as="span" color="fgMuted">
                채권 조달 {funding.basis === 'base' ? '기준금리' : '콜금리'}{' '}
                {funding.spreadBp >= 0 ? '+' : ''}
                {funding.spreadBp}bp (Setting)
              </TextLegal>
            ) : null}
          </HStack>
        </VStack>

        {/* ── 답 ───────────────────────────────────────────────────────────── */}
        {unavailable ? (
          <TextBody as="p" color="fgMuted">
            백테스트는 실행 중인 백엔드가 필요해요. 다른 화면과 달리 이 답은 읽는 사람이 고른
            입력에 달려 있어서 미리 구워둘 수가 없어요.
          </TextBody>
        ) : error ? (
          <TextBody as="p" className="sr-up">
            실행하지 못했어요 — {error}
          </TextBody>
        ) : result && parts ? (
          <VStack gap={1.5} width="100%">
            <VStack gap={0.25}>
              <TextCaption as="span" color="fgMuted">
                총 손익 · {result.from} → {result.to}
              </TextCaption>
              <TextDisplay3
                as="span"
                tabularNumbers
                className={result.pnl > 0 ? 'sr-up' : result.pnl < 0 ? 'sr-down' : undefined}
              >
                {fmtKrw(result.pnl)}
              </TextDisplay3>
              {/* 분해 [OWNER 2026-08-11 — 교과서]. **항등식이지 귀속 모델이
                  아니다**: 평가 + 롤다운 + 캐리 (+ 조달) = 총손익, 정확히.
                  항목마다 부호색을 준다(v1 과 같은 규칙) — 어느 성분이 벌었고
                  어느 쪽이 까먹었는지가 이 줄의 전부라서, 셋을 한 색으로 두면
                  다시 읽어야 한다. */}
              <HStack gap={1} flexWrap="wrap">
                <Part label="평가" u={parts.uVal} />
                <Part label="롤다운" u={parts.uRoll} />
                <Part label="캐리" u={parts.uCarry} />
                {parts.uFund != null ? <Part label="조달" u={parts.uFund} /> : null}
              </HStack>
              {/* 구간 안에서 어디까지 갔었나 — 같은 응답이 이미 담고 있다.
                  "bp" 가 든 문장이 뒤에 붙을 수 있어 TextLegal 이다. */}
              <TextLegal as="span" color="fgMuted" tabularNumbers>
                최대 이익 {fmtKrw(result.maxProfit)} · 최대 손실 {fmtKrw(result.maxLoss)}
                {result.funding ? ` · 조달 ${result.funding.label}` : ''}
              </TextLegal>
              {/* 두 달력이 어긋난 날 — 혼합 북에서만 온다. 안 센 날이 있다는
                  사실은 데이터 사실이라 표 옆에 적는다(빠뜨리면 합계가 왜
                  안 맞는지 읽는 사람이 알 길이 없다). */}
              {result.calendar?.dropped ? (
                <TextLegal as="span" color="fgMuted">
                  민평과 IRS 달력이 다 가진 날 위에서 셌어요 — 한쪽에만 있던{' '}
                  {result.calendar.dropped}일은 빼고요.
                </TextLegal>
              ) : null}
              {/* 선이 늦게 시작할 때. 민평이 2020년부터라 그 앞에 들어간 스왑은
                  공통 달력이 못 담는다 — **총액은 옳고 그림만 중간부터**다.
                  0 에서 출발하지 않는 선을 설명 없이 두면 오독이다. */}
              {result.calendar?.clippedFrom ? (
                <TextLegal as="span" color="fgMuted">
                  가장 이른 진입은 {result.calendar.clippedFrom} 인데 민평이{' '}
                  {result.from} 부터라 선은 거기서 시작해요 — 손익 합계는 진입일부터
                  전부 들어 있어요.
                </TextLegal>
              ) : null}
            </VStack>

            {/* 차트 한 쌍 [v1 OWNER, 2026-08-04 — LINKED PAIR]: 종목 차트가
                진입→청산 창을 그리고, 누적 손익이 **픽셀 정렬**로 그 밑에 선다
                (`LinkedCharts` 의 근거). 종목 히스토리가 아직 안 왔으면(옛
                세션 복원 직후 한 프레임) 손익 선 하나로 물러선다 — 빈 자리보다
                낫고, 다음 렌더에 쌍이 선다. */}
            {(() => {
              const first = result.positions[0];
              const firstId = first?.id ?? '';
              const inst = points[firstId];
              const win = inst
                ? inst.filter((p) => p.t >= result.from && p.t <= result.to)
                : [];
              if (win.length > 1) {
                return (
                  <LinkedCharts
                    points={win}
                    unit={
                      bondById.get(firstId)?.unit ?? (firstId.includes('-') ? 'bp' : '%')
                    }
                    result={result}
                    policy={policy}
                    marks={[
                      ...new Set(result.positions.map((p) => p.entry)),
                    ]
                      .map((d) => ({ date: d, label: '진입' }))
                      .concat(
                        result.positions
                          .filter((p) => p.closed || p.matured)
                          .map((p) => ({ date: p.exit, label: p.matured ? '만기' : '청산' })),
                      )}
                  />
                );
              }
              return result.points.length > 1 ? (
                <Box width="100%">
                  <CartesianChart
                    animate={false}
                    height={200}
                    accessibilityLabel="북 손익 추이"
                    /* `right: 12, bottom: 8` — 본문 pane 의 CHART_INSET 과 같은 값
                       [OWNER 승인 2026-08-18 점검]. 첫 판(right 8, bottom 0)에서
                       +300만원 같은 y 라벨이 선 위에 얹혀 있었다. */
                    inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
                    series={[
                      {
                        id: 'pnl',
                        data: result.points.map((p) => p.pnl),
                        color:
                          result.pnl >= 0 ? 'var(--sr-up)' : 'var(--sr-down)',
                        yAxisId: AXIS,
                      },
                    ]}
                    xAxis={{ data: result.points.map((p) => p.t) }}
                    yAxis={[{ id: AXIS }]}
                  >
                    <XAxis showGrid={false} />
                    <YAxis
                      axisId={AXIS}
                      position="right"
                      showGrid={false}
                      tickLabelFormatter={(v) => fmtKrw(v)}
                    />
                    <Line seriesId="pnl" curve="linear" connectNulls={false} />
                  </CartesianChart>
                </Box>
              ) : null;
            })()}

            {/* 포지션별 — 선이 아니라 숫자다. 줄마다 자기 `kind` 를 지므로
                스왑은 다리 문장을, 채권은 표면금리를 적는다. */}
            <VStack gap={0.5} width="100%">
              {result.positions.map((p, i) => (
                <HStack
                  key={`${p.id}-${p.entry}-${i}`}
                  className="sr-bt-row"
                  gap={1.5}
                  alignItems="baseline"
                  flexWrap="wrap"
                >
                  <TextLabel1 as="span" noWrap>
                    {p.label ?? p.id}
                  </TextLabel1>
                  {p.kind === 'swap' ? (
                    <TextCaption as="span" color="fgMuted" noWrap>
                      {legsSentence(p)}
                    </TextCaption>
                  ) : (
                    <>
                      <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                        {(p.notional / EOK).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        억 매수
                      </TextCaption>
                      <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                        표면 {fmtLevel(p.coupon ?? null, '%')}%
                      </TextCaption>
                    </>
                  )}
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    {p.entry} → {p.exit}
                    {p.matured ? ' (만기)' : p.closed ? ' (청산)' : ''}
                  </TextCaption>
                  {p.kind === 'swap' ? (
                    <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                      {fmtLevel(p.entryValue, p.legs.length === 1 ? '%' : 'bp')} →{' '}
                      {fmtLevel(p.exitValue, p.legs.length === 1 ? '%' : 'bp')}
                    </TextCaption>
                  ) : null}
                  {p.kind === 'assetswap' && p.aswSpread != null ? (
                    /* "bp" 가 든 문장 — TextCaption 의 uppercase 를 피한다 */
                    <TextLegal as="span" color="fgMuted" tabularNumbers noWrap>
                      진입 스프레드 {fmtLevel(p.aswSpread, 'bp')}bp
                    </TextLegal>
                  ) : null}
                  <TextLabel2
                    as="span"
                    tabularNumbers
                    noWrap
                    className={p.pnl > 0 ? 'sr-up' : p.pnl < 0 ? 'sr-down' : undefined}
                  >
                    {fmtKrw(p.pnl)}
                  </TextLabel2>
                  {/* 기계는 접어 둔다 — 두 번째 질문의 답이고, 첫 번째 답 옆에
                      두면 둘 다 안 읽힌다. 스왑은 다리별 노셔널·DV01, 채권은
                      줄의 4분해(가로로 반드시 더해진다 — `splitCashBondKrw`). */}
                  {p.kind === 'swap' ? (
                    p.legs.length > 1 ? (
                      <details className="sr-bt-legs">
                        <summary>
                          <TextCaption as="span" color="fgMuted">
                            자세히
                          </TextCaption>
                        </summary>
                        <VStack gap={0.25} paddingY={0.5}>
                          {p.legs.map((l) => (
                            <TextCaption
                              key={l.tenor}
                              as="span"
                              color="fgMuted"
                              tabularNumbers
                              noWrap
                            >
                              {l.tenor} {l.side === 'pay' ? '페이' : '리시브'} ·{' '}
                              {mag(l.notional ?? 0)} · DV01{' '}
                              {mag(l.dv01 * (l.notional ?? 0) * 1e-4)}
                              /bp · 진입 {fmtLevel(l.entryRate, '%')}%
                            </TextCaption>
                          ))}
                        </VStack>
                      </details>
                    ) : null
                  ) : (
                    (() => {
                      const u = splitCashBondKrw(
                        p.pnl,
                        p.valuation,
                        p.rolldown ?? 0,
                        p.funding ?? 0,
                        p.startup ?? 0,
                      );
                      return (
                        <details className="sr-bt-legs">
                          <summary>
                            <TextCaption as="span" color="fgMuted">
                              자세히
                            </TextCaption>
                          </summary>
                          <VStack gap={0.25} paddingY={0.5}>
                            <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                              평가 {fmtKrwFromMan(u.uVal)} · 캐리 {fmtKrwFromMan(u.uCarry)} ·
                              롤다운 {fmtKrwFromMan(u.uRoll)} · 조달 {fmtKrwFromMan(u.uFund)}
                            </TextCaption>
                            {p.kind === 'assetswap' && p.swapPnl != null ? (
                              <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                                스왑 다리 {fmtKrw(p.swapPnl)} · 진입금리{' '}
                                {p.swapEntryRate != null
                                  ? `${fmtLevel(p.swapEntryRate, '%')}%`
                                  : '—'}
                              </TextCaption>
                            ) : null}
                          </VStack>
                        </details>
                      );
                    })()
                  )}
                </HStack>
              ))}
            </VStack>
          </VStack>
        ) : (
          <TextBody as="p" color="fgMuted">
            줄을 채우고 실행을 누르면 그날 들어간 북을 오늘까지 매일 재평가해요.
          </TextBody>
        )}
      </VStack>
    </FloatingWindow>
  );
}

/** 창을 열 때 씨앗이 되는 북 — URL 의 `bt` 가 있으면 그것, 없으면 세션 기억,
 * 그것도 없으면 지금 보고 있는 종목 한 줄. */
export function seedBook(
  btParam: string | undefined,
  seedId: string,
  asOf: string,
  bondAsOf: string,
  bondFrom: string,
): BookRow[] {
  const fromUrl = decodeBook(btParam);
  if (fromUrl.length) return fromUrl;
  const remembered = loadBacktestMemory(MEMORY_KEY).book;
  if (remembered?.length) return remembered;
  return [newRow(seedId, defaultEntry(seedId, asOf, bondAsOf, bondFrom))];
}

export { encodeBook };
