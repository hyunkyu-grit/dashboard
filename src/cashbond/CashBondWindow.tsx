'use client';

/* 현금채권 백테스트 창 — IRS 쪽 `BacktestWindow` 와 **같은 양식** [v1 OWNER,
 * 2026-08-14 — "Rates Swap에서 사용했던 양식과 너무 다르다니까"].
 *
 * 같은 것: 떠 있는 창(`FloatingWindow`), 북 줄이 위에 쌓이고 그 밑에 줄 추가와
 * 실행, 헤드라인 = 북 합계, 손익 선 하나, 포지션별은 숫자, 서랍의 일별 대사.
 *
 * 다른 것은 상품이 달라서다(`cashbond/book.ts` 의 주석): **방향 칸이 없다**
 * (매수만), 종목·테너를 **따로** 고른다 [OWNER — "Cash Bond에서는 종목, 테너로"],
 * 분해에 **조달** 칸이 하나 더 있고 그 값은 Setting 이 정한다.
 *
 * 개시(자산스왑의 스왑 다리가 싣고 오는 한 밤)는 **평가에 접는다**
 * [OWNER, 2026-08-14] — `splitCashBondKrw` 가 그 자리다. 서버는 따로 보낸다.
 *
 * §16 그대로 — 표시 정밀도의 만원 반올림 말고는 여기서 아무 산술도 하지 않는다.
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
  TextLegal,
} from '@coinbase/cds-web/typography';
import { CartesianChart, Line, XAxis, YAxis } from '@coinbase/cds-web/visualizations/chart';

import {
  BacktestUnavailable,
  fetchCashBondBacktest,
  fetchCashBondSeries,
  runErrorMessage,
  type BacktestRecon,
  type CashBondBacktest,
  type CashBondRow,
  type PolicyStep,
} from '@/lib/api';
import { fmtLevel, unitSuffix } from '@/lib/format';
import { fmtKrw, fmtKrwFromMan, splitCashBondKrw } from '@/lib/krw';
import { pointOnOrAfter } from '@/backtest/BacktestWindow';
import { loadBacktestMemory, saveBacktestMemory } from '@/backtest/book';
import { useFunding } from '@/state/funding';
import { FloatingWindow } from '@/ui/window/FloatingWindow';
import { DROPDOWN_STYLES } from '@/ui/window/popup';
import { ReconStack, type ReconStackDay } from '@/ui/window/ReconStack';

import { LinkedCharts } from '@/backtest/LinkedCharts';
import {
  decodeCashBondBook,
  MAX_POSITIONS,
  newCashBondRow,
  runnableCashBond,
  type CashBondBookRow,
} from './book';

const MEMORY_KEY = 'cashbond';
const AXIS = 'pnl';
const EOK = 1e8;

/* 종목별 히스토리 — 진입 레벨을 실행 **전에** 보여주기 위한 것. IRS 창의
 * `loadSeriesPoints` 와 같은 캐시 수법이고, 경로만 cashbond 다. */
const seriesCache = new Map<string, Promise<{ t: string; v: number }[] | null>>();
function loadCashBondPoints(id: string): Promise<{ t: string; v: number }[] | null> {
  let hit = seriesCache.get(id);
  if (!hit) {
    hit = fetchCashBondSeries(id)
      .then((s) => s.points)
      .catch(() => null);
    seriesCache.set(id, hit);
  }
  return hit;
}

/** 서버 recon → 대사 스택. `funding` 필드가 실리므로 조달 열이 선다
 * (`ReconStack` 의 hasFunding). 여기서 계산하는 것은 없다 — 이름만 바꿔 넘긴다. */
function cashbondDays(recon: BacktestRecon): ReconStackDay[] {
  return recon.rows.map((r) => ({
    date: r.t,
    title: r.carryover ? `${r.t} · 다음 영업일로 들고 가는 이월 리스크` : r.t,
    krd: r.krd,
    dbp: r.dbp,
    est: r.est,
    estTotal: r.estTotal,
    valuation: r.valuation,
    carry: r.carry,
    rolldown: r.rolldown,
    funding: r.funding ?? null,
    actual: r.actual,
  }));
}

/**
 * 북 전체의 4분해 — **표시 정밀도에서 합계와 맞도록** (`splitCashBondKrw`).
 * 서버가 포지션마다 낸 평가·롤다운·조달·개시를 더하고, 캐리는 잔차로 낸다.
 */
