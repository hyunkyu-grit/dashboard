# 차트 레인 — 라이트웨이트차트 이관 (v2 · 2026-08-27)

v1 은 «무슨 일이 있었나» 를 적었다. v2 는 **다음 세션이 첫 10분에 무엇을
치면 되는가** 를 적는다. 위쪽이 붙여 넣을 프롬프트, 아래쪽이 부록(함정 19건)
이다.

---

# 프롬프트 (여기부터 복사)

## 0. 첫 3분 — 아무것도 고치기 전에 이것부터 친다

```bash
cd "C:\Users\infomax\Projects\apps\sauron-v2"
git log --oneline -6
git status --porcelain          # 내 것이 아닌 미커밋이 몇 개인지 눈으로 센다
curl -s localhost:8200/api/health || echo "백엔드 죽음"
```

세 줄이 각각 답하는 것: **어디까지 되어 있나 / 남의 레인이 무엇을 들고 있나 /
서버가 디스크만큼 새것인가.** 셋째가 특히 중요하다 — 백엔드는 **뜰 때 한 번만
SQL 을 읽는다.** `backend/app/main.py` 가 바뀌었으면 재기동해야 응답이 바뀐다.

```powershell
Start-ScheduledTask SauronV2Backend
```

2026-08-26 에 이걸 몰라 전략 창이 죽은 줄 알고 30분을 썼다. 실제로는 서버가
디스크보다 낡아 `neighbors` 키를 안 주고 있었을 뿐이다. **화면이 이상하면
코드를 의심하기 전에 서버 나이를 의심한다.**

## 1. 자리

| | |
|---|---|
| 리포 | `C:\Users\infomax\Projects\apps\sauron-v2` (rateslab) |
| 프런트 | dev `:3200` — `npx next dev -p 3200` |
| 백엔드 | `:8200` — 예약태스크 `SauronV2Backend` |
| 라이브 | https://rateslab.vercel.app (푸시 = 배포) |
| 차트 모듈 | `src/chart/` — **`src/ui/chart/` 아니다** |
| 이관 벤치 | `/chart` 라우트 (`src/app/chart/page.tsx`) |

**`braveworld` 는 열지 않는다.** v1 리포다.

## 2. 만지지 않는 것

동시 세션이 **같은 워킹트리에서** 돈다. 2026-08-27 아침 기준 남의 미커밋:

```
src/terminal/  src/app/terminal/  src/theme/terminal.css
src/app/layout.tsx  src/theme/direction.css  HANDOFF-terminal-2026-08-26.md
backend/data/raw/bigfoot_*.csv   (굽기 레인 산출물)
```

`backend/app/main.py` 도 남의 것이다 — **재기동은 해도 편집은 하지 않는다.**
내 것이 아닌 경로는 읽지도 고치지도 않는다.

## 3. 커밋 — 경로를 못 박는 방법 말고는 없다

```bash
git add -- <새 파일 경로>                    # 새 파일은 하나씩. --only 는 미추적을 못 담는다
git diff --cached --name-only                # ① 담긴 목록
git commit --only -- <경로1> <경로2> ...     # 언제나 --only
git show --stat HEAD                         # ② 실제로 들어간 목록
```

보고에는 **①과 ② 두 목록을 다 적는다.** 금지: bare `git commit` ·
`git add -A` · `git commit -a` · `git stash`(이 리포는 동시 세션과 pop 이 조용히
실패한다 — 대조가 필요하면 worktree 로).

푸시가 곧 배포다(Vercel Git 연동). **수동 `vercel` CLI 금지** — 미커밋이 딸려
올라간다.

## 4. 게이트 — 푸시 전 넷 다

```bash
npx tsc --noEmit -p tsconfig.json
npx eslint src guards
npx vitest run
NEXT_PUBLIC_API_BASE=https://e110430.tailc7b701.ts.net/v2 npx next build
```

넷째를 빼면 안 된다. **tsc·eslint·vitest 는 CSS 를 파싱하지 않는다** — CSS 한
줄로 프로덕션이 깨진 적이 있다.

**⚠ `next build` 는 dev 서버의 `.next` 를 덮는다** [실측 2026-08-27 — 한 세션에
네 번 밟았다]. 게이트를 돌리면 `:3200` 이 정적 청크를 404 로 내주고 화면이
스타일 없는 HTML 로 떨어진다. 「내가 방금 뭘 깨뜨렸나」로 보이지만 아니다.

    빌드를 돌릴 거면 dev 를 내리고, 끝나면 다시 띄운다:

      netstat -ano | grep ":3200" | grep LISTENING     # PID 찾기
      taskkill //PID <pid> //F
      NEXT_PUBLIC_API_BASE=… npx next build
      npx next dev -p 3200

    (`rm -rf .next` 는 dev 가 살아 있으면 "Directory not empty" 로 실패한다 —
     먼저 죽여야 한다.)

