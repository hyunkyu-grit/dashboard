# 차트 레인 — 라이트웨이트차트 이관 (2026-08-26 완료)

다음 세션에 그대로 붙여 넣을 수 있게 쓴 문서입니다. 위쪽 절반이 «프롬프트»,
아래쪽이 «참고» 입니다.

---

# 프롬프트 (여기부터 복사)

## 자리

- 리포: `C:\Users\infomax\Desktop\Assistant\Projects_AS\sauron-v2` (rateslab).
  **braveworld 는 열지 말 것.**
- 프런트 dev `:3200` · 백엔드 `:8200` · 라이브 https://rateslab.vercel.app
- 백엔드는 **뜰 때 한 번만 SQL 을 읽는다.** `main.py` 를 고쳤으면 재기동해야
  응답이 바뀐다(`Start-ScheduledTask SauronV2Backend`). 2026-08-26 에 이걸 몰라
  전략 창이 죽은 줄 알고 30분을 썼다 — 실제로는 서버가 디스크보다 낡아
  `neighbors` 키를 안 주고 있었다.

## 규칙 (어기면 사고가 난다)

1. **커밋은 언제나 `git commit --only -- <경로들>`.** bare `git commit` /
   `git add -A` / `git commit -a` / `git stash` 금지. 새 파일은 `git add -- <경로>`
   로 **하나씩** 스테이징한다(`--only` 는 추적 안 되는 파일을 못 담는다).
   커밋 전후로 `git diff --cached --name-only` 를 찍어 두 목록을 보고에 남긴다.
2. **동시 세션이 같은 워킹트리에서 돈다.** 2026-08-26 기준 «터미널 레인» 이
   `src/terminal/`·`src/app/terminal/`·`src/theme/terminal.css`·`layout.tsx`·
   `direction.css`·`HANDOFF-terminal-2026-08-26.md` 를 미커밋으로 들고 있었다.
   내 것이 아닌 경로는 **읽지도 고치지도 않는다.**
3. **`backend/app/main.py` 는 남의 것이다.** 재기동은 해도 편집은 하지 않는다.
4. **푸시가 곧 배포다**(Vercel Git 연동). 수동 `vercel` CLI 금지.
   푸시 전에 **반드시** `next build` 를 돌린다 — tsc·eslint·vitest 는 **CSS 를
   파싱하지 않아서**, 2026-08-26 이전에 CSS 한 줄 때문에 프로덕션이 깨진 적이
   있다.

## 게이트

```
npx tsc --noEmit -p tsconfig.json
npx eslint src guards
npx vitest run
NEXT_PUBLIC_API_BASE=https://e110430.tailc7b701.ts.net/v2 npx next build
```

- `guards/production-env.test.ts` 2건은 `.next` 가 **dev 산출물일 때** 빨갛다.
  프로덕션 빌드 직후에 돌리면 초록이다. 환경 건이지 결함이 아니다.
- `backend/tests/test_cashbond.py::TestReconTiesOutOnLiveData` 4건은 진입일이
  `dt.date(2025, 8, 13)` 하드코딩이라 250영업일 창을 넘어 빨갛다 — **캐시본드
  레인 몫**이고 이 레인과 무관하다.

## 지금 상태

**차트 15개 전부 `lightweight-charts` 5.2.1 로 이관 완료·배포됨.**
3D 표면(`src/ui/Surface3D.tsx`)은 오너 지시로 CDS/캔버스 그대로 둔다.
CDS `visualizations/chart` 에서 아직 쓰는 것은 `PeriodSelector` 뿐이고 그건
차트가 아니라 구간 선택 컨트롤이다.

```
0cc45c61  축이 시끄러웠다 — 눈금 밀도와 날짜 어휘
193610c3  차트 15개 전부 라이트웨이트로
e414d822  커브 가로축을 √만기로
28f21695  커브가 실제로 그려진다 — 색은 라이브러리 파서를 지나야 했다
c792591f  IRS 커브가 진짜 만기 축 위에 선다
d32f27b5  차트 이관 토대 — 축이 셋이다
```

