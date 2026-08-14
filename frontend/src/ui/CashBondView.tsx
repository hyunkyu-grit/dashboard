"use client";

/* Cash Bond — Backtest 섹션의 여섯 번째 종목군 [OWNER, 2026-08-14].
 *
 * 왼쪽이 표, 오른쪽이 백테스트다. IRS 쪽의 "행 → 차트 → 백테스트" 를 한 화면에
 * 접어 놓은 것인데, 창을 띄우지 않고 옆에 붙인 이유는 이 표가 종목군 여덟 ×
 * 만기 열셋이라 **무엇을 고르고 있는지가 계속 보여야** 하기 때문이다.
 *
 * §16 은 그대로다. 수준·변화·백분위·52주 범위·손익 다섯 칸을 전부 서버가 내고
 * (`backend/app/cashbond.py`), 여기서 하는 산술은 표시 정밀도의 만원 반올림
 * 하나뿐이다(`krw.ts:splitCashBondKrw`).
 *
 * 이 화면은 **전부 라이브**다. 민평이 SQL 에만 있어 정적 쌍둥이를 구울 수
 * 없다 — 백엔드가 없으면 표부터 안 뜨고, 그렇게 말한다.
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  BacktestUnavailable,
  fetchCashBondBacktest,
  fetchCashBondInstruments,
  type CashBondBacktest,
  type CashBondKind,
  type CashBondRow,
} from "@/lib/api";
import { fmtLevel } from "@/lib/format";
import { useFundingStore } from "@/state/funding";

import { ErrorState, LoadingState } from "./DataState";
import { Field, INPUT } from "./formKit";
import { GroupBox, GroupBoxGap, GroupBoxNote, GroupBoxTitle } from "./GroupBox";
import { fmtKrw, fmtKrwFromMan, splitCashBondKrw } from "./krw";
import { PAGE_X } from "./pageGutter";

/** 표의 두 갈래. 한 화면에 섞으면 %와 bp 가 같은 열에 서서 읽을 수 없다. */
const KINDS: { id: CashBondKind; label: string; note: string }[] = [
  { id: "CB", label: "현금채권", note: "민평 수익률" },
  { id: "ASW", label: "자산스왑", note: "민평 − IRS, 같은 만기" },
];

function dirClass(v: number | null | undefined): string {
  if (v === null || v === undefined || v === 0) return "text-ink-3";
  return v > 0 ? "text-up" : "text-down";
}

