/* 부호 틴트 — 히트맵 셀의 배경.
 *
 * 이사 노트 (2026-08-11): 구현은 `src/theme/sign-tint.ts` 로 옮겨졌다 —
 * 일별 대사 스택(ui/ReconStack.tsx)이 백테스트 창(첫 로드 경로)에서도 같은
 * 문법을 쓰는데, ui/ 가 `@/sim/**` 을 값-임포트하면 시뮬 서브트리 전체가
 * 첫 로드 경로에 실린다(guards/lazy-chart — 시뮬은 동적 임포트 하나로만
 * 들어가는 서브트리다). 순수 함수 두 개를 공용 theme/ 로 내보내고 여기는
 * 재수출만 남긴다 — 시뮬 쪽 20여 군데의 임포트 경로는 그대로 산다.
 * 규칙·실측·doc 전부 sign-tint.ts 에 그대로 있다. */
export { MAX_MIX, MIN_MIX, directionVar, tintFor } from "@/theme/sign-tint";
