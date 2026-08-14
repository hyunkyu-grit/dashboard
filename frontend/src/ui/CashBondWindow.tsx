"use client";

/* 현금채권 백테스트 창 — IRS 쪽 `BacktestWindow` 와 **같은 양식** [OWNER,
 * 2026-08-14 — "Rates Swap에서 사용했던 양식과 너무 다르다니까"].
 *
 * 같은 것이 무엇인지 적어 둔다. 떠 있는 창(같은 `useFloatingWindow`·같은
 * 신호등·같은 폭), 포지션 줄이 위에 쌓이고 그 밑에 `+ 포지션 추가`와 `실행`,
 * 그 아래 **차트 한 쌍**(종목 차트 + 픽셀 정렬된 누적 손익), 그 아래 헤드라인
 * 금액 · 포지션 표 · 손익 구성 표. 순서도 컴포넌트도 그쪽 것을 그대로 쓴다 —
 * 두 백테스트가 같은 질문에 다른 그림을 주면 안 된다.
 *
 * 다른 것은 둘뿐이고, 둘 다 상품이 달라서다:
 *
 *   **방향이 없다** [OWNER, 2026-08-14 — "국고채는 매도는 없는거고"].
 *   현금채권은 사는 것이지 파는 것이 아니다. 공매도를 하려면 채권을 빌려야
 *   하고 그 대차료는 이 화면이 아는 값이 아니다. 그래서 고를 것 자체를 두지
 *   않는다 — 고를 수 없는 것을 회색으로 두는 것보다 없는 편이 정직하다.
 *
 *   **손익 칸이 하나 더 있다**: 조달. 원금을 빌려서 사므로 그 이자를 빼야
 *   실제로 번 돈이다. 값은 Setting 탭이 정한다.
 *
 * 개시(거래일→발효일 한 밤)는 두 창 모두 **평가에 접혀 있다** [OWNER,
 * 2026-08-14]. 엔진은 그 밤을 여전히 따로 세어 롤다운에서 빼 두고, 표시만
 * 합친다 — `ui/krw.ts` 에 근거가 있다.
 *
 * §16 그대로 — 표시 정밀도의 만원 반올림(`splitCashBondKrw`) 말고는 여기서
 * 아무 산술도 하지 않는다.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";

import {
  BacktestUnavailable,
  fetchCashBondBacktest,
  fetchCashBondSeries,
  type CashBondPositionInput,
  type CashBondRow,
  type CashBondSeries,
  type BacktestRecon,
  type HistoryPoint,
  type PolicyStep,
} from "@/lib/api";
import { fmtLevel } from "@/lib/format";
import { useFundingStore } from "@/state/funding";

import { LinkedPnlChart } from "./BacktestPnlCharts";
import { ErrorBoundary } from "./ErrorBoundary";
import { SIM_WINDOW_W } from "./floatingWindow";
import { Field, INPUT, POPUP } from "./formKit";
import { fmtKrw, fmtKrwFromMan, splitCashBondKrw } from "./krw";
import { Z_WINDOW } from "./layers";
import {
  CASHBOND_SUMMARY,
  ReconStack,
  type ReconStackDay,
} from "./ReconStack";
import { WindowDrawer } from "./WindowDrawer";
import { ARRIVE, ENTER, instant, STAGGER_STEP } from "./motion";
import { type ChartMark, PreviewChart } from "./PreviewChart";
import { useFloatingWindow } from "./useFloatingWindow";
import { WindowControls } from "./WindowControls";

/** 백엔드 `app/cashbond.py:MAX_POSITIONS` 와 같은 수. */
const MAX_POSITIONS = 12;

/** 일별 대사 — IRS 창과 **같은 컴포넌트**(ui/ReconStack), 조달 열이 하나 더
 * 있다 [OWNER, 2026-08-14]. 열 목록은 그쪽이 내보내는 `CASHBOND_SUMMARY` 다. */
