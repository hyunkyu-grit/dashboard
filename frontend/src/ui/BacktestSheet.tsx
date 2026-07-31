"use client";

/* The backtest sheet — "그때 들어갔으면 지금 얼마였을까" (§backtest).
 *
 * Opened by clicking the CHART (a row click still pins). It replaced the
 * enlarged chart popup in that slot: the pane chart is now pane-sized, so a
 * popup whose job was "the same line, bigger" had nothing left to do.
 *
 * TOSS-STYLE, WHICH IS A CONSTRAINT ON THE NUMBERS AS MUCH AS THE PAINT
 * [OWNER standing rule]. The result is one big figure in plain Korean, and the
 * controls read as a sentence — instrument, side, size, from, to — not as a
 * form with labels stacked above inputs. Everything that is machinery (per-leg
 * notionals, DV01, settled cash) sits under a fold, because it is the answer to
 * a second question and putting it beside the first one makes neither readable.
 *
 * A BOOK, NOT ONE TRADE [OWNER, 2026-07-31]. Positions are rows: instrument,
 * side, size, entry AND exit, each independent — you leg in on different days
 * and out on different days. The chart click seeds the first row; more come
 * from the row's own dropdown, or by clicking another instrument in the table
 * behind (the sheet stays open and captures it).
 *
 * The headline is the BOOK total and the chart draws only that line. Per
 * position there are numbers, not lines: three or four curves on one axis is
 * a chart nobody reads, and the question "which one carried it" is answered
 * by a column of figures faster than by picking lines apart.
 *
 * IT DOES NOT RUN ON ITS OWN. The user presses 실행. A backtest is a question
 * someone asks, not a thing that happens while they are still typing the date,
 * and each run is a full daily revaluation on the server.
 *
 * LIVE BACKEND ONLY. Every other surface reads a baked JSON file; this answer
 * depends on inputs the reader chooses, so it cannot be one. With no backend
 * configured the sheet says that plainly instead of drawing an empty chart.
 */

import { useMutation } from "@tanstack/react-query";
import { motion, type PanInfo } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  BacktestUnavailable,
  fetchBacktest,
  type BacktestResult,
  type PositionInput,
} from "@/lib/api";

import { ErrorBoundary } from "./ErrorBoundary";
import { Z_MODAL } from "./layers";
import { SHEET_SPRING } from "./motion";
import type { Row } from "./rows";

/** Money, the way a Korean desk reads it: 억 / 만, never 12 raw digits. */
export function fmtKrw(v: number): string {
  const sign = v < 0 ? "−" : "+";
  const n = Math.abs(Math.round(v));
  if (n < 10_000) return `${sign}${n.toLocaleString()}원`;
  const eok = Math.floor(n / 100_000_000);
  const man = Math.floor((n % 100_000_000) / 10_000);
  if (eok > 0) return `${sign}${eok}억${man ? ` ${man.toLocaleString()}만` : ""}원`;
  return `${sign}${man.toLocaleString()}만원`;
}

/** 억 in, raw won out. The input is in 억 because nobody types eleven zeros. */
const EOK = 100_000_000;

/** Mirrors `backtest.MAX_POSITIONS`. Past this the sheet is unreadable and
 * each extra row is another full daily revaluation pass on the server. */
const MAX_POSITIONS = 12;

const SIDE_WORDS: Record<string, [string, string]> = {
  // group → [what +1 is called, what -1 is called]
  outright: ["고정 지급", "고정 수취"],
  spread: ["스티프너", "플래트너"],
  fly: ["벨리 지급", "벨리 수취"],
  forward: ["고정 지급", "고정 수취"],
};

/** One year before the data's last date, ISO. Empty when there is no as-of
 * yet — the run button stays disabled until there is. */
function defaultEntry(asOf: string | undefined): string {
  if (!asOf) return "";
  const d = new Date(asOf);
  d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] opacity-50">{label}</span>
      {children}
    </label>
  );
}

const INPUT =
  "rounded-[10px] bg-page px-3 py-2 text-[14px] tabular-nums outline-none " +
  "focus:ring-2 focus:ring-ink/15";

/** The P&L line. Hand-rolled SVG like every other chart here; the zero line is
 * drawn because a P&L chart without one cannot be read at a glance. */
