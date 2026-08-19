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
import {
  TextBody,
  TextCaption,
  TextDisplay3,
  TextLabel1,
  TextLabel2,
} from '@coinbase/cds-web/typography';
import { CartesianChart, Line, XAxis, YAxis } from '@coinbase/cds-web/visualizations/chart';

import {
  BacktestUnavailable,
  fetchBacktest,
  runErrorMessage,
  type BacktestPosition,
  type BacktestRecon,
  type BacktestResult,
  type PolicyStep,
} from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { API_BASE } from '@/lib/staticPaths';
import { fmtKrw, fmtKrwFromMan, splitKrw } from '@/lib/krw';
import type { Row } from '@/table/rows';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { DROPDOWN_STYLES } from '@/ui/window/popup';
import { ReconStack, type ReconStackDay } from '@/ui/window/ReconStack';

import { LinkedCharts } from './LinkedCharts';
import {
  decodeBook,
  directionLabel,
  encodeBook,
  isBookable,
  loadBacktestMemory,
  MAX_POSITIONS,
  newRow,
  runnable,
  saveBacktestMemory,
  type BookRow,
} from './book';

const MEMORY_KEY = 'backtest';
const AXIS = 'pnl';

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
 * 번만 받는다(미리보기 pane 과 같은 경로라 서버 캐시도 같이 탄다). */