function decompose(result: CashBondBacktest) {
  let valuation = 0;
  let rolldown = 0;
  let funding = 0;
  let startup = 0;
  for (const p of result.positions) {
    valuation += p.valuation;
    rolldown += p.rolldown;
    funding += p.funding;
    startup += p.startup;
  }
  return splitCashBondKrw(result.pnl, valuation, rolldown, funding, startup);
}

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

export function CashBondWindow({
  rows,
  types,
  asOf,
  minDate,
  book,
  setBook,
  onClose,
  policy,
}: {
  /** 이 탭(현금채권 또는 자산스왑)의 행 전부 — 종목·테너 목록의 출처다. */
  rows: CashBondRow[];
  types: { id: string; label: string }[];
  asOf: string;
  /** 데이터 시작일 — 진입일의 바닥이자 기본값(1년 전)의 바닥. */
  minDate: string;
  book: CashBondBookRow[];
  setBook: (next: CashBondBookRow[]) => void;
  onClose: () => void;
  /** 기준금리 스텝 — 차트 기준선(`LinkedCharts`). IRS 창과 같은 배선. */
  policy?: PolicyStep;
}) {
  /* 조달은 Setting 이 정한 값을 그대로 싣는다 [OWNER — "Cash Bond 전용"]. */
  const [funding] = useFunding();

  const [result, setResult] = useState<CashBondBacktest | undefined>(
    () => loadBacktestMemory(MEMORY_KEY).result as CashBondBacktest | undefined,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string>();
  const [unavailable, setUnavailable] = useState(false);
  const [points, setPoints] = useState<Record<string, { t: string; v: number }[]>>({});

  useEffect(() => {
    let live = true;
    for (const id of new Set(book.map((r) => r.id).filter(Boolean))) {
      if (points[id]) continue;
      void loadCashBondPoints(id).then((p) => {
        if (live && p) setPoints((prev) => (prev[id] ? prev : { ...prev, [id]: p }));
      });
    }
    return () => {
      live = false;
    };
  }, [book, points]);

  useEffect(() => {
    saveBacktestMemory(MEMORY_KEY, { book });
  }, [book]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const bondTypes = useMemo(
    () => types.filter((t) => rows.some((r) => r.bondType === t.id)),
    [types, rows],
  );

  const run = useCallback(async () => {
    const rs = runnableCashBond(book);
    if (rs.length === 0) return;
    setRunning(true);
    setError(undefined);
    setUnavailable(false);
    try {
      const r = await fetchCashBondBacktest(rs, funding);
      setResult(r);
      saveBacktestMemory(MEMORY_KEY, { result: r });
    } catch (e) {
      if (e instanceof BacktestUnavailable) setUnavailable(true);
      else setError(runErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [book, funding]);

  const patch = (key: string, next: Partial<CashBondBookRow>) =>
    setBook(book.map((r) => (r.key === key ? { ...r, ...next } : r)));

  /** 종목군을 바꿀 때 만기를 되도록 지킨다. 못 지키면 **가장 긴 것**으로
   * 떨어진다 — 통안채는 3년까지고 자산스왑은 양쪽에 있는 만기에만 서므로,
   * 없는 조합을 고르면 칸이 비는 대신 그 종목군이 실제로 갖는 끝으로 간다. */
  const switchType = (key: string, bondType: string) => {
    const cur = byId.get(book.find((r) => r.key === key)?.id ?? '');
    const same = rows.filter((r) => r.bondType === bondType);
    const keep = same.find((r) => r.tenor === cur?.tenor);
    const next = keep ?? same[same.length - 1];
    if (next) patch(key, { id: next.id });
  };

  const parts = result ? decompose(result) : null;

  return (
    <FloatingWindow
      windowKey="cashbond"
      title="백테스트"
      aside={
        <TextCaption as="span" color="fgMuted" noWrap>
          {asOf} 민평까지
        </TextCaption>
      }
      onClose={onClose}
      drawer={[
        {
          id: 'recon',
          label: '일별 대사',
          content: result?.recon ? (
            <ReconStack
              days={cashbondDays(result.recon)}
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
            : '실행하면 하루씩 대사가 서요 — 시작 KRD, 그날 Δbp, 그 곱(추정), 그리고 실제 손익의 평가/롤다운/캐리/조달 분해예요.',
        },
      ]}
    >
      <VStack gap={2} padding={2} width="100%">
        {/* ── 북 ───────────────────────────────────────────────────────────── */}
        <VStack gap={1} width="100%">
          {book.map((r) => {
            const row = byId.get(r.id);
            const tenors = rows.filter((x) => x.bondType === (row?.bondType ?? ''));
            const unit = row?.unit ?? '%';
            return (
              <HStack key={r.key} gap={1.5} alignItems="flex-end" flexWrap="wrap">
                <Box width={148}>
                  <Field label="종목">
                    {/* font legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거). */}
                    <Select
                      size="s"
                      font="legal"
                      styles={DROPDOWN_STYLES}
                      accessibilityLabel="종목"
                      value={row?.bondType ?? ''}
                      onChange={(v) => v && switchType(r.key, v)}
                      options={bondTypes.map((t) => ({ value: t.id, label: t.label }))}
                    />
                  </Field>
                </Box>
                <Box width={92}>
                  <Field label="테너">
                    <Select
                      size="s"
                      font="legal"
                      styles={DROPDOWN_STYLES}
                      accessibilityLabel="테너"
                      value={r.id}
                      onChange={(v) => v && patch(r.key, { id: v })}
                      options={tenors.map((x) => ({ value: x.id, label: x.tenor }))}
                    />
                  </Field>
                </Box>
                {/* 방향 칸이 여기 없는 것은 실수가 아니다 — 매수만 있다
                    (`cashbond/book.ts` 의 [OWNER]). */}
                <Box width={88}>
                  <Field label="규모 (억)">
                    {/* fontSize legal(13) — 컨트롤 값 13px 통일(popup.ts 의 근거). */}
                    <TextInput
                      size="s"
                      fontSize="legal"
                      accessibilityLabel="규모(억)"
                      value={String(r.eok)}
                      onChange={(e) => patch(r.key, { eok: Number(e.target.value) || 0 })}
                    />
                  </Field>
                </Box>
                <Box width={128}>
                  <Field label="진입일">
                    <input
                      className="sr-date"
                      type="date"
                      value={r.entry}
                      min={minDate}
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
                      min={r.entry}
                      max={asOf}
                      onChange={(e) => patch(r.key, { exit: e.target.value })}
                      aria-label="청산일 (비우면 데이터 끝까지)"
                    />
                  </Field>
                </Box>
                {/* 진입 레벨 — 실행 전에도 (IRS 창과 같은 규약·같은 스냅 규칙). */}
                <Box width={96}>
                  <Field label="진입 레벨">
                    <TextLabel2 as="span" tabularNumbers noWrap>
                      {(() => {
                        const p = pointOnOrAfter(points[r.id], r.entry);
                        if (!p) return '—';
                        return `${fmtLevel(p.v, unit)}${unitSuffix(unit)}`;
                      })()}
                    </TextLabel2>
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
            );
          })}

          <HStack gap={1} alignItems="center" flexWrap="wrap">
            <Button
              variant="secondary"
              size="s"
              disabled={book.length >= MAX_POSITIONS}
              onClick={() =>
                setBook([
                  ...book,
                  newCashBondRow(book.at(-1)?.id ?? rows[0]?.id ?? '', asOf, minDate),
                ])
              }
            >
              줄 추가
            </Button>
            <Button
              size="s"
              onClick={() => void run()}
              disabled={running || runnableCashBond(book).length === 0}
            >
              {running ? '계산 중…' : '실행'}
            </Button>
            {/* TextCaption 은 uppercase 라 "+10bp (Setting)" 이 "+10BP (SETTING)"
                이 된다(v1 실측 함정 그대로 재확인, 2026-08-18). 문장·단위는
                TextLegal 이 진다. */}
            <TextLegal as="span" color="fgMuted">
              청산일 비우면 {asOf}까지예요 · 조달{' '}
              {funding.basis === 'base' ? '기준금리' : '콜금리'}{' '}
              {funding.spreadBp >= 0 ? '+' : ''}
              {funding.spreadBp}bp (Setting)
            </TextLegal>
          </HStack>
        </VStack>

        {/* ── 답 ───────────────────────────────────────────────────────────── */}
        {unavailable ? (
          <TextBody as="p" color="fgMuted">
            현금채권 백테스트는 실행 중인 백엔드가 필요해요. 민평이 SQL 에만 있어서
            미리 구워둘 수가 없어요.
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
              {/* 4분해 [OWNER, 2026-08-14]. 항등식이다: 평가 + 캐리 + 롤다운 +
                  조달 = 총손익, 표시 정밀도에서 정확히 (`splitCashBondKrw`). */}
              <HStack gap={1} flexWrap="wrap">
                <Part label="평가" u={parts.uVal} />
                <Part label="캐리" u={parts.uCarry} />
                <Part label="롤다운" u={parts.uRoll} />
                <Part label="조달" u={parts.uFund} />
              </HStack>
              {/* 조달 라벨에 "bp" 가 든다 — TextLegal (uppercase 함정) */}
              <TextLegal as="span" color="fgMuted" tabularNumbers>
                최대 이익 {fmtKrw(result.maxProfit)} · 최대 손실 {fmtKrw(result.maxLoss)} ·
                조달 {result.funding.label}
              </TextLegal>
            </VStack>

            {/* 차트 한 쌍 — IRS 창과 같은 `LinkedCharts`. 종목 차트는 북 첫
                줄의 민평(또는 자산스왑 스프레드) 시계열이고, 누적 손익이 픽셀
                정렬로 밑에 선다. 히스토리가 아직 안 왔으면 손익 선으로 물러선다. */}
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
                    unit={byId.get(firstId)?.unit ?? '%'}
                    result={result}
                    policy={policy}
                    marks={[...new Set(result.positions.map((p) => p.entry))]
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
                    inset={{ top: 12, right: 12, bottom: 8, left: 8 }}
                    series={[
                      {
                        id: 'pnl',
                        data: result.points.map((p) => p.pnl),
                        color: result.pnl >= 0 ? 'var(--sr-up)' : 'var(--sr-down)',
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

            {/* 포지션별 — 선이 아니라 숫자다 (IRS 창과 같은 판단). */}
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
                    {p.label}
                  </TextLabel1>
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    {(p.notional / EOK).toLocaleString(undefined, { maximumFractionDigits: 0 })}억
                  </TextCaption>
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    표면 {fmtLevel(p.coupon, '%')}%
                  </TextCaption>
                  <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                    {p.entry} → {p.exit}
                    {p.matured ? ' (만기)' : p.closed ? ' (청산)' : ''}
                  </TextCaption>
                  {p.kind === 'ASW' && p.aswSpread != null ? (
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
                  {/* 줄의 4분해 — 가로로 반드시 더해진다 (`splitCashBondKrw`). */}
                  {(() => {
                    const u = splitCashBondKrw(p.pnl, p.valuation, p.rolldown, p.funding, p.startup);
                    return (
                      <details className="sr-bt-legs">
                        <summary>
                          <TextCaption as="span" color="fgMuted">
                            자세히
                          </TextCaption>
                        </summary>
                        <VStack gap={0.25} paddingY={0.5}>
                          <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                            평가 {fmtKrwFromMan(u.uVal)} · 캐리 {fmtKrwFromMan(u.uCarry)} · 롤다운{' '}
                            {fmtKrwFromMan(u.uRoll)} · 조달 {fmtKrwFromMan(u.uFund)}
                          </TextCaption>
                          {p.kind === 'ASW' && p.swapPnl != null ? (
                            <TextCaption as="span" color="fgMuted" tabularNumbers noWrap>
                              스왑 다리 {fmtKrw(p.swapPnl)} · 진입금리{' '}
                              {p.swapEntryRate != null ? `${fmtLevel(p.swapEntryRate, '%')}%` : '—'}
                            </TextCaption>
                          ) : null}
                        </VStack>
                      </details>
                    );
                  })()}
                </HStack>
              ))}
            </VStack>

            <TextLegal as="span" color="fgMuted">
              평가는 민평이 움직인 몫, 캐리는 받은 이표와 쌓인 경과이자, 롤다운은
              커브가 멈춰도 잔존만기가 줄며 생기는 몫, 조달은 초기 투자금액을 빌린
              값이에요. 넷의 합이 손익이에요. 조달은 Setting 에서 바꿔요.
            </TextLegal>
          </VStack>
        ) : (
          <TextBody as="p" color="fgMuted">
            줄을 채우고 실행을 누르면 그날 민평 par 로 발행한 채권을 오늘까지 매일
            재평가해요.
          </TextBody>
        )}
      </VStack>
    </FloatingWindow>
  );
}

/** 창을 열 때 씨앗이 되는 북 — URL 의 `cb` 가 있으면 그것, 없으면 세션 기억,
 * 그것도 없으면 지금 보고 있는 종목 한 줄 (IRS `seedBook` 과 같은 순서). */
export function seedCashBondBook(
  cbParam: string | undefined,
  seedId: string,
  asOf: string,
  minDate: string,
): CashBondBookRow[] {
  const fromUrl = decodeCashBondBook(cbParam);
  if (fromUrl.length) return fromUrl;
  const remembered = loadBacktestMemory(MEMORY_KEY).book as CashBondBookRow[] | undefined;
  if (remembered?.length) return remembered;
  return [newCashBondRow(seedId, asOf, minDate)];
}
