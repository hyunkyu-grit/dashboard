/* 트레이드 — 모형 − 시장 벡터에서 **산술로** 나오는 것만.
 *
 * ## 진입·목표·손절을 안 적는다
 *
 * 그건 트레이더의 몫이다. 한 번 빗나가는 날 이 화면이 가진 신뢰를 전부 잃고,
 * 그 신뢰는 «모형이 뭘 보는가» 를 정직하게 말해서 번 것이다. 방향·크기·수렴
 * 지평까지가 이 물건이 아는 것의 끝이다.
 *
 * ## 모형 − 시장은 «전망» 이 아니라 «캐리 대비» 다
 *
 *     시나리오 − 현재      전망
 *     모형 Δ − 시장 캐리    **트레이드**
 *
 * 전망이 맞아도 시장이 이미 그만큼 프라이싱했으면 포지션이 없다. 이 계약은
 * `lab/scenario/assemble.ts` 가 먼저 세운 것이고 백엔드가 그 모양으로 답한다
 * (`/api/scenario/anchors`).
 *
 * 앵커가 스스로 붙인 경고 하나를 화면이 승계해야 한다 —
 * **`CARRY_NOT_EXPECTATION`**: 캐리는 커브가 함의하는 이동이지 정책 기대가
 * 아니다(기간프리미엄이 섞여 있다). 「시장은 인하를 예상한다」로 옮기면 안 된다.
 *
 * ## 10년은 후보에 없다 [실측, 진단 §C.6]
 *
 * 1Y 시작 10Y 포워드는 11Y 할인계수를 부르는데 IRS 커브가 10Y 에서 끝난다.
 * 백엔드가 외삽을 거절하고 `carry12mBp = null` 을 보낸다(`TENOR_10Y_NO_CARRY`).
 * 그래서 과제 문안의 예시 「2s10s 스티프너」는 **시장 대비 숫자를 못 단다.**
 * 빼고, 왜 뺐는지 화면이 말한다. 빈칸은 0 이 아니다.
 *
 * ## 12개월 자리에만 트레이드가 선다
 *
 * 포워드 시작점이 1년이라 캐리는 **12개월짜리 하나**다. 3개월·6개월 자리에서
 * 그 캐리를 비례로 잘라 쓰면 그건 우리가 만든 숫자다. 그 자리에서는 전망만
 * 보이고 트레이드 줄은 «여기서는 못 재요» 라고 말한다.
 */

import { TENORS, type PathSolution, type Tenor } from './path';

/** 12개월 = 4분기. `assemble.ts::H_12M` 와 같은 자리다. */
export const H_12M = 4;

/** 백엔드가 답하는 한 테너의 오늘. `/api/scenario/anchors` 의 모양 그대로. */
export type TenorAnchor = {
  spot: number;
  /** 1Y 시작 τ 포워드 − 같은 커브의 τ 스팟, bp. 커브 밖이면 `null` — 0 이 아니다. */
  carry12mBp: number | null;
  /** 포워드의 시작·끝이 **둘 다** 라이브 호가 노드인가. 자릿수가 아니라 확신이다. */
  live: boolean;
};

export type StrategyAnchors = {
  asof: string;
  cd: number;
  base: number | null;
  irs: Record<Tenor, TenorAnchor>;
  caveats?: string[];
};

export type TenorGap = {
  tenor: Tenor;
  spot: number;
  /** 모형 Δ, bp. 선택한 지평에서. */
  deltaBp: number;
  carry12mBp: number | null;
  /** 모형 Δ − 시장 캐리, bp. 12개월 자리가 아니거나 캐리가 없으면 `null`. */
  vsMarketBp: number | null;
  /** 시나리오가 보는 그날의 레벨, %. */
  modelPct: number;
  /** 시장이 이미 프라이싱한 그날의 레벨, %. 캐리가 없으면 `null`. */
  marketPct: number | null;
  live: boolean;
  /** |Δ| 가 가장 커지는 분기. 1..12 에서 고른다 — 0 은 구성상 0 이라 뺀다. */
  convergenceQ: number;
  /** 그 최댓값이 **기저의 마지막 분기**에 있나. 그렇다면 «여기서 수렴한다» 가
   *  아니라 «여기까지밖에 못 본다» 이고, 화면이 그 둘을 구별해야 한다. */
  convergenceAtEdge: boolean;
};

