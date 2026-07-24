/* Chrome copy — 해요체 sentences (DESIGN §15). Instrument names are passed
 * through untouched; only the surrounding sentence is Korean. */

import type { BasisKey } from "@/lib/api";
import type { BandId, Hero } from "./bands";

const MINUS = "−";

/** "어제 대비", "연초 대비", … for a basis. */
export const BASIS_PHRASE: Record<BasisKey, string> = {
  d1: "어제 대비",
  wtd: "이번 주 들어",
  mtd: "이번 달 들어",
  qtd: "분기 들어",
  ytd: "연초 대비",
};

const QUIET_BP = 2; // |Δ| below this reads as "quiet"

function bp(v: number): string {
  return `${Math.abs(v).toFixed(1)}bp`;
}

/** A move sentence: "연초 대비 22.0bp 내려왔어요" / "어제보다 조용해요". */
export function moveSentence(deltaBp: number | null, basis: BasisKey): string {
  if (deltaBp == null) return "아직 값이 없어요";
  if (Math.abs(deltaBp) < QUIET_BP) return "오늘은 조용해요";
  const dir = deltaBp > 0 ? "올라왔어요" : "내려왔어요";
  return `${BASIS_PHRASE[basis]} ${bp(deltaBp)} ${dir}`;
}

/** Home status line (one sentence). */
export function statusLine(tenYDeltaBp: number | null, basis: BasisKey): string {
  if (tenYDeltaBp == null) return "시장 데이터를 기다리고 있어요";
  if (Math.abs(tenYDeltaBp) < QUIET_BP) return "오늘 커브는 조용해요";
  const dir = tenYDeltaBp > 0 ? "올라왔어요" : "내려왔어요";
  return `장기 구간이 ${BASIS_PHRASE[basis]} ${bp(tenYDeltaBp)} ${dir}`;
}

/** Briefing headline. */
export function briefingHeadline(count: number): string {
  return count > 0
    ? `마지막으로 보신 뒤로 새로운 게 ${count}건 있어요`
    : "마지막으로 보신 뒤로 새로운 건 없어요";
}

export const BRIEFING_EMPTY = "그동안 시장이 잠잠했어요.";

/** One-sentence band-card summary. */
export function bandSummary(band: BandId, hero: Hero, basis: BasisKey): string {
  if (band === "vol") return "변동성은 아직 준비 중이에요";
  if (hero.now == null) return "값을 불러오지 못했어요";
  return `${hero.label}는 ${moveSentence(hero.deltaBp, basis)}`;
}

export const ERROR_SENTENCE = "불러오지 못했어요. 잠시 뒤 다시 시도해 주세요";
export const LOADING_SENTENCE = "불러오는 중이에요";
export const VOL_PLACEHOLDER = "변동성은 아직 준비 중이에요";

/** "지금 · 오후 3:21" style timestamp. */
export function stamp(asof: string): string {
  return `${asof} 종가 기준`;
}

export { MINUS };
