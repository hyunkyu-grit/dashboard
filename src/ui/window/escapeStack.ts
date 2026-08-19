/* **Esc 는 한 겹만 닫는다.**
 *
 * v1 의 규칙이고, 그 규칙이 필요한 이유는 겹이 실제로 쌓이기 때문이다: 확대 창이
 * 떠 있고 그 안에서 무언가를 열었을 때, Esc 한 번이 둘 다 닫으면 읽는 사람은
 * "닫으려던 것" 과 "작업하던 것" 을 함께 잃는다. 반대로 안쪽이 이벤트를 삼키면
 * 바깥은 영영 못 닫는다.
 *
 * v1 은 이 판정을 **이벤트 시점에 URL 을 읽어서** 했다(`bt` 와 `tile` 파라미터의
 * 존재로 누가 위인지 결정). v2 는 층이 URL 에만 사는 게 아니므로 작은 스택을
 * 둔다 — 열릴 때 밀어 넣고, 닫힐 때 빼고, Esc 는 **맨 위 것만** 응답한다.
 *
 * 모듈 상태인 이유: 이 질문("내가 맨 위인가")은 컴포넌트 트리를 가로지른다.
 * 컨텍스트로 만들면 트리 밖(포털·모달)에서 열린 겹이 스택에 안 들어온다.
 */

const stack: string[] = [];

/** 겹을 연다. 같은 id 가 이미 있으면 **맨 위로 올린다** — 다시 열린 것이지
 * 두 개가 된 것이 아니다. */
export function pushLayer(id: string): void {
  const at = stack.indexOf(id);
  if (at !== -1) stack.splice(at, 1);
  stack.push(id);
}

/** 겹을 닫는다. 맨 위가 아니어도 지운다 — 창은 Esc 말고 ×(닫기)로도 닫히고,
 * 그때 순서는 지켜지지 않는다. */
export function popLayer(id: string): void {
  const at = stack.indexOf(id);
  if (at !== -1) stack.splice(at, 1);
}

/** 이 겹이 지금 맨 위인가. Esc 핸들러는 이걸 물어보고 아니면 아무것도 안 한다. */
export function isTopLayer(id: string): boolean {
  return stack.length > 0 && stack[stack.length - 1] === id;
}

/** 지금 열려 있는 겹의 수 — 진단과 가드용. */
export function layerDepth(): number {
  return stack.length;
}

/** 테스트 전용. 모듈 상태라 테스트끼리 오염된다. */
export function resetLayers(): void {
  stack.length = 0;
}
