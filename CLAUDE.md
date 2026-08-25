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

## 화면 문법의 캐논 [OWNER 2026-08-25 — "이 요청 진짜 자주 하고 있는데 뭐가 문제인거임?"]

**「Main/Backtest 를 참고한다」= 그 화면의 부품과 함수를 임포트한다**는 뜻이다.
클래스 이름이나 색 하나를 옮겨 적는 것은 참고가 아니다 — 그렇게 세 번 어긋났고
오너가 세 번 같은 지적을 했다. 새 화면을 만들 때 아래를 **먼저 임포트**하고,
없을 때만 새로 만든다.

| 무엇 | 캐논 | 어디 |
|---|---|---|
| 표 | CDS `Table/TableRow/TableCell` + `ROW_H`(60) | `table/InstrumentTable.tsx`·`table/rowHeight.ts` |
| 이름 칸 | 2줄 스택 `sr-name-stack`(label1 + legal 뮤트) | 같은 파일 |
| 레벨 값 | `fmtLevel` (표·리드아웃 한 벌) | `lib/format.ts`·`table/cells.ts` |
| 레벨 열 **머리** | `levelHeadText`/`levelHeadTitle` — **날짜**이지 「값」이 아니다 | `lib/format.ts` |
| 변화 열 머리 | `1D`/`MTD`/`YTD`(BASIS_LABEL) | `table/InstrumentTable.tsx` |
| 변화 셀 | **네 부품 한 벌**: `tintStyle` 배경 + `directionClass` + `directionGlyph`(↗↘) + `unsignedDelta`(무부호) | `table/tint.ts` |
| 범위 위치 | `.sr-track`/`.sr-track-mark`(폭은 바깥이 준다) | `table/InstrumentTable.tsx`·`lib/range.ts` |
| 사실 스트립 | `StatColumn`+`Stat`, 감싸는 `.sr-stats` — 차트 **아래** | `ui/Stat.tsx` |
| 커서 리드아웃 | `ReadoutCard`+`ReadoutLevel`/`ReadoutMoney`+`placeReadout`, 상자는 `.sr-plot` | `ui/ReadoutCard.tsx` |
| 시계열 차트 | 주선 = **보이는 구간 순변화 방향색**(`--sr-up`/`--sr-down`/뮤트) + `showArea areaType="dotted"` + `CHART_INSET{16,12,8,8}` + `animate={false}` + 축 `showGrid={false}`·y 오른쪽 | `ui/PreviewPane.tsx` |
| 손익 차트 | 부호 방향색 + 면 | `backtest/LinkedCharts.tsx` |
| 화면 컨트롤 | `.sr-pillbtn`(32px·14/600 알약) — **앱 공용**이다 | `theme/type.css` |
| 떠 있는 창 | `FloatingWindow`(windowKey 등록) | `ui/window/` |
| 대사 표 | `ReconStack` | `ui/window/ReconStack.tsx` |

규칙 셋:
1. **새로 만들기 전에 찾는다.** 위 표에 있으면 그것을 쓴다. 같은 모양을 손으로
   다시 만들면 한쪽만 낡는다(실측: 전략 실험 창의 KPI 타일이 `ui/Stat.tsx` 의
   중복이었다).
2. **클래스 이름은 소유권이 아니다.** `.sr-rv-*` 중 일부는 앱 공용이다. 판단은
   이름이 아니라 **그 파일의 머리 주석**이 한다.
3. 캐논에서 벗어나야 하면 **왜인지를 주석으로 남긴다**(시뮬 케이스 색·Lab 3D 처럼
   정당한 예외가 있다). 근거 없는 이탈은 결함이다.

## 얼라인 [OWNER 2026-08-25 — "얼라인 맞추는 것도 규칙에 박아두자"]

한 행에 서는 것들은 자로 잰 듯 맞아야 한다. 어긋난 행은 결함이다.

