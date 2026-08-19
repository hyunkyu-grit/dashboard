# sauron-v2 — Claude 세션 규칙

## UI 작업: cds-code × ui-ux-pro-max 병행 규칙 [OWNER 2026-08-19]

이 프로젝트에서 UI 작업 시 cds-code 스킬과 ui-ux-pro-max 스킬을 병행한다. 역할 분담과 우선순위는 다음과 같다.

1. **우선순위**: 토큰·컴포넌트·스타일링 결정은 항상 CDS(cds-code)가 우선이다.
   색은 CDS 시맨틱 토큰 또는 `src/theme/direction.css`의 `--sr-*` 토큰만 쓰고
   (hex는 direction.css에만 — `guards/color-source.test.ts` 가드), 스페이싱·타이포는
   CDS style prop(`padding`, `gap`, `font` 등)으로 적용한다. ui-ux-pro-max가
   팔레트·폰트·hex 값을 제안해도 코드에 반영하지 않는다.

2. **ui-ux-pro-max의 용도**: 접근성, 레이아웃/반응형, 인터랙션·모션, 폼/내비게이션 UX,
   차트 유형 선택 같은 라이브러리 중립적 판단에만 조회용(`--domain ux` 등)으로 쓴다.

3. **금지**: 이 리포에서 ui-ux-pro-max의 `--design-system --persist`로 MASTER.md를
   생성하지 않는다. `src/theme/sauronTheme.ts`와 `src/theme/direction.css`가 유일한
   디자인 소스오브트루스다.

4. **UI 코드 작성·리뷰 시 cds-code 워크플로우를 따른다**: CDS 컴포넌트 선택을 먼저
   알리고, inline style 대신 style prop, raw px 스페이싱 금지(동적 값은 CSS 변수),
   deprecated 임포트 금지.
   - 참고: 기존 코드의 타이포 shorthand(`TextCaption`/`TextLegal`/`TextLabel1·2`/
     `TextBody` 등 602건)는 전부 `@deprecated`지만 시각 무변이라 존치 중 —
     **새 코드에서 추가 사용 금지**, 일괄 마이그레이션(`Text font=…`)은 CDS 메이저
     승급 전에 별도 레인으로(HANDOFF-2026-08-18c §8.14).
