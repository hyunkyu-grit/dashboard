---
target: swap-monitor v2 Lab (Surface3D) 2차
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-08-19T00-23-25Z
slug: src-ui-surface3d-tsx
---
# Critique — sauron-v2 Lab (Surface3D) 2026-08-19 (2차, 13차 수리 후)

Method: dual-agent (A: design review with live browser · B: deterministic detector + page instrumentation)

## Design Health Score — 28/40 (Good, 전회 26)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | 줌/드래그 후 리드아웃이 이전 노드에 동결(실측) |
| 2 | Match System / Real World | 3 | 범례 끝값이 패딩 도메인(0.4436%) — 시장에 없던 수를 4자리로 |
| 3 | User Control and Freedom | 3 | 칩 해제·더블클릭 리셋·고스트 보존(실측 확인) |
| 4 | Consistency and Standards | 2 | 동일한 알약 4그룹이 4가지 의미(데이터 풀·발행체·테너·카메라) |
| 5 | Error Prevention | 3 | 5px 클릭 임계·250ms 고스트 가드·GL 복구 |
| 6 | Recognition Rather Than Recall | 2 | 램프 키가 탑뷰에만·키보드 확장키(Shift/PgUp 등)는 코드 주석에만 |
| 7 | Flexibility and Efficiency | 3 | 포인터+완전한 키보드 경로+프리셋+자리기억 |
| 8 | Aesthetic and Minimalist Design | 3 | 라이트 수려·다크 메시 과다·22알약 |
| 9 | Error Recovery | 3 | ErrorState 재시도·토큰 throw·빈 풀 카피 |
| 10 | Help and Documentation | 3 | 실제 도움말이나 불완전(확장키 누락)·상시 90px |
| **Total** | | **28/40** | 손실은 컨트롤 줄 의미론과 회상 부담에 집중 |

## Anti-Patterns Verdict

"crafted instrument" — 슬롭 아님. 정적 디텍터 0건. 인페이지 4건: 전회의 all-caps-body("LAB"/"BP")가 **소멸**(남은 uppercase 는 상단 신선도 칩의 "IRS" 약어 — 무해), line-length 는 디텍터 추정 86ch vs 캔버스 실측 66ch 로 오탐 판정, tight-leading 캡션 1.23x 는 CDS legal 토큰(13/16) 자체, layout-transition(.sr-strip)·flat-type-hierarchy(body)는 Lab 밖. 13차 수리 전 항목 실측 통과: 전 픽셀 스냅·휠 줌·고스트 칩(리셋·풀 전환 생존)·키보드 경로("genuinely equivalent")·aria-live·포커스 링.

## Priority Issues

1. **[P1] 알약 22개가 보조기술에 무명 + 각자 탭 정거장.** read_page 실측: 빈 접근성 이름의 tab 22개, 그룹 내 화살표 무동작 → 캔버스까지 Tab ~23회. Fix: PeriodSelector 항목에 접근성 이름 + 그룹 라벨(풀/발행체/테너/구도, TextLegal) — 시각적 그룹핑 실패(P2)도 같은 손으로 해결. (Surface3D.tsx:1555-1595)
2. **[P1] 다크에서 도형-바탕 역전.** 메시 fg 0.5α 가 `--sr-s3d-lo #26303c`(페이지 #0a0b0d 대비 미미) 위에서 채움을 삼켜 와이어프레임화(신용SP 오블리크 최악). Fix: 다크 lineA 0.22~0.3 (draw 블록 scheme 분기, Surface3D.tsx:804-816) ± `--sr-s3d-lo` 한 단계 인상(direction.css:207).
3. **[P2] 범례의 거짓 정밀도 + 단일 뷰 한정.** 끝값 = 6% 패딩 포함 dom.min/max (surfaceProjection.ts:307-309) — "0.4436%" 는 찍힌 적 없는 수. Fix: 실데이터 min/max 또는 반올림 눈금으로, 오블리크 뷰 노출 여부 결정.
4. **[P2] 줌·드래그 후 리드아웃 동결.** 제스처 후 카드·능선 하이라이트가 이전 노드에 남아 커서와 불일치(실측) — 데스크에서 오독 위험. Fix: endDrag/휠 정착 후 cursorRef 로 nearestNode 재실행.
5. **[P2] 우측 모서리 라벨 충돌 군집.** "기준금리 2.7500" 시계열 우측 클리핑(실측)·"50bp"×날짜 겹침(신용SP)·측면 "3Y 2Y 1Y" 압착·탑뷰 고스트 날짜×테너 라벨 겹침·바닥선 stub 삐져나옴(x01 −0.1/1.1 오버행). Fix: 우측 거터 충돌 패스 + 바닥선 fitted box 클램프.

## Cognitive Load — 8항목 중 4 실패

선택지 수(22알약)·동일 스타일 다의미·프로즈 의존 학습·램프 의미 회상. 전회 대비: 캔버스 입력 6의미 항목은 제스처 표준화로 통과 전환.

## What's Working

1. 데이터 정직성이 구조적 — 평활은 그리기 전용, hover/리드아웃/aria-live/고스트 전부 pool.z 원값 × fmtLevel, toFixed 0건.
2. 테너 역사 + 시계열 관용구와 고스트 비교 루프(클릭→점선→칩→×)는 데모가 아니라 실제 분석 워크플로.
3. 키보드 경로가 진짜 동등(화살표·Enter·aria-live·포커스 링 전부 실측) — WebGL 캔버스에서 드묾.

## Persona Red Flags

Alex: 최속 경로(5Y 알약→hover)가 프로즈로만 학습 가능·무한 스냅에서 카드는 커서에, 점은 노드에(멀면 오독)·휠 줌이 커서 앵커 아님(화면 중심, Surface3D.tsx:696-702)·카드 안 단위 3종 혼재("7Y 34.4bp" vs 무단위 기준금리/CD).
Sam: 캔버스 앞 무명 정거장 ~23개·aria-live 가 시각 카드보다 정보 빈약(기준금리·CD·역전 누락)·포커스 링 통과·다크 대비 희생자는 표면 자체.

## Minor Observations

고스트가 풀을 넘어 지속하나 칩이 출처 풀 무표시 · 탑뷰에서 고스트 곡선이 우측 모서리 실오라기(칩의 "보이는 상태" 약속 반쪽) · 풀별 시간축 재척도 무언 · 도움말·aria-label 에 Shift/PgUp/PgDn/Home/End 누락 · 오늘 커브 뷰의 금통위 핀이 데이터 점으로 오독 가능 · 구도 무게중심 좌하(우상단 1/3 공백) · 콘솔 에러 0·트윈 유려.

## Questions to Consider

1. 파랑이 이 앱에서 하락인데 이 표면에선 높음이다 — 하단 띠의 적/청 부호 변화와 같은 화면에 서는 유일한 탭에서, 램프가 앱이 소유하지 않은 색조로 갔어야 했나?
2. 트레이더의 반복 질문("X 테너 지금 vs 역사")의 최속 답은 시계열+테너 잠금 — 기본 상태가 오블리크 히어로샷이 아니라 테너 잠금 측면이어야 하나?
3. 위에서가 은퇴한 히트맵의 대체라면, 히트맵의 정량 장비(등치선·눈금)는 어디 갔나?