**이미 빨간 것 둘(내 결함 아님, 고치지 말 것):**

- `guards/production-env.test.ts` 2건 — `.next` 가 dev 산출물일 때만 빨갛다.
  프로덕션 빌드 직후엔 초록. 환경 건이다.
- `backend/tests/test_cashbond.py::TestReconTiesOutOnLiveData` 4건 — 진입일
  `dt.date(2025, 8, 13)` 하드코딩이 250영업일 창을 넘었다. **캐시본드 레인 몫.**

## 5. 지금 상태

`lightweight-charts` **5.2.1** 이관 **완료·배포됨**. 호출부 16곳 = 제품 15 +
하니스 1.

```
TimeChart    x=날짜   9  StrategyWindow×3 · LinkedCharts×2 · BacktestWindow
                         BandChart · RvPage · PreviewPane
CurveChart   x=√만기  3  PreviewPane · CurvePreview · ModelChart   (+하니스 /chart)
NumericChart x=숫자   3  ResultsWindow · CurvePreview · BasisIrf
```

**3D 표면(`src/ui/Surface3D.tsx`)은 오너 지시로 CDS/캔버스 그대로 둔다.**

CDS `visualizations/chart` 에서 아직 임포트하는 것은 `PeriodSelector` 뿐이다
(`PreviewPane` 1 · `Surface3D` 4). **이건 이관 대상이 아니다 — 손대지 말 것.**
그림이 아니라 탭 컨트롤이고, `DESIGN.md §5.4 «컴포넌트는 CDS 것만»`
[OWNER 2026-08-13] 이 *"CDS 컴포넌트가 존재하면 항상 그것을 우선한다"* 라고
못 박아 두었다. `PreviewPane.tsx:865` 주석이 그 자리의 내력을 적어 놓았다 —
손으로 만든 알약 행을 **일부러 걷어내고** CDS 것으로 바꾼 자리다(키보드 이동·
활성 인디케이터·포커스 링을 다시 만들지 않으려고). 우리가 얹은 것은 색뿐이고
그건 `type.css` 의 `.sr-spans`(부호 있는 선택)·`.sr-tabs-neutral`(부호 없는
필터·카메라)에 있다.

**이 레인이 옮긴 것은 «그림을 그리는 층» 이지 CDS 컴포넌트 전부가 아니다.**

```
ae624baf  차트 레인 인계 문서
0cc45c61  축이 시끄러웠다 — 눈금 밀도와 날짜 어휘
193610c3  차트 15개 전부 라이트웨이트로
e414d822  커브 가로축을 √만기로
28f21695  커브가 실제로 그려진다 — 색은 라이브러리 파서를 지나야 했다
c792591f  IRS 커브가 진짜 만기 축 위에 선다
d32f27b5  차트 이관 토대 — 축이 셋이다
```

번들: `/` 라우트 225 kB → **188 kB**(CDS 차트 모듈이 빠졌다), 공유 청크 +20 kB.

## 6. 부품 지도 — 새 차트를 만들기 전에 여기부터

```
src/chart/
  palette.ts       토큰 → 캔버스 색. p.up · p.resolve('var(--…)') · p.dim(css,%)
  useLwChart.ts    차트 수명 + 캐논 룩 한 곳 (creationOptions / canonOptions)
  series.ts        선 하나를 세우는 일 — 셋이 공유
  horzScale.ts     우리 가로축(LabelledHorzScale) + 빈 점 메우기 + 최근접

  TimeChart.tsx    x = 날짜
  CurveChart.tsx   x = √만기   ┐ ScaleChart.tsx 위
  NumericChart.tsx x = 숫자    ┘

  dottedArea.ts    점무늬 면(캐논) · 채운 면(손익)   시리즈 프리미티브
  verticalLines.ts 세로 상수선 + 라벨                시리즈 프리미티브
  tenorScale.ts    만기 어휘 → 자리·글자·무게
  tenor.ts         만기 ↔ 월수
  curve.ts pchip.ts references.ts extremes.ts zoom.ts surfaceProjection.ts
```

이 레인이 세운 가드: `chart-palette`(26) · `chart-overlays`(25) ·
`reference-lines`(21) · `tenor-scale`(13) · `idle-curve`(13) · `chart-zoom`(11) ·
`chart-tenor`(9) · `chart-domain`(9) · `chart-attribution`(1).