function fmtBp(v: number | null): string {
  if (v === null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(2)}`;
}

/* ── 표 ─────────────────────────────────────────────────────────────────── */

function Table({
  rows,
  selectedId,
  onPick,
}: {
  rows: CashBondRow[];
  selectedId: string | null;
  onPick: (r: CashBondRow) => void;
}) {
  return (
    <table className="w-full text-[13px] tabular-nums">
      <thead className="sticky top-0 z-10 bg-tile text-left text-ink-2">
        <tr className="border-b border-edge">
          <th className="pb-2 pl-3 font-normal">종목</th>
          <th className="pb-2 pr-3 text-right font-normal">현재</th>
          <th className="pb-2 pr-3 text-right font-normal">어제</th>
          <th className="pb-2 pr-3 text-right font-normal">MTD</th>
          <th className="pb-2 pr-3 text-right font-normal">YTD</th>
          <th className="pb-2 pr-3 text-right font-normal">52주 저</th>
          <th className="pb-2 pr-3 text-right font-normal">52주 고</th>
          <th className="pb-2 pr-3 text-right font-normal">백분위</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const unit = r.unit === "pct" ? "%" : "bp";
          const on = r.id === selectedId;
          return (
            <tr
              key={r.id}
              onClick={() => onPick(r)}
              className={`cursor-pointer border-b border-edge transition-colors ${
                on ? "bg-ink-5" : "hover:bg-ink-5"
              }`}
            >
              <td className="relative py-1.5 pl-3 font-semibold">
                {on && (
                  <span className="absolute left-1 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
                )}
                {r.label}
              </td>
              <td className="py-1.5 pr-3 text-right font-semibold">
                {fmtLevel(r.now, unit)}
              </td>
              {(["d1", "mtd", "ytd"] as const).map((b) => (
                <td key={b} className={`py-1.5 pr-3 text-right ${dirClass(r.changes[b])}`}>
                  {fmtBp(r.changes[b])}
                </td>
              ))}
              <td className="py-1.5 pr-3 text-right opacity-60">
                {fmtLevel(r.rangeLow, unit)}
              </td>
              <td className="py-1.5 pr-3 text-right opacity-60">
                {fmtLevel(r.rangeHigh, unit)}
              </td>
              <td className="py-1.5 pr-3 text-right opacity-60">
                {r.pct === null ? "—" : `${r.pct.toFixed(0)}%`}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ── 백테스트 ───────────────────────────────────────────────────────────── */

/** 손익 구성 — **세로**다.
 *
 * IRS 쪽(BacktestWindow)은 북에 여러 포지션이 서므로 가로 표가 맞다: 행이
 * 포지션이고 열이 칸이라 세로로도 더해진다. 여기는 고른 종목 하나뿐이라 가로로
 * 눕히면 34rem 안에 일곱 열이 들어가야 하고, 실제로 넣어 보니 억·만원 표기가
 * 서로 붙어 읽히지 않았다. 한 줄에 한 칸이면 금액이 오른쪽에 정렬돼 합계까지
 * 눈으로 더해진다.
 *
 * 가산성은 그대로다 — `splitCashBondKrw` 가 만원 단위로 갈라 놓고 캐리가 잔차를
 * 진다(krw.ts). 개시가 정확히 0 인 줄은 **빼고 그린다**: 현금채권 단독은 항상
 * 그렇고(진입일에 발행돼 셀 밤이 없다), 0 만 적힌 줄은 자리만 차지한다. 빼도
 * 나머지 넷이 여전히 합계로 닫힌다. */
function Breakdown({ result }: { result: CashBondBacktest }) {
  const p = result.positions[0];
  const u = splitCashBondKrw(p.pnl, p.valuation, p.rolldown, p.funding, p.startup);
  const lines: { label: string; units: number; note?: string }[] = [
    { label: "평가", units: u.uVal, note: "민평이 움직인 몫" },
    { label: "캐리", units: u.uCarry, note: "받은 이표와 쌓인 경과이자" },
    { label: "롤다운", units: u.uRoll, note: "잔존만기가 줄며 생기는 몫" },
    { label: "조달", units: u.uFund, note: result.funding.label },
  ];
  if (u.uStart !== 0) {
    lines.push({ label: "개시", units: u.uStart, note: "스왑 다리가 발효되기까지 하룻밤" });
  }
  return (
    <dl className="text-[14px] tabular-nums">
      {lines.map((l) => (
        <div
          key={l.label}
          className="flex items-baseline gap-3 border-b border-edge py-1.5"
        >
          <dt className="w-14 shrink-0 opacity-60">{l.label}</dt>
          <dd
            className={`w-36 shrink-0 text-right font-medium ${
              l.units >= 0 ? "text-up" : "text-down"
            }`}
          >
            {fmtKrwFromMan(l.units)}
          </dd>
          {l.note && (
            <dd className="min-w-0 truncate text-[13px] opacity-40">{l.note}</dd>
          )}
        </div>
      ))}
      <div className="flex items-baseline gap-3 pt-2">
        <dt className="w-14 shrink-0 font-semibold">합계</dt>
        <dd
          className={`w-36 shrink-0 text-right text-[16px] font-semibold ${
            u.uPnl >= 0 ? "text-up" : "text-down"
          }`}
        >
          {fmtKrwFromMan(u.uPnl)}
        </dd>
      </div>
    </dl>
  );
}

interface Draft {
  direction: number;
  eok: number;
  entry: string;
  exit: string;
}

function BacktestPanel({
  row,
  asOf,
  minDate,
}: {
  row: CashBondRow;
  asOf: string;
  minDate: string;
}) {
  const basis = useFundingStore((s) => s.basis);
  const spreadBp = useFundingStore((s) => s.spreadBp);

  /** 기본 진입일 = 1년 전. 채권 백테스트는 캐리가 쌓여야 읽히는 화면이라
   * 며칠짜리 기본값은 늘 "거의 0" 을 보여 준다. */
  const defaultEntry = useMemo(() => {
    const d = new Date(asOf);
    d.setFullYear(d.getFullYear() - 1);
    const iso = d.toISOString().slice(0, 10);
    return iso < minDate ? minDate : iso;
  }, [asOf, minDate]);

  const [draft, setDraft] = useState<Draft>({
    direction: 1,
    eok: 100,
    entry: defaultEntry,
    exit: "",
  });

  // 종목을 바꾸면 결과는 그 종목의 것이 아니게 된다 — 초안은 남기고 결과만 비운다
  const run = useMutation({
    mutationFn: () =>
      fetchCashBondBacktest(
        [
          {
            id: row.id,
            direction: draft.direction,
            eok: draft.eok,
            entry: draft.entry,
            exit: draft.exit,
          },
        ],
        { basis, spreadBp },
      ),
  });
  useEffect(() => {
    run.reset();
    // row.id 가 바뀔 때만 — run 은 매 렌더 새 객체다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id]);

  const result = run.data;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-end gap-4">
        <Field label="방향">
          <div className="flex gap-1">
            {[
              { v: 1, label: "매수" },
              { v: -1, label: "매도" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                aria-pressed={draft.direction === o.v}
                onClick={() => setDraft((d) => ({ ...d, direction: o.v }))}
                className={`h-6 rounded-control px-3 text-[14px] font-medium transition-colors ${
                  draft.direction === o.v
                    ? "bg-accent text-on-accent"
                    : "bg-tile text-ink hover:bg-ink-5"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="명목">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={draft.eok}
              onChange={(e) =>
                setDraft((d) => ({ ...d, eok: Math.max(1, Number(e.target.value)) }))
              }
              className={`${INPUT} w-20 text-right`}
            />
            <span className="text-[15px] opacity-55">억</span>
          </div>
        </Field>
        <Field label="진입일">
          <input
            type="date"
            value={draft.entry}
            min={minDate}
            max={asOf}
            onChange={(e) => setDraft((d) => ({ ...d, entry: e.target.value }))}
            className={INPUT}
          />
        </Field>
        <Field label="청산일">
          <input
            type="date"
            value={draft.exit}
            min={draft.entry}
            max={asOf}
            onChange={(e) => setDraft((d) => ({ ...d, exit: e.target.value }))}
            className={INPUT}
          />
        </Field>
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="h-6 rounded-control bg-accent px-4 text-[14px] font-semibold text-on-accent transition-opacity disabled:opacity-50"
        >
          {run.isPending ? "재평가 중…" : "실행"}
        </button>
      </div>

      <p className="text-[13px] opacity-45">
        청산일을 비우면 마지막 영업일까지 들고 있어요. 조달은{" "}
        {basis === "base" ? "기준금리" : "콜금리"} {spreadBp >= 0 ? "+" : ""}
        {spreadBp}bp 예요 — Setting 에서 바꿔요.
      </p>

      {run.isError && (
        <p className="text-[13px] text-down">
          {run.error instanceof BacktestUnavailable
            ? "백엔드가 필요한 화면이에요."
            : run.error instanceof Error
              ? run.error.message
              : "실행하지 못했어요."}
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-3">
          {/* 기간과 극단만. 합계는 구성표의 맨 아랫줄이 이미 크게 적는다 —
              같은 숫자를 두 자리에 크게 두면 어느 쪽이 기준인지가 흐려진다. */}
          <p className="text-[13px] opacity-50">
            {result.from} → {result.to} · 최대이익 {fmtKrw(result.maxProfit)} · 최대손실{" "}
            {fmtKrw(result.maxLoss)}
          </p>

          <Breakdown result={result} />

          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-[13px]">
            <dt className="opacity-50">표면금리</dt>
            <dd className="tabular-nums">
              {result.positions[0].coupon.toFixed(3)}%
              <span className="ml-1.5 opacity-50">진입일 민평 그대로예요</span>
            </dd>
            {result.positions[0].aswSpread !== undefined && (
              <>
                <dt className="opacity-50">진입 스프레드</dt>
                <dd className="tabular-nums">
                  {fmtBp(result.positions[0].aswSpread)}bp
                  <span className="ml-1.5 opacity-50">
                    민평 {result.positions[0].coupon.toFixed(3)}% − IRS{" "}
                    {result.positions[0].swapEntryRate?.toFixed(3)}%
                  </span>
                </dd>
              </>
            )}
          </dl>

          <p className="text-[13px] opacity-45">
            이 줄들의 합이 손익이에요. 현금채권 단독에는 개시 줄이 없어요 —
            진입일에 발행돼서 셀 하룻밤이 없거든요.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── 화면 ───────────────────────────────────────────────────────────────── */

export function CashBondView() {
  const hydrate = useFundingStore((s) => s.hydrate);
  useEffect(() => hydrate(), [hydrate]);

  const [kind, setKind] = useState<CashBondKind>("CB");
  const [bondType, setBondType] = useState<string | null>(null);
  const [selected, setSelected] = useState<CashBondRow | null>(null);

  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["cashbond", "instruments"],
    queryFn: fetchCashBondInstruments,
    retry: 1,
  });

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter(
      (r) => r.kind === kind && (bondType === null || r.bondType === bondType),
    );
  }, [data, kind, bondType]);

  if (isError) {
    return (
      <ErrorState
        what={
          error instanceof BacktestUnavailable ? "현금채권 표를 (백엔드가 필요해요)" : "현금채권 표를"
        }
        onRetry={() => void refetch()}
        retrying={isFetching}
      />
    );
  }
  if (!data) return <LoadingState what="현금채권" />;

  return (
    <div className={`flex min-h-0 flex-1 gap-4 pt-4 ${PAGE_X}`}>
      {/* 왼쪽 — 표 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => {
                setKind(k.id);
                setSelected(null);
              }}
              className={`flex h-6 items-center rounded-control px-3 text-[13px] font-medium transition-colors ${
                kind === k.id ? "bg-accent text-on-accent" : "bg-tile text-ink hover:bg-ink-5"
              }`}
            >
              {k.label}
            </button>
          ))}
          <span className="ml-1 text-[13px] opacity-45">
            {KINDS.find((k) => k.id === kind)?.note}
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            aria-pressed={bondType === null}
            onClick={() => setBondType(null)}
            className={`flex h-6 items-center rounded-control px-3 text-[13px] transition-colors ${
              bondType === null ? "bg-ink-5 font-medium text-ink" : "text-ink-2 hover:bg-ink-5"
            }`}
          >
            전체
          </button>
          {data.types.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={bondType === t.id}
              onClick={() => setBondType(t.id)}
              className={`flex h-6 items-center rounded-control px-3 text-[13px] transition-colors ${
                bondType === t.id ? "bg-ink-5 font-medium text-ink" : "text-ink-2 hover:bg-ink-5"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-2 min-h-0 flex-1 overflow-auto">
          {rows.length === 0 ? (
            // 없는 조합은 빈 표가 아니라 문장이다 — 통안채 자산스왑처럼 만기가
            // 겹치지 않아 애초에 설 수 없는 칸이 있다.
            <p className="pt-6 text-center text-[13px] opacity-50">
              고른 조합에는 행이 없어요. 통안채는 3년까지만 있고, 자산스왑은 채권과
              IRS 양쪽에 있는 만기에만 서요.
            </p>
          ) : (
            <Table rows={rows} selectedId={selected?.id ?? null} onPick={setSelected} />
          )}
        </div>

        <p className="shrink-0 py-2 text-[13px] opacity-45">
          {data.asof} 기준 · 민평 {data.from}부터 · 3개월 이표채로 가정해요
        </p>
      </div>

      {/* 오른쪽 — 고른 종목의 백테스트 */}
      <div className="flex w-[34rem] shrink-0 flex-col pb-4">
        {selected ? (
          <GroupBox
            className="min-h-0"
            header={
              <>
                <GroupBoxTitle>{selected.label}</GroupBoxTitle>
                <GroupBoxGap />
                <GroupBoxNote>
                  {fmtLevel(selected.now, selected.unit === "pct" ? "%" : "bp")}
                  {selected.unit === "pct" ? "%" : "bp"}
                </GroupBoxNote>
              </>
            }
          >
            <div className="min-h-0 overflow-y-auto">
              <BacktestPanel
                key={selected.id}
                row={selected}
                asOf={data.asof}
                minDate={data.from}
              />
            </div>
          </GroupBox>
        ) : (
          <div className="flex h-full items-center justify-center rounded-popover border border-dashed border-edge">
            <p className="px-6 text-center text-[14px] opacity-45">
              표에서 종목을 하나 고르면 여기서 백테스트를 돌려요.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
