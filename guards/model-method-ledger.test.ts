/* 방법 면이 지는 명제들.
 *
 * ## 하나만 고르면 이것이다
 *
 * **맞춘 값을 시험한 값으로 내보내지 않는다.** β_sync 는 논문의 «미 +25bp →
 * 한국 장기 +0.06%p» 에 맞춰 핀한 자유모수인데, 스코어카드에서 그 칸이 다른
 * 칸과 같은 모양으로 서면 독자는 그것을 독립적인 확인으로 읽는다. 그건 화면이
 * 하는 거짓말 중 검사할 수 없는 종류다.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import backtestJson from '../src/lab/model/method/backtest_2021_cycle.json';
import methodJson from '../src/lab/model/method/method_surface.json';
import modelJson from '../src/lab/model/model/model_surface.json';
import graphJson from '../src/lab/model/model/wiring_graph.json';
import anchorsJson from '../src/lab/model/artifacts/paper_anchors.json';
import { ANCHORS, hrefFor, ledgerRow } from '../src/lab/model/anchors';
import { splitEmphasis } from '../src/lab/model/model/emph';
import type { Graph } from '../src/lab/model/model/layout';

/* eslint-disable @typescript-eslint/no-explicit-any */
const M = methodJson as any;
const MODEL = modelJson as any;
const B = backtestJson as any;
const G = graphJson as unknown as Graph;
const PAPER = anchorsJson as any;

describe('해석 원장', () => {
  it('행마다 논문 인용과 코드 참조를 **둘 다** 든다', () => {
    expect(M.ledger.length).toBeGreaterThan(8);
    for (const r of M.ledger) {
      expect(r.paper, r.key).toBeTruthy();
      expect(String(r.paper).length, r.key).toBeGreaterThan(3);
      expect(r.code, r.key).toBeTruthy();
      expect(String(r.code), r.key).toMatch(/(backend\/|output\/)/);
    }
  });

  it('행마다 네 칸이 다 차 있다 — 「어떻게 틀릴 수 있나」 를 비우면 원장이 아니다', () => {
    for (const r of M.ledger) {
      for (const k of ['paper_says', 'we_do', 'why', 'could_be_wrong']) {
        expect(String(r[k] ?? '').length, `${r.key}.${k}`).toBeGreaterThan(20);
      }
    }
  });

  it('행 키가 앵커로 만들어진다 — 세션 2 가 이 주소로 들어온다', () => {
    for (const r of M.ledger) {
      expect(() => hrefFor(ledgerRow(r.key))).not.toThrow();
      expect(hrefFor(ledgerRow(r.key))).toContain('view=method');
    }
  });

  it('가리키는 모형 노드가 실제로 그래프에 있다', () => {
    const ids = new Set(G.nodes.map((n) => n.id));
    for (const r of M.ledger) {
      if (r.node) expect(ids.has(r.node), `${r.key}→${r.node}`).toBe(true);
    }
  });

  it('가리키는 방정식이 등록부에 있다', () => {
    const nos = new Set(MODEL.equations.map((e: any) => e.no));
    for (const r of M.ledger) {
      if (r.equation && r.equation !== '항등식') {
        expect(nos.has(r.equation), `${r.key}→${r.equation}`).toBe(true);
      }
    }
  });

  it('부록 B 조건화·β_sync·r*·금리 단위·PAC 비대칭 행이 전부 있다', () => {
    const keys = new Set(M.ledger.map((r: any) => r.key));
    for (const k of [
      'policy-conditioning',
      'beta-sync',
      'deviation-space',
      'rate-units',
      'no-term-premium-irs',
      'ou-spread',
      'pac-asymmetry',
    ]) {
      expect(keys.has(k), k).toBe(true);
    }
  });
});

describe('무엇을 출하하나 — 한 문장', () => {
  it('원장의 한 행과 **같은 말**을 한다', () => {
    const row = M.ledger.find((r: any) => r.key === M.limitations.ledger_row);
    expect(row).toBeDefined();
    // 둘 다 «커브 델타» 와 «레벨 전망» 을 같은 방향으로 말해야 한다.
    for (const text of [M.limitations.ships, row.we_do]) {
      expect(text).toContain('커브 델타');
      expect(text).toContain('레벨');
    }
    expect(M.limitations.ships).toContain('아니에요');
  });

  it('편차 공간에서 0 이라는 실측이 두 자리에 다 실려 있다', () => {
    const row = M.ledger.find((r: any) => r.key === 'deviation-space');
    expect(row.why).toContain('0.000000bp');
    expect(M.limitations.ships_why).toContain('0.000000bp');
  });

  it('한계는 «델타 영향» 과 «레벨 영향» 으로 갈라져 있다', () => {
    expect(Array.isArray(M.limitations.no_effect)).toBe(true);
    expect(M.limitations.level_only.length).toBeGreaterThan(5);
    for (const x of M.limitations.level_only) {
      expect(x.equation).toMatch(/^\d+$/);
      expect(String(x.why).length).toBeGreaterThan(5);
    }
  });
});

