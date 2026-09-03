# 터미널 목업 레인 — 이어받기 프롬프트 (2026-08-26 · **08-27 갱신**)

> 아래 전체를 새 세션에 그대로 붙여넣으면 이 레인을 이어서 할 수 있습니다.
>
> **2026-08-27 에 §6 의 남은 것 중 다섯을 집행했습니다** — 주소 상태 · 키보드
> 탐색 · 그래프 pan/zoom · 축마다의 zoom · `/api/rv/analysis`. §8 이 그날의
> 기록이고, §5·§6·§7 은 그 뒤의 상태로 갈아 끼웠습니다.

---

## 0. 너의 임무

`Projects_AS\sauron-v2` 의 **`/terminal` 목업 레인**을 이어서 만든다.
팔란티어 Gotham 의 분석 문법(동적 온톨로지 · Object Explorer · 링크 그래프 ·
타임라인 · 도시에)을 **원화 금리 데스크**로 옮긴 화면이고, 데이터는 **이 앱의
실제 백엔드에서만** 온다.

시작 전에 반드시:
1. `CLAUDE.md` 를 읽는다 — 캐논·얼라인·말줄임 금지·낱말 중간 줄바꿈 금지.
2. UI 코드를 쓰기 전에 **`cds-code` 스킬을 먼저 부른다**(CLAUDE.md 규칙 1).
3. 이 문서의 §4 「이미 밟은 함정」과 §8-3 을 읽는다 — 같은 데를 또 밟지 마라.
4. `CLAUDE.md` 의 **「키보드와 접근성」** 절을 읽는다 — 이 레인에서 올라간
   규칙이고, 그림 축을 새로 만들면 그 아홉 줄이 요구사항이다.

---

## 1. 절대 규칙 (오너 지시)

- **커밋 금지.** 오너가 명시적으로 지시할 때까지 `git commit` 하지 않는다.
- **동시 세션이 이 리포를 편집 중이다.** 2026-08-26 기준 다른 세션이
  `src/chart/*` · `src/sim/*` 를 lightweight-charts 로 이관 중이다.
  - 가드가 빨개지면 **먼저 `git status --porcelain` 으로 누구 파일인지 가른다.**
    `sim-hover` · `sim-bond-parts` · `simulation` · `idle-curve` · `readout-card`
    실패는 그쪽 레인의 것이지 이 레인의 것이 아니었다.
  - `:3200` 과 `.next` 를 공유한다. dev 서버가 죽거나
    `routes-manifest.json` 이 깨지면 `.next` 를 지우고 다시 띄운다.
  - **`git stash` 금지**(이 리포의 기존 규칙). 커밋할 때는 반드시
    `git commit --only -- <경로>` 로 경로를 못 박는다.
- **지어낸 데이터 금지 [OWNER 2026-08-26].** "실제 연결된 데이터에 기반해서
  사용할 수 있는 것만 만들기." 없는 것은 화면에도 없어야 한다.

---

## 2. 지금 있는 것

### 실행

```
백엔드  http://127.0.0.1:8200   (FastAPI, 이미 떠 있을 수 있음)
프런트  npm run dev             → http://localhost:3200/terminal
```

`.env.development.local` 에 `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8200`.

### 파일 (전부 **미커밋 신규**)