## 7. 새 차트를 붙이는 절차

1. **축부터 고른다** — 가로가 날짜면 `TimeChart`, 만기면 `CurveChart`,
   그 밖의 숫자면 `NumericChart`. 넷째 축이 필요하면 `horzScale.ts` 에
   새 `IHorzScaleBehavior` 를 세우고 `ScaleChart` 를 태운다. **호출부에서
   `createChart` 를 직접 부르지 않는다.**
2. **색은 반드시 `palette.ts` 를 지난다.** 리터럴 hex 금지 —
   `guards/chart-palette.test.ts` 가 잡는다.
3. **값 사이를 빈 점으로 메운다**(`horzScale.ts` 의 도우미). 노드만 넣으면
   자리가 등간격이 된다.
4. **주선을 먼저 적는다** — 캔버스는 먼저 만든 계열이 아래다(CDS/SVG 와 반대).
5. **`/chart` 하니스에서 먼저 본다.** 탭을 **앞으로 세운 채** — 배경 탭에서는
   캔버스가 아예 안 그려진다(함정 17).
6. 게이트 넷 → 커밋(`--only`) → 푸시.

## 8. 안 읽고 시작하면 반드시 밟는 함정 넷

- **캔버스는 `var()` 를 못 푼다.** 팔레트가 **산 DOM 에서**, 그것도
  `document.documentElement` 가 아니라 **차트가 실제로 선 엘리먼트**에서 읽는다
  (CDS `ThemeProvider` 는 인라인 스타일로 뿌린다). 읽는 시점은 마운트가 아니라
  **스킴이 바뀔 때마다**.
- **라이브러리는 자기 색 파서를 갖고 있고** `color-mix` 계산값
  (`color(srgb …)`)에 **던진다** — 화면이 통째로 에러 경계로 떨어졌다.
  `layout.colorParsers` 로 받되 **생성 뒤엔 못 바꾼다**
  (`attributionLogo`·`autoSize` 도 생성자 전용). 그래서 함수가 둘이다.
- **가로축은 인덱스 간격이고 눈금 자리는 점의 «가중치» 가 정한다.** 기본 축들은
  가중치를 값의 배수 관계로 매기므로, 값을 스케일해 넣으면(√만기) 배수가 뜻을
  잃고 **10Y 가 제일 먼저 사라진다.** 그래서 축을 직접 정의했다.
- **가드는 «안 넘긴 옵션» 을 못 본다.** 이관 직후 눈금이 11칸이고 날짜가
  「9월」이었는데 가드 1,494개가 전부 초록이었다. **«어떻게 보이는가» 는 화면을
  봐야 한다.**

나머지 15건은 부록에 있다. 차트를 손대기로 했으면 부록을 통으로 읽는다 —
전부 **에러 없이 조용히 틀리는** 종류다.

## 9. 남은 것 / 미결

**이 레인에 남은 코드 작업은 없다.** 차트 15개 이관이 끝이었다. 아래는 전부
다른 사람 몫이거나 오너 판단이다.

| 무엇 | 상태 |
|---|---|
| MCP 핀 `@coinbase/cds-mcp-server` 9.15 → 9.22 | 리포 밖 · **오너 조치** |
| 시뮬 선물 진입가 편집 | 서버 절반만 됨 — `main.py` 두 줄이 남의 것이라 못 박음 |
| 표 머리 `caption` 대문자화(σ → Σ) | 일곱 중 둘만 고칠지 전부 `legal` 로 갈지 **오너 판단** |
| `test_cashbond` 4건 | 캐시본드 레인(하드코딩 날짜) |
| 터미널 레인 미커밋 | 동시 세션 — 그쪽이 커밋하면 `/terminal` 이 함께 올라간다 |

# (여기까지 복사)

---

# 부록 — 실측한 함정 19건

증상 → 원인 → 처방 순으로 읽는다. 번호는 v1 과 같다.

## 색

**1. 차트만 색이 없다 / 검다.** 캔버스는 `var()` 를 못 푼다. → 팔레트가 산
DOM 에서 읽어 넘긴다.

**2. 다크로 토글했는데 차트만 라이트로 남는다.** 마운트 때 한 번 읽고 박아
뒀다. → 읽는 시점은 «스킴이 바뀔 때마다».

**3. 화면이 통째로 에러 경계로 떨어진다.** 라이브러리 색 파서는
hex·rgb·rgba·hsl·hwb·이름만 안다. 크롬의 `color-mix` 계산값이
`color(srgb …)` 라 던진다. → `layout.colorParsers` 에 픽셀로 재는 파서를 등록.

