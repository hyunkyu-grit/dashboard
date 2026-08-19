---
target: swap-monitor v2 Lab (Surface3D)
total_score: 26
p0_count: 0
p1_count: 3
timestamp: 2026-08-18T23-41-50Z
slug: src-ui-surface3d-tsx
---
# Critique — sauron-v2 Lab (Surface3D) 2026-08-19

Method: dual-agent (A: design review with live browser · B: deterministic detector + page instrumentation)

## Design Health Score — 26/40 (Acceptable)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | ghost 상태 무표시·줌 레벨 무표시 (asof/결측 캡션은 우수) |
| 2 | Match System / Real World | 3 | 위에서 뷰에 연도 라벨 전무 |
| 3 | User Control and Freedom | 2 | 더블클릭 리셋이 ghost 를 조용히 지움 (실측 확인) |
| 4 | Consistency and Standards | 2 | "LAB"·"BP" uppercase, toFixed vs fmtLevel, 휠 죽음(프리뷰 차트는 살아 있음) |
| 5 | Error Prevention | 2 | 클릭/더블클릭 충돌, 사선 드래그가 의도치 않은 줌 |
| 6 | Recognition Rather Than Recall | 2 | 제스처 4종+Shift 가 산문 한 문단에만, 호버 타깃은 보이지 않는 14px |
| 7 | Flexibility and Efficiency | 3 | 프리셋·테너 필터·ghost·세션 기억·reduced-motion |
| 8 | Aesthetic and Minimalist Design | 3 | 표면은 탁월, 컨트롤 줄은 최대 22알약 |
| 9 | Error Recovery | 3 | ErrorState 재시도·WebGL 컨텍스트 복구·토큰 throw |
| 10 | Help and Documentation | 3 | 항상 보이는 안내문 — 완전하나 미분화 산문 |
| **Total** | | **26/40** | 렌더링은 상급, 입력 레이어가 한 세대 뒤 |

## Anti-Patterns Verdict

렌더링은 슬롭이 아니다 — NYT/TradingView 에 유창한 눈이 멈추는 곳은 픽셀이 아니라 입력 문법이다. 정적 디텍터 0건. 인페이지 디텍터 4그룹/5건: line-length(도움말 233자/줄), tight-leading(캡션 1.23x), all-caps-body(TextCaption — 한글은 무효지만 라틴 "LAB"·"BP"는 실제로 대문자화되어 노출, A 가 독립 확인), layout-transition(.sr-strip height — Lab 밖), flat-type-hierarchy(BODY — 의도된 조밀 레지스터, 오탐). 캔버스 내부(축 라벨·핀·리드아웃)는 디텍터 사각지대 — A 의 육안 실측이 대신 덮었다.

## Priority Issues

1. **[P1] 호버 데드존 — 1차 행동이 불안정.** 노드는 실측 테너 열 7~8개에만 있고 HOVER_PX=14 (Surface3D.tsx:73, 1035-1049) — 표면 대부분이 리드아웃을 반환하지 않는다. Fix: 커서를 최근접 테너 열×최근접 능선으로 스냅, 값은 지금처럼 노드만.
2. **[P1] 위에서(탑) 뷰에 축·범례 전무.** 연도 라벨이 탑뷰 fit 에서 캔버스 밖으로 (1088-1097); pitch≥70 에서 금리축·기준금리선 제거 (1112, 1146); 램프 범례는 어디에도 없음. Fix: 탑뷰 연도 라벨을 하단 변에 클램프 + dom.min/max 라벨 붙은 lo→hi 램프 범례.
3. **[P1] 포인터 없이는 어떤 값도 못 읽는다.** canvas 는 role="img"·비포커스, 리드아웃·회전·줌·ghost 전부 포인터 전용. 풀 선택까지는 키보드 통과(실측). Fix: 레인 6 의 "표로 보기" 관례 재사용 — 보이는 풀의 날짜×테너 표.
4. **[P2] 제스처 문법이 제품 자신과 싸운다.** 휠 죽음(프리뷰는 휠 줌), 수직 드래그=줌(비표준), Shift 피치 은닉, 더블클릭 리셋이 단일클릭 ghost 핸들러를 삼킴(1322-1348, 1452 — 실측: ghost 소실). ghost 는 보이는 칩("고스트 2024-08-05 ×")으로. 휠 줌은 네이티브 non-passive 부착(레인 6 교훈).
5. **[P2] 자기 리포의 동결 규칙 위반.** TextCaption 이 "LAB 의"·"-13.0BP" 를 대문자화 (1427-1434, 1483-1490 — DESIGN §8.9 가 문서화한 그 함정, TextLegal 로); 기준금리/CD 가 fmtLevel 대신 toFixed (1167, 1478, 1481 — ReadoutCard 는 toFixed 금지 가드 보유).