## 부품 구조 — 새 차트를 만들기 전에 여기부터 본다

```
chart/palette.ts      토큰 -> 캔버스 색. p.up · p.refCd · p.resolve('var(--…)') · p.dim(css, %)
chart/useLwChart.ts   차트 수명 + **캐논 룩 한 곳**(canonOptions / creationOptions)
chart/series.ts       선 하나를 세우는 일 — 셋이 공유
chart/horzScale.ts    우리 가로축(LabelledHorzScale) + 빈 점 메우기 + 최근접

chart/TimeChart.tsx     x = 날짜        9개
chart/CurveChart.tsx    x = √만기       3개   (ScaleChart 위)
chart/NumericChart.tsx  x = 숫자        3개   (ScaleChart 위)
chart/ScaleChart.tsx    커브·숫자축의 공통 몸통

chart/dottedArea.ts     점무늬 면(캐논) · 채운 면(손익)   — 시리즈 프리미티브
chart/verticalLines.ts  세로 상수선 + 라벨               — 시리즈 프리미티브
chart/tenorScale.ts     만기 어휘 -> 자리·글자·무게
chart/tenor.ts          만기 <-> 월수
```

가드: `guards/chart-palette.test.ts`(26) · `guards/tenor-scale.test.ts`(13)
· `guards/chart-tenor.test.ts`(9) — 그리고 기존 가드 12벌이 새 자리를 잰다.

---

# 참고 — 실측한 함정 (전부 «에러 없이 조용히 틀리는» 종류)

## 색

1. **캔버스는 `var()` 를 못 푼다.** 팔레트가 **산 DOM 에서** 읽어 넘긴다.
   읽는 대상은 `document.documentElement` 가 아니라 **차트가 실제로 선
   엘리먼트** — CDS `ThemeProvider` 는 팔레트를 제 래퍼의 **인라인 스타일**로
   뿌린다.
2. **읽는 시점은 마운트가 아니라 «스킴이 바뀔 때마다».** 마운트 때 한 번 읽고
   박아 두면 다크로 토글해도 차트만 라이트로 남는다(하니스 CandidateB 의 그 고장).
3. **라이브러리는 자기 색 파서를 갖고 있다.** hex·rgb·rgba·hsl·hwb·이름만 안다.
   `color-mix` 의 계산값이 크롬에서 `color(srgb …)` 라 **던진다** —
   화면이 통째로 에러 경계로 떨어졌다. 해결은 `layout.colorParsers` 에
   픽셀로 재는 파서를 등록하는 것.
4. **그 파서는 생성 뒤에 못 바꾼다.** `applyOptions` 로 넘기면
   «colorParsers option should not be changed once the chart has been created»
   로 던진다. `attributionLogo`·`autoSize` 도 생성자 전용이다. 그래서
   `creationOptions`(만들 때) / `canonOptions`(다시 입힐 때)가 함수 둘로 갈려 있다.
5. **캔버스 `fillStyle` getter 로는 정규화가 안 된다** — 크롬은 `color(srgb …)`
   를 그대로 돌려준다. 픽셀을 칠해서 읽어야 채널이 나온다.
6. **불투명도 손잡이가 없다.** CDS 의 `strokeOpacity` 자리는 `p.dim(css, %)` —
   섞는 계산은 브라우저(`color-mix`)가 한다. 이 층에 색 산술을 두지 않는다.

## 자리·크기

7. **가로축은 인덱스 간격이다.** 자리를 값에 비례시키려면 **사이를 빈 점
   (whitespace)으로 메워야** 한다. 노드만 넣으면 등간격이 된다.
8. **눈금 자리는 점의 «가중치» 가 정한다.** 라이브러리 기본 축들은 그 가중치를
   **값의 배수 관계**로 매긴다. 값을 스케일해 넣으면(√만기 등) 그 배수가 아무
   뜻도 없어져서 **10Y 가 제일 먼저 사라진다.** 그래서 축을 직접 정의한다.
