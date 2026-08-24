/* 면 사이의 링크가 실제로 착지하나.
 *
 * ## 왜 이 가드가 필요한가
 *
 * Lab 「모형」 은 면 셋이 서로를 가리킨다 — 전략 면의 논거 항이 Model 면의
 * 식으로, 리스크 줄이 Method 면의 원장 행으로 간다. 주소는
 * `anchors.ts::hrefFor` 가 만들고, 자리는 `anchorProps` 가 심는다.
 *
 * **안 닿는 링크는 조용하다.** 해시에 맞는 `id` 가 없으면 브라우저는 에러를
 * 내지 않고 그냥 면 맨 위에 선다. 그래서 셋이 죽어 있어도 아무도 몰랐다
 * (2026-08-24 전수 확인):
 *
 *     eq('36-37')                       등록부는 번호를 낱개로 단다
 *     ledgerRow('r_star')               원장 키는 케밥이고 그 행은 없다
 *     ledgerRow('policy_conditioning')  실제 키는 `policy-conditioning`
 *
 * ## 왜 DOM 을 안 읽고 페이로드로 재나
 *
 * 자리를 심는 쪽은 전부 페이로드를 그대로 도는 `map` 이다(원장 행 · 식 등록부
 * · 채널 칩). 그러니 **페이로드가 낳을 수 있는 앵커의 집합**이 곧 존재하는
 * 타깃의 집합이고, 그건 렌더 없이 정확히 셀 수 있다.
 *
 * 렌더로 재면 오히려 못 미더워진다 — 이 리포에는 접힌 것·툴팁 안에 있는 것이
 * DOM 에 없어서 `textContent` 가드가 통째로 못 본 전례가 있다(RV 열 머리).
 */

import { describe, expect, it } from 'vitest';

import { ANCHORS, eq, hrefFor, ledgerRow } from '../src/lab/model/anchors';
import { CHANNELS } from '../src/lab/model/model/layout';
import { RISK_HREF, TERM_HREF } from '../src/lab/model/strategy/StrategySurface';
import methodJson from '../src/lab/model/method/method_surface.json';
import modelJson from '../src/lab/model/model/model_surface.json';

/* eslint-disable @typescript-eslint/no-explicit-any */
const M = methodJson as any;
const MODEL = modelJson as any;

/** 세 면이 실제로 심는 `id` 전부. 심는 자리와 같은 출처에서 만든다. */
function existingTargets(): Set<string> {
  const t = new Set<string>();
  for (const group of Object.values(ANCHORS)) {
    for (const id of Object.values(group)) t.add(id as string);
  }
  for (const c of CHANNELS) t.add(`model:channel:${c.id}`);
  for (const e of MODEL.equations) t.add(eq(e.no));
  for (const r of M.ledger) t.add(ledgerRow(r.key));
  return t;
}

/** `?g=lab&lab=model&view=…#<id>` 에서 id 만 뽑는다. */
function targetOf(href: string): string {
  const i = href.indexOf('#');
  expect(i, href).toBeGreaterThan(-1);
  return href.slice(i + 1);
}

describe('면 사이 링크', () => {
  const targets = existingTargets();

  it('논거 항 다섯이 전부 실재하는 자리로 간다', () => {
    for (const [key, href] of Object.entries(TERM_HREF)) {
      expect(targets.has(targetOf(href)), `${key} → ${href}`).toBe(true);
    }
  });

  it('리스크 줄 셋이 전부 실재하는 자리로 간다', () => {
    for (const [key, href] of Object.entries(RISK_HREF)) {
      expect(targets.has(targetOf(href)), `${key} → ${href}`).toBe(true);
    }
  });

  it('지평 이탈 줄은 잔차 꼬리 행으로 간다 — 그 줄이 답하는 것이 거기 있다', () => {
    expect(targetOf(RISK_HREF['horizon-exit'])).toBe(ledgerRow('residual-tail'));
    expect(M.ledger.some((r: any) => r.key === 'residual-tail')).toBe(true);
  });

  it('가드가 스스로 위반을 잡는지 — 없는 주소는 떨어져야 한다', () => {
    expect(targets.has(targetOf(hrefFor(ledgerRow('r_star'))))).toBe(false);
    expect(targets.has(targetOf(hrefFor(eq('36-37'))))).toBe(false);
  });

  it('면 이름이 셋 중 하나다 — hrefFor 가 그걸 붙든다', () => {
    for (const href of [...Object.values(TERM_HREF), ...Object.values(RISK_HREF)]) {
      expect(href).toMatch(/^\?g=lab&lab=model&view=(strategy|model|method)#/);
    }
  });
});
