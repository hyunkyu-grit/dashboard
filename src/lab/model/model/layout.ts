/* 배선 그래프의 자리 계산 — **순수 함수**다.
 *
 * 판단을 컴포넌트 안에 두면 가드가 못 본다(2026-08-21 백테스트 레인에서 배운
 * 것 그대로). 층 매기기·교차 줄이기·좌표는 전부 여기 있고, 화면은 좌표를
 * 그리기만 한다.
 *
 * ## 층은 최장경로다
 *
 * 이 모형은 «해외는 한국에 영향을 주고 한국은 해외에 안 준다» 는 뜻에서
 * 블록외생이지만, 국내 블록 **안에서는** 되먹임이 있다(갭 → 물가 → 준칙 →
 * 금리 → 소비 → 갭). 그래서 순수 DAG 가 아니다.
 *
 * DFS 로 back-edge 를 찾아 **층 매기기에서만** 빼고, 그린다. 뺀 엣지는
 * 사라지지 않고 «되돌아가는 화살표» 로 남는다 — 그게 이 모형의 성질이라
 * 지우면 거짓말이 된다.
 */

export type Block = 'external' | 'expenditure' | 'price' | 'financial';

export type Edge = {
  from: string;
  to: string;
  block: Block;
  horizon: 'LR' | 'SR';
  sign: '+' | '-';
  coefficient_slot: string | null;
  equation: string;
  paper_page: string | null;
  via?: string | null;
  lagged?: boolean;
};

export type Node = { id: string; label: string; block: Block };

export type Graph = {
  module: 'wiring_graph';
  generated_from: string;
  uncovered: { var: string; why: string }[];
  unsupported_expressions: string[];
  /** 생성기가 노드는 세웠는데 사람이 읽을 이름을 못 붙인 자리. **비어 있는
   *  척하지 않는다** — 화면이 «없어요» 를 말할 수 있어야 한다.
   *  2026-08-24 까지 이 칸이 타입에도 화면에도 없었다(페이로드에는 있었다). */
  missing_labels: string[];
  nodes: Node[];
  edges: Edge[];
  flow_merges: { folded: string; into: string }[];
  eq_no_corrections: { where: string; code: string; paper: string; why: string }[];
  non_paper_equations: Record<string, string>;
};

export const BLOCK_LABEL: Record<Block, string> = {
  external: '해외',
  expenditure: '지출',
  price: '물가',
  financial: '금융',
};

/** 층 매기기에서 뺄 엣지(되먹임). DFS 회색 노드로 들어가는 것이 back-edge 다. */
export function backEdges(nodes: Node[], edges: Edge[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.from)?.push(e.to);

  const color = new Map<string, 0 | 1 | 2>();
  const back = new Set<string>();
  const visit = (v: string) => {
    color.set(v, 1);
    for (const w of adj.get(v) ?? []) {
      const c = color.get(w) ?? 0;
      if (c === 1) back.add(`${v}→${w}`);
      else if (c === 0) visit(w);
    }
    color.set(v, 2);
  };
  /* 해외 노드부터 시작한다 — 들어오는 엣지가 0 인 자리라 여기서 출발하면
     되먹임이 국내 안쪽에서만 잡힌다. 순서가 결과를 바꾸므로 **정렬한다**:
     같은 그래프가 새로고침마다 다른 모양이면 아무도 안 믿는다. */
  const start = [...nodes].sort((a, b) => {
    const ext = (n: Node) => (n.block === 'external' ? 0 : 1);
    return ext(a) - ext(b) || a.id.localeCompare(b.id);
  });
  for (const n of start) if ((color.get(n.id) ?? 0) === 0) visit(n.id);
  return back;
}

export type Placed = Node & { layer: number; row: number; x: number; y: number };

export type Layout = {
  nodes: Placed[];
  byId: Record<string, Placed>;
  layers: number;
  width: number;
  height: number;
  back: Set<string>;
};

