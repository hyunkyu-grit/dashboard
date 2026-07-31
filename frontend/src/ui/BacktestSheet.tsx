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
import { useEffect, useMemo, useState } from "react";

import {
  BacktestUnavailable,
  fetchBacktest,
  type BacktestResult,
} from "@/lib/api";

import { ErrorBoundary } from "./ErrorBoundary";
import { instrumentSubtitle } from "./gloss";
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

const SIDE_WORDS: Record<string, [string, string]> = {
  // group → [what +1 is called, what -1 is called]
  outright: ["고정 지급", "고정 수취"],
  spread: ["스티프너", "플래트너"],
  fly: ["벨리 지급", "벨리 수취"],
  forward: ["고정 지급", "고정 수취"],
};

function sideWords(row: Row): [string, string] {
  return SIDE_WORDS[row.group] ?? SIDE_WORDS.outright;
}

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
        {result.entry}
      </text>
      <text
        x={width - PAD.right}
        y={height - 5}
        textAnchor="end"
        className="fill-ink"
        style={{ fontSize: 10, opacity: 0.45 }}
      >
        {result.exit}
      </text>
    </svg>
  );
}

function Result({ result, row }: { result: BacktestResult; row: Row }) {
  const up = result.pnl >= 0;
  const unit = row.unit === "%" ? "%" : "bp";
  const moved =
    result.entryValue != null && result.exitValue != null
      ? result.exitValue - result.entryValue
      : null;

  return (
    <div className="mt-5">
      <p className="text-[13px] opacity-55">
        {result.entry}에 들어갔다면 {result.exit} 기준
      </p>
      <p
        className={`mt-1 text-[34px] font-bold leading-tight tabular-nums ${
          up ? "text-up" : "text-down"
        }`}
      >
        {fmtKrw(result.pnl)}
      </p>
      {moved != null && (
        <p className="mt-1 text-[13px] opacity-55 tabular-nums">
          {result.entryValue}
          {unit} → {result.exitValue}
          {unit} ({moved >= 0 ? "+" : "−"}
          {Math.abs(row.unit === "%" ? moved * 100 : moved).toFixed(1)}bp)
        </p>
      )}

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

      {/* The machinery, folded. It answers "how was this built", which is a
          different question from "what did it make", and side by side neither
          is readable. */}
      <details className="mt-5">
        <summary className="cursor-pointer text-[13px] opacity-50 hover:opacity-80">
          자세히 — 다리별 구성과 정산
        </summary>
        <table className="mt-3 w-full text-[13px] tabular-nums">
          <thead className="text-left text-ink/50">
            <tr>
              <th className="pb-1 font-normal">다리</th>
              <th className="pb-1 font-normal">방향</th>
              <th className="pb-1 text-right font-normal">명목</th>
              <th className="pb-1 text-right font-normal">진입금리</th>
              <th className="pb-1 text-right font-normal">DV01</th>
            </tr>
          </thead>
          <tbody>
            {result.legs.map((l) => (
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
        <p className="mt-3 text-[12px] leading-relaxed opacity-55">
          매일 그날의 커브로 다시 평가하고, 그동안 실제로 정산된 현금을 더한
          값입니다. 금리 변동분만 곱한 근사치가 아니라 잔존만기가 줄어드는
          효과(롤다운)와 캐리가 들어 있습니다. 다리가 둘 이상이면 진입일 DV01
          중립 비율로 명목을 잡았습니다.
          {result.points.length > 0 && (
            <>
              {" "}
              누적 정산현금{" "}
              {fmtKrw(result.points[result.points.length - 1].cash)}.
            </>
          )}
        </p>
      </details>
    </div>
  );
}

export function BacktestSheet({
  row,
  asOf,
  onClose,
}: {
  row: Row;
  /** the dataset's last date — the default 종료일 and the latest allowed */
  asOf?: string;
  onClose: () => void;
}) {
  const [pay, receive] = sideWords(row);
  const [direction, setDirection] = useState(1);
  const [eok, setEok] = useState(100);
  const [entryRaw, setEntry] = useState("");
  const [exit, setExit] = useState("");

  /* A year back from the data's end, so the sheet opens ready to RUN rather
   * than ready to be filled in. Derived during render, not set by an effect:
   * setState in an effect body is lint-banned here, and it would also flash an
   * empty date field for one frame before correcting itself. `entryRaw` is the
   * user's choice and empty means "not chosen yet", which is a fine thing for
   * state to mean — the default lives in the expression below. */
  const entry = entryRaw || defaultEntry(asOf);

  const run = useMutation({
    mutationFn: () =>
      fetchBacktest(row.seriesId ?? row.id, {
        direction,
        notional: eok * EOK,
        entry,
        exit: exit || undefined,
      }),
  });

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

  const gloss = useMemo(() => instrumentSubtitle(row), [row]);
  const unavailable = run.error instanceof BacktestUnavailable;

  return (
    <motion.div
      className="fixed inset-0 z-30 flex items-end justify-center bg-page/70"
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
            <span className="text-[22px] font-bold">{row.label}</span>
            <span className="text-[13px] opacity-50">{gloss}</span>
          </div>
          <p className="mt-0.5 text-[13px] opacity-55">
            그때 들어갔으면 지금 얼마였을까
          </p>

          {/* the controls, as a sentence rather than a stack of labelled boxes */}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label="방향">
              <select
                value={direction}
                onChange={(e) => setDirection(Number(e.target.value))}
                className={INPUT}
              >
                <option value={1}>{pay}</option>
                <option value={-1}>{receive}</option>
              </select>
            </Field>
            <Field label="명목">
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  value={eok}
                  onChange={(e) => setEok(Math.max(1, Number(e.target.value)))}
                  className={`${INPUT} w-24 text-right`}
                />
                <span className="text-[14px] opacity-55">억</span>
              </div>
            </Field>
            <Field label="진입일">
              <input
                type="date"
                value={entry}
                max={asOf}
                onChange={(e) => setEntry(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="종료일">
              <input
                type="date"
                value={exit}
                max={asOf}
                placeholder={asOf}
                onChange={(e) => setExit(e.target.value)}
                className={INPUT}
              />
            </Field>
            <button
              type="button"
              onClick={() => run.mutate()}
              disabled={!entry || run.isPending}
              className="rounded-[10px] bg-ink px-5 py-2 text-[14px] font-semibold text-page disabled:opacity-40"
            >
              {run.isPending ? "계산 중…" : "실행"}
            </button>
          </div>
          {!exit && (
            <p className="mt-1.5 text-[12px] opacity-45">
              종료일을 비우면 {asOf ?? "마지막 영업일"}까지 계산합니다
            </p>
          )}

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
          {run.data && <Result result={run.data} row={row} />}
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