9. **`flexBasis: 0` 은 세로 flex 부모에서 높이를 0 으로 만든다**(가로 부모에선
   폭). CDS `Box` 는 flex row, `VStack` 은 flex column 이라 차트는 둘 다에
   놓인다 — `flexBasis: 'auto'` + `width/height` 를 둘 다 준다.
10. **양 끝 여백은 폭에 비례**시킨다. 고정 4칸이 만기 축(35~219)에서는 2%,
    20분기 축에서는 20% 였다.

## 수명·상호작용

11. **정리 순서.** 훅의 차트 생성 효과가 호출부의 시리즈 효과보다 먼저
    선언되므로 언마운트에서도 **먼저** 정리된다 — 차트가 `remove()` 된 뒤
    `removeSeries` 를 부르면 `Value is undefined` 로 던진다. `LwHandle.alive` 로 막는다.
12. **리드아웃은 «최근접 노드»** 로 붙어야 한다. 사이가 빈 점으로 촘촘해서
    커서는 거의 항상 노드가 아닌 자리에 선다 — 일치로 찾으면 크로스헤어는 뜨는데
    카드가 안 뜬다.
13. **잉크 순서가 CDS 와 반대다.** SVG 는 나중에 적은 것이 위, 캔버스는 **먼저
    만든 계열이 아래**다. 주선을 먼저 적어야 MA 가 그 위에 온다.
14. **`lineWidth` 는 1~4 정수만** 된다. CDS 의 소수 굵기 사다리는 못 옮긴다 —
    사다리의 뜻은 불투명도가 진다.

## 보이는 것

15. **`tickMarkDensity` 기본은 2.5 이고 작을수록 촘촘하다.** 그냥 두면 560px
    패널에 눈금이 **11칸** 선다(CDS 는 5칸). `4` 로 못 박혀 있다. 8 은 2칸이라
    너무 줄인 것이다.
16. **날짜 눈금 글자를 안 주면 로케일 월 이름(「9월」·「2026년」)이 선다.**
    이 제품의 날짜 어휘는 화면 전체가 **ISO** 다 — `tickMarkFormatter` 필수.
17. **배경 탭에서는 캔버스가 안 그려진다.** `fancy-canvas` 가 비트맵 크기를
    `device-pixel-content-box` ResizeObserver 로 정하는데, 배경 탭은 프레임을
    안 그려 그 콜백이 영영 안 온다. **탭을 보는 순간 그려진다.** 우회로 없음.
    (자동화로 확인할 때는 크롬 창을 앞으로 세워야 한다 — PowerShell 로
    `SetForegroundWindow` + `AttachThreadInput` 이 필요했다.)

## 테스트

18. **jsdom 에는 캔버스가 없다.** 차트를 품은 컴포넌트를 렌더하는 테스트는
    ① 앱 `Providers` 로 감싸야 하고(차트가 스킴을 읽는다)
    ② 색 파서가 그 환경에서 중립 채널을 준다(그릴 화면이 없는 곳이다).
19. **가드는 «안 넘긴 옵션» 을 못 본다.** 이관 직후 눈금이 11칸이고 날짜가
    「9월」이었는데 가드 1,494개가 전부 초록이었다 — 소스에 흔적이 없기
    때문이다. **«어떻게 보이는가» 는 화면을 봐야 한다.**

---

# 남은 것 / 미결

| 무엇 | 상태 |
|---|---|
| MCP 핀 `@coinbase/cds-mcp-server@9.15.0` -> 9.22.0 | 리포 밖 · **오너 조치** |
| 시뮬 선물 진입가 편집 | 서버 절반만 됨 — `main.py` 두 줄이 남의 것이라 못 박음 |
| 표 머리 `caption` 대문자화(σ -> Σ) | 일곱 중 둘만 고칠지 전부 `legal` 로 갈지 **오너 판단** |
| `test_cashbond` 4건 | 캐시본드 레인 몫(하드코딩 날짜) |
| 터미널 레인 미커밋 | 동시 세션 — 그쪽이 커밋하면 `/terminal` 이 함께 올라간다 |

번들: `/` 라우트 225 kB -> **188 kB**(CDS 차트 모듈이 빠졌다), 공유 청크 +20 kB.
