/* 시나리오 레인 은퇴 — 죽은 쌍둥이가 안 남았나.
 *
 * ## 은퇴에서 진짜 위험한 것은 **반쯤 지우는 것**이다
 *
 * 화면을 지우고 라우팅을 남기면 링크가 조용히 다른 데로 간다. 라우팅을 지우고
 * 셈 모듈을 지우면 그 산술을 쓰는 다른 면이 깨진다. 그래서 여기서 재는 것은
 * 「지웠나」 가 아니라 **「경계가 맞나」** 다.
 *
 * ## 남긴 것은 일부러 남겼다
 *
 * `lab/scenario/{combine,assemble,api,presets}.ts` 와 `basis.json` 은 산다 —
 * 「전략」 면이 같은 산술을 쓰기 때문이고, 그 산술을 잠그는 가드 40개가 계속
 * 돈다. **잃은 시험 커버리지는 0 이다.** 그 파일들이 전략 면 밑으로 옮겨 가는
 * 날 지우는 것은 그쪽 세션 일이다.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isLabId, LAB_ITEMS, resolveLab, RETIRED_LAB } from '../src/ui/nav';
import { stripComments } from './_source';

const read = (p: string) =>
  stripComments(readFileSync(join(process.cwd(), p), 'utf8'));

describe('내려간 것', () => {
  it('화면 파일이 없다', () => {
    expect(existsSync(join(process.cwd(), 'src/lab/ScenarioPage.tsx'))).toBe(false);
    expect(existsSync(join(process.cwd(), 'src/lab/scenario/IrfPanels.tsx'))).toBe(
      false,
    );
  });

  it('Lab 세입자 목록에 없다', () => {
    expect(LAB_ITEMS.map((i) => i.id)).not.toContain('scenario');
    expect(isLabId('scenario')).toBe(false);
  });

  it('페이지가 더 이상 그 화면을 부르지 않는다', () => {
    const page = read('src/app/page.tsx');
    expect(page).not.toContain('ScenarioPage');
    expect(page).not.toContain("lab === 'scenario'");
  });
});

describe('링크는 살려 둔다', () => {
  it('`lab=scenario` 는 모형으로 간다 — 커브 표면으로 떨어지지 않는다', () => {
    expect(RETIRED_LAB.scenario).toBe('model');
    expect(resolveLab('scenario')).toBe('model');
  });

  it('모르는 값은 기본 세입자로 간다', () => {
    expect(resolveLab('없는것')).toBe('surface');
    expect(resolveLab(undefined)).toBe('surface');
  });

  it('사는 세입자는 그대로다', () => {
    for (const id of ['surface', 'issuance', 'model'] as const) {
      expect(resolveLab(id)).toBe(id);
    }
  });
});

describe('남긴 것 — 일부러 남겼다', () => {
  const KEPT = [
    'src/lab/scenario/combine.ts',
    'src/lab/scenario/assemble.ts',
    'src/lab/scenario/api.ts',
    'src/lab/scenario/presets.ts',
    'src/lab/scenario/basis.json',
  ];

  it('셈 모듈이 산다 — 「전략」이 같은 산술을 쓴다', () => {
    for (const f of KEPT) {
      expect(existsSync(join(process.cwd(), f)), f).toBe(true);
    }
  });

  it('그 산술을 잠그는 가드도 산다 — 잃은 커버리지 0', () => {
    for (const g of [
      'guards/scenario-parity.test.ts',
      'guards/scenario-assemble.test.ts',
      'guards/scenario-decompose.test.ts',
    ]) {
      expect(existsSync(join(process.cwd(), g)), g).toBe(true);
    }
  });
});

describe('옮겨 간 것', () => {
  it('논문 Figure 18 의 여덟 칸은 모형 면의 기저 충격반응이 이어받았다', () => {
    const irf = read('src/lab/model/model/BasisIrf.tsx');
    // 여덟째 칸(명목 가계부채)이 왜 비었는지 계속 말한다.
    expect(irf).toContain('명목 가계부채');
    expect(irf).toContain('식 44');
    // 일곱 칸이 다 있다.
    for (const t of ['기준금리와 시장금리', '원/달러', 'GDP 갭', '수출과 수입', '주택가격']) {
      expect(irf, t).toContain(t);
    }
  });

  it('원장 줄은 방법 면의 해석 원장이 이어받았다', () => {
    expect(
      existsSync(join(process.cwd(), 'src/lab/model/method/method_surface.json')),
    ).toBe(true);
  });

  it('나침반이 남아 있다 — 왜 내려갔고 무엇이 어디로 갔는지', () => {
    const nav = readFileSync(join(process.cwd(), 'src/ui/nav.ts'), 'utf8');
    expect(nav).toContain('시나리오');
    expect(nav).toContain('전략');
    expect(nav).toContain('방법');
  });
});
