/* Screener presets (DESIGN §D, Session 15). Named views in plain language, a
 * filter ON TOP of the active tab — one at a time, click again clears. The Toss
 * screener is the reference.
 *
 * Data-driven by design: a screener is a predicate over a Row's already-served
 * numbers, so adding a named view is a definition here, not a new component.
 * These are filters (booleans), not displayed values, so they stay on the
 * client without crossing the §16 boundary. Descriptions are 합니다체 (§H). */

import type { BasisKey } from "@/lib/api";
import type { Row } from "./rows";

const BASES: BasisKey[] = ["d1", "wtd", "mtd", "qtd", "ytd"];

/** A sign flip between adjacent bases, both moves non-trivial — the 되돌림 test. */
function retraced(changes: Row["changes"]): boolean {
  for (let i = 0; i < BASES.length - 1; i++) {
    const a = changes[BASES[i]];
    const b = changes[BASES[i + 1]];
    if (
      a != null && b != null &&
      Math.abs(a) >= 0.5 && Math.abs(b) >= 0.5 &&
      Math.sign(a) !== Math.sign(b)
    ) {
      return true;
    }
  }
  return false;
}

export interface Screener {
  id: string;
  label: string;
  description: string; // shown beneath the chip row when active
  test: (row: Row) => boolean;
}

export const SCREENERS: Screener[] = [
  {
    id: "movers",
    label: "오늘 많이 움직인 것",
    description: "자기 과거 대비 오늘 변동이 큰 종목만 봅니다.",
    test: (r) => r.movePct != null && r.movePct >= 90,
  },
  {
    id: "high",
    label: "10년 고점권",
    description: "10년 레인지에서 상위 10% 안에 있는 레벨만 봅니다.",
    test: (r) => r.pct != null && r.pct >= 90,
  },
  {
    id: "low",
    label: "10년 저점권",
    description: "10년 레인지에서 하위 10% 안에 있는 레벨만 봅니다.",
    test: (r) => r.pct != null && r.pct <= 10,
  },
  {
    id: "retrace",
    label: "되돌림",
    description: "인접 기준 구간 사이에서 방향이 뒤집힌 종목만 봅니다.",
    test: (r) => retraced(r.changes),
  },
  {
    id: "quoted",
    label: "호가만",
    description: "보간 만기를 제외하고 실제 고시 만기만 봅니다.",
    test: (r) => r.quoted === true,
  },
  {
    id: "keyfwd",
    label: "주요 포워드",
    description: "시장에서 주로 호가되는 여섯 개 포워드만 봅니다.",
    test: (r) => r.keyForward === true,
  },
];
