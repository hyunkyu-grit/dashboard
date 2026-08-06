"use client";

/* 연구실 — the incubation tab at the FAR RIGHT of the tab strip [OWNER,
 * 2026-08-04: "연구실 항목을 따로 맨 우측에 만들어서 거기에 반영해서 트레이더
 * 피드백 나오면 이제 왼쪽으로 옮기는거로"]. Experimental, statistics-flavoured
 * surfaces live here first; one that earns trader feedback GRADUATES leftward
 * into the main tabs, one that does not is dropped without ever having
 * touched the product proper. Rightmost on purpose: tab order is the
 * product's order of confidence.
 *
 * First resident: 라고 할 때 살걸 — the change log's last 20 business days of
 * 주요-instrument lines (derive.is_key, the tab divider's own membership),
 * each priced as if followed the NEXT business day with 100억, valued to
 * as-of by the backtest engine. Every figure is SERVED
 * (backend/app/regret.py); the component formats and never computes (§16).
 * The vocabulary is the backtest's own — `directionLabel` / `fmtKrw`
 * imported from BacktestWindow so two surfaces cannot drift into two
 * grammars for one trade — pinned byte-for-byte by
 * guards/regret-list.test.ts. */

import type { RegretEntry } from "@/lib/api";
import { dirClass, fmtBp } from "@/lib/format";
import { directionLabel, fmtKrw } from "./BacktestWindow";

/** "M.D" from an ISO date — the list is recent memory (20 business days by
 * construction), so the year is noise. */
function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}.${Number(d)}`;
}

/* One past log line, priced. Line 1 is the log's own grammar (date, label,
 * Δbp); line 2 is what following it meant and what that is worth now. The
 * click is the change log's click: focus the instrument.
 * Exported for guards/regret-list.test.ts. */
export function RegretLine({
  r,
  onFocus,
}: {
  r: RegretEntry;
  onFocus: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onFocus(r.id)}
      className="w-full rounded-control px-2 py-1.5 text-left hover:bg-page"
      title={`${r.date} ${r.label} — ${r.entry}에 ${directionLabel(r.id, r.direction)}, 100억`}
    >
      <span className="flex items-baseline gap-2">
        <span className="shrink-0 text-[12px] tabular-nums opacity-45">
          {shortDate(r.date)}
        </span>
        {/* no truncate anywhere in this panel [OWNER, 2026-08-04: "한글
            잘림 꺼라"] — a clipped 방향어 hides the trade; long lines WRAP. */}
        <span className="min-w-0 flex-1 break-keep text-[13px]">{r.label}</span>
        <span
          className={`shrink-0 text-[12px] tabular-nums ${dirClass(r.deltaBp)}`}
        >
          {fmtBp(r.deltaBp)}
        </span>
      </span>
      <span className="flex items-baseline gap-2 pl-[34px]">
        <span className="min-w-0 flex-1 break-keep text-[12px] opacity-55">
          {directionLabel(r.id, r.direction)}
        </span>
        <span
          className={`shrink-0 text-[13px] tabular-nums ${dirClass(r.pnl)}`}
        >
          {fmtKrw(r.pnl)}
        </span>
      </span>
    </button>
  );
}

export function RegretLab({
  regret,
  onFocus,
}: {
  regret: RegretEntry[];
  onFocus: (id: string) => void;
}) {
  return (
    <div className="max-w-[440px]">
      <h2 className="text-[15px] font-semibold">라고 할 때 살걸</h2>
      <p className="mt-1 text-[12px] leading-relaxed opacity-55">
        지난 20영업일의 주요 종목 변화 각각을 다음 영업일에 그 방향대로
        100억 따라갔다면 지금까지의 손익이에요. 진입은 이벤트 다음 영업일
        종가예요. 손익은 백테스트 엔진의 전체 재평가 값이에요.
      </p>
      <p className="mt-1 text-[11px] opacity-40">
        연구실의 실험 기능이에요. 피드백에 따라 본 탭으로 옮기거나 내려요.
      </p>
      <div className="mt-3 border-t border-edge pt-3">
        {regret.length === 0 ? (
          <p className="px-2 py-3 text-[13px] opacity-55">
            지난 20영업일에 기록된 변화가 없어요.
          </p>
        ) : (
          regret.map((r, i) => (
            <RegretLine key={`${r.date}-${r.id}-${i}`} r={r} onFocus={onFocus} />
          ))
        )}
      </div>
    </div>
  );
}