describe('스코어카드', () => {
  const S = M.scorecard;

  it('9/13 이고, 12/13 이 기준선이 아니라고 적는다', () => {
    expect(S.engine_passed).toBe(9);
    expect(S.engine_total).toBe(13);
    expect(S.not_a_baseline).toContain('순열');
    expect(S.not_a_baseline).toContain('기준선이 아니');
  });

  it('논문 앵커 13칸이 전부 실려 있다', () => {
    const want = PAPER.shocks.flatMap((s: any) => s.anchors.map((a: any) => a.id));
    expect(S.anchor_rows.map((r: any) => r.anchor_id).sort()).toEqual(
      [...want].sort(),
    );
  });

  it('칸마다 논문 쪽수를 든다', () => {
    for (const r of S.anchor_rows) expect(r.page).toMatch(/pp?\.\d+/);
  });

  it('β_sync 를 맞춘 칸은 «통과» 가 아니라 «핀» 이다', () => {
    const pin = S.anchor_rows.find(
      (r: any) => r.anchor_id === 'us_policy_25bp.kr10y',
    );
    expect(pin.verdict).toBe('pinned');
    expect(['pass', 'shape_pass']).not.toContain(pin.verdict);
  });

  it('밴드가 없는 칸을 통과로 세지 않는다', () => {
    const noBand = S.anchor_rows.filter((r: any) => r.verdict === 'no_band');
    expect(noBand.length).toBeGreaterThan(0);
    for (const r of noBand) expect(r.band).toBeNull();
  });

  it('실측이 있으면 나온 분기도 같이 든다 — 지평을 숨기면 헛진단이 난다', () => {
    for (const r of S.anchor_rows) {
      if (r.measured != null) {
        expect(Number.isInteger(r.measured_q), r.anchor_id).toBe(true);
        expect(r.measured_12q, r.anchor_id).not.toBeNull();
      }
    }
  });

  it('꼬리에서 나온 칸에 표시가 붙어 있다', () => {
    const tail = S.anchor_rows.filter((r: any) => r.tail);
    expect(tail.length).toBeGreaterThan(0);
    for (const r of tail) expect(r.measured_q).toBeGreaterThanOrEqual(16);
  });

  it('벗어난 넷의 뿌리로 금리 단위 규약을 말하고, 배율을 안 지어냈다고 적는다', () => {
    expect(S.root).toContain('금리 단위');
    expect(S.root).toContain('배율');
    expect(S.chain).toContain('주택');
  });
});

describe('자유모수 공개', () => {
  it('β_sync 만이 아니다 — 스코어카드에 대고 고른 레버가 여럿이다', () => {
    const fit = M.free_params.filter((p: any) => p.kind === 'fit');
    expect(fit.length).toBeGreaterThanOrEqual(5);
    expect(M.free_params.map((p: any) => p.name)).toContain('beta_sync');
  });

  it('모수마다 코드 자리를 든다', () => {
    for (const p of M.free_params) {
      expect(String(p.code), p.name).toMatch(/(backend\/|output\/)/);
      expect(String(p.contaminates).length, p.name).toBeGreaterThan(3);
    }
  });

  it('9/13 이 독립적인 시험이 아니라고 머리에서 말한다', () => {
    expect(M.free_params_headline).toContain('독립');
    expect(M.free_params_headline).toContain('밴드');
  });
});

