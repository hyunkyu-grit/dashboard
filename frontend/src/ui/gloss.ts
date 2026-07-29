/* Instrument explanation for the enlarged view (DESIGN §2 popup, Session 15
 * Pass C). What a thing *is* — static, keyed to instrument kind.
 *
 * §16: the API sends the classification (kind + legs, already present as
 * `kind`/`id`); the frontend renders the Korean here. No finished Korean string
 * ever ships from the backend, so wording changes never need a deploy. This is
 * purely presentation and lives only in the popup — it is not a table column
 * and not a row view-model field, so the row-vm-source guard is untouched.
 *
 * Since pass L deleted the 한 줄, THIS is one of the §16 exception's two
 * remaining subjects (the other is the curve banner) — see DESIGN §16. The
 * same classification also drives the Pay/Receive mode diagram, so `classify`
 * has two consumers, not one.
 *
 * Register: 합니다체, standard market terminology (§15, Pass H). Do not
 * paraphrase into everyday words. */

import type { Row } from "./rows";

export type Construct =
  | { kind: "outright"; tenor: string }
  | { kind: "call" } // the 1D overnight call rate (an outright row, but not an IRS)
  | { kind: "spread"; short: string; long: string }
  | { kind: "butterfly"; short: string; belly: string; long: string }
  | { kind: "forward"; start: string; tenor: string }
  | { kind: "volatility"; tenor: string }
  | { kind: "unknown" };

/** Classify a row from its group + id (the legs). Butterfly vs spread is the
 * leg count on a derived id; the call rate is the 1D outright. */
export function classify(row: Row): Construct {
  if (row.group === "vol") {
    return { kind: "volatility", tenor: row.id.replace(/^vol:/, "") };
  }
  if (row.group === "forward") {
    const [start, tenor] = row.id.split("x");
    return { kind: "forward", start, tenor };
  }
  if (row.group === "outright") {
    return row.id === "1D" ? { kind: "call" } : { kind: "outright", tenor: row.id };
  }
  const legs = row.id.split("-");
  if (legs.length === 3) {
    return { kind: "butterfly", short: legs[0], belly: legs[1], long: legs[2] };
  }
  if (legs.length === 2) {
    return { kind: "spread", short: legs[0], long: legs[1] };
  }
  return { kind: "unknown" };
}

/** Tenor label → Korean duration. "10Y"→"10년", "1.5Y"→"1년 6개월",
 * "1Y3M"→"1년 3개월", "6M"→"6개월", "1D"→"1일", "ON"→"익일", "SPOT"→"현물". */
export function tenorKo(t: string): string {
  if (t === "ON") return "익일";
  if (t === "1D") return "1일";
  if (t === "SPOT") return "현물";
  const y = t.match(/(\d+(?:\.\d+)?)Y/);
  const m = t.match(/(\d+)M/);
  const parts: string[] = [];
  if (y) {
    const val = parseFloat(y[1]);
    const whole = Math.floor(val);
    const frac = Math.round((val - whole) * 12);
    if (whole) parts.push(`${whole}년`);
    if (frac) parts.push(`${frac}개월`);
  }
  if (m) parts.push(`${parseInt(m[1], 10)}개월`);
  return parts.join(" ") || t;
}

/** A tight subtitle naming the construct, shown under the instrument name. */
export function instrumentSubtitle(row: Row): string {
  const c = classify(row);
  switch (c.kind) {
    case "call":
      return "익일물(콜) 금리";
    case "outright":
      return `${tenorKo(c.tenor)} 만기 IRS 파 금리`;
    case "spread":
      return `${c.short}·${c.long} 커브 스프레드`;
    case "butterfly":
      return `${c.short}·${c.belly}·${c.long} 버터플라이`;
    case "forward":
      return c.tenor === "SPOT"
        ? `${tenorKo(c.start)} 현물 파 금리`
        : `${tenorKo(c.start)} 후 ${tenorKo(c.tenor)} 선도금리`;
    case "volatility":
      return `${c.tenor} 상대 변동성`;
    default:
      return "";
  }
}

/** Two or three sentences (합니다체) — what it is, how it is built, what a
 * rising value means. Keyed to kind; legs interpolated from the classification.
 * The wording is fixed (§ Pass C1) — do not paraphrase; gloss.test.ts pins it. */
export function instrumentGloss(row: Row): string {
  const c = classify(row);
  switch (c.kind) {
    case "call":
      return "익일물 콜 금리입니다. 국내 단기자금시장의 기준이 되는 초단기 금리이며, IRS 커브의 단기 앵커로 쓰입니다.";
    case "outright":
      return `${tenorKo(c.tenor)} 만기 KRW IRS 파 금리입니다. CD 91일물을 변동금리로 교환하는 조건이며, 국내 IRS 시장의 표준 호가입니다.`;
    case "spread":
      return `${c.short}·${c.long} 커브 스프레드. ${c.long}에서 ${c.short}를 뺀 값입니다. 확대는 스티프닝, 축소는 플래트닝을 뜻합니다.`;
    case "butterfly":
      return `${c.short}·${c.belly}·${c.long} 버터플라이. ${c.belly} 금리의 두 배에서 ${c.short}와 ${c.long}를 뺀 값입니다. 확대되면 벨리가 윙 대비 약세, 축소되면 강세입니다.`;
    case "forward":
      return c.tenor === "SPOT"
        ? `현재 커브에서 도출한 ${tenorKo(c.start)} 현물 파 금리입니다. 해당 만기 구간에 대한 시장의 기대 금리를 나타냅니다.`
        : `${tenorKo(c.start)} 후 시작하는 ${tenorKo(c.tenor)} 내재 선도금리입니다. 현재 커브에서 도출되며, 해당 구간에 대한 시장의 기대 금리를 나타냅니다.`;
    case "volatility":
      return "최근 5일 평균 변동폭을 60일 평균으로 나눈 상대 변동성 지표입니다. 1을 넘으면 단기 변동성이 장기 평균보다 확대된 상태입니다.";
    default:
      return "";
  }
}
