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
