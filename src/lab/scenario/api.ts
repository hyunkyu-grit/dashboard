/* 시나리오가 서버와 주고받는 하나 — 앵커.
 *
 * 손잡이는 프런트가 돌린다(`combine.ts`). 서버가 답하는 것은 **오늘의 시장**뿐이라
 * 이 요청은 화면당 한 번이고, 그래서 손잡이를 끌 때 왕복이 없다.
 *
 * 백엔드가 없으면 그 사실을 말한다 — 백테스트·시뮬과 같은 규약이다(404 = 라우트가
 * 없다 = 뒤에 백엔드가 없다). 커브 없이는 «현재» 칸도 «시장» 칸도 못 그리므로
 * 이 화면은 굽기에 실을 수 없다.
 */

import { scenarioAnchorsUrl } from '@/lib/staticPaths';

import type { Anchors } from './assemble';

export class ScenarioUnavailable extends Error {
  constructor() {
    super('시나리오는 실행 중인 백엔드가 필요해요');
    this.name = 'ScenarioUnavailable';
  }
}

/** 백엔드가 보내는 것. `Anchors` 에 서버만 아는 것들이 붙어 있다. */
export type AnchorsPayload = Anchors & {
  /** 이 커브가 정직하게 답할 수 있는 마지막 만기(년). 10Y 빈칸의 근거다. */
  curveLastTenorY: number;
  /** 포워드 시작점(년). 12개월이면 1. */
  fwdStartY: number;
  caveats: string[];
};

export async function fetchScenarioAnchors(): Promise<AnchorsPayload> {
  const r = await fetch(scenarioAnchorsUrl());
  if (r.status === 404) throw new ScenarioUnavailable();
  if (!r.ok) {
    const detail = (await r.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(detail?.detail ?? `시나리오 앵커: HTTP ${r.status}`);
  }
  return (await r.json().catch(() => {
    throw new Error('서버가 응답을 끝내지 못했어요, 다시 열어 보세요');
  })) as AnchorsPayload;
}
