/* 앵커 ID — 세 면(Strategy · Model · Method)이 서로를 가리키는 주소.
 *
 * ## 왜 이게 세션 1 것인가
 *
 * 세션 2(Strategy)와 세션 3(Model·Method)이 **동시에** 돈다. Strategy 의 「논거」
 * 항목은 Model 의 방정식으로, 「리스크」 줄은 Method 의 해석 원장으로 이어져야
 * 하고, Method 의 원장 행은 다시 Strategy 로 돌아와야 한다. 두 세션이 각자
 * 링크 규약을 만들면 **그 링크는 서로 안 닿는다** — 병합 시점에 발견되고, 그때는
 * 양쪽 다 고쳐야 한다.
 *
 * 그래서 주소 체계를 여기서 못 박고 둘 다 읽기만 한다.
 *
 * ## 규약
 *
 *     {surface}:{group}:{item}
 *
 * `surface` 는 셋 중 하나이고 URL 의 `view` 파라미터와 같은 낱말을 쓴다. 링크는
 * `hrefFor()` 가 만든다 — 문자열을 손으로 조립하면 오타가 조용히 죽은 링크가
 * 되고, 죽은 링크는 눌러 보기 전까지 안 보인다.
 */

export const SURFACES = ['strategy', 'model', 'method'] as const;
export type Surface = (typeof SURFACES)[number];

export const SURFACE_LABEL: Record<Surface, string> = {
  strategy: '전략',
  model: '모형',
  method: '방법',
};

/** 한 줄 설명. 세 면이 왜 갈라져 있는지가 여기 있어야 한다. */
export const SURFACE_BLURB: Record<Surface, string> = {
  strategy: '경로 하나를 놓으면 나오는 데스크 노트예요',
  model: '이 숫자가 어디서 왔는지 — 배선·전달경로·방정식이에요',
  method: '논문을 어디까지 따랐고 어디서 해석했는지예요',
};

/* ── 앵커 네임스페이스 ──────────────────────────────────────────────────────
 *
 * 여기 없는 ID 로는 링크를 못 만든다(`hrefFor` 가 타입에서 막는다). 새 앵커가
 * 필요하면 **이 파일에 먼저 더한다** — 그래야 상대 세션이 그 이름을 볼 수 있다.
 */

export const ANCHORS = {
  /** Strategy 의 다섯 줄. `D.3` 의 순서 그대로다. */
  strategy: {
    view: 'strategy:note:view',
    implication: 'strategy:note:implication',
    argument: 'strategy:note:argument',
    trade: 'strategy:note:trade',
    risk: 'strategy:note:risk',
    assumptions: 'strategy:strip:assumptions',
    horizonExit: 'strategy:risk:horizon-exit',
    rStar: 'strategy:risk:r-star',
    ruleDeviation: 'strategy:input:rule-deviation',
    asOf: 'strategy:strip:as-of',
  },
  /** Model 면. 방정식 앵커는 번호로 만든다 — `eq(35)` 참조. */
  model: {
    wiring: 'model:wiring:graph',
    channelTrade: 'model:channel:trade',
    channelFinancial: 'model:channel:financial',
    channelPolicy: 'model:channel:policy',
    basisIrf: 'model:irf:basis',
    equationRegister: 'model:register:equations',
    coefficientRegister: 'model:register:coefficients',
  },
  /** Method 면. */
  method: {
    ledger: 'method:ledger:interpretations',
    seams: 'method:seams:known',
    limitations: 'method:limits:exogenous',
    backtest: 'method:backtest:2021',
    scorecard: 'method:scorecard:irf',
  },
} as const;

/** 방정식 앵커. 논문의 인쇄 번호를 그대로 쓴다.
 *
 *  **묶음(`"23-24"`)은 쓰지 마세요.** 예전 주석이 허용한다고 적어 놨는데,
 *  등록부(`model/Registers.tsx`)는 번호를 **낱개**로만 답니다 — 묶음 주소는
 *  만들 수는 있어도 착지할 자리가 없습니다. 2026-08-24 에 `eq('36-37')` 이
 *  실제로 그렇게 죽어 있었습니다. */
export function eq(no: string | number): string {
  return `model:equation:${no}`;
}

/** 해석 원장의 한 행. `paper_anchors.json` 의 앵커 ID 를 그대로 받는다. */
export function ledgerRow(key: string): string {
  return `method:ledger:${key}`;
}

type AnchorId =
  | (typeof ANCHORS)[keyof typeof ANCHORS][keyof (typeof ANCHORS)[keyof typeof ANCHORS]]
  | string;

/**
 * 앵커로 가는 링크. **문자열을 손으로 조립하지 않는다.**
 *
 * Lab 은 URL 파라미터로 산다(`?g=lab&lab=model`). 면 전환은 `view`, 면 안의
 * 자리는 해시다 — 해시로 두는 이유는 그것이 브라우저의 기본 스크롤 앵커라
 * 우리가 스크롤 코드를 안 써도 되기 때문이다.
 */
export function hrefFor(id: AnchorId): string {
  const surface = String(id).split(':')[0];
  if (!(SURFACES as readonly string[]).includes(surface)) {
    throw new Error(`앵커의 면이 이상해요: ${id}`);
  }
  return `?g=lab&lab=model&view=${surface}#${id}`;
}

/** DOM 에 심을 속성. `<div {...anchorProps(ANCHORS.model.wiring)}>` */
export function anchorProps(id: AnchorId) {
  return { id: String(id), 'data-sr-anchor': String(id) } as const;
}
