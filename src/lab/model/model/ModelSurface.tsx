'use client';

/* Lab 「모형」 의 둘째 면 — «이 숫자 어디서 왔어» 에 답한다.
 *
 * 읽는 사람은 전략가와 궁금한 트레이더다. 그래서 순서가 **배선 → 반응 → 식 →
 * 계수** 다. 지도를 먼저 주고, 그 지도가 내는 그림을 보이고, 그다음에 글자로
 * 내려간다. 반대로 놓으면(식 44개부터) 아무도 두 번째 화면까지 안 온다.
 *
 * 읽기 전용이다 — 입력이 없고 엔진을 import 하지 않는다. 정적 JSON 만 읽는다.
 */

import { ANCHORS } from '../anchors';
import { SurfaceShell, type TocItem } from '../SurfaceShell';

import { BasisIrf } from './BasisIrf';
import { Census, CoefficientTable, EquationRegister } from './Registers';
import { WiringGraph } from './WiringGraph';

/* 차례. **순서는 이 면의 논지**라 알파벳도 크기도 아니다 — 지도 → 그림 → 글자.
   id 는 손으로 조립하지 않는다(`anchors.ts`). */
const TOC: TocItem[] = [
  { id: ANCHORS.model.wiring, label: '배선' },
  { id: ANCHORS.model.basisIrf, label: '기저 반응' },
  { id: ANCHORS.model.equationRegister, label: '식 등록부' },
  { id: ANCHORS.model.coefficientRegister, label: '계수표' },
  { id: ANCHORS.model.census, label: '미인쇄 인구조사' },
];

export function ModelSurface() {
  return (
    <SurfaceShell
      items={TOC}
      className="sr-model-surface"
      blurb="BOK-LOOK(한국은행 BOK WP 2025-3)을 구현한 거예요. 논문에 없는 자리는 그렇다고 적어 뒀어요."
    >
      <WiringGraph />
      <BasisIrf />
      <EquationRegister />
      <CoefficientTable />
      <Census />
    </SurfaceShell>
  );
}