/** 왜 이 테너가 트레이드 후보에서 빠졌나. 비어 있는 척하지 않는다. */
export type Excluded = { tenor: Tenor; why: string };

export type GapVector = {
  h: number;
  gaps: TenorGap[];
  /** 시장 대비를 잴 수 있는 테너만. 후보는 여기서만 나온다. */
  tradable: TenorGap[];
  excluded: Excluded[];
};

function convergenceQ(series: readonly number[]): number {
  let best = 1;
  for (let h = 1; h < series.length; h += 1) {
    if (Math.abs(series[h]) > Math.abs(series[best])) best = h;
  }
  return best;
}

/** 기저가 IRS 를 담은 마지막 분기. 여기서 최대면 «지평 끝» 이다. */
export const LAST_H = 12;

export function gapVector(sol: PathSolution, anchors: StrategyAnchors, h: number): GapVector {
  const gaps: TenorGap[] = TENORS.map((tenor) => {
    const a = anchors.irs[tenor];
    const dPp = sol.irs[tenor][h];
    const deltaBp = dPp * 100;
    const carry = h === H_12M ? a.carry12mBp : null;
    return {
      tenor,
      spot: a.spot,
      deltaBp,
      carry12mBp: a.carry12mBp,
      vsMarketBp: carry === null ? null : deltaBp - carry,
      modelPct: a.spot + dPp,
      marketPct: carry === null ? null : a.spot + carry / 100,
      live: a.live,
      convergenceQ: convergenceQ(sol.irs[tenor]),
      convergenceAtEdge: convergenceQ(sol.irs[tenor]) === LAST_H,
    };
  });

  const tradable = gaps.filter((g) => g.vsMarketBp !== null);
  const excluded: Excluded[] = gaps
    .filter((g) => g.vsMarketBp === null)
    .map((g) => ({
      tenor: g.tenor,
      why:
        h === H_12M
          ? '12개월 포워드가 커브 밖이에요 — IRS 커브가 10년에서 끝나거든요.'
          : '시장 캐리는 12개월 자리에만 있어요 — 포워드 시작점이 1년이거든요.',
    }));

  return { h, gaps, tradable, excluded };
}

/* ── 후보 ──────────────────────────────────────────────────────────────────
 *
 * 셋 다 위 벡터의 **뺄셈**이다. 숨은 모수가 없다는 것이 이 파일의 하중이고,
 * `guards/model-strategy-trades.test.ts` 가 그것부터 본다.
 */

export type Candidate = {
  kind: 'outright' | 'curve' | 'fly';
  /** 다리들, 짧은 쪽부터. */
  legs: Tenor[];
  /** 화면과 노트가 그대로 쓰는 이름 — `3Y 리시브` · `2s5s 스티프너`. */
  label: string;
  /** 부호 있는 크기, bp. 양수 = 모형이 시장보다 높게 본다. */
  bp: number;
  /** 수렴 지평, 분기. 다리들 중 |Δ| 가 가장 늦게 최대가 되는 쪽. */
  convergenceQ: number;
  /** 그 자리가 기저의 마지막 분기인가 — «수렴» 이 아니라 «여기까지밖에 못 봄». */
  convergenceAtEdge: boolean;
  /** 다리 하나라도 포워드 끝점이 호가가 아니면 참. */
  interpolatedLeg: boolean;
};

const LABEL: Record<Tenor, string> = {
  '1y': '1Y',
  '2y': '2Y',
  '3y': '3Y',
  '5y': '5Y',
  '10y': '10Y',
};
const SHORT: Record<Tenor, string> = { '1y': '1', '2y': '2', '3y': '3', '5y': '5', '10y': '10' };

const YEARS: Record<Tenor, number> = { '1y': 1, '2y': 2, '3y': 3, '5y': 5, '10y': 10 };

