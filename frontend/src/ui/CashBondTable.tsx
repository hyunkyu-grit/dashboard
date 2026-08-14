"use client";

/* 현금채권 / 자산스왑 표 — 아웃라이트 표와 **같은 격자·같은 셀** [OWNER,
 * 2026-08-14 — "52주 평균 고 저 백분위 슬라이더가 뜨고 세타가 뜨는 거 똑같이"].
 *
 * 같은 것: 열 사다리와 폭(`ui/columns.ts` 의 `visibleColumns`/`gridTemplate`),
 * 52주 고·저·평균 + 위치 트랙 + 세타(`ui/RangeCells.tsx` 를 그대로 호출),
 * 헤더를 누르면 그 열로 정렬, 행 호버가 오른쪽 판을 미리보기, 행 클릭이 핀.
 *
 * 다른 것: 종목군 필터 칩(국고채·통안채·…)이 위에 한 줄 더 있다. 이 표에만
 * 있는 축이고 IRS 에는 대응물이 없다. 스크리너 칩은 **양쪽 다 없다**
 * [OWNER, 2026-08-14] — 정렬과 52주·위치 열이 같은 질문에 이미 답한다.
 *
 * 세타는 서버가 낸다(§16). 이 파일에 산술은 없다.
 */

import { useMemo, useState } from "react";

import type { BasisKey, CashBondRow } from "@/lib/api";
import { fmtDelta, levelHeadText } from "@/lib/format";

import { rangeText } from "./cells";
import {
  ALL_COLUMNS,
  BASIS_HEAD,
  CASHBOND_LABEL_W,
  gridTemplate,
  type VisibleColumns,
} from "./columns";
import { RangeCells, RangeHeader } from "./RangeCells";

function dirClass(v: number | null): string {
  if (v === null || v === 0) return "text-ink-3";
  return v > 0 ? "text-up" : "text-down";
}

/** 이 표의 열 구성. 아웃라이트와 같은 사다리를 쓰되 폭 계산 없이 전부 편다 —
 * 이 화면은 표가 자기 폭(TABLE_W)을 갖고 나머지를 오른쪽 판이 가져가는 구조라
 * 열이 떨어질 일이 없다. 떨어지기 시작하면 `visibleColumns` 로 바꾸면 된다. */
const COLUMNS: VisibleColumns = ALL_COLUMNS;
/** 종목 열만 넓힌 같은 격자 — 한글 이름이 라틴 9글자 트랙에 안 들어간다
 * (`CASHBOND_LABEL_W` 의 주석에 실측이 있다). 나머지 트랙은 IRS 표와 같은 수라
 * 두 표를 나란히 놓아도 숫자 열이 같은 자리에 선다. */
const TEMPLATE = gridTemplate(COLUMNS, CASHBOND_LABEL_W);

type SortCol = BasisKey | "label" | "now" | null;

export function CashBondTable({
  rows,
  asOf,
  activeId,
  pinnedId,
  onHover,
  onPin,
}: {
  rows: CashBondRow[];
  asOf: string;
  activeId: string | null;
  pinnedId: string | null;
  onHover: (row: CashBondRow | null) => void;
  onPin: (row: CashBondRow) => void;
}) {
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortAsc, setSortAsc] = useState(false);

  const shown = useMemo(() => {
    const base = [...rows];
    if (sortCol === null) {
      // 서버가 준 정렬 키 — 종목군 사다리(국고 → 캐피탈) 안에서 만기 순
      return base.sort((a, b) => {
        for (let i = 0; i < Math.max(a.sortKey.length, b.sortKey.length); i++) {
          const d = (a.sortKey[i] ?? 0) - (b.sortKey[i] ?? 0);
          if (d !== 0) return d;
        }
        return 0;
      });
    }
    const key = (r: CashBondRow): number | string =>
      sortCol === "label"
        ? r.label
        : sortCol === "now"
          ? r.now
          : (r.changes[sortCol] ?? Number.NEGATIVE_INFINITY);
    return base.sort((a, b) => {
      const x = key(a);
      const y = key(b);
      const d = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
      return sortAsc ? d : -d;
    });
  }, [rows, sortCol, sortAsc]);

  const toggle = (c: SortCol) => {
    if (sortCol === c) setSortAsc((v) => !v);
    else {
      setSortCol(c);
      setSortAsc(false);
    }
  };
  const arrow = (c: SortCol) => (sortCol === c ? (sortAsc ? " ↑" : " ↓") : "");

  return (
    <div role="table" className="w-full text-[13px]">
      <div
        role="row"
        style={{ gridTemplateColumns: TEMPLATE }}
        className="sticky top-0 z-10 grid items-end border-b border-edge bg-tile pb-2 text-left text-ink-2"
      >
        <div role="columnheader" className="pl-3">
          <button type="button" onClick={() => toggle("label")} className="hover:text-ink">
            종목{arrow("label")}
          </button>
        </div>
        <div role="columnheader" className="whitespace-nowrap pr-3 text-right tabular-nums">
          <button type="button" onClick={() => toggle("now")} className="hover:text-ink">
            {levelHeadText(asOf)}
            {arrow("now")}
          </button>
        </div>
        {COLUMNS.bases.map((b) => (
          <div key={b} role="columnheader" className="pr-3 text-right">
            <button type="button" onClick={() => toggle(b)} className="hover:text-ink">
              {BASIS_HEAD[b]}
              {arrow(b)}
            </button>
          </div>
        ))}
        {COLUMNS.range52 && (
          <RangeHeader slider={COLUMNS.slider} theta={COLUMNS.theta} />
        )}
      </div>

      <div role="rowgroup" className="relative">
        {shown.map((row) => {
          const active = row.id === activeId;
          const pinned = row.id === pinnedId;
          return (
            <div
              key={row.id}
              role="row"
              tabIndex={0}
              aria-selected={active}
              onMouseEnter={() => onHover(row)}
              onMouseLeave={() => onHover(null)}
              onClick={() => onPin(row)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onPin(row);
                }
              }}
              style={{ gridTemplateColumns: TEMPLATE }}
              /* 선택·호버 규칙은 아웃라이트 행과 같다 — 액센트 채움과 잉크 5%
                 띠, `isolate` + `-z-10` 로 가상 요소가 숫자를 덮지 않게. 그쪽
                 주석이 근거를 다 들고 있다(InstrumentTable). */
              className={`relative isolate grid h-12 cursor-pointer items-center border-b border-edge ${
                active
                  ? "bw-row-selected bg-accent text-on-accent"
                  : "before:pointer-events-none before:absolute before:inset-y-0 before:left-1 before:right-1 before:-z-10 before:rounded-control-lg before:content-[''] hover:before:bg-ink-5"
              }`}
            >
              <div role="cell" className="relative z-10 pl-3 font-semibold">
                {pinned && (
                  <span className="absolute left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-ink" />
                )}
                {row.label}
              </div>
              <div
                role="cell"
                className="pr-3 text-right font-semibold tabular-nums text-ink"
              >
                {rangeText(row.now, row.unit)}
              </div>
              {COLUMNS.bases.map((b) => (
                <div
                  role="cell"
                  key={b}
                  className={`self-stretch content-center pr-3 text-right tabular-nums ${dirClass(
                    row.changes[b],
                  )}`}
                >
                  {fmtDelta(row.changes[b], row.unit)}
                </div>
              ))}
              {COLUMNS.range52 && (
                <RangeCells row={row} slider={COLUMNS.slider} theta={COLUMNS.theta} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
