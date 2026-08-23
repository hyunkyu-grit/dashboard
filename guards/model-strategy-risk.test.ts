/* 리스크 세 줄과 「이 답이 0 으로 놓은 것」 띠.
 *
 * ## 하중 셋
 *
 *   ① r* 줄에 **숫자가 없다**            — 실측 0 이라 지어낼 자리가 없다
 *   ② σ 상수가 원본과 갈리지 않았다      — 사본은 반드시 갈린다
 *   ③ `effect` 값별로 문구가 갈린다      — 출처 없는 칸은 렌더가 아니라 **선다**
 *
 * ①이 이 가드에서 제일 중요하다. 「±0.5%면 10년이 ±XXbp」 는 이 제품에서 XX 가
 * 0 이고, 숫자를 쓰는 순간 지어낸 것이 된다. 그래서 그 줄에 bp 가 붙으면 선다.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CONDITIONAL_NOTE,
  EFFECT_ORDER,
  NO_DELTA_ITEMS,
  STALENESS_LABEL,
  assumptionValue,
  effectGroups,
  ASSUMPTIONS,
  ENGINE_STATUS,
} from '@/lab/model/strategy/assumptions';
import { PINNED_Q, solvePath } from '@/lab/model/strategy/path';
import {
  RESIDUAL_TREATMENT,
  RULE_RESIDUAL_AR1,
  RULE_RESIDUAL_AR1_SE,
  RULE_SIGMA_PP,
  RULE_SIGMA_SAMPLE,
  horizonExitBp,
  riskLines,
  ruleDeviationSigma,
} from '@/lab/model/strategy/risk';
import { decomposeTenor } from '@/lab/model/strategy/decompose';
import BASIS from '@/lab/model/artifacts/scenario_basis.json';

const CUT = solvePath(Array<number>(PINNED_Q).fill(-25));
const HOLD = solvePath(Array<number>(PINNED_Q).fill(0));
const HEAD = decomposeTenor(CUT, '3y', 4);

/* ── ② σ 상수가 원본과 같다 ─────────────────────────────────────────────── */

const MOMENTS = path.join(import.meta.dirname, '..', 'backend', 'output', 'residual_moments.json');

describe('준칙 잔차 σ 는 엔진 산출물의 사본이다', () => {
  it('원본 파일이 제자리에 있다', () => {
    expect(fs.existsSync(MOMENTS), 'residual_moments.json 이 없어요 — 리베이크를 돌리세요').toBe(true);
  });

  it('σ · 표본 · AR(1) 이 원본과 같다', () => {
    const doc = JSON.parse(fs.readFileSync(MOMENTS, 'utf8')) as {
      sigma_diagonal_std: Record<string, number>;
      equations: Record<string, { sample: string; ar1: number }>;
    };
    expect(doc.sigma_diagonal_std.policy_rule).toBeCloseTo(RULE_SIGMA_PP, 10);
    expect(doc.equations.policy_rule.ar1).toBeCloseTo(RULE_RESIDUAL_AR1, 10);
    /* 표본 문자열은 하이픈 종류가 다를 수 있어 숫자만 본다. */
    expect(RULE_SIGMA_SAMPLE.replace(/[^0-9Q]/g, '')).toBe(
      doc.equations.policy_rule.sample.replace(/[^0-9Q]/g, ''),
    );
  });
});

/* ── ① r* 줄에 숫자가 없다 ──────────────────────────────────────────────── */

describe('r* 줄', () => {
  const line = riskLines(CUT, HEAD).find((r) => r.key === 'r-star')!;

  /* 이 줄에 bp 가 나오는 자리는 **실측한 0** 하나뿐이어야 한다. 0 이 아닌 bp 가
     하나라도 있으면 그건 지어낸 민감도다. 정규식으로 «bp 금지» 를 걸면 0 까지
     막혀서 «재 봤더니 0» 이라는 사실도 같이 사라진다. */
  it('0 이 아닌 bp 민감도를 안 적는다 — 실측 0 이라 적을 것이 없다', () => {
    const numbers = [...line.text.matchAll(/(\d+(?:\.\d+)?)\s*bp/g)].map((m) => Number(m[1]));
    expect(numbers.length, 'bp 가 한 번은 나와야 «재 봤다» 가 성립해요').toBeGreaterThan(0);
    expect(
      numbers.filter((v) => v !== 0),
      '지어낸 민감도예요',
    ).toEqual([]);
    expect(line.text).not.toMatch(/XX/);
  });

  it('실측했다는 사실은 말한다', () => {
    expect(line.text).toContain('0.000000bp');
  });

  it('논문 각주 24 를 인용하고 미공표라고 단다', () => {
    expect(line.badges).toContain('논문 각주 24');
    expect(line.badges).toContain('논문 미공표');
  });

  it('문장을 화면이 다시 쓰지 않는다 — assumptions.json 의 것 그대로다', () => {
    const rs = ASSUMPTIONS.items.find((i) => i.key === 'r_star')!;
    expect(line.text).toBe(rs.effect_note);
    expect(rs.effect).toBe('level_only');
  });
});

