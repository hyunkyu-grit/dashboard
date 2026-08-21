/* 배선 그래프가 지는 명제들.
 *
 * ## 여기서 잠그는 것 중 하나는 **UI 가 아니라 모형에 대한 사실**이다
 *
 * 「해외 블록으로 들어가는 화살표가 0개」 는 그림이 그렇게 생긴 것이 아니라
 * 모형이 블록외생이라는 뜻이다. 화면이 그 문장을 적고 있으므로, 그 문장이 참인
 * 것을 여기서 잰다 — 다음에 누가 해외 블록에 되먹임을 배선하면 이 시험이
 * 빨개져야지, 화면이 조용히 거짓말을 하면 안 된다.
 *
 * ## 「엣지마다 방정식 번호」
 *
 * 과제지가 못 박은 규칙이다. 번호 없는 화살표는 출처 없는 주장이라 화면에
 * 세우지 않는다.
 */

import { describe, expect, it } from 'vitest';

import graphJson from '../src/lab/model/model/wiring_graph.json';
import {
  backEdges,
  CHANNELS,
  layout,
  PRINTED_NOT_WIRED,
  reachable,
  type Graph,
} from '../src/lab/model/model/layout';

const G = graphJson as unknown as Graph;
const BLOCK = Object.fromEntries(G.nodes.map((n) => [n.id, n.block]));

describe('배선 엣지리스트', () => {
  it('노드와 엣지가 실제로 있다', () => {
    expect(G.nodes.length).toBeGreaterThan(25);
    expect(G.edges.length).toBeGreaterThan(60);
  });

  it('엣지마다 방정식 번호가 있다 — 없으면 빌드가 선다', () => {
    const naked = G.edges.filter((e) => !e.equation || e.equation.trim() === '');
    expect(naked).toEqual([]);
  });

  it('논문 번호를 단 엣지는 인쇄 쪽수도 든다', () => {
    const numbered = G.edges.filter((e) => /^\d+$/.test(e.equation));
    expect(numbered.length).toBeGreaterThan(50);
    const pageless = numbered.filter((e) => !e.paper_page);
    expect(pageless).toEqual([]);
  });

  it('논문 번호가 아닌 «식» 은 이름이 등록돼 있다', () => {
    const other = new Set(
      G.edges.filter((e) => !/^\d+$/.test(e.equation)).map((e) => e.equation),
    );
    for (const name of other) {
      expect(Object.keys(G.non_paper_equations)).toContain(name);
    }
  });

  it('엣지의 양 끝이 노드 목록에 있다', () => {
    for (const e of G.edges) {
      expect(BLOCK[e.from], `${e.from} 노드가 없어요`).toBeDefined();
      expect(BLOCK[e.to], `${e.to} 노드가 없어요`).toBeDefined();
    }
  });

  /* ── 모형의 성질 ─────────────────────────────────────────────────────────── */

  it('블록외생 — 국내에서 해외로 가는 화살표가 0개다', () => {
    const leaking = G.edges.filter(
      (e) => BLOCK[e.from] !== 'external' && BLOCK[e.to] === 'external',
    );
    expect(leaking).toEqual([]);
  });

  it('가계부채→소비는 **엣지가 둘**이고 부호가 반대다 (eq 7 · eq 8)', () => {
    const pair = G.edges.filter((e) => e.from === 'debt' && e.to === 'c');
    expect(pair).toHaveLength(2);
    const lr = pair.find((e) => e.horizon === 'LR');
    const sr = pair.find((e) => e.horizon === 'SR');
    expect(lr?.sign).toBe('-');
    expect(sr?.sign).toBe('+');
    expect(lr?.equation).toBe('7');
    expect(sr?.equation).toBe('8');
  });

  it('유가는 해외 블록마다 산출갭에 음으로 들어간다 (eq 5)', () => {
    const oil = G.edges.filter((e) => e.from === 'oil' && e.to.startsWith('f_'));
    expect(oil.length).toBeGreaterThanOrEqual(4);
    for (const e of oil) {
      expect(e.sign).toBe('-');
      expect(e.equation).toBe('5');
    }
  });

  it('수입 수요에 건설과 정부가 들어 있다 (2026-08-21 수정, eq 21)', () => {
    const into = new Set(G.edges.filter((e) => e.to === 'm').map((e) => e.from));
    expect(into.has('i_con')).toBe(true);
    expect(into.has('g')).toBe(true);
  });

  it('PAC 기대항은 소비에만 배선돼 있다 (PLAIN_ECM_NON_CONSUMPTION)', () => {
    const pac = G.edges.filter((e) => (e.via ?? '').startsWith('PAC 기대항'));
    expect(pac.length).toBeGreaterThan(0);
    expect(new Set(pac.map((e) => e.to))).toEqual(new Set(['c']));
  });

  it('생성기가 못 잡은 자리를 비워 두지 않는다', () => {
    expect(G.uncovered.length).toBeGreaterThan(0);
    for (const u of G.uncovered) expect(u.why.length).toBeGreaterThan(10);
  });

  it('해석 못 한 식이 없다', () => {
    expect(G.unsupported_expressions).toEqual([]);
  });
});

