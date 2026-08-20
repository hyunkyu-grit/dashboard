/* 경로 프리셋 — **씨앗**이지 주장이 아니다.
 *
 * 이름은 시뮬레이션의 케이스 넷과 같다 [OWNER, 2026-08-20]. 같은 앱에서 같은 것을
 * 두 이름으로 부르지 않기 위해서고, 방향 규약도 그쪽 것을 그대로 승계한다 —
 * **불은 금리 하락, 베어는 상승**(채권시장 관행, 주식과 반대).
 *
 * 시뮬의 씨앗은 커브 이동(bp)이고 여기 씨앗은 **정책 레벨 경로**다. 같은 이름이
 * 다른 단위를 다는 것이 아니라, 같은 이야기를 각자의 입력으로 적은 것이다.
 *
 * ── 8개 점은 스텝이 아니라 레벨이다 ─────────────────────────────────────────
 * `[-25, -50, -75, -100, …]` 은 네 번의 인하다. `[-25, -25, -25, …]` 는 **한 번**
 * 인하하고 그대로 두는 것이다. 화면의 칸 라벨이 그 사실을 말하고, 씨앗도 그
 * 문법으로 적혀 있다.
 *
 * ── 넷 다 검증 영역 안이다 [실측 수리 2026-08-20] ──────────────────────────
 * 첫 판은 «네 분기에 걸쳐 100bp 인하» 처럼 적었다가 고르는 순간 «검증 영역 밖»
 * 배지가 떴다. 기저의 `domain.policy_bp_per_q` 가 ±50 이라 그 밖은 선형 외삽이고,
 * 손잡이 드롭다운도 ±50 까지만 고를 수 있다 — **씨앗이 도구가 표현할 수 없는 값을
 * 내밀고 있었다.**
 *
 * 그래서 넷 다 ±50 안으로 내렸다. 이 도구가 말할 수 있는 것이 거기까지라는 사실은
 * 숨길 것이 아니라 씨앗이 먼저 보여줄 것이다. 더 큰 경로가 필요하면 손으로 밀 수
 * 있고, 그때 배지가 «여기부터는 외삽» 이라고 말한다.
 *
 * 크기는 시장 관행 폭(분기당 25bp)에서 왔고 모형이 정한 값이 아니다. 넷 다 고쳐
 * 쓰라고 있는 것이라, 하나를 골라도 그 순간부터 내 경로다.
 */

import type { Knobs } from './combine';
import { ZERO_KNOBS } from './combine';

export type PresetId = 'base' | 'bull' | 'bear' | 'crisis';

export const PRESETS: readonly {
  id: PresetId;
  label: string;
  /** 한 줄 설명. 화면이 그대로 출력한다. */
  blurb: string;
  policyBp: number[];
}[] = [
  {
    id: 'base',
    label: 'Base',
    blurb: '8분기 내내 동결',
    policyBp: [0, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'bull',
    label: 'Bull',
    blurb: '두 번에 걸쳐 50bp 인하하고 유지',
    policyBp: [-25, -25, -50, -50, -50, -50, -50, -50],
  },
  {
    id: 'bear',
    label: 'Bear',
    blurb: '두 번에 걸쳐 50bp 인상하고 유지',
    policyBp: [25, 25, 50, 50, 50, 50, 50, 50],
  },
  {
    id: 'crisis',
    label: 'Crisis',
    blurb: '첫 분기에 50bp 인하하고 유지',
    policyBp: [-50, -50, -50, -50, -50, -50, -50, -50],
  },
];

export function knobsFromPreset(id: PresetId): Knobs {
  const p = PRESETS.find((x) => x.id === id) ?? PRESETS[0];
  return { ...ZERO_KNOBS, policyBp: [...p.policyBp] };
}

/**
 * 지금 경로가 어느 프리셋과 **글자 그대로** 같은가. 하나라도 다르면 `null` 이다.
 *
 * 손으로 고친 뒤에도 알약이 눌린 채로 남으면 화면이 "이건 Bull 이다" 라고
 * 거짓말한다. 나머지 손잡이(CPI·갭·수출·Fed·유가)까지 본다 — 정책 경로만 같고
 * 유가가 켜져 있으면 그건 프리셋이 아니다.
 */
export function matchPreset(knobs: Knobs): PresetId | null {
  const zeroShocks =
    knobs.cpiPp === 0 &&
    knobs.gapPp === 0 &&
    knobs.exportsPct === 0 &&
    knobs.usBp === 0 &&
    knobs.oilPct === 0;
  if (!zeroShocks) return null;
  for (const p of PRESETS) {
    if (p.policyBp.every((v, i) => v === knobs.policyBp[i])) return p.id;
  }
  return null;
}
