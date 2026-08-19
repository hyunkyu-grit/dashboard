import type { CashBondInstruments, CashBondRow } from '@/lib/api';

import type { Row } from './rows';

/**
 * Cash Bond 표의 행 — `universeRows.toRows` 와 같은 성질의 어댑터다.
 *
 * 백엔드가 모든 숫자를 끝내서 보낸다(`backend/app/cashbond.py:instruments`) —
 * 수준·변화·백분위·52주·세타·정렬 키까지. 이 파일은 시장 데이터에 아무 산술도
 * 하지 않는다(§16). 현금채권(`CB:*`)은 `cashbond` 그룹, 자산스왑(`ASW:*`)은
 * `asw` 그룹으로 갈린다 — 메가 패널의 두 항목이 곧 두 탭이다.
 */

/** 종목군 필터(국고채·통안채·…)가 남기는 행. `bondType === null` 이 전체다. */
export function filterByType(rows: Row[], all: CashBondRow[], bondType: string | null): Row[] {
  if (bondType === null) return rows;
  const ids = new Set(all.filter((r) => r.bondType === bondType).map((r) => r.id));
  return rows.filter((r) => ids.has(r.id));
}

/** Straight field mapping — no derivation (§16).
 *
 * `seriesId` 는 null 이다: 이 행의 히스토리는 `/api/series` 가 아니라
 * `/api/cashbond/series` 에 있고, 미리보기 pane 이 그룹으로 그 경로를 고른다
 * (`PreviewPane.loadSeries`). `quoted` 는 undefined — 민평 평가금리에는 고시/보간
 * 구분이 없다(`universeRows` 의 같은 판단). */
export function toCashBondRows(p: CashBondInstruments): Row[] {
  return p.rows.map((u) => ({
    id: u.id,
    label: u.label,
    group: u.kind === 'CB' ? ('cashbond' as const) : ('asw' as const),
    unit: u.unit,
    now: u.now,
    changes: { ...u.changes },
    pct: u.pct,
    seriesId: null,
    rangeHigh: u.rangeHigh,
    rangeLow: u.rangeLow,
    rangeAvg: u.rangeAvg,
    sortKey: u.sortKey,
    movePct: null,
    quoted: undefined,
    /* 주요 구분선이 이 표에는 없다 — 오너의 주요 목록이 이 유니버스에 없다.
     * 전부 false 면 orderRows 의 핀이 아무 일도 하지 않는다. */
    key: false,
    theta: u.theta ?? null,
  })) as Row[];
}