/* ── 지평 이탈 ──────────────────────────────────────────────────────────── */

describe('지평 이탈 줄', () => {
  it('되돌림은 i_kr[q12] − i_kr[q8] 이다 — 조합된 경로에서 읽는다', () => {
    expect(horizonExitBp(CUT)).toBeCloseTo((CUT.iKr[11] - CUT.iKr[7]) * 100, 10);
  });

  /* 실측(P4 D.4, `output/p4/d4_tail.json`): 지속 −25×8 이면 q12 까지
     **+14.8bp** 를 되돌린다.

     **D.4 전에는 +27.8bp 였다** — 25bp 인하를 세 분기 만에 전부 되돌리고
     넘어서는 크기였다. 그게 그렇게 큰 이유는 「경로가 끝나면 완화 쪽 잔차가
     그 순간 증발한다」 였기 때문이고, 그건 정한 것이 아니라 안 채운 것이었다.
     ρ=0.801 로 잦아들게 하니 절반이 됐다. 각주가 아니라 숫자의 몫이다. */
  it('지속 −25×8 의 되돌림이 실측과 같다', () => {
    expect(horizonExitBp(CUT)).toBeCloseTo(14.79, 1);
  });

  /* 감쇠가 실제로 실렸나 — 이름만 바꾸고 숫자가 옛것이면 여기서 걸린다. */
  it('기저가 감쇠를 싣고 왔고 화면이 그 이름을 쓴다', () => {
    const tail = (BASIS as { residual_tail: Record<string, unknown> }).residual_tail;
    expect(tail.treatment).toBe('decay');
    expect(tail.rho).toBeCloseTo(RULE_RESIDUAL_AR1, 3);
    expect(tail.rho_se_nw).toBeCloseTo(RULE_RESIDUAL_AR1_SE, 4);
    expect(tail.pin_window_q).toBe(8);
    expect(tail.in_paper).toBe(false);
    expect(RESIDUAL_TREATMENT).toBe('감쇠');
  });

  it('동결이면 되돌릴 것이 없다고 말한다 — 0bp 라고 안 적는다', () => {
    const line = riskLines(HOLD, null).find((r) => r.key === 'horizon-exit')!;
    expect(line.text).toContain('되돌릴 것이 없어요');
  });

  it('우리 해석이라고 달고, 구현한 잔차 처리의 이름을 화면에 낸다', () => {
    const line = riskLines(CUT, HEAD).find((r) => r.key === 'horizon-exit')!;
    expect(line.badges).toContain('논문에 없는 해석이에요');
    expect(line.badges).toContain(`잔차 처리: ${RESIDUAL_TREATMENT}`);
    expect(line.source).toContain('각주 31');
    /* 대안(부록 C 의 AR 감쇠)을 근거 숫자와 같이 남긴다 — 화면이 «이게 유일한
       처리다» 로 읽히면 안 된다. */
    expect(line.source).toContain(String(RULE_RESIDUAL_AR1));
  });

  it('헤드라인 테너의 준칙 몫을 같이 말한다', () => {
    const line = riskLines(CUT, HEAD).find((r) => r.key === 'horizon-exit')!;
    expect(line.text).toMatch(/\d+% 가 그 되돌림/);
  });
});

/* ── 룰 이탈 σ ──────────────────────────────────────────────────────────── */