```
src/app/terminal/page.tsx          라우트. 상단 내비에 등록 안 함(하네스)
src/theme/terminal.css             .sr-term-* 화면 문법 전부
src/theme/direction.css            [수정] 팔레트 토큰만 추가 (hex 는 여기에만)
src/app/layout.tsx                 [수정] terminal.css import 한 줄

src/terminal/
  ontology.ts        ★ 핵심. 실제 페이로드 → 객체·링크 (순수 빌더)
  useTermData.ts     백엔드 5곳 fetch + buildOntology + 로딩/에러/부분실패
  urlState.ts        [신설] 패싯·구간·정렬의 주소 부호화 (순수 함수)
  ShortcutHelp.tsx   [신설] 단축키 목록 + 한 글자 단축키 끄기 (WCAG 2.1.4)
  useExploration.ts  탐색 이력(뒤로/앞으로/빵부스러기). **키는 셸이 듣는다**
  TerminalShell.tsx  한 프레임·네 축. 상태는 전부 여기 한 곳
  ObjectExplorer.tsx 좌 20% — 패싯 히스토그램 + 필터 칩
  Dossier.tsx        우 20% — 속성·링크·출처(원문 링크)
  CommandPalette.tsx Ctrl+K / `/` — 348개에서 이름·id 로 점프
  PanelHead.tsx      세 칸이 공유하는 32px 머리
  rows.ts            TERM_ROW_H(24) · TERM_LOG_H(20) · 헤드 높이 · 오버스캔
  apps/
    GraphApp.tsx     관계 — 초점 방사 + 부채꼴 + 묶음/펼치기 + 막다른 길 안내
    TimelineApp.tsx  시간 — 사건 레인 + 발행 분포 + focus/context 브러시
    TableApp.tsx     표 — 결과를 고밀도 그리드로(정렬 가능)
    ChartApp.tsx     값 — 실제 시계열 + 십자선 + 축 좌표 상자
```

### 데이터 (실측 확인됨, 전부 실제)

| 엔드포인트 | 쓰는 것 |
|---|---|
| `/api/universe` | 계열 122 (국고 9 · 크레딧 96 · BSS 9 · 선물 6 · 퓨처스왑 2) |
| `/api/mr/board?window=20&k=2` | 밴드 13 — z · %B · state · rank. **계열의 속성으로 접는다** |
| `/api/rv/analysis?window=52w&basis=base&spreadBp=10` | 크레딧 RV 42 — Score·순위·앵커. 밴드와 **같은 대우**(계열의 속성). 42 중 35만 붙는다(2.5Y 없음) |
| `/api/issuance/calendar` | 두 달 43영업일 — 섹터 발행액(조원) · 그날 일정 · caveats |
| `/api/issuance/day/{iso}` | 그날 **원문** — DART 발행 건 · 기재부 입찰 결과 · 출처 URL |
| `/api/universe/series/{id}` | 일별 시계열 (2020-01-02~, 예: BSS-3Y 1,600여 점) |

객체 **348개**: 계열 122 · 발행 122 · 일정 36 · 발행체 33 · 입찰 16 · 섹터 10 · 만기 9.

### 링크는 **유도**한다 (지어내지 않는다)

id 가 이미 정의를 담고 있다:

```
BSS-{T}        → GOVT-{T}          (국고 − IRS)
FUT-KTB{n}-IY  → FUT-KTB{n}        (내재금리)
FUT-KTB{n}-BS  → FUT-KTB{n}        (저평가)
FSW-KTB{n}     → FUT-KTB{n}-IY     (내재금리 − IRS)
CRD-{ISS}-{T}  → 발행체 · 만기
```

**못 잇는 것은 안 잇는다** — 화면이 그 사실을 말한다:
- 캘린더 섹터(10) ↔ 크레딧 커브 발행체(11)는 **셋만 정확히 겹친다**
  (은행·카드·기타금융). 「캐피탈」에는 커브가 없다(OFB 는 「기타금융」 라벨).
- MR 보드는 `FSW-3Y`, 유니버스는 `FSW-KTB3` — **어휘가 둘**이라 표로 못 박았다.
  (참고: `backtest/book.ts::MAIN_TO_BOOK_ID` 에 세 번째 어휘 `FSW:3Y` 가 있다.)

### 백엔드에 **없는 것** (지어내지 마라)

체결 로그 · 거래상대 마스터 · 개별종목 민평 · 포지션.
앞선 판에서 이것들을 지어냈다가 오너 지시로 전부 삭제했다.

---

## 3. 설계 근거 — 전부 실측·인용

### 3-1. 팔란티어에서 **브라우저로 직접 재 온 값** (2026-08-26)

기억으로 적은 Blueprint v3 시절 값이 **v6 에서 통째로 바뀌어 있었다.**
아래는 blueprintjs.com/docs 다크 테마에서 `getComputedStyle` 로 읽은 것이다.