describe('백테스트', () => {
  it('못 한다고 말하고, 못 하는 이유를 내용으로 든다', () => {
    expect(B.verdict).toBe('infeasible');
    expect(B.blockers.length).toBeGreaterThanOrEqual(5);
    for (const b of B.blockers) {
      expect(String(b.detail).length, b.id).toBeGreaterThan(30);
      expect(String(b.needs).length, b.id).toBeGreaterThan(5);
    }
  });

  it('기간을 안 바꿨다 — 2021Q3 에서 2023Q1 이다', () => {
    expect(B.window[0]).toBe('2021Q3');
    expect(B.window[B.window.length - 1]).toBe('2023Q1');
  });

  it('돌려 본 것을 «백테스트» 라고 부르지 않는다', () => {
    expect(B.coherence_check.what).toContain('백테스트가 아니');
  });

  it('닻 없는 RMSE 를 안 낸다 — 벤치마크와 비율이 같이 있다', () => {
    const c = B.coherence_check;
    expect(c.rmse_bp).toBeGreaterThan(0);
    expect(c.benchmark_rmse_bp).toBeGreaterThan(0);
    expect(c.ratio).toBeCloseTo(c.rmse_bp / c.benchmark_rmse_bp, 2);
  });

  it('오차의 몫을 모형·구현·입력·논문으로 갈라 놓는다', () => {
    const whose = new Set(B.error_shares.map((r: any) => r[1]));
    for (const w of ['모형', '구현', '입력', '논문']) {
      expect(whose.has(w), w).toBe(true);
    }
  });

  it('Table 1 의 BVAR(2) 는 못 한다고 적는다', () => {
    const bvar = B.benchmark_options.find((o: any) => String(o[0]).includes('BVAR'));
    expect(bvar[1]).toBe(false);
  });
});

describe('앵커 주소', () => {
  it('방법 면의 네 자리가 다 만들어진다', () => {
    for (const id of Object.values(ANCHORS.method)) {
      expect(hrefFor(id)).toContain('view=method');
    }
  });

  it('모형 면의 일곱 자리가 다 만들어진다', () => {
    for (const id of Object.values(ANCHORS.model)) {
      expect(hrefFor(id)).toContain('view=model');
    }
  });
});

/* ── 페이로드의 `**강조**` 가 화면에 별표로 새지 않는다 ──────────────────────
 *
 * 이 두 면의 문장은 정적 JSON 에서 오고, 그 JSON 을 쓰는 파이썬은 강조를
 * 마크다운으로 적는다(같은 문장이 진단 문서에도 들어간다). React 는 문자열을
 * 그대로 그리므로 화면에 별표가 찍힌다 — 실측 2026-08-21 에 그렇게 찍혔다.
 * `Emph` 가 그 자리를 진다. */
describe('강조 표시', () => {
  it('페이로드에 강조가 실제로 들어 있다 — 없으면 이 규칙이 헛돈다', () => {
    const all = JSON.stringify(M) + JSON.stringify(MODEL) + JSON.stringify(B);
    expect((all.match(/\*\*/g) ?? []).length).toBeGreaterThan(20);
  });

  it('강조는 늘 짝이 맞는다 — 홀수면 화면에 별표가 남는다', () => {
    const walk = (v: unknown): string[] =>
      typeof v === 'string'
        ? [v]
        : Array.isArray(v)
          ? v.flatMap(walk)
          : v && typeof v === 'object'
            ? Object.values(v).flatMap(walk)
            : [];
    const odd = [M, MODEL, B]
      .flatMap(walk)
      .filter((s) => ((s.match(/\*\*/g) ?? []).length % 2) === 1);
    expect(odd).toEqual([]);
  });

  it('네 화면이 전부 `Emph` 를 쓴다', () => {
    for (const f of [
      'src/lab/model/model/WiringGraph.tsx',
      'src/lab/model/model/Registers.tsx',
      'src/lab/model/model/BasisIrf.tsx',
      'src/lab/model/method/MethodSurface.tsx',
    ]) {
      expect(readFileSync(join(process.cwd(), f), 'utf8'), f).toContain('<Emph t=');
    }
  });

  it('짝이 안 맞는 별표는 글자 그대로 남긴다 — 삼키면 문장이 바뀐다', () => {
    expect(splitEmphasis('a **b** c')).toEqual([
      { text: 'a ', bold: false },
      { text: 'b', bold: true },
      { text: ' c', bold: false },
    ]);
    expect(splitEmphasis('열린 ** 채로')).toEqual([
      { text: '열린 ** 채로', bold: false },
    ]);
    expect(splitEmphasis('**앞**과 **뒤**')).toEqual([
      { text: '앞', bold: true },
      { text: '과 ', bold: false },
      { text: '뒤', bold: true },
    ]);
    expect(splitEmphasis('')).toEqual([]);
  });
});