const seriesCache = new Map<string, Promise<{ t: string; v: number }[] | null>>();
function loadSeriesPoints(id: string): Promise<{ t: string; v: number }[] | null> {
  let hit = seriesCache.get(id);
  if (!hit) {
    hit = (async () => {
      try {
        const r = await fetch(`${API_BASE}/api/series/${encodeURIComponent(id)}?res=full`);
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
 * 북 전체의 3분해 — **표시 정밀도에서 합계와 맞도록**.
 *
 * 서버가 포지션마다 낸 평가·롤다운을 더하고, 캐리는 `splitKrw` 가 합계에서 뺀 값으로
 * 낸다. 셋을 각자 반올림했더니 화면에서 1만원이 어긋났다(실측 2026-08-14: 세 항목
 * 합 −6,127 vs 헤드라인 −6,128). 이 셋은 합계의 **구성**이라, 읽는 사람이 더해서
 * 헤드라인이 안 나오면 그건 화면이 틀린 것이다. */
function decompose(result: BacktestResult) {
  let valuation = 0;
  let rolldown = 0;
  let startup = 0;
  for (const p of result.positions) {
    valuation += p.valuation;
    rolldown += p.rolldown ?? 0;
    // 개시(거래일→발효일 한 밤)는 평가에 접는다 [OWNER, 2026-08-14] —
    // `splitKrw` 의 넷째 인자가 그 자리다. 옛 세션의 결과에는 필드가 없다.
    startup += p.startup ?? 0;
  }
  return splitKrw(result.pnl, valuation, rolldown, startup);
}

/** 서버 recon → 대사 스택 [v1 OWNER, 2026-08-11].
 *
 * 행은 서버 순서(오름차순) 그대로 넘기고 **첫 방향만** 최신-위(desc)로 준다 —
 * 대사는 보통 어제·오늘을 보는 일이다. 뒤집기 자체는 스택의 날짜 헤더 토글이 한다.
 *
 * 여기서 계산하는 것은 없다. 이름만 바꿔 넘긴다 — 두 번째 정의를 만들지 않는다.
 * 하나 접는 것이 있다: **개시**(거래일→발효일 한 밤)는 진입일 행에만 서고
 * 총손익 대비 0.005% 라 자기 열을 갖지 않는다 — 평가에 접는다 [OWNER,
 * 2026-08-14]. 엔진은 여전히 따로 센다(`backend/app/backtest.py`). */
function backtestDays(recon: BacktestRecon): ReconStackDay[] {
  return recon.rows.map((r) => ({
    date: r.t,
    title: r.carryover ? `${r.t} · 다음 영업일로 들고 가는 이월 리스크` : r.t,
    krd: r.krd,
    dbp: r.dbp,
    est: r.est,
    estTotal: r.estTotal,
    valuation: r.valuation === null ? null : r.valuation + (r.startup ?? 0),
    carry: r.carry,
    rolldown: r.rolldown,
    actual: r.actual,
  }));
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

export function BacktestWindow({
  rows,
  asOf,
  book,
  setBook,
  onClose,
  policy,
}: {
  /** 표의 행들 — 종목 목록의 출처다. 담을 수 있는 것만 고른다(`isBookable`). */
  rows: Row[];
  /** 데이터 일자 — 새 줄의 기본 진입일이자 청산 미기재의 뜻("데이터 끝까지"). */
  asOf: string;
  book: BookRow[];
  setBook: (next: BookRow[]) => void;
  onClose: () => void;
  /** 기준금리 스텝 — 차트의 기준선이 진다(`LinkedCharts`). 화면의 성질이라
   * 창이 스스로 가져오지 않고 받는다(미리보기 pane 과 같은 규칙). */
  policy?: PolicyStep;
}) {
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

  const options = useMemo(
    () =>
      rows
        .filter(isBookable)
        .map((r) => ({ value: r.id, label: r.label })),
    [rows],
  );

  const run = useCallback(async () => {
    const rs = runnable(book);
    if (rs.length === 0) return;
    setRunning(true);
    setError(undefined);
    setUnavailable(false);
    try {
      const r = await fetchBacktest(rs);
      setResult(r);
      saveBacktestMemory(MEMORY_KEY, { result: r });
    } catch (e) {
      if (e instanceof BacktestUnavailable) setUnavailable(true);
      else setError(runErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [book]);

  const patch = (key: string, next: Partial<BookRow>) =>
    setBook(book.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const parts = result ? decompose(result) : null;

  return (
    <FloatingWindow
      windowKey="backtest"
      title="백테스트"
      /* 1020 — 북 한 줄의 산술(아래 칸 폭 주석: 종목 160 + 방향 264 + 규모 88
         + 날짜 128×2 + 레벨 96 + gap 6×12 + ✕)이 기본 980 의 내용폭(~948)을
         24px 넘어 진입 레벨과 ✕가 둘째 줄로 접혔다. 방향·종목을 말줄임 없이
         전부 적는 쪽을 창이 넓어지는 것보다 우선한 오너 지시의 귀결이다
         [2026-08-19 — "… 처럼 생략되는 것도 별로"]. */
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
          content: result?.recon ? (
            <ReconStack
              days={backtestDays(result.recon)}
              tenors={result.recon.tenors}
              defaultOrder="desc"
              note={
                result.recon.truncated
                  ? '긴 백테스트라 최근 영업일만 실었어요 — 기간 전체 분해는 위에 있어요.'
                  : undefined
              }
            />
          ) : null,
          unavailable: result
            ? '이 실행에는 대사가 없어요 — 예전 세션에서 복원한 결과예요.'
            : '실행하면 하루씩 대사가 서요 — 시작 KRD, 그날 Δbp, 그 곱(추정), 그리고 실제 손익의 평가/롤다운/캐리 분해예요.',
        },
      ]}
    >
      <VStack gap={2} padding={2} width="100%">
        {/* ── 북 ───────────────────────────────────────────────────────────── */}
        <VStack gap={1} width="100%">
          {/* 칸 폭은 **가장 긴 실제 내용**에 맞춘다 [OWNER 2026-08-18 — "버튼이나
              탭들 사이에 거리가 너무 멀어"]. 첫 판(180/210/110/140/140/120)은
              CDS Select 가 상자를 채우지 않아 칸마다 죽은 여백이 섰고, 여섯 칸
              합(996px)이 창 내용폭(~940)을 넘어 **진입 레벨과 ✕가 둘째 줄로
              접혔다.**

              방향 104 는 아웃라이트("리시브")의 폭이었다 — 스프레드·플라이를
              고르면 "스티프너 (1.5Y 페이 · 6M 리시브)" 가 "스…" 로 잘렸다
              [OWNER 2026-08-19 — "… 처럼 생략되는 것도 별로"]. 264 는 실측
              산술이다: 가장 긴 방향 문장 "스티프너 (1.5Y 페이 · 6M 리시브)"
              가 13px legal 로 175px 이고, CDS 컨트롤의 크롬(좌우 패딩 +
              셰브론)이 82px 을 먹는다(Box 248 에서 안쪽 가용 166 실측) —
              175 + 82 = 257, 여유 7. 종목 160 도 같은 산술이다: 가장 긴
              플라이 "6M/1.5Y/10Y" ≈ 70px + 크롬 82. 여섯 칸 합 ~864 + gap
              72 + ✕ 가 기본 창(내용폭 ~948)을 넘어서 창이 1020 으로 넓어졌다
              (FloatingWindow width 주석). */}
          {book.map((r) => (
            <HStack key={r.key} gap={1.5} alignItems="flex-end" flexWrap="wrap">
              <Box width={160}>
                <Field label="종목">
                  {/* font legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거). */}
                  <Select
                    size="s"
                    font="legal"
                    styles={DROPDOWN_STYLES}
                    accessibilityLabel="종목"
                    value={r.id}
                    onChange={(v) => v && patch(r.key, { id: v })}
                    options={options}
                  />
                </Field>
              </Box>
              <Box width={264}>
                <Field label="방향">
                  <Select
                    size="s"
                    font="legal"
                    styles={DROPDOWN_STYLES}
                    accessibilityLabel="방향"
                    value={String(r.direction)}
                    onChange={(v) => patch(r.key, { direction: Number(v) })}
                    options={[
                      { value: '1', label: directionLabel(r.id, 1) },
                      { value: '-1', label: directionLabel(r.id, -1) },
                    ]}
                  />
                </Field>
              </Box>
              <Box width={88}>
                <Field label="규모 (억)">
                  {/* fontSize legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거).
                      height 32 — 이 행의 등고. 13px 패스가 `Select` 는
                      `font="legal"` 로 상자까지 39→32 로 줄였지만 `TextInput` 은
                      `fontSize` 라 글자만 줄고 상자는 CDS `size="s"` 기본값(38)에
                      남았다. 2026-08-14 에 "둘 다 39px" 로 검증됐던 등고가 그때
                      비대칭으로 깨진 것이고(HANDOFF.md 8.21), 그 결과 이 칸만
                      6px 높고 라벨이 6px 위에 앉았다(실측). 폰트로 되돌리면
                      13px 규칙이 깨지므로 상자를 직접 적는다 — `height` 는
                      TextInput 이 InputStack 에서 받는 CDS prop 이다. */}
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
                    max={asOf}
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
                    max={asOf}
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
                      이 행은 `alignItems="flex-end"` 라 바닥(189)이 정렬되는데,
                      그 규칙에서는 **블록 높이가 곧 라벨 높이**다: 값이 맨살
                      글자(20px)면 블록이 38 이 되어 라벨만 형제보다 12px 아래로
                      내려앉았다(실측 라벨 bottom 167 vs 155). 상자를 주면 블록이
                      형제와 같은 50 이 되고, 글자는 상자 중앙에 서서 컨트롤
                      중심선(173)과 만난다. */}
                  <HStack height={32} alignItems="center">
                    <TextLabel2 as="span" tabularNumbers noWrap>
                      {(() => {
                        const p = pointOnOrAfter(points[r.id], r.entry);
                        if (!p) return '—';
                        const unit = r.id.includes('-') ? 'bp' : '%';
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
          ))}

          <HStack gap={1} alignItems="center">
            <Button
              variant="secondary"
              size="s"
              disabled={book.length >= MAX_POSITIONS}
              onClick={() => setBook([...book, newRow(book.at(-1)?.id ?? '10Y', asOf)])}
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
              {/* 3분해 [OWNER 2026-08-11 — 교과서]. **항등식이지 귀속 모델이
                  아니다**: 평가 + 롤다운 + 캐리 = 총손익, 정확히.
                  항목마다 부호색을 준다(v1 과 같은 규칙) — 어느 성분이 벌었고
                  어느 쪽이 까먹었는지가 이 줄의 전부라서, 셋을 한 색으로 두면
                  다시 읽어야 한다. */}
              <HStack gap={1} flexWrap="wrap">
                <Part label="평가" u={parts.uVal} />
                <Part label="롤다운" u={parts.uRoll} />
                <Part label="캐리" u={parts.uCarry} />
              </HStack>
              {/* 구간 안에서 어디까지 갔었나 — 같은 응답이 이미 담고 있다. */}
              <TextCaption as="span" color="fgMuted" tabularNumbers>
                최대 이익 {fmtKrw(result.maxProfit)} · 최대 손실 {fmtKrw(result.maxLoss)}
              </TextCaption>
            </VStack>

            {/* 차트 한 쌍 [v1 OWNER, 2026-08-04 — LINKED PAIR]: 종목 차트가
                진입→청산 창을 그리고, 누적 손익이 **픽셀 정렬**로 그 밑에 선다
                (`LinkedCharts` 의 근거). 종목 히스토리가 아직 안 왔으면(옛
                세션 복원 직후 한 프레임) 손익 선 하나로 물러선다 — 빈 자리보다
                낫고, 다음 렌더에 쌍이 선다. */}
            {(() => {
              const firstId = result.positions[0]?.id ?? '';
              const inst = points[firstId];
              const win = inst
                ? inst.filter((p) => p.t >= result.from && p.t <= result.to)
                : [];
              if (win.length > 1) {
                return (
                  <LinkedCharts
                    points={win}
                    unit={firstId.includes('-') ? 'bp' : '%'}
                    result={result}
                    policy={policy}
                    marks={[
                      ...new Set(result.positions.map((p) => p.entry)),
                    ]
                      .map((d) => ({ date: d, label: '진입' }))
                      .concat(
                        result.positions
                          .filter((p) => p.closed || p.matured)
                          .map((p) => ({ date: p.exit, label: '청산' })),
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
                       +300만원 같은 y 라벨이 선 위에 얹혀 있었다 — pane 이 같은
                       값으로 이미 겪고 고친 자리다(그쪽 상수 주석의 실측). */
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

            {/* 포지션별 — 선이 아니라 숫자다. */}
            <VStack gap={0.5} width="100%">
              {result.positions.map((p) => (
                <HStack
                  key={`${p.id}-${p.entry}`}
                  className="sr-bt-row"
                  gap={1.5}
                  alignItems="baseline"
                  flexWrap="wrap"
                >
                  <TextLabel1 as="span" noWrap>
                    {p.id}
                  </TextLabel1>
                  <TextCaption as="span" color="fgMuted" noWrap>
                    {legsSentence(p)}
                  </TextCaption>
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    {p.entry} → {p.exit}
                    {p.matured ? ' (만기)' : p.closed ? ' (청산)' : ''}
                  </TextCaption>
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    {fmtLevel(p.entryValue, p.legs.length === 1 ? '%' : 'bp')} →{' '}
                    {fmtLevel(p.exitValue, p.legs.length === 1 ? '%' : 'bp')}
                  </TextCaption>
                  <TextLabel2
                    as="span"
                    tabularNumbers
                    noWrap
                    className={p.pnl > 0 ? 'sr-up' : p.pnl < 0 ? 'sr-down' : undefined}
                  >
                    {fmtKrw(p.pnl)}
                  </TextLabel2>
                  {/* 기계는 접어 둔다 — 다리별 노셔널과 DV01 은 두 번째 질문의
                      답이고, 첫 번째 답 옆에 두면 둘 다 안 읽힌다. 다리가 하나면
                      접을 것도 없다(노셔널이 곧 그 줄의 규모다). */}
                  {p.legs.length > 1 ? (
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
                            {mag(l.notional ?? 0)} · DV01 {mag(l.dv01 * (l.notional ?? 0) * 1e-4)}
                            /bp · 진입 {fmtLevel(l.entryRate, '%')}%
                          </TextCaption>
                        ))}
                      </VStack>
                    </details>
                  ) : null}
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
export function seedBook(btParam: string | undefined, seedId: string, asOf: string): BookRow[] {
  const fromUrl = decodeBook(btParam);
  if (fromUrl.length) return fromUrl;
  const remembered = loadBacktestMemory(MEMORY_KEY).book;
  if (remembered?.length) return remembered;
  return [newRow(seedId, asOf)];
}

export { encodeBook };