describe('룰 이탈 σ', () => {
  it('RMS 를 헤드라인으로 쓰고 max 를 같이 든다', () => {
    const s = ruleDeviationSigma(CUT);
    const u = CUT.ruleResidual;
    const rms = Math.sqrt(u.reduce((a, v) => a + v * v, 0) / u.length) / RULE_SIGMA_PP;
    const max = u.reduce((a, v) => Math.max(a, Math.abs(v)), 0) / RULE_SIGMA_PP;
    expect(s.rms).toBeCloseTo(rms, 12);
    expect(s.max).toBeCloseTo(max, 12);
    expect(s.max).toBeGreaterThan(s.rms);
  });

  /* 실측(진단 §C.4): 지속 −25×8 은 RMS 0.22σ, 가장 큰 분기 0.51σ. */
  it('지속 −25×8 이 실측과 같다', () => {
    const s = ruleDeviationSigma(CUT);
    expect(s.rms).toBeCloseTo(0.22, 2);
    expect(s.max).toBeCloseTo(0.51, 2);
  });

  it('동결이면 준칙과 같다고 말한다 — 0.0σ 라고 안 적는다', () => {
    const line = riskLines(HOLD, null).find((r) => r.key === 'rule-deviation')!;
    expect(line.text).toContain('준칙이 하려는 것과 같아요');
  });

  it('표본을 인용한다', () => {
    const line = riskLines(CUT, HEAD).find((r) => r.key === 'rule-deviation')!;
    expect(line.badges).toContain(RULE_SIGMA_SAMPLE);
    expect(line.source).toContain('residual_moments.json');
  });
});

/* ── ③ 가정 띠 ─────────────────────────────────────────────────────────── */

describe('이 답이 0 으로 놓은 것', () => {
  const groups = effectGroups();

  it('effect 값별로 묶고 문구가 갈린다', () => {
    expect(groups.map((g) => g.effect)).toEqual(EFFECT_ORDER);
    const by = Object.fromEntries(groups.map((g) => [g.effect, g.headline]));
    expect(by.not_in_basis).toContain('안 움직인다고 봤어요');
    expect(by.level_only).toContain('레벨 전망');
    expect(new Set(Object.values(by)).size).toBe(3);
  });

  /* 지금 `delta` 항목이 0개다. 그 사실을 숨기면 «정책 말고도 뭔가 들어갔겠지» 로
     읽히고, 그게 이 띠가 막으려는 오독이다. */
  it('델타를 움직이는 항목이 하나도 없다는 사실을 숨기지 않는다', () => {
    const delta = groups.find((g) => g.effect === 'delta')!;
    expect(delta.items).toHaveLength(0);
    expect(NO_DELTA_ITEMS).toContain('하나도 없어요');
  });

  it('조건부라는 것을 띠가 스스로 말한다', () => {
    expect(CONDITIONAL_NOTE).toContain('정책 경로만');
  });

  it('r*·π* 는 level_only 이고 나머지 셋은 not_in_basis 다', () => {
    const by = Object.fromEntries(ASSUMPTIONS.items.map((i) => [i.key, i.effect]));
    expect(by.r_star).toBe('level_only');
    expect(by.pi_star).toBe('level_only');
    for (const k of ['us_policy', 'oil', 'foreign_growth']) expect(by[k], k).toBe('not_in_basis');
  });

  it('출처가 빈 칸이 있으면 렌더가 아니라 선다', () => {
    const broken = {
      ...ASSUMPTIONS,
      items: ASSUMPTIONS.items.map((i, n) => (n === 0 ? { ...i, source: '  ' } : i)),
    };
    expect(() => effectGroups(broken)).toThrow(/출처가 없어요/);
  });

  it('effect 설명이 빈 칸도 마찬가지다', () => {
    const broken = {
      ...ASSUMPTIONS,
      items: ASSUMPTIONS.items.map((i, n) => (n === 0 ? { ...i, effect_note: '' } : i)),
    };
    expect(() => effectGroups(broken)).toThrow(/effect 설명/);
  });

  it('못 받은 값은 0 이 아니라 줄표다', () => {
    const missing = ASSUMPTIONS.items.find((i) => i.value === null)!;
    expect(assumptionValue(missing)).toBe('—');
  });

  it('신선도는 엔진이 판정한 것을 읽기만 한다', () => {
    expect(Object.keys(STALENESS_LABEL).sort()).toEqual(['blocked', 'fresh', 'stale']);
    expect(STALENESS_LABEL[ENGINE_STATUS.staleness.state]).toBeTruthy();
    expect(ENGINE_STATUS.staleness.why.trim()).not.toBe('');
  });
});