function PnlChart({
  result,
  width,
  height,
}: {
  result: BacktestResult;
  width: number;
  height: number;
}) {
  const pts = result.points;
  if (pts.length < 2) return null;
  const PAD = { top: 8, right: 8, bottom: 18, left: 8 };
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  let lo = 0; // the zero line is always in frame — it is the win/lose boundary
  let hi = 0;
  for (const p of pts) {
    if (p.pnl < lo) lo = p.pnl;
    if (p.pnl > hi) hi = p.pnl;
  }
  const pad = (hi - lo) * 0.08 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * plotW;
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.pnl).toFixed(1)}`).join(" ");
  const up = result.pnl >= 0;
  // the area under the line, closed on the zero axis rather than the bottom —
  // so the fill reads as "distance from breakeven", which is what it is
  const area = `${line} ${x(pts.length - 1).toFixed(1)},${y(0).toFixed(1)} ${x(0).toFixed(1)},${y(0).toFixed(1)}`;

  return (
    <svg width={width} height={height} role="img" aria-label="누적 손익">
      <defs>
        <linearGradient id="btfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
        </linearGradient>
      </defs>
      <g className={up ? "text-up" : "text-down"}>
        <polygon points={area} fill="url(#btfill)" stroke="none" />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </g>
      <line
        x1={PAD.left}
        x2={width - PAD.right}
        y1={y(0)}
        y2={y(0)}
        className="stroke-ink"
        strokeWidth={1}
        strokeOpacity={0.25}
      />
      <text
        x={PAD.left}
        y={height - 5}
        className="fill-ink"
        style={{ fontSize: 10, opacity: 0.45 }}
      >
        {result.from}
      </text>
      <text
        x={width - PAD.right}
        y={height - 5}
        textAnchor="end"
        className="fill-ink"
        style={{ fontSize: 10, opacity: 0.45 }}
      >
        {result.to}
      </text>
    </svg>
  );
}

function fmtMove(p: {
  entryValue: number | null;
  exitValue: number | null;
  id: string;
}): string {
  if (p.entryValue == null || p.exitValue == null) return "";
  // outrights are quoted in %, spreads and flies in bp — the id's leg count
  // is what distinguishes them, the same rule rows.ts routes groups by
  const isPct = !p.id.includes("-") && !p.id.includes("x");
  const d = (p.exitValue - p.entryValue) * (isPct ? 100 : 1);
  return `${p.entryValue} → ${p.exitValue} (${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}bp)`;
}

function Result({
  result,
  naming,
}: {
  result: BacktestResult;
  /** id → how the rest of the product names it. The server echoes the id it
   * was given (`3Y-10Y`); every other surface says `3s10s`, and a backtest
   * that names instruments differently from the table above it is two
   * products. */
  naming: Map<string, { label: string; group: string }>;
}) {
  const up = result.pnl >= 0;
  return (
    <div className="mt-5">
      <p className="text-[13px] opacity-55">
        {result.from} → {result.to} · 포지션 {result.positions.length}개
      </p>
      <p
        className={`mt-1 text-[34px] font-bold leading-tight tabular-nums ${
          up ? "text-up" : "text-down"
        }`}
      >
        {fmtKrw(result.pnl)}
      </p>

      <div className="mt-4">
        <PnlChart result={result} width={880} height={200} />
      </div>

      <div className="mt-3 flex gap-6 text-[13px] tabular-nums">
        <span>
          <span className="opacity-50">최고 </span>
          <span className="text-up">{fmtKrw(result.maxProfit)}</span>
        </span>
        <span>
          <span className="opacity-50">최저 </span>
          <span className="text-down">{fmtKrw(result.maxLoss)}</span>
        </span>
      </div>

      {/* Which position carried it. Numbers, not lines — see the header note. */}
      <table className="mt-5 w-full text-[13px] tabular-nums">
        <thead className="text-left text-ink/50">
          <tr>
            <th className="pb-1 font-normal">종목</th>
            <th className="pb-1 font-normal">방향</th>
            <th className="pb-1 text-right font-normal">명목</th>
            <th className="pb-1 font-normal">기간</th>
            <th className="pb-1 text-right font-normal">손익</th>
          </tr>
        </thead>
        <tbody>
          {result.positions.map((p, i) => (
            <tr key={`${p.id}-${i}`} className="border-t border-edge">
              <td className="py-1.5 font-semibold">
                {naming.get(p.id)?.label ?? p.id}
              </td>
              <td className="py-1.5">
                {
                  (SIDE_WORDS[naming.get(p.id)?.group ?? "outright"] ??
                    SIDE_WORDS.outright)[p.direction > 0 ? 0 : 1]
                }
              </td>
              <td className="py-1.5 text-right">
                {(p.notional / EOK).toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
                억
              </td>
              <td className="py-1.5 text-[12px] opacity-60">
                {p.entry} → {p.exit}
                {p.closed && <span className="ml-1 opacity-70">(청산)</span>}
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

      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] opacity-50 hover:opacity-80">
          자세히 — 다리별 구성과 정산
        </summary>
        {result.positions.map((p, i) => (
          <div key={`${p.id}-${i}`} className="mt-3">
            <p className="text-[12px] font-semibold opacity-70">
              {naming.get(p.id)?.label ?? p.id} · {fmtMove(p)}
            </p>
            <table className="mt-1 w-full text-[13px] tabular-nums">
              <tbody>
                {p.legs.map((l) => (
                  <tr key={l.tenor} className="border-t border-edge">
                    <td className="py-1 font-semibold">{l.tenor}</td>
                    <td className="py-1">{l.side === "pay" ? "지급" : "수취"}</td>
                    <td className="py-1 text-right">
                      {(l.notional / EOK).toLocaleString(undefined, {
                        maximumFractionDigits: 1,
                      })}
                      억
                    </td>
                    <td className="py-1 text-right">{l.entryRate}%</td>
                    <td className="py-1 text-right">
                      {(l.dv01 * l.notional * 1e-4).toLocaleString(undefined, {
                        maximumFractionDigits: 0,
                      })}
                      원/bp
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[12px] opacity-50">
              누적 정산현금 {fmtKrw(p.cash)}
            </p>
          </div>
        ))}
        <p className="mt-3 text-[12px] leading-relaxed opacity-55">
          매일 그날의 커브로 다시 평가하고, 그동안 실제로 정산된 현금을 더한
          값입니다. 금리 변동분만 곱한 근사치가 아니라 잔존만기가 줄어드는
          효과(롤다운)와 캐리가 들어 있습니다. 다리가 둘 이상이면 진입일 DV01
          중립 비율로 명목을 잡았습니다. 청산한 포지션은 청산일 손익에서 멈추고,
          그 값은 합계에 계속 남습니다.
        </p>
      </details>
    </div>
  );
}

/** One editable row of the book. */
function PositionRow({
  value,
  choices,
  asOf,
  onChange,
  onRemove,
  removable,
}: {
  value: PositionInput;
  choices: { id: string; label: string; group: string }[];
  asOf?: string;
  onChange: (next: PositionInput) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const pick = choices.find((c) => c.id === value.id);
  const [long, short] =
    SIDE_WORDS[pick?.group ?? "outright"] ?? SIDE_WORDS.outright;
  const set = (patch: Partial<PositionInput>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-edge py-2.5">
      <Field label="종목">
        <select
          value={value.id}
          onChange={(e) => set({ id: e.target.value })}
          className={`${INPUT} max-w-[13rem]`}
        >
          {choices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="방향">
        <select
          value={value.direction}
          onChange={(e) => set({ direction: Number(e.target.value) })}
          className={INPUT}
        >
          <option value={1}>{long}</option>
          <option value={-1}>{short}</option>
        </select>
      </Field>
      <Field label="명목">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            value={value.eok}
            onChange={(e) => set({ eok: Math.max(1, Number(e.target.value)) })}
            className={`${INPUT} w-20 text-right`}
          />
          <span className="text-[14px] opacity-55">억</span>
        </div>
      </Field>
      <Field label="진입일">
        <input
          type="date"
          value={value.entry}
          max={asOf}
          onChange={(e) => set({ entry: e.target.value })}
          className={INPUT}
        />
      </Field>
      <Field label="청산일">
        <input
          type="date"
          value={value.exit}
          max={asOf}
          onChange={(e) => set({ exit: e.target.value })}
          className={INPUT}
        />
      </Field>
      <button
        type="button"
        onClick={onRemove}
        disabled={!removable}
        title="이 포지션 빼기"
        className="rounded-[10px] px-2 py-2 text-[16px] opacity-40 hover:opacity-90 disabled:opacity-15"
      >
        ×
      </button>
    </div>
  );
}

/** A fresh row, seeded from an instrument id. */
function newRow(id: string, asOf: string | undefined): PositionInput {
  return { id, direction: 1, eok: 100, entry: defaultEntry(asOf), exit: "" };
}

export function BacktestSheet({
  row,
  rows,
  asOf,
  captured,
  onClose,
}: {
  row: Row;
  /** every instrument the app knows, for the per-row dropdown */
  rows: Row[];
  /** the dataset's last date — the default 청산일 and the latest allowed */
  asOf?: string;
  /** an instrument clicked in the table BEHIND the sheet, to be appended */
  captured?: Row | null;
  onClose: () => void;
}) {
  const choices = useMemo(
    () =>
      rows
        // a volatility ratio is not a position anyone can put on
        .filter((r) => r.group !== "vol")
        .map((r) => ({ id: r.seriesId ?? r.id, label: r.label, group: r.group })),
    [rows],
  );

  const naming = useMemo(
    () =>
      new Map(
        rows.map((r) => [
          r.seriesId ?? r.id,
          { label: r.label, group: r.group as string },
        ]),
      ),
    [rows],
  );

  const [book, setBook] = useState<PositionInput[]>(() => [
    newRow(row.seriesId ?? row.id, asOf),
  ]);

  /* An instrument clicked in the TABLE BEHIND the sheet is appended as a row.
   * Guarded by the last id seen, because `captured` stays set until the click
   * that replaces it — without this, any unrelated re-render would append the
   * same instrument again. */
  const lastCaptured = useRef<string | null>(null);
  useEffect(() => {
    const id = captured?.seriesId ?? captured?.id ?? null;
    if (!id || id === lastCaptured.current) return;
    lastCaptured.current = id;
    setBook((b) => (b.length >= MAX_POSITIONS ? b : [...b, newRow(id, asOf)]));
  }, [captured, asOf]);

  const run = useMutation({ mutationFn: () => fetchBacktest(book) });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 500) onClose();
  };

  const unavailable = run.error instanceof BacktestUnavailable;
  const ready = book.length > 0 && book.every((b) => b.entry);

  return (
    <motion.div
      className={`fixed inset-0 ${Z_MODAL} flex items-end justify-center bg-page/70`}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <motion.div
        className="max-h-[92vh] w-full max-w-[960px] overflow-y-auto rounded-t-[20px] bg-popover p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={SHEET_SPRING}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.5 }}
        onDragEnd={onDragEnd}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-edge" />
        <ErrorBoundary fallback="백테스트 화면을 그리지 못했어요">
          <div className="flex items-baseline gap-2">
            <span className="text-[22px] font-bold">백테스트</span>
            <span className="text-[13px] opacity-50">
              그때 들어갔으면 지금 얼마였을까
            </span>
          </div>

          <div className="mt-3">
            {book.map((b, i) => (
              <PositionRow
                key={i}
                value={b}
                choices={choices}
                asOf={asOf}
                removable={book.length > 1}
                onChange={(next) =>
                  setBook((prev) => prev.map((p, j) => (j === i ? next : p)))
                }
                onRemove={() => setBook((prev) => prev.filter((_, j) => j !== i))}
              />
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() =>
                setBook((b) => [
                  ...b,
                  newRow(b[b.length - 1]?.id ?? choices[0]?.id ?? "", asOf),
                ])
              }
              disabled={book.length >= MAX_POSITIONS}
              className="rounded-[10px] border border-edge px-3 py-2 text-[13px] disabled:opacity-40"
            >
              + 포지션 추가
            </button>
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={!ready || run.isPending}
              className="rounded-[10px] bg-ink px-5 py-2 text-[14px] font-semibold text-page disabled:opacity-40"
            >
              {run.isPending ? "계산 중…" : "실행"}
            </button>
            <span className="text-[12px] opacity-45">
              청산일을 비우면 {asOf ?? "마지막 영업일"}까지 · 뒤 표에서 종목을
              눌러도 추가됩니다
            </span>
          </div>

          {unavailable && (
            <div className="mt-6 rounded-[12px] bg-page p-4 text-[13px] leading-relaxed">
              <p className="font-semibold">백엔드가 필요한 화면이에요</p>
              <p className="mt-1 opacity-60">
                다른 화면은 미리 만들어 둔 파일을 읽지만, 백테스트는 입력한
                조건마다 답이 달라져서 미리 구워둘 수 없습니다. 백엔드를 띄우고
                <code className="mx-1 rounded bg-tile px-1">
                  NEXT_PUBLIC_API_BASE
                </code>
                를 지정해 주세요.
              </p>
            </div>
          )}
          {run.error && !unavailable && (
            <p className="mt-6 text-[13px] text-up">{run.error.message}</p>
          )}
          {run.data && <Result result={run.data} naming={naming} />}
          {!run.data && !run.error && !run.isPending && (
            <p className="mt-8 text-center text-[14px] opacity-45">
              조건을 정하고 실행을 눌러 주세요
            </p>
          )}
        </ErrorBoundary>
      </motion.div>
    </motion.div>
  );
}