function combo(
  gaps: TenorGap[],
  legs: Tenor[],
  weights: number[],
): { bp: number; conv: number; interp: boolean } {
  let bp = 0;
  let conv = 0;
  let interp = false;
  legs.forEach((t, i) => {
    const g = gaps.find((x) => x.tenor === t);
    if (!g || g.vsMarketBp === null) throw new Error(`${LABEL[t]} 는 시장 대비를 못 재요`);
    bp += weights[i] * g.vsMarketBp;
    conv = Math.max(conv, g.convergenceQ);
    if (!g.live) interp = true;
  });
  return { bp, conv, interp };
}

/** 아웃라이트 — |모형 − 시장| 이 가장 큰 한 칸. */
export function bestOutright(v: GapVector): Candidate | null {
  const sorted = [...v.tradable].sort((a, b) => Math.abs(b.vsMarketBp!) - Math.abs(a.vsMarketBp!));
  const g = sorted[0];
  if (!g) return null;
  return {
    kind: 'outright',
    legs: [g.tenor],
    label: `${LABEL[g.tenor]} ${g.vsMarketBp! > 0 ? '페이' : '리시브'}`,
    bp: g.vsMarketBp!,
    convergenceQ: g.convergenceQ,
    convergenceAtEdge: g.convergenceAtEdge,
    interpolatedLeg: !g.live,
  };
}

/** 커브 — 모형 기울기 − 시장 기울기가 가장 큰 쌍. `긴쪽 − 짧은쪽`. */
export function bestCurve(v: GapVector): Candidate | null {
  const ts = [...v.tradable].sort((a, b) => YEARS[a.tenor] - YEARS[b.tenor]).map((g) => g.tenor);
  let best: Candidate | null = null;
  for (let i = 0; i < ts.length; i += 1) {
    for (let j = i + 1; j < ts.length; j += 1) {
      const { bp, conv, interp } = combo(v.tradable, [ts[i], ts[j]], [-1, 1]);
      if (best && Math.abs(bp) <= Math.abs(best.bp)) continue;
      best = {
        kind: 'curve',
        legs: [ts[i], ts[j]],
        label: `${SHORT[ts[i]]}s${SHORT[ts[j]]}s ${bp > 0 ? '스티프너' : '플래트너'}`,
        bp,
        convergenceQ: conv,
        convergenceAtEdge: conv === LAST_H,
        interpolatedLeg: interp,
      };
    }
  }
  return best;
}

/** 플라이 — `2×벨리 − 양날개`. 부호가 벨리를 페이할지 리시브할지 정한다. */
export function bestFly(v: GapVector): Candidate | null {
  const ts = [...v.tradable].sort((a, b) => YEARS[a.tenor] - YEARS[b.tenor]).map((g) => g.tenor);
  let best: Candidate | null = null;
  for (let i = 0; i < ts.length; i += 1) {
    for (let j = i + 1; j < ts.length; j += 1) {
      for (let k = j + 1; k < ts.length; k += 1) {
        const { bp, conv, interp } = combo(v.tradable, [ts[i], ts[j], ts[k]], [-1, 2, -1]);
        if (best && Math.abs(bp) <= Math.abs(best.bp)) continue;
        best = {
          kind: 'fly',
          legs: [ts[i], ts[j], ts[k]],
          label: `${SHORT[ts[i]]}s${SHORT[ts[j]]}s${SHORT[ts[k]]}s 벨리 ${bp > 0 ? '페이' : '리시브'}`,
          bp,
          convergenceQ: conv,
          convergenceAtEdge: conv === LAST_H,
          interpolatedLeg: interp,
        };
      }
    }
  }
  return best;
}

export function candidates(v: GapVector): Candidate[] {
  return [bestOutright(v), bestCurve(v), bestFly(v)].filter((c): c is Candidate => c !== null);
}

/** 헤드라인 — |모형 − 시장| 이 가장 큰 한 칸. 「함의」 줄이 이걸 말한다. */
export function headlineGap(v: GapVector): TenorGap | null {
  const sorted = [...v.tradable].sort((a, b) => Math.abs(b.vsMarketBp!) - Math.abs(a.vsMarketBp!));
  return sorted[0] ?? null;
}