| 쓰임 | 값 | 출처 |
|---|---|---|
| 페이지 | `#111418` | `$black` = surface bg rest |
| 패널 | `#1C2127` | `$dark-gray1` = surface bg hover |
| 패널+1 | `#252A31` | `$dark-gray2` = surface bg active |
| 헤어라인 | `#2F343C` | `$dark-gray3` |
| **행 경계** | **`#ffffff33`** | `--bp-surface-border-color-default` (다크) |
| **행 호버** | **`rgba(95,107,124,.3)`** | interactive 표에서 실측 = `$gray1` 30% |
| 본문/뮤트/흐림 | `#F6F7F9` / `#ABB3BF` / `#8F99A8` | light-gray5 / gray4 / gray3 |
| 강조 | `#4C90F0` | `$blue4` (`$blue3` #2D72D2 는 패널 위 3.43 미달) |
| 시안 | `#68C1EE` | `$cerulean5` |
| **반경** | **컨트롤 4 / 프레임 0** | `--bp-surface-border-radius: 4px` |
| **간격 기본** | **4px** | `$pt-spacing` (옛 10px 그리드는 폐기) |
| **로그 행** | **20px · `0 8px` · 12/20** | `@blueprintjs/table` 셀 실측 |

**짐작으로는 안 나왔을 두 가지:**
1. 팔란티어는 표 경계를 `border` 가 아니라 **`box-shadow: inset`** 으로 그린다.
2. 「흐린 선」·「밝은 호버」를 불투명 색이 아니라 **알파 워시**로 한다.

Gotham 브랜드 면은 `#1E2124`, `{ GOTHAM }` 괄호 라벨, **가는 선 + 교점의 점**
격자(palantir.com/titanium). Foundry Quiver 실물은 3분할 프레임 · 초소형 대문자
패널 머리 · 큰 숫자 타일.
**부수 발견: Foundry 제품 자체는 라이트다.** 「딥다크 팔란티어」는 Gotham/
Blueprint 다크 레지스터이지 Foundry 기본 화면이 아니다.

### 3-2. 외부 UX 리서치 (인용 가능 — CLAUDE.md 규칙 7)

**Shneiderman 1996, "The Eyes Have It"** — 일곱 과업으로 이 화면을 감사했다:

| 과업 | 상태 |
|---|---|
| overview · filter · details-on-demand · relate | ✅ |
| zoom | ⚠️ 타임라인만 |
| **history** | ✅ 추가함 (뒤로/앞으로 · 빵부스러기 · `Alt+←/→`) |
| **extract** | ✅ 추가함 (결과를 TSV 로 클립보드) |

**Cambridge Intelligence 그래프 UX 지침**
- 검색은 노드를 빨리 찾는 **지름길** → 커맨드 팔레트 `Ctrl+K` / `/`
- 고차수 노드는 **점진적 확장** → 부채꼴당 `MAX_FAN=8` + 묶음 노드 + 펼치기
- 색 단독 금지 → 종류마다 글리프(◆ ■ ⬟ │ ● ▲ ★)
- 있는 관례를 따른다 → `Alt+←/→` 는 브라우저의 그 손짓

**Nielsen Norman Group 필터 지침**
- **applied-filter chips** + 개별 해제 → `계열 분류 bss ✕`
- **zero-results dead end 방지** → 그래프가 초점만 남으면
  「이웃 N개가 지금 필터에 가려져 있어요 + 필터 비우기」
- 실시간 개수 → 패싯 막대는 **지금 결과**로 다시 그려진다

출처:
- https://www.cs.umd.edu/~ben/papers/Shneiderman1996eyes.pdf
- https://cambridge-intelligence.com/blog/designing-intuitive-data-experiences-with-graph-visualizations/
- https://www.nngroup.com/articles/filter-categories-values/
- https://blueprintjs.com/docs/ (다크 테마 실측)

---

## 4. 이미 밟은 함정 — **다시 밟지 마라**

### CDS `TableCell` 은 children 을 **네 겹**으로 감싼다

```
깊이 0  td      padding 0 8px      ← 우리 것
깊이 1  div     padding 0
깊이 2  div     padding 6px 16px + margin 0 -16px   ← 한 쌍이다
깊이 3  div     padding 0
깊이 4  div     line-height 24px + font-size(자기 선언)
```

- `padding` 만 지우면 **음수 마진만 남아 글자가 칸 왼쪽 밖으로 16px 끌려나간다.**
  둘 다 지워야 한다.
- 깊이 4 는 **자기 `font-size` 를 선언**한다. 상속으로 못 이긴다 — `td` 를 12px 로
  만들어도 실제 글자는 CDS `body`(16px)로 나온다.
- 마지막 겹이 **세로 flex** 라 가로 정렬은 `justify-content` 가 아니라
  **`align-items`** 가 한다. (`theme/type.css` 의 `.sr-num` 주석이 이미 적어 둔 것.
  이 세션에서 **세 번** 같은 원인으로 걸렸다: 우측 정렬 실패 · 표 종류 칸의 글리프가
  세로로 쌓임 · 행 높이 20→31.)
- 셀 안에 여러 조각을 넣을 때는 **한 span 으로 묶어라**(`.sr-term-typecell`).

### 절대 배치에 `top` 을 안 주면 **정적 위치**를 쓴다

가로 십자선이 `top` 없이 `translateY` 만 있어서 플롯 **아래**(y=906, 플롯은 32~807)에
그려지고 있었다. 세로선은 `top:0; bottom:0` 이 있어 멀쩡했기 때문에
「십자선이 반만 보인다」로 나타났다.

### CDS `Table` 컨테이너가 sticky 를 가로챈다

`overflow: auto` 인 div 로 감싸므로 그것이 열 머리의 «가장 가까운 스크롤 조상» 이
된다. 정작 스크롤은 바깥이 하므로 sticky 가 **아무 데도 안 붙는다.**
→ `.sr-term-log > div { overflow: visible }`

### `useMeasure` 에 **인라인 화살표 ref 금지**

렌더마다 새 함수 → React 가 ref 를 null/노드로 다시 부름 → ResizeObserver 재연결 →
즉시 측정 → setState → 렌더 → 무한 루프. **브라우저가 얼었다.**
`useCallback` 으로 고정할 것.

### `useState` 업데이터 안에서 다른 setter 를 부르지 마라

`setPresent(cur => { setPast(p=>[...p,cur]); return id })` 로 썼더니 StrictMode 가
업데이터를 두 번 불러 **빵부스러기가 두 칸씩 쌓였다.** 관련 상태는 한 객체로 합쳐라.

### 가드가 요구하는 것

- hex 는 `src/theme/direction.css` **에만** (`color-source.test.ts`)
- CSS 간격 px 는 `{0,2,4,6,8,12,16,24,32}` 계단 (`spacing-scale.test.ts`)
- `var(--color-*)` 이름은 화이트리스트에 있어야 (`css-token-names.test.ts`)
- 다크 방향 쌍은 `[data-sr-scheme='dark']` 블록 안 **hex 리터럴**이어야
  (`contrast.test.ts` 가 그걸 읽는다 — 변수로 우회하면 가드의 눈을 가리는 것)
- `text-overflow: ellipsis` 금지 (`no-ellipsis.test.ts`)
- **CSS 주석은 `/*` 로 열어야 한다.** 주석 본문만 넣었다가 그 뒤 규칙이 통째로
  무효가 된 적이 있다(정렬이 안 먹는 것으로 나타났다).

### 다크 배선

터미널 루트는 `<div className="sr-term" data-sr-scheme="dark">` 다.
그 속성이 방향 쌍 · `color-scheme` · 상속 글자색을 전부 내려보낸다.
CSS 선택자는 `.sr-term[data-sr-scheme='dark']`(0,2,0) — 임포트 순서에 안 기대려고
특정도로 이긴다.

---

## 5. 지금 상태 (2026-08-27)

- `npx tsc --noEmit` : 클린
- `npx eslint src/terminal guards/terminal-keyboard.test.ts` : 클린
- `npx vitest run` : **1523 통과 / 1 건너뜀**, 실패 2건은 `next dev` 가 만든
  `.next` 청크 아티팩트(`guards/production-env.test.ts`)다 — dev 서버를 끄거나
  `npm run build` 를 한 번 하면 그린이 된다. 이 레인의 것이 아니다.
- 브라우저 실측(2026-08-27, :3200):
  - 주소 왕복 — `?ta=table&to=CRD-BD-3Y&tf=kind~credit&tk=score:desc` 를 열면
    축·초점·칩·정렬이 그대로 선다. 패싯을 누르면 `tf=rv~Score 상위 25%` 가 적힌다.
  - `Alt+1…4` 축 전환 · `Alt+←/→` 이력 · 그래프 화살표 + `Enter` 이동 ·
    `+` 로 1.0×→1.3× · 차트 끌어서 확대(88점) · `?` 목록 — 전부 동작.
  - 객체 365(그날 데이터 기준. 08-26 의 348 은 그날의 수다).

---

## 6. 남은 것 / 다음 후보

**§6 의 1~5 는 2026-08-27 에 집행했다**(§8). 남은 것은 아래 둘과, 그날 새로
보인 것들이다.

1. **캐논 승격 — 내비 등록은 오너의 결정으로 남긴다.** 「키보드와 접근성」 문법은
   `CLAUDE.md` 로 올렸다(그것이 승격의 실질이었다). 상단 내비 등록은 **안 했고**,
   안 한 이유가 둘이다:
   - `page.tsx` 의 주석이 «등록은 이 화면이 제품이 됐다는 뜻» 이라고 못 박고
     있고, 그 판정은 오너의 것이다.
   - `.sr-term` 은 `height: 100vh` 짜리 **전체 화면 프레임**이라 앱 셸(상단 내비 +
     하단 띠) 안에 그대로 못 들어간다. Lab 세입자로 넣으려면 레이아웃을 다시
     짜야 하고, 그건 «등록» 이 아니라 다른 작업이다.
   → 오너가 «제품으로 간다» 고 하면 그때 (a) `nav.ts` 의 `LabId`+`LAB_ITEMS`,
     (b) `app/page.tsx` 의 렌더 분기, (c) 100vh 를 벗기는 레이아웃 패스 셋이다.
2. **그래프의 접힌 부채꼴 되접기.** 지금은 펼치면 초점을 바꿀 때까지 펼쳐진
   채다(`expanded`). 되접는 손잡이가 없다.
3. **표의 열 고르기.** 열이 일곱이 됐다(Score 합류). 계열이 아닌 객체에는
   대부분 «—» 라, «지금 결과에 값이 있는 열만» 이 다음 요구가 될 가능성이 높다.
4. **RV 조달 규약.** 지금은 백엔드 기본값(`base`+10bp)으로 고정이고 그 사실을
   도시에의 출처 줄이 적는다(`useTermData.RV_PARAMS` 주석). Setting 의 값을
   읽게 하려면 «같은 화면이 사람마다 다른 Score» 를 받아들이는 결정이 먼저다.
5. **`/api/rv/history`.** 크레딧 계열의 스프레드 이력은 아직 안 붙였다 — 차트
   축이 지금 그리는 것은 `universe/series` 의 아웃라이트다.

---

## 7. 확인하는 법

```bash
cd Desktop/Assistant/Projects_AS/sauron-v2
curl -s http://127.0.0.1:8200/api/health          # 백엔드
npm run dev                                        # → :3200/terminal
npx tsc --noEmit | grep src/terminal               # 이 레인만
npx eslint src/terminal
npx vitest run guards/terminal-keyboard.test.ts    # 이 레인의 가드
npx vitest run                                     # 전부(위 .next 2건 주의)
```

화면에서:
- `Ctrl+K` → 「국고 10」 → 계열과 실제 입찰 둘이 잡히면 정상
- 노드를 눌러 이동 → `Alt+←` 로 되돌아오면 이력 정상
- 좌측 패싯 두 개 클릭 → 칩 두 개 → 하나만 ✕ 로 떼지면 정상
- Table 축에서 `z ▼` 정렬 첫 행이 실제 MR 1위(BSS 3Y)면 정상

키보드·주소(2026-08-27 추가):
- 주소창을 복사해 새 탭에 붙여넣으면 **같은 화면**이 서면 정상
- 그래프에 탭으로 들어가 `←/→` 로 이웃을 짚고 `↑/↓` 로 고리를 옮긴 뒤
  `Enter` 로 이동되면 정상 (짚는 동안 화면이 안 움직여야 한다)
- 표에서 `↓` 를 눌러 아직 안 그려진 행까지 내려가지면 가상 스크롤 정상
- `?` → 목록 → 「한 글자 단축키」를 끄면 `/` 가 안 먹고 `Ctrl+K` 는 먹으면 정상

---

## 8. 2026-08-27 에 한 것 [오너 지시 — "접근성 및 사용성 높이면서 나머지도 쭉"]

### 8-1. 주소가 곧 상태다 (§6-1)

`ui/useUrlState.ts` 를 **임포트**한다(새로 만들지 않는다 — 그 훅이 v1 의 프로덕션
전용 라우터 사고를 기억하는 자리다). 키는 여섯이다:

```
ta 축 · to 초점 · tf 패싯 · tr 구간 · ts 차트 스팬 · tk 표 정렬
```

**필터·구간·축·정렬은 상태가 아니라 주소에서 유도한다.** 두 벌로 두고 한쪽을
다른 쪽에 비추면 마운트 한 프레임 동안 서로를 되받아 쓴다(첫 판이 실제로 들어온
주소를 덮어썼다). 초점만 이력이 딸려 있어 훅이 상태를 지고, 주소는 그 결과를
비춘다 — 그래서 이동은 전부 `goTo`·`goBack`·`goForward` 셋을 지나간다.

구간은 **날짜로** 적는다(`2026-01-02..2026-03-04`). 이 화면의 `t` 는 전부 UTC
자정이라 날 경계로 넓혀 적어도 걸러지는 집합이 같고, epoch ms 는 사람이 못 읽는다.

### 8-2. 키보드와 접근성 (§6-2 · WCAG 2.2)

문법은 `CLAUDE.md` 의 「키보드와 접근성」 절로 올라갔다. 이 화면에 들어온 것:

- **그림 축 셋 = roving tabindex.** 탭 정지 한 칸 + 화살표 + `Enter`.
  짚기(`data-cursor`)와 고르기(`data-on`)를 다른 표시로 가른다.
- **표도 roving.** 행마다 `tabIndex={0}` 이던 것을 고쳤다 — 348번 탭이었고,
  가상 스크롤이라 그중 스물 몇 개만 실제로 닿았다.
- **판정 24px**(§2.5.8) — 그래프 노드는 반지름 12 의 투명 원, 시간축 사건은
  폭 24 의 투명 사각형. 확대되면 배율로 나눠 화면에서 24 를 지킨다.
- **`aria-live` 넉 줄** — 셸(축·초점·결과 수)·그래프·시간축·차트. 그림의 변화는
  소리가 안 난다는 것이 근거다.
- **단축키 목록**(`?` 또는 버튼) + **한 글자 단축키 끄기**(§2.1.4, localStorage).
- **건너뛰기 링크**(§2.4.1) — 패싯 마흔 개를 지나야 본문에 닿았다.
- 초점 테두리가 없던 넷(칩·빵부스러기·정렬 버튼·팔레트 줄·출처 링크)에 추가.
- 팔레트에 `aria-activedescendant` — `role="option"` 은 있었는데 초점이 입력에
  있어서 «몇 번째를 고르고 있는지» 가 소리로 안 났다.

### 8-3. 그날 밟은 함정 — **§4 와 같은 등급으로 읽어라**

- **`useExploration` 의 `Alt+←/→` 가 주소를 안 써서 조용히 죽었다.** 훅이
  `back()` 으로 초점을 되돌리면 주소는 그대로라, 셸의 «주소 → 상태» 효과가
  곧바로 옛 값으로 되돌려 놨다 — 누르면 **아무 일도 안 일어나고 이력만 지워졌다**.
  뿌리는 «같은 상태를 두 곳에서 쓴다» 다. 키를 셸로 옮겨 버튼과 같은 함수를
  지나가게 했다.
- **패싯을 온톨로지에만 추가하고 화면에 등록 안 함.** `FacetKey` 에 `rv` 를
  더하고 `facetValue`·`bucketsOf` 까지 고쳤는데 `ObjectExplorer` 의 `FACETS`
  배열에 안 넣어서, 타입 검사도 가드도 다 통과한 채 **막대가 안 떴다**.
  이 목록은 손으로 열거하는 자리이므로 새 패싯은 두 곳을 고쳐야 한다.
- **가상 스크롤에서 초점 주기는 두 걸음**(스크롤 → 다음 렌더에서 `focus()`).
  의존성 없는 효과로 되풀이하게 되는데 **상한을 안 두면 무한 렌더**다(결과가
  0행이거나 스크롤이 더 못 갈 때). `tries` 가 그 상한이다.
- **떠 있는 상자가 화면 높이만큼 늘어나 있었다.** 스크림이 flex 인데
  `align-items` 를 안 줘서 기본 `stretch` 가 먹었고, `max-height: 70vh` 가
  그것을 «항상 70vh» 로 고정했다 — 세 줄짜리 결과 아래로 빈 상자 절반.
  팔레트도 처음부터 그 상태였다(단축키 목록에서야 눈에 띄었다).
- **떠 있는 컨트롤이 축의 마지막 눈금을 덮었다.** 시간축의 확대 손잡이가
  구간 끝 날짜 위에 앉았다 → 겹치는 것을 옮기는 대신 **축에서 자리를 뺐다**
  (`PAD_R = 144`). 글자 겹침은 잘림과 같은 등급의 결함이다.
- **도시에의 이름 두 줄이 한 줄로 붙어 있었다**(「국고 3Ygovt · 3Y」). CDS `Text`
  가 인라인이라 감싸는 `<span>` 만으로는 안 쌓인다 — 캐논 부품 `.sr-name-stack`
  을 쓰면 되는 자리였다(캐논 규칙 1).

### 8-4. RV 합류 (§6-5)

`/api/rv/analysis` 의 크레딧 42항목을 **밴드와 같은 대우**로 접었다 — 별도 노드가
아니라 계열의 속성이다(`seriesId` 가 이미 유니버스 어휘다). 화면에 들어온 것:

- 도시에 속성 아홉(Score·순위·사분위·순위 변화·스프레드·이론 대비·버퍼·
  월 총수익·숏 가능). **앵커 이름은 행마다** 붙는다 — 이 표에 앵커가 둘 섞인다
  (실측: 국고 18 · 산금채 24).
- 표에 `Score` 열 하나. 계열이 아닌 행은 «—» 이고, 열을 감추지 않는다.
- 패싯 「RV 사분위」 네 칸(값 순서 — 개수순이면 분위가 뒤섞인다).
- **새 링크 종류 `priced-against`(스프레드 기준).** 유도가 아니라 서버가 든
  사실(`base`)을 읽은 것이다. 「이 스프레드가 무엇 대비인가」가 그래프에서
  선 하나로 읽힌다.
- 못 붙는 것은 화면이 말한다: 42 중 **35만** 붙는다(유니버스에 2.5Y 노드가
  없다), 서버가 뺀 39건은 Score 가 없다(만기 보유 등).
- 조달은 **백엔드 기본값 고정**(`base`+10bp). 사람마다 다른 Score 를 안 만들려는
  것이고, 그 사실이 도시에의 출처 줄에 적힌다.

### 8-5. 새 가드

`guards/terminal-keyboard.test.ts` (24건) — 그림 축 셋의 `role`·`tabIndex`·
`onKeyDown`·`aria-label`·`aria-live` 한 벌 · 확대 키가 축마다 같은지 · 판정 24px ·
표의 roving · 단축키가 화면에 적혀 있는지 · 한 글자 끄기 스위치가 조합키보다
아래에 있는지 · 주소 부호화 왕복(패싯·구간·정렬, 옛 주소 무시, 구분자 든 값 배제).
