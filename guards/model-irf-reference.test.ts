/* 기저 충격반응 패널이 지는 명제 둘.
 *
 *   1. **참조선은 `paper_anchors.json` 에서만 온다.** 화면 코드에 숫자를 적으면
 *      그 순간 출처가 코드가 되고, 논문을 다시 읽어도 화면이 안 따라온다.
 *   2. **옛 기저 토글은 라이브 값을 못 건드린다.** 「순열 과적합(구)」 는 눈으로
 *      비교하라고 있는 것이지 계산에 들어가는 것이 아니다. 여기가 새면 8/21 에
 *      은퇴시킨 과적합판이 뒷문으로 돌아온다.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import anchorsJson from '../src/lab/model/artifacts/paper_anchors.json';
import basisJson from '../src/lab/model/artifacts/scenario_basis.json';
import oldBasisJson from '../src/lab/model/model/basis_pre_0821.json';
import { referenceLinesFor } from '../src/lab/model/model/BasisIrf';
import { stripComments } from './_source';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PAPER = anchorsJson as any;
const BASIS = basisJson as any;
const OLD = oldBasisJson as any;

const SRC = stripComments(
  readFileSync(join(process.cwd(), 'src/lab/model/model/BasisIrf.tsx'), 'utf8'),
);

describe('참조선의 출처', () => {
  it('화면 코드에 논문 값을 적어 두지 않았다', () => {
    /* 앵커 값 중 하나라도 리터럴로 박혀 있으면 잡는다. 이 패널이 앞선 판
       (`scenario/IrfPanels.tsx`)에서 `value: -0.07` 처럼 들고 있던 자리다. */
    const values = PAPER.shocks
      .flatMap((s: any) => s.anchors.map((a: any) => a.value))
      .filter((v: number | null) => v != null)
      .map((v: number) => String(v));
    for (const v of values) {
      expect(SRC.includes(v), `${v} 가 화면 코드에 박혀 있어요`).toBe(false);
    }
  });

  it('참조선마다 논문 쪽수가 따라온다', () => {
    const lines = [
      ...referenceLinesFor('policy_q1', 'gap'),
      ...referenceLinesFor('policy_q1', 'hpi'),
      ...referenceLinesFor('oil', 'cpi'),
    ];
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(l.page).toMatch(/pp?\.\d+/);
  });

  it('정책 기저의 참조선이 실제로 논문 값이다', () => {
    const gap = referenceLinesFor('policy_q1', 'gap');
    const want = PAPER.shocks
      .find((s: any) => s.id === 'kr_policy_25bp')
      .anchors.find((a: any) => a.var === 'y_gap');
    expect(gap).toHaveLength(1);
    expect(gap[0].value).toBe(want.value);
  });

  it('미국 기저에는 참조선을 안 긋는다 — 다른 실험이라서', () => {
    for (const b of ['us_2q', 'us_4q', 'us_6q']) {
      for (const p of ['gap', 'cpi', 'hpi', 'debt']) {
        expect(referenceLinesFor(b, p), `${b}/${p}`).toEqual([]);
      }
    }
    // 그리고 화면이 왜 안 긋는지 말한다.
    expect(SRC).toContain('다른 실험');
  });

  it('논문이 숫자를 안 적은 칸(모양 앵커)은 선을 안 만든다', () => {
    const shape = PAPER.shocks
      .flatMap((s: any) => s.anchors)
      .filter((a: any) => a.value == null);
    expect(shape.length).toBeGreaterThan(0);
    const all = ['gap', 'cpi', 'hpi', 'debt'].flatMap((p) => [
      ...referenceLinesFor('policy_q1', p),
      ...referenceLinesFor('oil', p),
    ]);
    for (const l of all) expect(l.value).not.toBeNull();
  });

  it('그림에서 눈으로 읽은 값이 아니라는 각주를 든다', () => {
    expect(PAPER.why_text_only).toContain('디지타이즈');
  });
});

describe('옛 기저 토글', () => {
  it('실제로 옛 판이다 — 지금 판과 값이 다르다', () => {
    expect(OLD.as_of).not.toBe(BASIS.as_of);
    const a = OLD.bases.policy_q1.hpi as number[];
    const b = BASIS.bases.policy_q1.hpi as number[];
    const diff = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
    expect(diff).toBeGreaterThan(0.1);
  });

  it('git 에서 꺼낸 것이지 재구성한 것이 아니다', () => {
    expect(OLD.source).toMatch(/^git show [0-9a-f]{7}:/);
  });

  it('과적합판이라고 스스로 적는다', () => {
    expect(OLD.why).toContain('순열');
    expect(OLD.why).toContain('기준선이 아니');
  });

  /* ── 토글이 라이브 값을 못 건드린다 ────────────────────────────────────────
   *
   * 배선으로 잠근다: 옛 기저를 import 하는 파일이 **패널 하나뿐**이어야 한다.
   * 시나리오 조립(`combine.ts`)이나 전략 면이 이걸 읽으면 그 순간 과적합판이
   * 라이브 숫자에 섞인다. */
  it('옛 기저를 읽는 곳이 이 패널 하나뿐이다', () => {
    const hits = grepImports('basis_pre_0821');
    expect(hits).toEqual(['src/lab/model/model/BasisIrf.tsx']);
  });

  it('패널은 옛 기저를 **그리기만** 한다 — 산술에 안 쓴다', () => {
    /* `OLD` 가 나타나는 자리가 전부 그리기용인지 본다. 사칙연산 옆에 서 있으면
       잡는다. */
    for (const line of SRC.split('\n')) {
      if (!/\bOLD\b/.test(line)) continue;
      expect(line, line.trim()).not.toMatch(/OLD[^\n]*[+\-*/]=/);
    }
  });
});

/** 어떤 파일들이 그 모듈을 읽나.
 *
 * `git grep` 을 안 쓴다 — 추적 전 파일을 못 보므로 **새로 만든 파일이 이 규칙을
 * 어겨도 조용히 통과한다.** 파일계를 직접 걷는다. */
function grepImports(needle: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(join(process.cwd(), dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const rel = `${dir}/${name}`;
      if (statSync(join(process.cwd(), rel)).isDirectory()) {
        walk(rel);
        continue;
      }
      if (!name.endsWith('.tsx') && !name.endsWith('.ts')) continue;
      if (readFileSync(join(process.cwd(), rel), 'utf8').includes(needle)) {
        hits.push(rel);
      }
    }
  };
  walk('src');
  walk('guards');
  return hits.filter((h) => h.endsWith('.tsx')).sort();
}