## Cognitive Load — 8항목 중 4~5 실패

크레딧 모드 22알약 한 줄(청킹·그룹핑 실패 — 데이터 선택과 뷰 선택이 동일하게 렌더), 캔버스 하나에 입력 의미 6개, 테너 8+1, 제스처 암기 의존.

## What's Working

1. 구도 규율이 레퍼런스와 실제로 일치 — SPAN_Z 2.6, PERSP 3.4, 요별 refit, as-of 능선 평활 제외 (surfaceProjection.ts:40-56, 85, 140, 257).
2. 값 정직성 — 호버는 실측 노드만, PCHIP 는 그리기 전용·비오버슈트, 결측 미가교 (Surface3D.tsx:373-375, pchip.ts:52).
3. 실패 공학 — 토큰 리졸버 throw, WebGL 컨텍스트 복구, 재시도 가능한 ErrorState (146-167, 1194-1212).

## Persona Red Flags

Alex(트레이더-오너): 표면 중앙 호버→무반응, 휠→무반응, 위에서 뷰에서 연도 인용 불가. 승리: 시계열+테너 알약 = 두 클릭에 10Y 이력+기준금리/CD.
Sam(키보드): 데이터 완전 차단 — canvas 비포커스, 리드아웃 호버 전용, 표 대안 없음. 알약 자체는 포커스 링과 Arrow+Enter 통과(실측). 탑뷰의 회색 테너 라벨은 청색 램프 위에서 대비 미달.

## Minor Observations

날짜/축 라벨 충돌·우측 클리핑(fillText 미클램프, 874, 1167); 정면 뷰 연도 라벨이 표면 위에 인쇄·테너 라벨 클리핑; ghost 가 풀 전환을 넘어 지속(무공지); 크레딧 전환 시 발행체 셀렉터 삽입으로 레이아웃 점프; "검은 선" 카피가 다크에선 흰 선; 로딩 한 줄→620px 캔버스 점프(스켈레톤 없음); 다크 스프레드 표면의 흰 메시 노이즈(알파 절반 고려); ReadoutCard 미재사용(자체 카드가 y고정 독트린도 위반); ghost 클릭 히트테스트 플레이크(첫 시도 무반응 실측); 도움말 문단 233자/줄, 캡션 행간 1.23x.

## Questions to Consider

1. 차트인가 계기인가 — "2023년 3월의 5Y" 에 답하는 데 보이지 않는 14px 노드에 커서를 얹어야 한다면, 3차원이 읽기를 돕는가 데모를 돕는가?
2. 스프레드 풀이 3D 를 벌어들이는가 — 신용SP 시계열은 원근을 입은 2D 면적 차트고, 위에서는 축 잃은 히트맵이다. 연결된 히트맵+단면 쌍이 더 빠르지 않은가?
3. 방향에 남은 색이 있는가 — 램프가 #0052ff(높음)를 쓰는데 앱의 동결 의미론은 파랑=하락이다. 이 표면에 "어제 대비" 음영을 요구받는 날, 적·청 둘 다 이미 임자가 있다.