describe('논문에만 있는 화살표 (배선 대 인쇄)', () => {
  it('유령마다 방정식 번호와 이유가 있다', () => {
    expect(PRINTED_NOT_WIRED.length).toBeGreaterThan(0);
    for (const g of PRINTED_NOT_WIRED) {
      expect(g.equation).toMatch(/^\d+$/);
      expect(g.paper_page).toMatch(/^p\.\d+$/);
      expect(g.why.length).toBeGreaterThan(10);
    }
  });

  it('유령의 양 끝이 노드 목록에 있다 — 안 그리면 화면에서 사라진다', () => {
    for (const g of PRINTED_NOT_WIRED) {
      expect(BLOCK[g.from], `${g.from}`).toBeDefined();
      expect(BLOCK[g.to], `${g.to}`).toBeDefined();
    }
  });

  it('유령은 실제로 안 배선돼 있다 — 있는 것을 없다고 하면 안 된다', () => {
    for (const g of PRINTED_NOT_WIRED) {
      const real = G.edges.find((e) => e.from === g.from && e.to === g.to);
      expect(real, `${g.from}→${g.to} 는 이미 배선돼 있어요`).toBeUndefined();
    }
  });

  /* 2026-08-21 (P4) 에 뒤집힌 시험이다. 여기 있던 것은 «설비투자로 오는 배선은
     산출갭 하나뿐이다» 였고, 그게 참인 동안 정책금리가 설비투자에 닿는 통로가
     없었다. eq (9) 의 `− UC_I` 를 배선했으니 이제 그 반대를 잰다 — 되돌아가면
     여기가 빨개져야지, 화면이 조용히 «금리가 설비투자에 온다» 로 읽히면 안 된다. */
  it('설비투자 목표에 자본 사용자비용이 와 있다 (eq 9 · 10)', () => {
    const into = G.edges.filter((e) => e.to === 'i_fi_star');
    expect(new Set(into.map((e) => e.from))).toEqual(
      new Set(['r_firm', 'cb', 'kr10y', 'cpi_yoy']),
    );
    /* 목표식이므로 장기 엣지다. */
    for (const e of into) expect(e.horizon, e.from).toBe('LR');
    /* 금리 셋은 음, 물가는 **양**이다 — eq (10) 이 π/4 를 **빼기** 때문이고,
       건설의 eq (13) 은 더한다. 그 비대칭이 논문 것이라 화면에 서야 한다. */
    const sign = Object.fromEntries(into.map((e) => [e.from, e.sign]));
    expect(sign.r_firm).toBe('-');
    expect(sign.cb).toBe('-');
    expect(sign.kr10y).toBe('-');
    expect(sign.cpi_yoy).toBe('+');
    const ihCpi = G.edges.find((e) => e.from === 'cpi_yoy' && e.to === 'ih_star');
    expect(ihCpi?.sign, '건설은 반대 부호여야 해요').toBe('-');
  });

  it('설비투자는 목표와 산출갭 둘에서 온다', () => {
    const into = G.edges.filter((e) => e.to === 'i_fi');
    expect(new Set(into.map((e) => e.from))).toEqual(new Set(['i_fi_star', 'y_gap']));
  });

  /* D.3 — 코드가 스스로 적은 `eq_no` 와 인쇄 번호가 갈리는 자리가 없다.
     `investment_growth` 가 자기를 eq 10 이라 부르던 것을 2026-08-21 에 고쳤고,
     `EQ_NO_CORRECTIONS` 로 우회하던 표를 은퇴시켰다. 다시 갈리면 여기가
     빨개진다 — 정정표가 조용히 다시 생기는 것이 이 시험이 막는 것이다. */
  it('식 번호 정정표가 비어 있다 — 엔진이 인쇄 번호를 쓴다', () => {
    expect(G.eq_no_corrections).toEqual([]);
    expect(G.edges.filter((e) => e.equation === '10')).toEqual([]);
  });
});