**4. «colorParsers option should not be changed once the chart has been
created».** → 생성자 전용 옵션이다. `attributionLogo`·`autoSize` 도 같다.
`creationOptions`(만들 때) / `canonOptions`(다시 입힐 때)로 갈라 둔 이유.

**5. 캔버스 `fillStyle` getter 로 정규화하려 했더니 그대로 돌아온다.** 크롬은
`color(srgb …)` 를 그대로 준다. → **픽셀을 칠해서 읽어야** 채널이 나온다.

**6. 불투명도 손잡이가 없다.** CDS 의 `strokeOpacity` 자리는 `p.dim(css, %)` —
섞는 계산은 브라우저(`color-mix`)가 한다. **이 층에 색 산술을 두지 않는다.**

## 자리·크기

**7. 노드 자리가 등간격이 된다.** 가로축은 인덱스 간격이다. → 사이를 **빈
점(whitespace)으로 메운다.**

**8. 10Y 눈금이 제일 먼저 사라진다.** 눈금 자리는 점의 «가중치» 가 정하고,
기본 축은 그 가중치를 값의 배수 관계로 매긴다. 값을 스케일해 넣으면(√만기)
배수가 뜻을 잃는다. → 축을 직접 정의한다.

**9. 차트 높이가 0 이다.** `flexBasis: 0` 은 **세로** flex 부모에서 높이를
0 으로 만든다(가로 부모에선 폭). CDS `Box` 는 flex row, `VStack` 은 column 이라
차트는 둘 다에 놓인다. → `flexBasis: 'auto'` + `width`/`height` 둘 다.

**10. 양 끝 여백이 어떤 차트에선 없고 어떤 차트에선 넘친다.** 고정 4칸이
만기 축(35~219)에서는 2%, 20분기 축에서는 20% 였다. → **폭에 비례**시킨다.

## 수명·상호작용

**11. 언마운트에서 `Value is undefined` 로 던진다.** 훅의 차트 생성 효과가
호출부의 시리즈 효과보다 먼저 «선언»되므로 정리도 **먼저** 된다 — 차트가
`remove()` 된 뒤 `removeSeries` 를 부른다. → `LwHandle.alive` 로 막는다.

**12. 크로스헤어는 뜨는데 리드아웃 카드가 안 뜬다.** 사이가 빈 점으로 촘촘해서
커서는 거의 항상 노드가 아닌 자리에 선다. → **최근접 노드**로 붙인다.

**13. MA 가 주선 아래로 들어간다.** 잉크 순서가 CDS 와 반대다 — SVG 는 나중에
적은 것이 위, **캔버스는 먼저 만든 계열이 아래**다. → 주선을 먼저 적는다.

**14. 소수 굵기 사다리가 안 옮겨진다.** `lineWidth` 는 **1~4 정수만** 된다.
→ 사다리의 뜻은 불투명도가 진다.

## 보이는 것

**15. 눈금이 11칸 선다(CDS 는 5칸).** `tickMarkDensity` 기본 2.5, **작을수록
촘촘**하다. → `4` 로 못 박혀 있다. 8 은 2칸이라 너무 줄인 것이다.

**16. 날짜 눈금이 「9월」·「2026년」으로 뜬다.** 글자를 안 주면 로케일 월
이름이 선다. 이 제품의 날짜 어휘는 화면 전체가 **ISO** 다. →
`tickMarkFormatter` 필수.

**17. 자동화로 열었는데 캔버스가 백지다.** `fancy-canvas` 가 비트맵 크기를
`device-pixel-content-box` ResizeObserver 로 정하는데, 배경 탭은 프레임을 안
그려 그 콜백이 **영영 안 온다.** **탭을 보는 순간 그려진다 — 우회로 없음.**
→ 크롬 창을 앞으로 세운다(PowerShell `SetForegroundWindow` +
`AttachThreadInput` 이 필요했다).

## 테스트

**18. jsdom 에는 캔버스가 없다.** 차트를 품은 컴포넌트를 렌더하는 테스트는
① 앱 `Providers` 로 감싸야 하고(차트가 스킴을 읽는다) ② 색 파서가 그 환경에서
중립 채널을 준다(그릴 화면이 없는 곳이다).

**19. 가드 1,494개가 전부 초록인데 화면이 틀렸다.** 가드는 «안 넘긴 옵션» 을
못 본다 — 소스에 흔적이 없기 때문이다. → **«어떻게 보이는가» 는 화면을 봐야
한다.**