export const NODE_W = 118;
export const NODE_H = 26;
export const COL_GAP = 62;
export const ROW_GAP = 12;
export const PAD = 12;

/**
 * 좌→우 층 배치. 층 안의 순서는 **바리센터 한 벌**로 정한다(들어오는 이웃의
 * 평균 자리). 완전한 교차 최소화는 NP-hard 라 여기서 할 일이 아니고, 한 벌만
 * 돌려도 화살표가 눈에 띄게 덜 엉킨다.
 */
export function layout(nodes: Node[], edges: Edge[]): Layout {
  const back = backEdges(nodes, edges);
  const forward = edges.filter((e) => !back.has(`${e.from}→${e.to}`));

  const incoming = new Map<string, string[]>();
  for (const n of nodes) incoming.set(n.id, []);
  for (const e of forward) incoming.get(e.to)?.push(e.from);

  /* 최장경로 층. 순환이 없으므로 고정점에 도달한다 — 안전을 위해 노드 수만큼만
     돈다(무한루프 금지). */
  const layer = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false;
    for (const e of forward) {
      const want = (layer.get(e.from) ?? 0) + 1;
      if (want > (layer.get(e.to) ?? 0)) {
        layer.set(e.to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }

  const maxLayer = Math.max(0, ...[...layer.values()]);
  const cols: Node[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    cols[layer.get(n.id) ?? 0].push(n);
  }

  const order = new Map<string, number>();
  cols.forEach((col, li) => {
    if (li === 0) {
      col.forEach((n, i) => order.set(n.id, i));
      return;
    }
    const bary = (n: Node) => {
      const ups = (incoming.get(n.id) ?? [])
        .map((u) => order.get(u))
        .filter((v): v is number => v != null);
      return ups.length ? ups.reduce((a, b) => a + b, 0) / ups.length : 1e6;
    };
    col.sort((a, b) => bary(a) - bary(b) || a.id.localeCompare(b.id));
    col.forEach((n, i) => order.set(n.id, i));
  });

  const rows = Math.max(1, ...cols.map((c) => c.length));
  const placed: Placed[] = [];
  cols.forEach((col, li) => {
    col.forEach((n, ri) => {
      placed.push({
        ...n,
        layer: li,
        row: ri,
        x: PAD + li * (NODE_W + COL_GAP),
        y: PAD + ri * (NODE_H + ROW_GAP),
      });
    });
  });

  const byId: Record<string, Placed> = {};
  for (const p of placed) byId[p.id] = p;

  return {
    nodes: placed,
    byId,
    layers: cols.length,
    width: PAD * 2 + cols.length * NODE_W + (cols.length - 1) * COL_GAP,
    height: PAD * 2 + rows * NODE_H + (rows - 1) * ROW_GAP,
    back,
  };
}

/* ── 전달경로 — 논문 그림 셋을 **같은 그래프 위에서** 비춘다 ────────────────
 *
 * Figure 2·3·12 는 서로 다른 그림이 아니라 **한 구조를 세 번 본 것**이다.
 * 그래서 그림을 셋 그리지 않고 필터를 셋 둔다. 각 필터는 씨앗 노드에서
 * 도달 가능한 부분그래프를 켠다 — 목록을 손으로 적으면 배선이 바뀌었을 때
 * 화면이 옛 배선을 계속 비춘다.
 */
export type ChannelId = 'trade' | 'financial' | 'policy';

export const CHANNELS: {
  id: ChannelId;
  label: string;
  figure: string;
  blurb: string;
  seeds: string[];
}[] = [
  {
    id: 'trade',
    label: '무역',
    figure: '논문 Figure 2',
    blurb:
      '미국 갭이 다른 블록으로 번지고, 그 합이 한국 수출수요가 돼요. 2차 스필오버는 한 겹 얕아요 — eq (4) 참조.',
    seeds: ['us_y', 'oil'],
  },
  {
    id: 'financial',
    label: '미 금융',
    figure: '논문 Figure 3',
    blurb: '미 정책금리가 미 장기금리를 거쳐 한국 장기금리로 와요(β_sync). 환율도 같이 움직여요.',
    seeds: ['us_i'],
  },
  {
    id: 'policy',
    label: '통화정책',
    figure: '논문 Figure 12',
    blurb: '기준금리 → 환율·시장금리·대출금리 → 지출. 주택과 가계부채가 대출금리에 매달려 있어요.',
    seeds: ['i_kr'],
  },
];

/** 씨앗에서 도달 가능한 노드. 되먹임 엣지도 따라간다 — 실제로 흐르니까. */
export function reachable(edges: Edge[], seeds: string[]): Set<string> {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    const a = adj.get(e.from) ?? [];
    a.push(e.to);
    adj.set(e.from, a);
  }
  const seen = new Set<string>(seeds);
  const stack = [...seeds];
  while (stack.length) {
    const v = stack.pop() as string;
    for (const w of adj.get(v) ?? []) {
      if (!seen.has(w)) {
        seen.add(w);
        stack.push(w);
      }
    }
  }
  return seen;
}

/* ── 배선 대 인쇄 ────────────────────────────────────────────────────────────
 *
 * **그래프에서 유도한다.** 손으로 적으면 배선이 바뀌었을 때 목록만 낡는다.
 */
export type Ghost = {
  from: string;
  to: string;
  equation: string;
  paper_page: string | null;
  why: string;
};

/**
 * 논문이 인쇄했는데 배선이 없는 엣지.
 *
 * 지금 담는 것은 **코드에서 확인한 것만**이다 — 출처 없는 화살표는 안 넣는다.
 * 목록이 짧은 게 결함처럼 보이면 안 된다: 여기 든 것은 전부 2026-08-21 에
 * 인쇄면을 렌더해서 대조한 자리다.
 */
export const PRINTED_NOT_WIRED: Ghost[] = [
  /* 2026-08-21 (P4): `r_firm → i_fi` · `cb → i_fi` · `cpi_yoy → i_fi` 유령 셋이
     여기서 내려갔어요. eq (9) 의 `− UC_I` 를 배선했거든요 — 이제 실재하는
     화살표라서, 셋을 여기 남겨 두면 화면이 «논문에만 있다» 고 거짓말을 해요.
     엣지리스트에서는 `r_firm·cb·kr10y·cpi_yoy → 설비투자 목표 → 설비투자` 로
     서요(건설의 `ih_star` 와 같은 모양). */
  {
    from: 'pi_core',
    to: 'i_fi',
    equation: '11',
    paper_page: 'p.18',
    why: 'eq (11) 이 기대 목표변화의 할인합을 인쇄하는데, PAC 기대항은 소비(eq 8)에만 배선돼 있어요.',
  },
  {
    from: 'pi_core',
    to: 'x',
    equation: '19',
    paper_page: 'p.24',
    why: '수출 성장식(eq 19)도 기대 목표변화의 할인합을 인쇄하는데, 배선된 것은 오차수정·수요증가·환율 셋뿐이에요.',
  },
  {
    from: 'pi_core',
    to: 'm',
    equation: '22',
    paper_page: 'p.24',
    why: '수입 성장식(eq 22)도 같아요. 기대항 없이 평범한 오차수정으로 돌아요.',
  },
  {
    from: 'pi_core',
    to: 'i_con',
    equation: '14',
    paper_page: 'p.21',
    why: '건설 성장식(eq 14)도 같아요. 8/21 에 이 블록이 해동됐지만 기대항은 안 붙었어요.',
  },
  {
    from: 'pi_core',
    to: 'pm',
    equation: '32',
    paper_page: 'p.29',
    why: '수입물가 성장식(eq 32)도 같아요. 기대항 자리가 비어 있어요.',
  },
];
