/* 「이 답이 0 으로 놓은 것」 띠.
 *
 * ## 이건 «가정 띠» 가 아니다 [P1 이 계획을 뒤집었다]
 *
 * 원래 설계는 「미 정책금리: FOMC 닷 · 유가: 브렌트 선물 · 해외성장: 컨센서스」를
 * 나란히 세우는 것이었다. **그 띠는 거짓말이 된다** — 편차 기저에 그 값들이
 * 애초에 안 들어 있고, `r*` 는 효과가 실측 0.000000bp 다.
 *
 * 그래서 이 띠가 말하는 것은 «모형이 딛고 선 값» 이 아니라 **«이 답이 0 으로
 * 놓은 것»** 이다. 그러면 단일 입력의 진짜 의미가 드러난다 — 이 답은
 * «정책 경로만 바뀌고 나머지는 그대로» 라는 **조건부**다.
 *
 * ## `effect` 가 문구를 가른다
 *
 *     delta         화면의 bp 를 실제로 움직인다     ← 지금 **하나도 없다**
 *     level_only    레벨 전망에만                   ← r* · π*
 *     not_in_basis  기저가 아예 안 쓴다             ← 미 정책금리 · 유가 · 해외성장
 *
 * `delta` 가 0개라는 사실을 숨기지 않는다. 숨기면 «정책 말고도 뭔가 들어갔겠지»
 * 로 읽히고, 그게 이 띠가 막으려는 오독이다.
 *
 * ## 편집 불가
 *
 * Layer 2 는 보여 주되 절대 편집 불가다. 손잡이를 달면 «이걸 바꾸면 숫자가
 * 바뀐다» 는 약속이 되는데, 실측상 안 바뀐다.
 */

import assumptionsJson from '../artifacts/assumptions.json';
import engineStatusJson from '../artifacts/engine_status.json';
import type { Assumption, AssumptionEffect, Assumptions, EngineStatus } from '../contracts';

export const ASSUMPTIONS = assumptionsJson as unknown as Assumptions;
export const ENGINE_STATUS = engineStatusJson as unknown as EngineStatus;

/** 묶음 하나 — `effect` 별로 문구가 갈린다. */
export type EffectGroup = {
  effect: AssumptionEffect;
  /** 이 묶음이 화면에 세우는 한 문장. */
  headline: string;
  items: Assumption[];
};

/** `effect` 별 한 문장. **P1 이 문구까지 정했다** — 여기서 다시 쓰지 않는다. */
const HEADLINE: Record<AssumptionEffect, string> = {
  delta: '이 값들이 화면의 bp 를 실제로 움직여요.',
  level_only: 'r* 가정은 이 화면의 bp 를 안 바꿔요 — 레벨 전망을 낼 때만 걸려요.',
  not_in_basis: '미국·유가·해외수요는 안 움직인다고 봤어요 — 움직이면 이 숫자는 달라져요.',
};

/** `delta` 묶음이 비었을 때 그 자리에 서는 문장. 빈칸으로 두지 않는다. */
export const NO_DELTA_ITEMS =
  '이 화면의 bp 를 움직이는 가정은 하나도 없어요 — 움직이는 건 정책 경로 하나예요.';

/** 조건부라는 사실을 띠가 스스로 말한다. */
export const CONDITIONAL_NOTE =
  '이 답은 «정책 경로만 바뀌고 나머지는 그대로» 라는 조건부예요.';

export const EFFECT_ORDER: AssumptionEffect[] = ['delta', 'level_only', 'not_in_basis'];

/**
 * 띠의 재료. **출처가 빈 항목이 있으면 던진다** — 빈칸으로 렌더하느니 선다.
 *
 * 빈 출처를 그냥 그리면 그 칸만 근거 없는 숫자가 되고, 그건 화면에서 안 보인다.
 */
export function effectGroups(doc: Assumptions = ASSUMPTIONS): EffectGroup[] {
  for (const it of doc.items) {
    if (!String(it.source ?? '').trim()) {
      throw new Error(`가정 «${it.key}» 에 출처가 없어요 — 빈칸으로 그리지 않아요`);
    }
    if (!String(it.effect_note ?? '').trim()) {
      throw new Error(`가정 «${it.key}» 에 effect 설명이 없어요`);
    }
  }
  return EFFECT_ORDER.map((effect) => ({
    effect,
    headline: HEADLINE[effect],
    items: doc.items.filter((i) => i.effect === effect),
  }));
}

/** 값 한 칸. 못 받았으면 0 이 아니라 줄표다. */
export function assumptionValue(it: Assumption): string {
  if (it.value === null) return '—';
  return it.unit ? `${it.value}${it.unit}` : String(it.value);
}

/** 신선도 — **다시 판정하지 않는다.** 엔진이 판정해서 싣고 화면은 읽는다. */
export function staleness(st: EngineStatus = ENGINE_STATUS) {
  return st.staleness;
}

/** 신선도 상태의 사람 말. 상태 이름을 그대로 찍으면 영어가 화면에 선다. */
export const STALENESS_LABEL: Record<EngineStatus['staleness']['state'], string> = {
  fresh: '최신이에요',
  stale: '다시 구워야 해요',
  blocked: '막혀 있어요',
};