describe('자리 계산', () => {
  const L = layout(G.nodes, G.edges);

  it('모든 노드에 자리가 있다', () => {
    expect(L.nodes).toHaveLength(G.nodes.length);
    for (const n of L.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
    }
  });

  it('되먹임을 뺀 뒤에는 앞으로만 간다', () => {
    const back = backEdges(G.nodes, G.edges);
    for (const e of G.edges) {
      if (back.has(`${e.from}→${e.to}`)) continue;
      expect(
        L.byId[e.to].layer,
        `${e.from}→${e.to}`,
      ).toBeGreaterThan(L.byId[e.from].layer);
    }
  });

  it('되먹임이 실제로 있다 — 지우면 이 모형이 아니다', () => {
    expect(backEdges(G.nodes, G.edges).size).toBeGreaterThan(0);
  });

  it('두 번 불러도 같은 자리다 — 새로고침마다 모양이 바뀌면 아무도 안 믿는다', () => {
    const again = layout(G.nodes, G.edges);
    expect(again.nodes.map((n) => `${n.id}@${n.x},${n.y}`)).toEqual(
      L.nodes.map((n) => `${n.id}@${n.x},${n.y}`),
    );
  });

  it('오너 창(911·855)의 카드 안에 들어간다', () => {
    // 세로는 흐르지 않는다는 것이 이 앱의 전제다. 가로만 흐른다.
    expect(L.height).toBeLessThan(560);
  });
});

describe('전달경로 — 그림 셋이 한 구조다', () => {
  it('경로마다 논문 그림 번호를 든다', () => {
    for (const c of CHANNELS) expect(c.figure).toMatch(/Figure \d+/);
  });

  it('씨앗이 노드 목록에 있다', () => {
    for (const c of CHANNELS) {
      for (const s of c.seeds) expect(BLOCK[s], `${c.id}:${s}`).toBeDefined();
    }
  });

  it('경로마다 켜지는 노드가 여럿이다 — 하나면 필터가 아니라 점이다', () => {
    for (const c of CHANNELS) {
      expect(reachable(G.edges, c.seeds).size, c.id).toBeGreaterThan(3);
    }
  });

  it('통화정책 경로에 주택과 가계부채가 들어 있다 (논문 Figure 12)', () => {
    const on = reachable(G.edges, ['i_kr']);
    expect(on.has('hpi')).toBe(true);
    expect(on.has('debt')).toBe(true);
    expect(on.has('r_hh')).toBe(true);
  });

  it('미 금융 경로가 한국 장기금리에 닿는다 (논문 Figure 3)', () => {
    expect(reachable(G.edges, ['us_i']).has('kr10y')).toBe(true);
  });
});