1. **컨트롤 행 등고 = 32px.** 입력·셀렉트·알약·행 안의 버튼이 한 행에 서면
   전부 32px 상자다(`guards/control-parity.test.ts` 의 그 등고). CDS 기본을
   그대로 두면 그 행만 벌어진다 — `Select` 는 `font="legal"`, `TextInput` 은
   `fontSize="legal" height={32}`. 컨트롤이 아닌 **값**도 같은 행에 서면 같은
   32px 상자에 담는다(백테스트 「진입 레벨」 판례 — 안 담으면 그 블록만
   바닥에서 어긋난다).
2. **라벨은 컨트롤 위다**(Field 문법 — 백테스트·시뮬 창의 그 컴포넌트).
   라벨을 옆에 붙이면 라벨 폭마다 컨트롤 시작점이 계단이 진다(전략 실험 창
   첫 판의 실측 — "아주 얼라인이 개판"). 라벨을 옆에 둬야 하는 설정 패널은
   rv 처럼 **고정폭 라벨 열**(SetRow)로만.
3. **행은 바닥 정렬**(`alignItems="flex-end"`) — 바닥 정렬 행에서는 블록
   높이가 곧 라벨 높이다(2026-08-19 얼라인 레인의 실측 규칙).
4. **숫자는 오른쪽, 글은 왼쪽**, 숫자는 tabular-nums. 표 머리도 같은 쪽으로
   정렬한다(.sr-rv-th 기본 우측·라벨 열만 .sr-rv-left).
5. 같은 위계의 카드 머리는 같은 패딩 리듬(paddingX 2 · paddingTop 1.5 ·
   paddingBottom 0.5) — 한 화면에서 카드마다 머리 높이가 다르면 안 된다.
6. 새 행·새 카드를 만들면 **스크린샷으로 실측**한다 — 눈이 마지막 가드다.

## 낱말 중간 줄바꿈 금지 [OWNER 2026-08-25 — "국고, 줄 바꾸고 채 뭐 이딴게 비일비재하네"]

한글은 **낱말 사이에서만** 접힌다. 「국고채」가 「국고 / 채」로 갈리면 결함이다.

1. 뿌리에 `body { word-break: keep-all }` 이 있다(`theme/type.css`). 상속되므로
   새 컴포넌트가 각자 다시 적을 필요가 없다 — 그렇게 여덟 곳에 흩어져 있었다.
2. `word-break: break-all`·`break-word`·`overflow-wrap: anywhere` 금지. 낱말을
   쪼갠다.
3. `overflow-wrap: break-word` 는 **허용**이다 — 끊을 자리가 없는 긴 토큰
   (URL·id)이 상자를 넘는 것만 막고 낱말은 안 쪼갠다.
4. 가드: `guards/no-midword-break.test.ts` 가 ①과 ②를 잰다.
5. 좁아서 접히는 것 자체가 문제면 폭을 고친다 — 「얼라인」·「말줄임」 절과 한 몸이다.

## 말줄임 절대 금지 [OWNER 2026-08-25 — "진짜 눈에 안 들어오면 안 돼"]

라벨·이름·숫자를 잘라 «국고…» 로 만드는 것을 금지한다. 어떤 화면·어떤 칸에서도.

1. `text-overflow: ellipsis` 사용 금지(CSS·inline style·CDS `overflow="truncate"`
   전부). JS 로 문자열을 잘라 '…' 를 붙이는 것도 같은 것이다.
2. 대신 **맞게 만든다**: 칸 폭을 최장 라벨로 실측해 잡거나(BacktestWindow 방향
   세그먼트가 이미 이 판례 — "… 처럼 생략되는 것도 별로" [OWNER 2026-08-19]),
   줄바꿈(`keep-all`)으로 두 줄에 세운다. 폭이 정말 안 나오면 레이아웃을 바꾸지
   글자를 자르지 않는다.
3. 잘림의 사촌인 **글자 겹침**(nowrap 텍스트가 이웃 칸 위로 넘치는 것)도 같은
   등급의 결함이다 — 고정폭 상자 안의 nowrap 라벨은 최장 라벨이 들어가는지
   실측하고 근거를 주석으로 남긴다.
4. 가드: `guards/no-ellipsis.test.ts` 가 src 전체에서 ①을 잰다. 허용 목록은 없다.
5. 진행 중 표기("갱신 중…")의 '…' 는 생략이 아니라 문장 부호다 — 이 규칙과
   무관하다.