function CashBondReconStack({ recon }: { recon: BacktestRecon }) {
  const days: ReconStackDay[] = recon.rows.map((r) => ({
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
  return (
    <ReconStack
      days={days}
      tenors={recon.tenors}
      defaultOrder="desc"
      heightClass="max-h-[30vh]"
      summaryCols={CASHBOND_SUMMARY}
      note={
        recon.truncated ? "창이 길어 마지막 250 영업일만 보여요." : undefined
      }
    />
  );
}

const CHART_W = SIM_WINDOW_W - 48;
const EOK = 1e8;

/** 진입일 기본값 = 1년 전. 채권은 캐리가 쌓여야 읽히는 화면이라 며칠짜리
 * 기본값은 늘 "거의 0" 을 보여 준다. */
function yearBefore(asOf: string, floorDate: string): string {
  const d = new Date(asOf);
  d.setFullYear(d.getFullYear() - 1);
  const iso = d.toISOString().slice(0, 10);
  return iso < floorDate ? floorDate : iso;
}

function newRow(id: string, asOf: string, floorDate: string): CashBondPositionInput {
  return { id, direction: 1, eok: 100, entry: yearBefore(asOf, floorDate), exit: "" };
}

/** 그 날짜(또는 그 이후 첫 영업일)의 값. 서버의 진입일 스냅과 같은 규칙이다. */
function pointOnOrAfter(points: HistoryPoint[], iso: string): HistoryPoint | null {
  if (!iso) return null;
  for (const p of points) if (p.t >= iso) return p;
  return null;
}

/* ── 포지션 한 줄 ───────────────────────────────────────────────────────── */

function PositionRow({
  value,
  rows,
  types,
  asOf,
  minDate,
  onChange,
  onRemove,
  removable,
}: {
  value: CashBondPositionInput;
  rows: CashBondRow[];
  types: { id: string; label: string }[];
  asOf: string;
  minDate: string;
  onChange: (next: CashBondPositionInput) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const set = (patch: Partial<CashBondPositionInput>) => onChange({ ...value, ...patch });
  const row = rows.find((r) => r.id === value.id);
  const unit = row?.unit ?? "%";

  /* 진입 레벨, 실행 **전에** — IRS 창과 같은 규약 [OWNER feedback, 2026-08-04].
   * 날짜를 치는 동안 그 날 민평이 얼마였는지가 바로 보여야, "그래서 어디서
   * 들어가는 건데" 를 서버 왕복 없이 알 수 있다. 시계열은 차트와 **같은 캐시**
   * 를 쓴다(같은 queryKey) — 한 종목에 한 번만 받는다. */
  const series = useQuery<CashBondSeries>({
    queryKey: ["cashbond", "series", value.id],
    queryFn: () => fetchCashBondSeries(value.id),
    enabled: !!value.id,
    retry: 1,
  });
  const entryPoint = pointOnOrAfter(series.data?.points ?? [], value.entry);

  /* **종목과 테너를 따로 고른다** [OWNER, 2026-08-14 — "스왑 백테스트에는
   * 종목이랑 방향으로 되어있는데, Cash Bond에서는 종목, 테너로"]. 여덟
   * 종목군 × 만기 열셋을 한 팝업에 optgroup 으로 넣어 두었더니 고르는 데
   * 두 번 스크롤이 들었다 — 축이 둘인 것을 칸 하나에 접은 탓이다. 스왑 창의
   * 둘째 칸이 방향인 자리에 테너가 온다: 채권은 살 수만 있어 방향 칸이 비고
   * (모듈 주석의 [OWNER] 참조), 대신 고를 것이 만기다. */
  const bondTypes = types.filter((t) => rows.some((r) => r.bondType === t.id));
  const tenors = rows.filter((r) => r.bondType === (row?.bondType ?? ""));

  /** 종목군을 바꿀 때 만기를 되도록 지킨다. 못 지키면 **가장 긴 것**으로
   * 떨어진다 — 통안채는 3년까지고 자산스왑은 양쪽에 있는 만기에만 서므로,
   * 없는 조합을 고르면 칸이 비는 대신 그 종목군이 실제로 갖는 끝으로 간다. */
  const switchType = (bondType: string) => {
    const same = rows.filter((r) => r.bondType === bondType);
    const keep = same.find((r) => r.tenor === row?.tenor);
    const next = keep ?? same[same.length - 1];
    if (next) set({ id: next.id });
  };

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-edge py-3">
      <Field label="종목">
        <select
          value={row?.bondType ?? ""}
          onChange={(e) => switchType(e.target.value)}
          className={`${POPUP} max-w-[11rem]`}
        >
          {bondTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="테너">
        <select
          value={value.id}
          onChange={(e) => set({ id: e.target.value })}
          className={`${POPUP} max-w-[8rem]`}
        >
          {tenors.map((r) => (
            <option key={r.id} value={r.id}>
              {r.tenor}
            </option>
          ))}
        </select>
      </Field>
      {/* 방향 칸이 여기 없는 것은 실수가 아니다 — 모듈 주석의 [OWNER] 참조. */}
      <Field label="명목">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            value={value.eok}
            onChange={(e) => set({ eok: Math.max(1, Number(e.target.value)) })}
            className={`${INPUT} w-20 text-right`}
          />
          <span className="text-[15px] opacity-55">억</span>
        </div>
      </Field>
      <Field label="진입일">
        <input
          type="date"
          value={value.entry}
          min={minDate}
          max={asOf}
          onChange={(e) => set({ entry: e.target.value })}
          className={INPUT}
        />
      </Field>
      <Field label="진입 레벨">
        {/* 입력이 아니라 판독값 — 이웃과 같은 세로 리듬을 갖게 두어 한 줄이
            왼쪽에서 오른쪽으로 읽히게 한다 (IRS 창과 같은 처리). */}
        <span
          className="flex h-6 items-center text-[14px] font-medium tabular-nums"
          title={entryPoint ? `${entryPoint.t} 종가` : undefined}
        >
          {entryPoint ? (
            <>
              {fmtLevel(entryPoint.v, unit)}
              <span className="ml-0.5 text-[12px] opacity-45">{unit}</span>
            </>
          ) : (
            <span className="opacity-40">—</span>
          )}
        </span>
      </Field>
      <Field label="청산일">
        <input
          type="date"
          value={value.exit}
          min={value.entry}
          max={asOf}
          onChange={(e) => set({ exit: e.target.value })}
          className={INPUT}
        />
      </Field>
      {removable && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="이 포지션 빼기"
          className="flex h-6 w-6 items-center justify-center rounded-control text-[15px] opacity-40 hover:bg-ink-5 hover:opacity-90"
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ── 차트 한 쌍 ─────────────────────────────────────────────────────────── */

function BookContextChart({
  book,
  rows,
  policy,
  result,
  hoverIso,
  onHover,
}: {
  book: CashBondPositionInput[];
  rows: CashBondRow[];
  policy?: PolicyStep;
  result?: Awaited<ReturnType<typeof fetchCashBondBacktest>> | null;
  hoverIso: string | null;
  onHover: (iso: string | null) => void;
}) {
  const id = book[0]?.id ?? "";
  const series = useQuery<CashBondSeries>({
    queryKey: ["cashbond", "series", id],
    queryFn: () => fetchCashBondSeries(id),
    enabled: !!id,
    retry: 1,
  });
  const points = useMemo(() => series.data?.points ?? [], [series.data]);
  const unit = rows.find((r) => r.id === id)?.unit ?? "%";

  /* THE WINDOW — IRS 창의 규칙 그대로. 결과가 있으면 far left 가 진입일이고
   * far right 가 청산일이라 아래 손익선이 이 x축을 점 단위로 공유한다
   * [OWNER 재피드백, 2026-08-04 — "완전히 수직적으로 얼라인"]. 없으면 진입일
   * 앞으로 리드인을 둔다(남은 구간의 1/4, 최소 20영업일). */
  const pts = useMemo(() => {
    if (points.length === 0) return points;
    if (result) {
      let sIdx = points.findIndex((p) => p.t >= result.from);
      if (sIdx < 0) sIdx = 0;
      let eIdx = points.length - 1;
      while (eIdx > sIdx && points[eIdx].t > result.to) eIdx--;
      return points.slice(sIdx, eIdx + 1);
    }
    const first = book.map((b) => b.entry).filter(Boolean).sort()[0];
    if (!first) return points;
    let sIdx = points.findIndex((p) => p.t >= first);
    if (sIdx < 0) sIdx = points.length - 1;
    const lead = Math.max(20, Math.round((points.length - 1 - sIdx) * 0.25));
    return points.slice(Math.max(0, sIdx - lead));
  }, [points, result, book]);

  if (series.isError)
    return (
      <p className="mt-5 text-[13px] opacity-55">
        시계열을 읽지 못했어요. 백엔드가 필요한 화면이에요.
      </p>
    );
  if (pts.length < 2 || !series.data?.stats) return null;

  const marks: ChartMark[] = [];
  const seen = new Set<string>();
  for (const b of book) {
    if (b.entry && !seen.has(`e${b.entry}`)) {
      seen.add(`e${b.entry}`);
      marks.push({ date: b.entry, label: "진입", level: true });
    }
    if (b.exit && !seen.has(`x${b.exit}`)) {
      seen.add(`x${b.exit}`);
      marks.push({ date: b.exit, label: "청산" });
    }
  }

  return (
    <div className="mt-5">
      <PreviewChart
        key={result ? "linked" : "free"}
        points={pts}
        stats={series.data.stats}
        unit={unit}
        width={CHART_W}
        height={200}
        policy={policy}
        marks={marks}
        still={!!result}
        hoverDate={hoverIso}
        onHoverDate={onHover}
      />
      {result && (
        <div className="mt-1">
          <LinkedPnlChart
            pts={pts}
            result={result}
            width={CHART_W}
            height={140}
            hoverIso={hoverIso}
            onHover={onHover}
          />
        </div>
      )}
    </div>
  );
}

/* ── 창 ─────────────────────────────────────────────────────────────────── */

export function CashBondWindow({
  rows,
  types,
  asOf,
  minDate,
  initialId,
  policy,
  onClose,
}: {
  rows: CashBondRow[];
  types: { id: string; label: string }[];
  asOf: string;
  minDate: string;
  initialId: string;
  policy?: PolicyStep;
  onClose: () => void;
}) {
  const basis = useFundingStore((s) => s.basis);
  const spreadBp = useFundingStore((s) => s.spreadBp);
  const reduced = useReducedMotion();
  const { pos, dragHandlers } = useFloatingWindow("cashbond", SIM_WINDOW_W);

  const [book, setBook] = useState<CashBondPositionInput[]>(() => [
    newRow(initialId, asOf, minDate),
  ]);
  const [hoverIso, setHoverIso] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => fetchCashBondBacktest(book, { basis, spreadBp }),
  });
  const ready = book.every((b) => b.id && b.entry && b.eok > 0);

  /* 마지막 답이 **지금 이 북의** 답일 때만 차트에 붙인다 — 종목을 바꿔 놓고
     옛 손익선을 그 위에 얹으면 그럴듯하게 틀린 그림이 된다 (IRS 창과 같은
     게이트). */
  const result =
    run.data && run.data.positions[0]?.id === book[0]?.id ? run.data : null;

  return (
    <motion.div
      className={`fixed ${Z_WINDOW} flex max-h-[88vh] flex-col overflow-hidden rounded-card border border-edge-live bg-popover shadow-window`}
      style={{
        left: 0,
        top: 0,
        x: pos.left,
        y: pos.top,
        width: `min(${SIM_WINDOW_W}px, calc(100vw - 16px))`,
      }}
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={instant(ENTER, reduced === true)}
    >
      <div
        {...dragHandlers}
        className="flex shrink-0 cursor-grab touch-none select-none items-center gap-2 border-b border-edge bg-popover px-5 py-3"
      >
        <WindowControls onClose={onClose} />
        {/* 그냥 "백테스트" 다 [OWNER, 2026-08-14] — 어느 종목군에서 열었는지는
            창이 아니라 그 안의 종목 칸이 말한다. IRS 창과 같은 제목이라야 둘이
            같은 도구로 읽힌다. */}
        <span className="text-[18px] font-bold">백테스트</span>
        <span className="text-[14px] text-ink-2">그때 샀으면 지금 얼마였을까</span>
        <span className="flex-1" />
      </div>

      <div className="min-h-[420px] flex-1 overflow-y-auto p-6 pt-4">
        <ErrorBoundary fallback="현금채권 백테스트 화면을 그리지 못했어요">
          <div className="mt-0">
            {book.map((b, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={instant(
                  { ...ARRIVE, delay: Math.min(i, 8) * STAGGER_STEP },
                  reduced === true,
                )}
              >
                <PositionRow
                  value={b}
                  rows={rows}
                  types={types}
                  asOf={asOf}
                  minDate={minDate}
                  removable={book.length > 1}
                  onChange={(next) =>
                    setBook((prev) => prev.map((p, j) => (j === i ? next : p)))
                  }
                  onRemove={() => setBook((prev) => prev.filter((_, j) => j !== i))}
                />
              </motion.div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setBook((b) => [
                  ...b,
                  newRow(b[b.length - 1]?.id ?? rows[0]?.id ?? "", asOf, minDate),
                ])
              }
              disabled={book.length >= MAX_POSITIONS}
              className="flex h-7 items-center rounded-full border border-edge px-4 text-[14px] font-medium hover:bg-page disabled:opacity-40 disabled:hover:bg-transparent"
            >
              + 포지션 추가
            </button>
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={!ready || run.isPending}
              className={`flex h-7 min-w-[6.75rem] items-center justify-center rounded-full bg-accent px-5 text-center text-[14px] font-medium text-on-accent hover:opacity-90 disabled:opacity-40 ${
                run.isPending ? "motion-safe:animate-pulse" : ""
              }`}
            >
              {run.isPending ? "계산 중…" : "실행"}
            </button>
            <span className="text-[13px] opacity-50">
              청산일 비우면 {asOf}까지예요 · 조달{" "}
              {basis === "base" ? "기준금리" : "콜금리"} {spreadBp >= 0 ? "+" : ""}
              {spreadBp}bp (Setting)
            </span>
          </div>

          <BookContextChart
            book={book}
            rows={rows}
            policy={policy}
            result={result}
            hoverIso={hoverIso}
            onHover={setHoverIso}
          />

          {run.isError && (
            <p className="mt-4 text-[13px] text-down">
              {run.error instanceof BacktestUnavailable
                ? "백엔드가 필요한 화면이에요."
                : run.error instanceof Error
                  ? run.error.message
                  : "실행하지 못했어요."}
            </p>
          )}

          {run.data && (
            <div className="mt-5">
              <p className="text-[13px] opacity-50">
                {run.data.from} → {run.data.to} · 포지션 {run.data.positions.length}개
              </p>
              <p
                className={`mt-1 text-[34px] font-bold tabular-nums ${
                  run.data.pnl >= 0 ? "text-up" : "text-down"
                }`}
              >
                {fmtKrw(run.data.pnl)}
              </p>
              <p className="text-[13px] opacity-50">
                최고 {fmtKrw(run.data.maxProfit)} · 최저 {fmtKrw(run.data.maxLoss)}
              </p>

              <table className="mt-4 w-full text-[14px] tabular-nums">
                <thead className="text-left text-ink-2">
                  <tr>
                    <th className="pb-1 font-normal">종목</th>
                    <th className="pb-1 pr-4 text-right font-normal">명목</th>
                    <th className="pb-1 pr-4 text-right font-normal">표면금리</th>
                    <th className="pb-1 font-normal">기간</th>
                    <th className="pb-1 text-right font-normal">손익</th>
                  </tr>
                </thead>
                <tbody>
                  {run.data.positions.map((p, i) => (
                    <tr key={`${p.id}-${i}`} className="border-t border-edge">
                      <td className="py-1.5 font-semibold">{p.label}</td>
                      <td className="py-1.5 pr-4 text-right">
                        {(p.notional / EOK).toLocaleString(undefined, {
                          maximumFractionDigits: 0,
                        })}
                        억
                      </td>
                      <td className="py-1.5 pr-4 text-right">
                        {p.coupon.toFixed(3)}
                        <span className="ml-0.5 text-[12px] opacity-45">%</span>
                      </td>
                      <td className="py-1.5 text-[13px] opacity-60">
                        {p.entry} → {p.exit}
                        {p.matured ? (
                          <span className="ml-1 opacity-70">(만기)</span>
                        ) : p.closed ? (
                          <span className="ml-1 opacity-70">(청산)</span>
                        ) : null}
                      </td>
                      <td
                        className={`py-1.5 text-right font-semibold ${
                          p.pnl >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {fmtKrw(p.pnl)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 손익 구성 — IRS 창과 같은 표, 조달 열이 하나 더 있다.
                  가로로도 세로로도 더해진다: 각 줄의 캐리가 합계 − 나머지 셋
                  (만원 단위, `splitCashBondKrw`)이고, 합계 줄은 화면에 찍힌
                  값들의 열 합이다.

                  자산스왑의 개시(스왑 다리가 발효되기까지 한 밤)는 **평가에
                  접혀 있다** [OWNER, 2026-08-14] — 총손익 대비 0.005% 라 자기
                  열을 갖지 않는다. 엔진은 여전히 따로 센다. */}
              <table className="mt-5 w-full text-[14px] tabular-nums">
                <thead className="text-left text-ink-2">
                  <tr>
                    <th className="pb-1 font-normal">손익 구성</th>
                    <th className="pb-1 text-right font-normal">평가손익</th>
                    <th className="pb-1 text-right font-normal">캐리손익</th>
                    <th className="pb-1 text-right font-normal">롤다운손익</th>
                    <th className="pb-1 text-right font-normal">조달비용</th>
                    <th className="pb-1 text-right font-normal">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {run.data.positions.map((p, i) => {
                    const u = splitCashBondKrw(
                      p.pnl,
                      p.valuation,
                      p.rolldown,
                      p.funding,
                      p.startup,
                    );
                    return (
                      <tr key={`${p.id}-${i}`} className="border-t border-edge">
                        <td className="py-1.5">{p.label}</td>
                        {[u.uVal, u.uCarry, u.uRoll, u.uFund].map((v, k) => (
                          <td
                            key={k}
                            className={`py-1.5 text-right ${
                              v >= 0 ? "text-up" : "text-down"
                            }`}
                          >
                            {fmtKrwFromMan(v)}
                          </td>
                        ))}
                        <td className="py-1.5 text-right font-semibold">
                          {fmtKrwFromMan(u.uPnl)}
                        </td>
                      </tr>
                    );
                  })}
                  {run.data.positions.length > 1 &&
                    (() => {
                      const us = run.data.positions.map((p) =>
                        splitCashBondKrw(
                          p.pnl,
                          p.valuation,
                          p.rolldown,
                          p.funding,
                          p.startup,
                        ),
                      );
                      const sum = (f: (u: (typeof us)[number]) => number) =>
                        us.reduce((a, u) => a + f(u), 0);
                      return (
                        <tr className="border-t-2 border-t-edge font-semibold">
                          <td className="py-1.5">합계</td>
                          {[
                            (u: (typeof us)[number]) => u.uVal,
                            (u: (typeof us)[number]) => u.uCarry,
                            (u: (typeof us)[number]) => u.uRoll,
                            (u: (typeof us)[number]) => u.uFund,
                            (u: (typeof us)[number]) => u.uPnl,
                          ].map((f, k) => (
                            <td key={k} className="py-1.5 text-right">
                              {fmtKrwFromMan(sum(f))}
                            </td>
                          ))}
                        </tr>
                      );
                    })()}
                </tbody>
              </table>
              <p className="mt-1.5 text-[13px] opacity-50">
                평가손익 = 민평이 움직인 몫, 캐리손익 = 받은 이표와 쌓인 경과이자,
                롤다운손익 = 커브가 멈춰도 잔존만기가 줄며 생기는 몫, 조달비용 =
                초기 투자금액을 빌린 값이에요. 넷의 합이 손익이에요. 조달은{" "}
                {run.data.funding.label} 이고 Setting 에서 바꿔요.
              </p>
            </div>
          )}
        </ErrorBoundary>
      </div>

      {/* 일별 대사 — IRS 창과 같은 자리(창 바닥 서랍)·같은 문법. 결과가 있을
          때만 선다: 대사는 그 실행의 하루하루라 실행 전에는 보여줄 것이 없다. */}
      {run.data && (
        <WindowDrawer
          tabs={[
            {
              id: "recon",
              label: "일별 대사",
              content: run.data.recon ? (
                <CashBondReconStack recon={run.data.recon} />
              ) : null,
              unavailable: "이 실행에는 일별 대사가 없어요 — 다시 실행하면 나와요",
            },
          ]}
        />
      )}
    </motion.div>
  );
}
