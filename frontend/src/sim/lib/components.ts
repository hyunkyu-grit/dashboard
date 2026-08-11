/**
 * 이 제품이 평가하는 Total Return 성분.
 *
 * ─ 범위: 스왑만 [OWNER, 2026-08-06] ─────────────────────────────────────
 * 채권평가·채권캐리는 화면에서 뺀다. 채권을 요청에 싣지 않으므로 조달비용도
 * 함께 빠진다 — 조달은 채권 북의 평가금액을 조달하는 비용이라, 채권이 없으면
 * 0이다. 상수 0을 줄로 그리면 "조달이 0이었다"가 아니라 "조달이라는 게 있고
 * 마침 0이다"로 읽히는데, 둘은 다른 주장이다.
 *
 * 백엔드 계약은 건드리지 않았다. 응답은 여전히 다섯 성분을 전부 싣고, 골든 핀도
 * 그대로다. 바뀐 것은 **무엇을 보내고 무엇을 그리는가**뿐이라, 채권을 다시
 * 넣으려면 아래 배열에 세 줄을 되살리고 입력 브릿지의 필터를 풀면 된다.
 */

import type { DecompositionDailyPoint } from "../api/simulate-dto";

export type ComponentKey = keyof Omit<DecompositionDailyPoint, "day" | "total">;

export interface ComponentDef {
  key: ComponentKey;
  label: string;
}

/** 현재 범위. 순서는 의미 없다 — 화면은 마지막 값 크기로 다시 정렬한다.
 *
 * [OWNER, 2026-08-11 — 교과서 3분해] 스왑캐리(세타 전액)가 캐리/롤다운으로
 * 갈렸다: 스왑캐리 = 순캐리(쿠폰 차 액크루얼+정산), 스왑롤다운 = 커브가
 * 멈춰도 잔존만기가 줄며 생기는 클린 가격 변화. 셋의 합 = 스왑 손익 전액은
 * 그대로다(백엔드 carry_split.py · 골든 핀). 구 캐시 응답에는 swapRolldown
 * 이 없다 — visibleTotal 의 typeof 가드가 그대로 처리한다. */
export const COMPONENTS: readonly ComponentDef[] = [
  { key: "swapMtm", label: "스왑평가" },
  { key: "swapCarry", label: "스왑캐리" },
  { key: "swapRolldown", label: "스왑롤다운" },
];

/** 범위 밖이라 화면에 없는 성분. 되살릴 때 여기서 위로 옮긴다.
 *   { key: "fundingCost", label: "조달비용" }
 *   { key: "bondMtm",     label: "채권평가" }
 *   { key: "bondCarry",   label: "채권캐리" }
 */
export const OUT_OF_SCOPE: readonly ComponentDef[] = [
  { key: "fundingCost", label: "조달비용" },
  { key: "bondMtm", label: "채권평가" },
  { key: "bondCarry", label: "채권캐리" },
];

/** 화면이 주장하는 토탈. 서버의 `total`은 다섯 성분 전부의 합이므로, 범위가
 * 스왑뿐인 지금 그 값을 그대로 쓰면 보이지 않는 성분이 섞인 숫자를 "토탈"이라고
 * 부르게 된다. 그래서 **보이는 성분만 더한다.**
 *
 * 채권을 싣지 않는 한 두 값은 같다(나머지가 0이라서). 같다는 사실에 기대지 않고
 * 명시적으로 더하는 이유는, 언젠가 채권이 요청에 섞여 들어오는 날 화면이
 * 조용히 거짓말하는 대신 눈에 띄게 어긋나기 위해서다. */
export function visibleTotal(point: {
  [K in ComponentKey]?: number | null;
}): number {
  let sum = 0;
  for (const { key } of COMPONENTS) {
    const v = point[key];
    if (typeof v === "number") sum += v;
  }
  return sum;
}

/** 표기·설정의 테너 상한 [OWNER, 2026-08-06].
 *
 * 이 제품은 KRW IRS 북을 본다. 실측(2026-08-06): 북의 최장 만기가 9.67년이고
 * 10년을 넘는 스왑은 **한 건도 없다.** 그래서 커브 미리보기의 축과 스프레드
 * 손잡이를 10년에서 끊는다 — 넘어가는 구간은 어떤 포지션도 건드리지 않으면서
 * 축만 늘려 앞쪽(실제로 읽는 구간)을 압축한다.
 *
 * 충격 커브의 노드 자체(20Y·30Y)는 건드리지 않는다: `generateShockCurves`는
 * 골든 핀이 걸린 함수이고, 30Y 스프레드 입력이 사라지면 그 값은 기본 "0"으로
 * 남아 결과가 달라지지 않는다. 10년 밖으로 나가는 북이 생기면 상한을 올리는
 * 것이지 노드를 되살리는 게 아니다. */
export const MAX_TENOR_YEARS = 10;
