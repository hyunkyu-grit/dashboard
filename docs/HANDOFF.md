# Sauron — Session Handoff

> Living context for the next Claude Code session. Read this **after**
> `CLAUDE.md` and `docs/DESIGN.md` (the design spec still outranks everything
> here). Update the "Current state" and "Open / provisional" sections at the
> end of each session.

---

## 1. What this project is

- **Sauron** — a standalone KRW IRS (interest-rate-swap) monitor. One screen,
  two panes: a **list-first instrument table** on the left (the Toss ranking
  table is the reference), a **curve/preview** pane on the right.
- The product name is **Sauron**; the repo, npm package, and mirror script keep
  the old name **braveworld**. A path rename is deliberate churn we skip.
- **NEW and standalone.** It does **not** replace `krw-fi-pms`, which is frozen.
  Nothing under `krw-fi-pms` (`:3000`/`:8000`) may be read or modified from
  here. Do not port its DESIGN.md or its rulings.
- Only the **curve-side engine** (bootstrap, discount factors, forwards, CD-IRS
  conventions) was ported from the frozen engine, byte-identical, with a
  provenance header — see `docs/PORT_PROPOSAL.md`. No portfolio / MtM /
  scenario / trade code exists here.

### Ports & backup

| | |
|---|---|
| Frontend (Next.js, App Router, TS, Tailwind v4) | `:3100` |
| Backend (FastAPI + ported curve engine) | `:8100` |
| Data | **MySQL** `miraebond2.kro.kr:4004/sim_portfolio`, table `mkt_irs_close` (2026-08-07). `data/irsdata.xlsx` 는 2026-08-11 부터 **보충 출처**로 복귀 — 병합 로더(`load_dataset_merged`)가 SQL 에 기대 전영업일이 없을 때만 읽는다. 아침 자동화가 매일 갱신 |
| Git remote | `origin` = `wwoo1116-cell/swap_monitor` (**push is owner-only**), `mirror` = `D:\Backups\braveworld.git` |
| Backup | mirror to `D:\Backups\braveworld.git` |

**After every commit, run the mirror:**

```powershell
powershell -File scripts/mirror-to-d.ps1
```

---

## 2. How to run & gate

```powershell
# run (two shells)
cd backend;  python -m uvicorn app.main:app --port 8100
cd frontend; pnpm install; pnpm next dev --port 3100

# gates — all must be green before a commit
cd backend;  python -m pytest tests -q
cd frontend; pnpm vitest run; pnpm lint; pnpm build
```

**Gotchas about the gates (learned the hard way):**

- Do **not** rely on a bare `pnpm exec tsc --noEmit` as "the typecheck". It
  pulls in test files that use a newer regex flag and errors spuriously. The
  real typecheck is inside `pnpm build` ("Running TypeScript…"). vitest
  transpiles via esbuild and doesn't care.
- vitest **now HAS the `@/` alias** (added in the strip session for the first
  runtime `@/…` import inside src, `data/calendar.json`). Guard tests in
  `guards/` still import with **relative paths** by convention. The old trap
  is worth remembering: a type-only `@/` import appears to "work" because it
  is erased — before the alias, a value import failed at resolve time.
- `pnpm lint` prints a `$ eslint` banner to stderr; PowerShell wraps that as a
  scary-looking `NativeCommandError` even on success. Check the **exit code**
  (run it via the Bash tool: `pnpm lint; echo EXIT=$?`).
- Git warns `LF will be replaced by CRLF` on commit — expected on Windows,
  harmless. Goldens are pinned; don't let autocrlf rewrite fixture bytes.

---

## 3. Architecture map

### Frontend `frontend/src/`

- `ui/App.tsx` — the shell. One continuous surface pinned to the viewport;
  owns the lifted `tab` + `pinned`/`hovered` state; right pane = `PreviewPane`
  when a row is active, else `CurveView`. Uses `useMeasure` for pane width.
- `ui/IntroCurtain.tsx` + `ui/introCurves.ts` — 인트로 커튼 (DESIGN §14
  「인트로」). 첫 payload 전까지만 전체를 덮고 **반드시** 걷힌다. 커브 아홉 장은
  실측 상수이고 고정 — 굽기 때 갱신하지 않는다.
- `ui/InstrumentTable.tsx` — left pane. Sliding-underline tabs, controlled
  `filter`/`onFilter`, sortable columns, forward start-filter + matrix toggle,
  group headings, the quoted/interpolated dot marker.
- `ui/rows.ts` — **the data model.** `buildRows(summary, forwards)` produces the
  unified `Row[]`; `orderRows()` (THE ordering, lifted out of the component so
  it is testable without a DOM), `traderName()`, `cmpKey()`. Start here for any
  list/label/sort change.
- `ui/RangeCells.tsx` — the table's last column: 52주 고점/저점/평균. Ink, and
  not sortable; both pinned by `guards/range-column.test.ts`.
- `ui/cells.ts` — the table's two LEVEL call sites (`levelText`, `rangeText`),
  side by side so they cannot drift. Both are `fmtLevel`.
- `ui/CurveView.tsx` — idle right-pane curve: the IRS par curve, on every tab
  (pass M — it no longer dispatches on the tab). Hovering a node opens the
  shared readout card (pass N).
- `ui/ReadoutCard.tsx` — THE hovered-point readout card, shared by the idle
  curve and the preview chart (pass N). One card, one label map, one formatter
  path; pinned by `guards/readout-parity.test.ts`.
- `ui/PreviewPane.tsx` / `PreviewChart.tsx` / `CalendarHeatmap.tsx` — hover
  state: series history (blue SVG) + tooltip + calendar heatmap.
- `ui/EnlargedView.tsx` — the `?tile=…` sheet; **the only place
  `lightweight-charts` is allowed**. Entered via the pane header's 크게 보기.
- `ui/BacktestWindow.tsx` — the floating backtest window (one instance,
  `bt`/`bti`/`btf` URL namespace, header-only drag).
- `ui/floatingWindow.ts` — its geometry: clamp + session-remembered position.
- `ui/urlState.ts` — `mergeQuery` + the `bt`↔`tile` namespace split; every
  URL write goes through it.
- `ui/tint.ts` — shared grid background-tint scale (forward matrix + heatmap).
- `ui/useMeasure.ts` — **callback-ref** ResizeObserver width hook (see gotcha).
- `ui/motion.ts` — shared springs / press-scale / reduced-motion instants.
- `theme/tokens.css` — **the only file allowed raw hex** (lint-guarded).
- `guards/*.test.ts` — the invariant gates (see §4).

### Backend `backend/app/`

- `main.py` — FastAPI routes: `/api/wall/summary`, `/api/forwards`,
  `/api/series/{id}` (ids containing `x` route to forward history).
- `dataset.py` — loads the xlsx; drops today-dated rows (전일종가 rule, §18);
  `DISPLAY_TENORS` = the 8-tenor spread/fly universe [OWNER, 2026-07-31].
- `derive.py` — **all** server-side derivation: `basis_dates`, deltas,
  `spread_series`, `fly_series`, `summarize`. The browser never derives a
  series.
- `curves.py` / `forwards.py` — curve bootstrap + `forward_history` (per-date
  reprice, lazily cached).
- `engine_port.py` — the byte-identical ported engine. Do not edit.
- `mysqldb.py` — read-only MySQL helper (`sim_portfolio`). `read_sql` refuses
  anything that is not SELECT/SHOW/DESCRIBE/EXPLAIN/WITH.
- `creditmatrix.py` — 민평 커브, SQL `credit_matrix` (2026-08-14). **0 은 결측**
  이라는 규칙이 여기 한 곳에 있다(`rate_or_none`). 캐시 키는 워터마크.
- `funding.py` — 조달금리 = 기준금리(xlsx) 또는 콜금리(SQL) + 스프레드bp.
  누적은 계단을 한 번 적분해 두고 차분으로 읽는다. **Cash Bond 전용** — 이
  모듈은 `backtest.py` 가 import 하지 않는다.
- `cashbond.py` — 민평 par 발행 3개월 이표채의 가격·백테스트. 자산스왑은
  `backtest._run_one` 을 그대로 불러 IRS 다리를 얹는다.

---

## 4. Invariants that MUST stay green (do not weaken)

These are load-bearing and owner-mandated. Every one has a guard or is a hard
rule:

- `guards/no-raw-hex.test.ts` — **zero raw hex in components**; color only via
  semantic tokens. Raw hex lives solely in `theme/tokens.css`.
- `guards/canvas-var.test.ts` (`assertNoCssVars`) — canvas-bound options carry
  **resolved hex**, never `var(...)` strings (per-element `var()` in SVG stalled
  the compositor once).
- `guards/domain-guard.test.ts` (`assertDomainRendered`) — chart clip/domain.
- `guards/tint-contrast.test.ts` — ink stays ≥4.5:1 on the darkest grid tint.
- `guards/band-hue-contrast.test.ts` — direction hues clear contrast per theme.
- `guards/reduced-motion.test.ts` / `ramp-sync.test.ts` — motion + ramp.
- `guards/sort-key.test.ts` — **every `Row` carries a finite numeric sort key**
  (added S13; see the 3M diagnosis below).
- **`currentColor` discipline** for inline SVG strokes.
- **`lightweight-charts` only in the enlarged view** (`EnlargedView.tsx`). The
  list preview + idle curve are hand-rolled SVG.
- The change-log **event/state split** and its **fixed D-1 basis** stay as-is.
- **Every backend calculation and endpoint** is frozen unless the owner asks.

### Standing design decisions

- **Monochrome-first (§5):** every encoding must work in grayscale; hue only
  layers on. **Only directional numbers take hue; levels stay ink.**
- Colors: **two hues only — red up, blue down; everything else grey by
  lightness** [palette cut]. up `#d92d3c` / down `#0064FF` (Toss convention,
  red=up; up deepened from `#f04452` in S15 E1 so change TEXT clears 4.5:1).
  **Chart line is BLUE** (`#0064ff` light / `#4c93ff` dark, S16 E; same as the
  down colour — a line has no sign). Every non-directional interactive state
  (primary action, selection, focus, pins, tab underline, heatmap marker, gauge
  marker, product lockup, Pay/Receive accent) is **ink/grey** — `bg-ink` inverts
  with the theme so a filled pill is legible both ways. Orange (`#F58220`) and
  navy (`#043B72`) are defined but **unreferenced** and blocked by the §9 colour
  guard. Levels stay ink. **Exception [OWNER, 2026-08-04]: the two reference
  tokens** — CD solid grey (`ref-cd`) and 기준금리 solid translucent red
  (`ref-policy`), reference lines + legend only. All values live only in
  `theme/tokens.css`.
- **No elevation / no floating cards** (S13). Depth = surface steps + hairlines.
  The single sanctioned drop-shadow is the chart tooltip overlay.
- **Volatility is built** [Session 14] — relative ATR (mean ATR 5 / mean ATR
  60), close-only form; see DESIGN §4/§16 and `## Provisional`. Not a placeholder.
- Band 3 is **owner-gated**; leave reserved regions, build nothing speculative.
- Scenario tooling was gated with it and is now **OPEN and built** [OWNER,
  2026-08-07]: the 시뮬레이션 tab. The gate did its job — nothing speculative
  was built here, and what landed came in whole from simulation_project on the
  owner's instruction rather than being invented. Band 3 is unaffected and
  still closed.

---

## 5. Conventions read from code — document, do NOT change

- **Instrument notation** (identical across label / command bar / id):
  - outright `10Y`; spread id `1Y-10Y` → label `1s10s`; fly id `2Y-5Y-10Y` →
    label `2s5s10s`; forward id `{start}x{tenor}` e.g. `2Yx1Y`.
  - `traderName` drops only the trailing `Y`, so a **1.5Y leg → `1.5s`**
    (`1Y-1.5Y` → `1s1.5s`).
- **Butterfly weighting = 1 : −2 : 1 (cash/rate-neutral), NOT DV01-neutral.**
  `derive.py::fly_series` = `2×belly − short − long`. Positive = belly cheap.
- **MTD == QTD in the first month of a quarter is correct by construction**
  (month-start and quarter-start resolve to the same prior close). Not a bug —
  do not "fix" or collapse the columns.

---

## 6. Current state (as of the 2026-08-14 session)

### Cash Bond + Setting — 민평 채권이 Backtest 아래로 (2026-08-14)

[OWNER, 2026-08-14]. Backtest 섹션의 여섯 번째 종목군으로 **현금채권**이 서고,
최상위에 **Setting** 이 생겼다(조달금리 하나). 규약은 전부 오너가 골랐다:

| | |
|---|---|
| 민평 출처 | **SQL `credit_matrix`** (`app/creditmatrix.py`) — 워크북이 아니다 |
| 표면금리 | 진입일 민평 그대로 → **진입일 가격은 정확히 par** (연금 항등식) |
| 할인 | **단일 민평수익률** (잔존만기 선형보간), 제로커브 아님 |
| 이표 | 3개월 (스왑과 기준을 맞춘다) |
| 자산스왑 | 채권 매수 + **같은 명목** IRS 페이 (par-par) |
| 조달 | 기준금리 또는 콜금리 + 스프레드bp, **Cash Bond 전용** |
| 손익 | 평가 · 캐리 · 롤다운 · 조달 (+ 자산스왑은 스왑 다리의 개시) |

**엑셀 민평 로더는 이 배포에서 죽은 코드다.** `irs_pricer/loaders/credit_matrix.py`
가 읽는 `Credit Matrix Data.xlsx` 가 `data/` 에 없다(2026-08-14 확인). 오너가 SQL
을 지목한 이유가 그것이고, `app/creditmatrix.py` 가 살아 있는 유일한 민평 출처다.
엑셀 로더는 건드리지 않았다 — 시뮬레이션 레인이 아직 import 한다.

**데이터가 강제하는 것 셋** (실측 1,624 영업일):

- **0 은 결측이다, 금리가 아니다.** 테이블이 없는 값을 0.0 으로 채운다(NULL
  아님). 30Y 는 국고채·공사채만 있고 나머지 6종은 1,624일 전부 0, 통안채는 5Y
  이상 전부 0. 0 을 금리로 읽으면 통안채 10년이 0% 로 그려지고 보간이 커브
  전체를 끌어내린다. `creditmatrix.rate_or_none` 이 파싱 시점에 한 번 거른다.
- **통안채는 3Y 까지**, 30Y 는 국고채·공사채만. 표에 없는 행은 안 세운다.
- **자산스왑은 10개 테너만.** 채권의 2.5Y·20Y·30Y 는 대응 IRS 노드가 없고,
  IRS 의 4Y·6Y·8Y·9Y 는 대응 민평 노드가 없다. 민평 달력은 IRS 달력의
  **부분집합**이라(겹치는 1,624일 전부 포함) 조인 자체는 깨끗하다.

종목군 여덟은 오너가 지목했다 — SQL 의 `bond_type` 코드가 자명하지 않아 값으로
확인했다(2026-08-13 3Y 민평이 국고 3.777 < 통안 3.820 < 산금 4.007 < 공사 4.090
< 은행 4.099 < 회사AAA 4.275 < 카드 4.339 < 캐피탈 4.495 로 관행 사다리 순).
`OFB` = 기타금융채이고 **화면에는 캐피탈채로 적는다**. `CB2`~`CB5` 는 테이블에
있지만 이 화면의 유니버스가 아니다.

라우트는 **전부 라이브**다(`/api/cashbond/*`, `/api/settings/funding`). 정적
쌍둥이가 없는 이유가 백테스트보다 하나 더 있다 — 민평 자체가 SQL 에만 있어
굽기 산출물에 들어가지 않는다. `next.config.ts` 에 rewrite 두 줄을 넣었다.

### 개시 — 진입일에 서던 롤다운의 정체 (2026-08-14)

트레이더 지적 "백테스트 평가에서 롤다운이 첫날에도 발생한다" 의 원인과 수정.

KRW CD-IRS 는 스팟 시작이라 발효일이 거래일+1영업일이다. 그 한 밤 동안 스왑은
발효 전이고 `value_booked_trade` 는 경과이자를 `val_date > a_start` 일 때만
잡으므로 Δ경과이자가 0 이다. 캐리 = Δ경과이자 + 결제현금 이라 캐리가 구조적으로
0 이 되고, 롤 = Δclean 이 그 밤의 세타를 통째로 받았다. 같은 캘린더 밤을 두
포지션으로 재면 배분만 갈리는 것이 보인다 (2026-06-19 3Y 100억, 금→월):

    06-18 진입(이튿날 밤)  캐리 −784,932  롤 + 12,180  Δdirty −772,752
    06-19 진입(첫날  밤)  캐리        0  롤 −688,359  Δdirty −688,359

진입일 40개 표본에서 첫날 밤 롤의 중앙값이 이후 밤보다 3Y −91,802 · 10Y
−155,294 더 손실 쪽(78% / 82%)이었고, **10일 보유에서 보고된 롤다운의 24~26%**
가 이 한 밤이었다(60일 이상에서는 1~2%).

수정 = **네 번째 칸** [OWNER, 2026-08-14 — "지어내는 숫자가 없음"]. 경과이자를
거래일부터 발생시키는 대안은 법적으로 없는 하루치 이자를 만들어 내므로 물렸다.
롤다운 체인의 시드가 거래일에서 발효일로 옮겨 갔다. **총손익은 불변이다** —
골든 재생성 diff 가 pnl·cash·points·raw 바이트 동일, 평가 차 0, 롤다운이 개시로
그대로 이동임을 보인다.

함정 하나가 이 수정 안에 있었다: 루프 끝의 `prev_i, prev_clean, prev_fx = i, ...`
를 무조건 갱신하면 진입일 행을 지나며 시드가 발효일에서 거래일로 **되돌아가**
같은 밤을 롤다운으로 다시 센다. 처음 넣었을 때 롤다운이 한 푼도 안 줄어서
발견했다 — 네 칸 합이 항상 손익과 같아 합계 검증으로는 안 잡힌다.

### 크게 보기 은퇴 — 확대 뷰와 `?tile` 네임스페이스 삭제 (2026-08-13)

[OWNER — "이제 그러면 크게보기탭을 없애면 될 듯"]. **"이제 그러면"이 근거다**:
세타 열이 붙으면서 그 뷰가 혼자 들고 있던 것이 하나도 안 남았다.

- 입구는 미리보기 창 헤더의 `크게 보기` 버튼 하나뿐이었다. 버튼을 지우면 뷰
  전체가 고아가 되므로 `?tile` 네임스페이스(열기 push · 닫기 back · 죽은 링크
  정리 · Esc 층)까지 같이 걷어냈다.
- **뷰가 갖고 있던 것이 지금 어디 있나** — 지우기 전에 실제 화면으로 확인했다:
  캔들(선/주봉/월봉)은 2026-08-13 부터 **전역 차트 종류**라 미리보기 창이 이미
  그린다(예전엔 팝업만 캔들을 알았다) · DV01 숫자는 **세타 열 툴팁**에 있다 ·
  4-베이시스 읽기(Now/D-1/MTD/YTD)는 표의 열을 다시 말한 것 · "전략 도구가 이
  자리에 들어올 예정" 자리는 비어 있었다.
- **정말로 사라지는 것**: 더 큰 캔버스와 패닝, 페이/리시브 손익 스케치
  (`PayReceive`), 종목 설명 한 줄(`instrumentGloss`). 셋 다 오너가 알고 지운
  것으로 본다 — 되돌리려면 아래 복원 규칙대로 배선만 다시 하면 된다.
- **파일은 지우지 않았다.** `ui/EnlargedView.tsx` · `wall/DetailChart.tsx` ·
  `ui/PayReceive.tsx` 는 디스크에 남아 **참조만 끊겼다**(리포의 복원 규칙).
  이 파일 자신의 이력이 근거다 — 2026-07-31~08-03 사이에도 참조만 끊긴 채
  살아 있다가 통째로 돌아왔고, 그 docstring 이 "그래서 다시 만들지 않아도
  됐다"고 적어 뒀다. 부수 효과로 lightweight-charts 196KB 가 번들에서 아예
  빠진다(첫 로드 밖이 아니라 아예).
- `?missing=` 안내는 **살아 있다** — 이제 `bt`(백테스트 시드) 전용이다. 죽은
  링크를 "완전한 행 집합을 기다렸다가" 정리하라는 교훈도 그 자리로 옮겼다
  (`rows.length === 0` 로 판정했다가 났던 버그).
- **오래된 `?tile=` 링크는 무해하게 무시된다** — 읽는 코드가 없어 평범한
  화면이 뜨고 파라미터만 주소창에 남는다. 실측 확인함. 지우려면 tile 을 다시
  알아야 하므로 그대로 둔다.
- Esc 는 이제 **두 층**(백테스트 창 → 핀). 조건에서 `!tileParam` 만 빠졌으니
  이전보다 **더 넓게** 걸리고, 좁아질 수는 없다.
- 은퇴한 파일을 가리키는 가드 둘(`candle-mode` · `lazy-chart`)은 **남겼고**
  각각 그 이유를 적어 뒀다 — 복원 규칙 아래 파일이 살아 있으니, 다시 배선하는
  날 그 규칙들이 이미 서 있어야 한다.
- 검증: vitest 905 pass · `pnpm build` 통과 · prod 빌드 실브라우저로 버튼 부재 ·
  미리보기 캔들 · 죽은 `?tile` 링크 확인.

### 테너별 세타 — 역캐리·헤지비용을 표에서 바로 (2026-08-13)

[OWNER — "테너별 역캐리 및 헤지비용 바로 눈에 띄게 표시하기 … Notional 100억
기준으로 Theta(캐리 + 롤오버) 전부 연산하기, 그리고 이를 DV01 백만원 기준으로
다 환산한 Theta를 도출하기". 자리는 "Backtest 기준 위치 오른쪽에 남는 칸"].

**핵심은 이 숫자가 백테스트를 필요로 하지 않는다는 것**이다. 세타는 커브를
동결하고 시간만 흘린 손익이라(Tuckman unchanged term structure; Clarus
"Mechanics and Definitions of Carry") 오늘 커브 하나로 닫힌 식이 나온다 —
과거도 시뮬레이션도 없다. 그래서 굽기 산출물에 실리고, 창을 열어 실행을 누를
필요가 없어진다. 그게 요구의 전부였다.

- `app/theta.py` (신설) — 테너별 캐리·롤다운·세타. 호라이즌 3M, 노셔널 100억,
  **부호는 페이(고정 지급) 고정** [OWNER]. 우상향 커브에서 전 구간 음수로
  뜨고, 그 음수가 곧 역캐리이자 헤지비용이다. `wall_summary` 가 아웃라이트
  행에 `theta` 로 붙이고 표 전체 기준은 `thetaBasis` 로 한 번 싣는다.
- **DV01 백만원당이 표시값**이고 100억 금액은 툴팁 [OWNER]. 둘은 테너를
  **반대 순서로 정렬한다** — 100억 기준으로는 10Y 가 제일 크고(−3,260만원),
  리스크당으로는 1Y 가 10Y 의 6.4배다(−2,495만 vs −397만, 08-12 실측). 노셔널
  기준만 띄우면 트레이더가 정확히 거꾸로 읽는다. `perDv01` 은 노셔널에 무관.
- 재사용: DV01 은 `dv01.pv01`, 파 금리는 `forwards.forward_par_rate` — 제품에
  이미 하나뿐인 정의들이다. **진입 금리는 시장 호가(`now`)가 아니라 커브의 파
  금리**다. 보간 노드에서 호가로 진입하고 커브로 롤인하면 그 차이가 통째로
  롤다운에 실려 기울기가 아닌 것을 기울기라고 말하게 된다.
- 화면: `columns.ts` 에 자기 폭을 가진 사다리 칸(위치 다음, 세타가 제일 먼저
  드롭). **남는 슬랙에 그냥 넣지 않은 이유** = 그 트랙은 `minmax(0,1fr)` 이라
  좁은 창에서 폭이 0 이다 — 조용히 사라지는 숫자는 "눈에 띄게"의 반대다.
- **스프레드·플라이도 싣는다** [OWNER, 2026-08-13 — "스프레드랑 버터플라이까지
  부탁할게"]. 패키지는 DV01 중립이라 **순 DV01 이 0** 이고 0 으로 나눈 값은
  숫자가 아니다. 시장이 커브 트레이드의 리스크로 세는 것은 순 DV01 이 아니라
  **한쪽 다리의 DV01** 이다(Actrix "2bp on about $90k DV01 of risk" — 그
  $90k 가 다리 것이다). 기준 다리 = 스프레드의 긴 다리, 플라이의 벨리 —
  `dv01.py` 가 100 으로 정규화하는 그 다리다.
  - 그렇게 잡으면 **패키지 값이 다리 값들의 선형결합으로 저절로 닫힌다**:
    스프레드 = 긴 − 짧은, 플라이 = 벨리 − 날개 절반씩. 노셔널이 약분되기
    때문이고, 커브 트레이드 캐리를 스프레드 bp 로 말하는 관행이 그 항등식이다.
    `test_theta` 가 84개 전건을 직접 대조한다.
  - 부호는 방향 **+1**(호가값 롱)로 이어진다 — 아웃라이트 페이 · 스프레드
    스티프너 · 플라이 벨리 페이. 열이 한 문장을 말한다: **음수면 그 종목의
    첫 번째 방향을 잡았을 때 시간이 돈을 가져간다.** 헤더 툴팁이 셋을 다
    적는다("페이 기준"만 적으면 플라이 행에서 뜻이 없다).
  - **08-12 실측: 스티프너가 캐리를 번다.** 1s2s **+1,129만원**/DV01백만 ·
    2s10s +969만 · 5s10s +272만. 앞단 리시브의 캐리·롤이 워낙 커서(1Y 페이가
    −2,495만) 긴 다리 페이 비용을 덮는다. 플라이는 2s5s10s +213만 · 6M/9M/1Y
    +29만이고 전체 버터플라이 쪽은 대체로 음수.
- `withThetaData` — 폭이 되느냐(사다리)와 **해당되느냐**(데이터)는 다른 질문.
  포워드는 엔진에 다리 구성이 없고(`_legs_for` 가 'x' 를 거부) 변동성은 비율,
  1D·3M 은 커브의 짧은 끝이라 스왑이 아니다. 그 탭들은 열 자체가 서지 않는다
  (백테스트 창의 진입 par 선례 — "중복이거나 대시인 열은 폭을 못 얻는다").
  **이건 사다리 드롭이 아니라 `hidden` 카운트에 안 들어간다.**
- **함정(화면에서만 잡혔다)**: `withThetaData` 를 `rows` 로 물으면 표에는 앱이
  아는 **전 종목**이 들어 있어서 "어딘가에 세타가 있나"에 답한다 — 전 탭 true.
  값 없는 탭이 em dash 한 열을 그대로 그렸고 단위 테스트는 전부 통과했다.
  탭의 **그룹**으로 물어야 한다(`shown` 도 아니다 — 스크리너 칩마다 열이
  나타났다 사라진다). `guards/theta-column.test.ts` 가 이 회귀를 박아 뒀다.
- **함정(검증)**: 이 표를 CDP 로 캡처하면 `Page.captureScreenshot` 이 30초
  타임아웃 뒤 **페이지가 타일처럼 반복된 이미지**를 준다. 렌더러가 바쁠 때의
  캡처 인공산물이고 화면은 멀쩡하다 — 한 번 더 찍으면 정상이다. 이 리포의
  rAF 동결 인공산물(2026-08-12)과 같은 부류다.
- **Main 오버뷰에는 안 들어간다 [OWNER, 2026-08-13 — "Main은 걍 냅두자"].**
  둘 다 요청받아 만들어서 재 봤더니 안 맞았다: 세 열이 `minmax(0,1fr)` 로
  화면을 나눠 쓰는데 아웃라이트 표가 이미 자기 몫을 다 쓰고 있어서, +115px 이
  금액 칸을 그룹박스 밖으로 밀어내 **스크롤바 없이 잘렸다**. 그 실패는 이 탭의
  기정 오너 결함이다([OWNER, 2026-08-07 — "100%에서 잘린다"], 트랙이
  max-content 가 아니라 1fr 인 이유). 길 셋(여기서 평균 빼기 · 여기서만 bp 로
  표기 · Backtest 에 맡기기)을 올렸고 오너가 셋째를 골랐다. **미결이 아니라
  종결이다 — 열을 도로 넣어 다시 열지 말 것.** 표는
  `withThetaData(ALL_COLUMNS,false)` 로 굳혀 뒀다 — 그냥 `ALL_COLUMNS` 를 두면
  꼬리 바닥이 안 그리는 트랙의 폭을 예약해 매 행 끝에 죽은 공간이 남는다(한
  빌드 동안 실제로 그랬다).
- **성능**: 다리 계산이 종목마다 되풀이돼 `_unit_theta` 를 **237번** 부르고
  있었다(서로 다른 테너는 13개뿐 — 84개 패키지가 저마다 자기 다리를 다시
  구했다). 표 하나 33ms 로 `wall_summary` 전체의 22.8% 였다. 커브·CD 를 묶은
  조회 함수(`_leg_cache`)를 표당 하나 세워 **33ms → 3.4ms**, `wall_summary`
  는 145 → 116ms. 값은 원 단위까지 불변(위 실측 숫자 그대로). `lru_cache` 는
  못 쓴다 — 커브가 numpy 배열이라 해시가 안 된다. 캐시 수명 = 그 커브의 수명.
  [OWNER, 2026-08-13 — 시뮬·백테스트 계산 성능 레인이 동시에 돌고 있어 요약
  경로에 22.8% 를 얹어 두고 넘기지 않는다.]
- 검증: pytest 381 pass(신규 `test_theta.py` 15) · vitest 905 pass(신규
  `guards/theta-column.test.ts` 14) · `pnpm build` 통과 · `build_static.py`
  재굽기에 `theta`/`thetaBasis` 실림 확인 · prod 빌드를 :3100 에 띄우고
  실브라우저로 아웃라이트·스프레드·버터플라이(값 뜸) · 포워드(열 없음) ·
  Main(잘림 없음·죽은 공간 없음) 확인. 세타 대상 종목 97 = 아웃라이트 13 +
  스프레드 28 + 플라이 56.

### 인트로 커튼 — 시작할 때 커브 아홉 장이 피어난다 (2026-08-13)

[OWNER — "swap-monitor 기준으로 시작할 때 멋있는 웹사이트처럼 뒤에 영상같은 거
움직이게 할 수 잇나?"]. 오너 결정 둘: **인트로에만**(상시 배경 아님),
**실제 영상 파일이 아니라 앱 데이터로 그린 생성 애니메이션**. 스펙은
DESIGN §14 「인트로 커튼」.

- `ui/introCurves.ts` — 순수 모듈. data/irsdata.xlsx 에서 뽑은 **실측 파 커브
  아홉 장**(2016-07 → 2026-08, 13 테너)과 타임라인 수학. 커튼은 첫 fetch 전에
  그려지므로 백엔드에 물어볼 수가 없어서 박아 넣었다. **이 아홉 장은 굽기와
  무관하게 고정** — 매일 다시 뽑으면 커튼 그림이 매일 달라진다.
- `ui/IntroCurtain.tsx` — canvas 한 장 + 로크업. §9 시간 램프로 부채를 칠하고
  (오래될수록 옅고 가늘게), 포커스 커브에 §5 마디 점, 아래에 테너 방향표 넷.
  색·서체 전부 테마 브릿지.
- `ui/layers.ts` — `Z_CURTAIN`(`z-[60]`) 신설. 모달보다 위인 유일한 층.

**이 화면에서 유일하게 중요한 성질은 "반드시 걷힌다" 다.** 사용자가 닫을 수
없는 최상단이라, 남는 순간 앱이 잠긴다. 세 겹으로 막았다:

1. `INTRO_MAX_MS`(4초) — **데이터가 오든 말든** 걷는다. 방어적 장식이 아니라
   실측 결과다: 백엔드가 닿지 않는 빌드로 재현하니 `isError` 가 뜨기까지
   **82초**가 걸렸다(react-query 6회 재시도, §17 진단이 적어 둔 "24초에도
   81초에도" 와 같은 자리). 커튼은 82초에 정확히 걷혔지만 그동안 셸과
   사이드바까지 덮여 있었다 — 상한이 없으면 이 인트로가 **실패를 더 나쁘게**
   만든다. 상한을 넣은 뒤 4초에 걷히고 사이드바가 살아나는 것까지 확인했다.
2. 언마운트는 `setTimeout` 이 결정한다. AnimatePresence 도, exit 완료 콜백도
   쓰지 않는다 — `ba2c1e0`·`a344fb2e` 가 exit 유실로 창이 안 닫힌 두 전례다.
3. 걷기 시작하는 순간 `pointer-events-none`.

`ready = !!summary || isError` — 실패도 성공과 똑같이 커튼을 걷는다(§17 이
인트로보다 우선한다). 길이는 `INTRO_MIN_MS`(1초) 한 상수이고, 부채가 펴지는 데
976ms 라 그보다 짧으면 그리다 만 그림에서 걷힌다(가드가 부등식을 지킨다).
짧게 하려면 그 숫자만 내리고, 끄려면 App.tsx 에서 `<IntroCurtain>` 을 뺀다.

가드 `guards/intro-curtain.test.ts` (35+3항). 라이트·다크 양쪽, 걷힘, 실패
경로 전부 프로덕션 빌드(`npx next start --port 3100`)로 눈으로 확인했다.
**reduced-motion 정지화면 경로는 브라우저로는 못 봤다** — OS 선호를 켜야 해서,
가드와 코드 경로로만 확인된 상태다.

### 선 · 주봉 · 월봉 — 캔들이 팝업 밖으로 (2026-08-13)

[OWNER — "지금은 차트가 라인차트만 나오는데 (차트 전부 얘기하는 거임) 모드
설정하면 원하면 캔들차트로 보여줄 수 있게 가능?"]. 오너 결정 둘: **모드는
전역 하나**(툴바), **백테스트 문맥 차트는 선 유지**.

- **있던 것/없던 것**: 캔들 자체는 §G 로 이미 있었다 — 크게 보기 팝업의
  lightweight-charts 뿐. 손으로 그린 SVG(`PreviewChart`, 하단 3열 + 사이드
  미리보기)는 선만 그렸고, DESIGN 이 "candles need width it lacks" 로 그걸
  못 박아 뒀다. 이번에 그 룰링을 뒤집었다.
- **상태**: `state/ui.ts` 의 `chartType` — 테마·basis 와 같은 자리, 같은 길.
  `localStorage["bw-chart-type"]`, `syncUiFromDom` 에서 채택. **URL 이 아니다** —
  환경설정이 링크에 실리면 받는 사람 화면이 바뀐다. `?type=` 은 마운트에서
  **한 번 읽어 씨앗으로만** 쓰고(옛 링크 호환) 다시는 쓰지 않는다.
- **타입 정의가 이사했다**: `wall/DetailChart` → **`ui/chartType.ts`**. 스토어와
  툴바가 팝업 전용 청크(lightweight-charts 196KB)의 타입에 기대는 것은 의존
  방향이 거꾸로였다. `guards/lazy-chart.test.ts` 가 그에 맞춰 갱신됐다.
- **그리기**: 방향별 몸통 경로 1 + 꼬리 경로 1 = **차트당 요소 넷**
  (`ui/candlePath.ts`). 막대마다 rect+line 이면 주봉 553개 × 3열 = 3,300 노드다.
  몸통 폭은 간격의 0.62, [1px, 14px] 로 클램프.
- **범위(extent)는 꼬리다**: `extremes.ts` 에 `spanExtremes` 신설 —
  y-도메인과 최고/최저 점이 같은 스캔 하나를 읽으므로 점이 자기가 가리키는
  꼬리 끝에 정확히 앉는다. 선 창에서는 `windowExtremes` 와 **완전히 동일**
  (게이트가 그 등가를 핀).
- **확대창(ViewRange)이 배열 길이를 같이 기억한다**. 인덱스는 자기가 뽑힌
  배열에서만 뜻이 있고, 선 → 주봉은 2,621 → 553 이다. 남은 {i0,i1} 은 조용히
  다른 해상도의 다른 구간이 된다 — 화면은 멀쩡해 보인다. 길이가 안 맞는 뷰는
  렌더에서 버린다(효과 없음).
- **툴팁**: 캔들이면 시가·고가·저가·종가·등락률(52주 통계 없음). 등락률은
  `fmtChangePct` 공용 — **시가 0 이면 em dash**(팝업의 인라인 판은 `+0.00%` 를
  지어냈다; 스프레드·플라이는 0 을 지난다).
- **툴바 컨트롤은 차트 있는 섹션에만**(main·backtest). Simulation·Lab 에는
  시계열 차트가 없어 아무것도 안 하는 컨트롤이 된다.
- **검증**(prod `next start :3100`): 세 열 + 사이드 패널 동시 전환·툴팁 실측
  (2022-06-30 시가 1.5000 고가 1.8630 저가 1.4760 종가 1.7330 +15.53%)·주봉
  전체 span 552봉 1px → 확대 24봉 14px·모드 전환 시 확대창 해제·팝업 토글이
  툴바와 같은 스토어·`?type=w` 링크 씨앗·Simulation/Lab 컨트롤 0개·**전역
  주봉 상태에서 백테스트 문맥 차트는 선** 확인.
- ⚠ **주봉 전체 span 은 668px 에서 봉당 1.21px 라 빗살로 보인다**(월봉은
  5.22px 로 읽힌다). 데이터 문제가 아니라 픽셀 예산이고, 오너가 알고 택했다 —
  확대가 답이다. 폭 규율을 다시 논의하게 되면 이 숫자에서 시작할 것.
- ⚠ **일봉은 영원히 불가**: 소스가 종가뿐이라 시가=종가. `candle-mode.test.ts`
  가 그 부재를 핀으로 박아 뒀다.

### 메인 하단 3개 차트: 커서가 일간을 못 짚던 것 → full 해상도 (2026-08-13)

[OWNER — "main 화면에서 하단에 위치한 그래프들에 커서를 가져다 대면 지금 월
정보만 확인할 수 있는데, 이거 일간단위로 나오게 가능하니?"].

- **원인**: `OverviewColumns` 의 `ColumnChart` 만 `res=preview` 로 받고
  있었다. `preview` 는 `derive.py` 의 스트라이드 데시메이션 —
  2,620 영업일 종가를 150 포인트로 솎아내므로 **살아남은 점 사이 간격이
  약 23일**. 실측: `10Y.preview.json` 앞 6개 = 01-04 / 01-27 / 02-24 /
  03-22 / 04-15 / 05-13. 크로스헤어가 한 달에 한 점밖에 못 잡고, 카드의
  날짜·레벨·당일 변화는 커서가 가리키는 날이 아니라 그 점의 것이었다.
  확대해도 복구 불가 — 중간 날이 **페이로드에 아예 없다**.
- **수정**: 쿼리 키·URL 을 `["series", id, "full"]` 로. 한 줄이다. 옆
  미리보기 패널(`PreviewPane`)은 자기 이유(150점 선이 패널 폭에서 다각형으로
  보임)로 이미 `full` 이었으므로, 이제 **두 표면이 캐시 항목 하나를 공유**한다
  (예전에는 같은 종목의 두 해상도가 나란히 캐시됐다).
- **검증**(prod 빌드 `next start :3100`, 정적 모드): 전체 span 에서 1px ≈
  4영업일(2020-10-27 → 11-02 → 11-06 …), 휠로 확대하면 2021-04-29 → 04-30 →
  05-03 → 05-04 로 **영업일이 하나씩** 잡힌다. 10년을 670px 에 그리는 한
  전체 span 에서 특정 하루를 짚는 것은 픽셀 예산 문제이고 — 데이터 한계가
  아니다. 확대가 그 답이고 이제 실제로 작동한다.
- 비용: 종목당 원본 10KB → 106KB(brotli ~25KB), 열 3개. 정적 파일은 이미
  구워져 있어 백엔드·굽기 변경 없음.
- ⚠ CD 91일 참조선은 `useCdReference` 에서 여전히 `preview` 다. `alignSeries`
  가 날짜로 병합하므로 값은 정확하고, 23일 유지 구간이 670px 에서 ~1.2px 라
  계단이 보이지 않는다. 참조선이 주인공이 되는 화면이 생기면 그때 올릴 것.

### 안 닫히는 창 4제(최종?): 프로덕션 라우터 웨지 → 얕은 히스토리 (2026-08-12)

[OWNER — "하 백테스트 또 안 닫히는데 이거 왜 그런거냐 자꾸"]. 세 번째
안-닫힘이고, 이번 것은 **프로덕션 빌드 전용**이라 dev 로 검증하던 앞의 두
수정(ba2c1e0·bbd46c5, AnimatePresence 제거 — 그 클래스는 진짜였고 고쳐진
채로 남는다)을 통과해 살아남았다. ba2c1e0 커밋문의 "배포: 그대로 보이는
채"가 사실 이놈이었을 가능성이 높다.

- **증상/실측(CDP)**: 정적 프리렌더 프로덕션에서 클릭 핸들러 발
  `router.replace`(같은 페이지, 쿼리만 변경)가 트랜지션을 시작만 하고
  영영 커밋하지 않는다 — RSC 요청도 없고, Next 내부가 히스토리에 **옛
  URL 을 재동기화**만 한다. 창이 안 닫힐 뿐 아니라 **그 뒤로는 라우터
  전체가 막힌다**(이후 window.next.router.replace 직접 호출도 무시).
  dev 는 같은 코드로 정상. 신선한 페이지에서 라우터 직접 호출은 정상 —
  즉 React 이벤트 → startTransition 경로에서만 죽는다.
- **수정**: App.tsx 의 오버레이 네임스페이스(bt·tile·type·missing) URL
  쓰기 전부를 Next 14.1+ 공식 **얕은 히스토리**로 —
  `shallowReplace`(= history.replaceState) / openEnlarged 는
  history.pushState(닫기 = router.back() 그대로). useSearchParams 에
  그대로 반영되고(실측: 창 닫힘) 트랜지션이 없어서 막힐 것도 없다.
  App 에 router.replace/push 는 이제 0곳(가드가 부재를 핀).
- 검증: 프로덕션 헤드리스 CDP — ✕ 클릭 닫힘·Esc 닫힘·닫은 뒤 라우터
  건강(?probe 반영) 전부 green. guards/backtest-back 의 닫기-의미 핀을
  같은 의도(replace-never-push)로 메커니즘만 갱신.
- ⚠ 근본 원인은 Next 16.2.11 내부(미니파이 청크)라 여기까지만 판다 —
  Next 를 올릴 때 이 항목을 다시 보고, 재발 시 이 절의 CDP 프로브
  (scratchpad cdp-close-probe*.mjs 패턴)를 재사용할 것.

### 대사 스택: 전 테너 열 복원 + 고정 범례 스크롤러 (2026-08-12, 두 패스)

[OWNER 1차 — "좌우로 드래그하는 부분을 만들어서 잘리는 부분도 볼 수 있게
해주고, 물리적으로 잘린 테너들도 복원해줘" → 2차 — "3s10s에서 잘린거 복구
안 됐고, 좌우 드래그를 마우스로 잡아 끄는게 아니라 좌우 스크롤이 가능하게
… 좌우의 범례는 열과 행 고정시켜서 스크롤을 움직이더라도 고정"].
2026-08-10 의 폭 규율("좌우 스크롤 하기 싫음" → KRD 전 기간 0 테너 열
숨김)을 뒤집는 룰링. 1차의 드래그 팬(`useDragScroll`, 커밋 `2e82c3d6`)은
2차 지시로 같은 날 삭제됐다 — 최종 상태는 아래다.

- **전 테너 열 복원**: ReconStack 의 0-열 숨김 필터(+"숨겼어요" 캡션)
  삭제. 백엔드는 원래 전 라벨을 싣고 있었다(backtest `_book_recon` 은
  krd/dbp/est 딕셔너리에 전 테너, 시뮬 recon 은 KRD_TENORS 15개) — 만기
  밖 버킷은 범프를 안 해서 0 일 뿐이고, 그 0("—")은 리스크가 없다는
  사실로서 대사의 일부다. 백엔드는 한 줄도 안 바뀌었다.
- **양축 스크롤러 + 보이는 스크롤바**: ReconStack 이 자기 컨테이너에서
  가로+세로를 스크롤한다(`overflow-auto` + 높이 캡 `heightClass` 프롭 —
  기본 60vh, 백테스트 서랍은 30vh: WindowDrawer 캡 38vh 안에 들어가야
  바깥 서랍이 스크롤을 뺏지 않는다. 스크롤러는 하나여야 고정이 산다).
  globals.css 의 킷 스크롤바(오버레이 아님, 상시 그려짐)가 컨테이너
  바닥(가로)·우측(세로)에 선다 — 수천 px 표의 바닥이 아니라 눈앞이다.
- **범례 사방 고정**: 테너 헤더 행 = sticky top, 날짜·구분 = sticky left,
  합계·평가·캐리·롤다운·그날 손익 = sticky right(뒤에서부터 0/11/22/33/
  44ch). 가운데 테너×날짜 격자만 흐른다. §G(sticky-opaque): bg 토큰 동반.
- **기하 함정 둘 (실측으로 잡음, 재발 주의)**:
  ① `w-full`+minWidth 였을 때 table-fixed 가 표 폭과 <col> 합의 차이를
  트랙에 재분배해(실측 11ch 지정 → 91.7px) ch 로 쓴 sticky 오프셋과
  트랙 경계가 어긋났다 — 표 폭을 **트랙 합과 동일한 명시 폭**으로(재분배
  0). ② `ch` 는 그 요소 **폰트의** '0' 진행폭이다: font-size 만이 아니라
  **굵기**도 탄다 — 합계 셀의 font-medium 이 44ch 를 13px 어긋나게 했다.
  오프셋을 진 셀은 폰트를 표와 동일하게, 크기(13px)·굵기(medium)는 안쪽
  span 이 진다. 13px 헤더의 좌표만 `calc(Nch * 14 / 13)` 환산.
- 검증: FE vitest 전 스위트 + lint 0 에러 + next build, 실화면은 3s10s
  100억 3/9 진입 백테스트로 — 확장 끊김 후 **헤드리스 크롬 CDP 프로브**
  (scratchpad cdp-verify.mjs 패턴)로 고정 열 헤더↔본문 좌표차 0.00px·
  인접 갭 ±0.03px 수치 확인 + 스크린샷. ⚠ 헤드리스에선 rAF 동결로 창
  enter 불투명도가 중간에 얼어 반투명으로 찍힌다 — 08-11 "유령 재현"
  인공산물과 같은 클래스, 실브라우저는 정상. 백엔드 무변경(pytest 안 돌림).
- ⚠ `pnpm dev` 는 **:3000 에 뜬다** — 반드시 `pnpm next dev --port 3100`
  (README 의 run 명령이 정답). :3000 은 동결 krw-fi-pms 의 포트다(이
  세션에서 실수로 한 번 점유했다 즉시 회수).

### 아침 굽기 첫 실전 + 배포 두 갈래 분리 (2026-08-12 아침)

첫 실전(8/12 07:50)에서 굽기가 1단계에서 중단됐다: 부팅(07:46) 로그온
트리거로 뜬 SauronBackend 를 `Stop-ScheduledTask` 로 세웠는데 스케줄러가
launcher powershell 만 죽이고 cmd 래퍼 밑 uvicorn 이 살아남아 :8100 이 안
비었다(태스크 결과 267014 = TERMINATED 인데 포트는 LISTEN — 스케줄러가
다시는 못 잡는 고아). 두 커밋으로 마감:

- `58fb72c` — 굽기 1단계 폴백: 태스크 정지 후에도 :8100 이 살아 있으면
  리스너 pid 를 직접 `Stop-Process`. python 을 죽이면 redirect 를 쥔 cmd
  래퍼는 따라 내려간다.
- `0ad318d2` — 배포 두 갈래 [OWNER, 2026-08-12 "데이터만 자동으로 하고
  코드는 내가"]: 기존 push 가드는 비자동화 커밋이 있으면 데이터까지 통째로
  보류해 사이트가 영업일 지연됐다(8/12 실제). 이제 **Vercel 프로덕션
  브랜치 = `deploy`** — origin/main 위에 Data refresh 커밋만 체리픽한 기계
  소유 브랜치(임시 워크트리 `.sauron\deploy-wt`, 본 작업트리 불변, force
  push). main 은 비자동화 커밋이 없을 때만 자동 push. "푸시는 오너"는
  main 의 코드 커밋에 대한 규칙으로 산다.
- 오늘 데이터는 `977d81f8`(asof=2026-08-11, sql, 2,620행)로 구워졌고
  deploy 브랜치(3f8c1536 = origin/main 4019dc0e + 체리픽)가 GitHub 에
  올라갔다. **전환 완료(8/12 08:33)**: 프로덕션 브랜치 main→deploy 는
  비공식 `PATCH /v9/projects/{id}/branch` 를 오너가 CLI 로 직접 실행
  (Git Bash 에선 `MSYS_NO_PATHCONV=1` 필요 — MSYS 가 `/v9/...` 를 경로
  변환함). 빈 커밋(f75a0966) push 로 첫 프로덕션 빌드 트리거, 라이브
  manifest asof=2026-08-11 확인. 프로젝트 id
  `prj_vpVCV4AM1tMoK6Di1N8O8cHbHNe1`.

### 일별 대사: 전일 KRD 표시 + 이월 앵커 (2026-08-11 저녁)

[OWNER — "KRD를 전일걸 가져와서 붙이는게 조금 더 대사하기 편하지 않을까 …
같이 넣어주고 백테스트와 시뮬레이션에 모두 적용하기"]. 종전에는 KRD 줄이
그날 종가 KRD(수준값)였고 추정만 전일 KRD 를 써서, 한 블록의 KRD × Δbp 가
손익 줄과 안 맞았다(눈이 전일 블록으로 오가야 대사가 됐다).

- **행의 KRD = 추정이 곱한 전일(start-of-day) KRD 그 자체** — 두 백엔드
  모두(`recon.py` `pvbp`, `backtest.py` `_book_recon` `krd`). 한 블록 안에서
  KRD × Δbp = 손익이 표시 라운딩 안에서 닫힌다(test_block_closes_in_row 가
  핀). 백테스트 진입일 행의 krd 는 0 — 그날 아침엔 포지션이 없었다.
- **이월 앵커 행** — 표시가 전일 KRD 가 되며 사라질 뻔한 마지막 날의 종가
  KRD(다음 영업일로 들고 가는 리스크)를 rows 끝의 `carryover: true` 행이
  싣는다(D+0 앵커와 대칭). 손익 필드는 전부 **null** — 아직 오지 않은 날의
  손익을 0 이라고 말하지 않는다(공란 정책). dailyDbp/pnl(시뮬)·dbp/est
  (백테스트)는 빈 dict. 시뮬 앵커의 cumulativeBp 는 마지막 행 값의 이월
  (호라이즌 종점 커브가 그대로 서 있다).
- **계약**: `IrsDailyReconRow` 손익 스칼라들이 `int | None` + `carryover:
  bool = False`(전 행에 직렬화됨), FE `IrsDailyReconRow`/`BacktestReconRow`
  도 같은 방향으로 넓힘. ReconStack 은 null 을 — 로 그린다(기존 Won/cellText
  경로 그대로). 이월 행 툴팁: "다음 영업일로 들고 가는 이월 리스크".
- **골든 재핀 #4** (blast-radius 스크립트로 단언 후 재캡처): 61개 recon 행의
  `pvbp` 가 정확히 한 칸 시프트(행 0 시드 동일)·전 행 +carryover=False·앵커
  1행 추가 — pvbp/carryover 밖의 모든 키·값과 recon 밖 전체는 바이트 동일.
  FE 픽스처(linear/shaped.json)는 재캡처 안 함 — FE 테스트가 그 필드를 단언
  하지 않는 기존 정책 그대로, path-matrix F4a 는 carryover 행을 미리 걸러
  둠(앵커 날짜는 경로 행렬 정의역 밖).
- 검증: 백엔드 recon 8/8 + simulate 계열 37/37, FE vitest 815/816(1 skip
  기존), lint 0 에러. tsc 의 guards/*.test.ts 에러 8건은 HEAD 와 동일한
  기존 드리프트(stash 왕복으로 확인).

### 아침 자동 굽기 파이프라인 (2026-08-11 오후, 병행 세션)

[OWNER — "정적 JSON으로 하지말고, 매일 아침에 구워지게" · "SQL 데이터가 없다면
엑셀 데이터를 참조" · "1D가 없다면 1D는 엑셀에서" · "엑셀데이터에 연결되어
있다고 말은 해줘야" · 휴일 no-op · 정적 트리 경로 한정 자동 commit+push 승인].
발단: Vercel 트리는 push 가 유일한 갱신 트리거인데 8/6 에 멈춰 있었다.

- **병합 로더** `dataset.load_dataset_merged` — 서버(main.py)와
  build_static.py 가 **같은 진입점**을 지난다(한쪽만 병합을 알면 폴백한 날
  static-agreement 가 갈라진다). 판정은 `merge_expected_close` 순수 함수
  (test_dataset_merge, 12건): SQL 이 기대 전영업일을 온전히 들면 그대로 /
  1D 만 비면 그 칸을 엑셀에서 / 하루가 통째로 없으면 그 하루를 엑셀에서 /
  SQL 자체를 못 읽으면 전체 폴백. **과거사는 절대 엑셀로 갈아타지 않는다**
  (1D 는 다른 계열 — 유령 점프 방지). `Dataset.source` 4값("sql",
  "sql+xlsx-1d", "sql+xlsx-day", "xlsx")이 health·manifest 의 `source` 로
  나가고 `DataFreshness` 가 sql 아닐 때만 칩("엑셀 연결 — …")을 단다.
  캐시 키는 `Dataset.data_key` — 순수 SQL 이면 종전 워터마크 그대로, 엑셀이
  섞이면 병합분 지문이 붙는다.
- **ops/morning_bake.ps1** — `SauronMorningBake` 태스크(평일 07:20, 로그온
  세션 전용, StartWhenAvailable). 흐름: check_close.py(JSON) → 휴일 no-op →
  SQL full 이면 즉시 굽기, 아니면 08:30 까지 대기(그동안 refresh_irsdata 로
  엑셀 폴백을 데움) → 있는 것으로 굽기 → 게이트 1(데이터 경로 pytest:
  build_static/dataset_merge/dataset_validation/cache — 전체 스위트가 아닌
  이유: 데이터 커밋이 다른 레인 WIP 에 인질 잡히면 안 됨; 코드 게이트는
  gate.ps1) → 백엔드 재시작 → 게이트 2(static-agreement) → **정적 트리 경로만
  commit** → push 가드: 비자동화 커밋이 ahead 면 push 보류+알림("푸시는
  오너" 규칙 보존) → 11:00 까지 late-SQL 재굽기(출처 랭크가 오를 때만).
  실패·보류는 전부 msg 팝업 + `.sauron\ALERT-bake.txt` + bake.log.
- **ops/refresh_irsdata.ps1** — 핵심 발견: **COM 으로 띄운 엑셀에는 인포맥스
  애드인이 실리지 않는다**(레지스트리 OPEN 키 미처리; xlam 직접 열기·
  RegisterXLL(False) 모두 실패, IMDH=#NAME?). 정답은 **정상 excel.exe 기동 +
  GetActiveObject 부착**. 사본에서 재계산 → 이중 검증(기대일 셀 존재+오류 셀
  없음, 그리고 load_dataset 전체 검증) 통과 시에만 원본 교체. 원본을 직접
  열지 않는 이유: 애드인 없이 저장하면 수식이 #NAME? 로 덮여 폴백 소스가
  파괴된다. 성공 판정은 **날짜 셀 == 기대 전영업일** — "값이 있음" 은 어제
  값 잔존(조용한 실패)을 통과시킨다.
- 함정 셋: ① .ps1 은 **UTF-8 BOM 필수** — PS 5.1 이 BOM 없는 UTF-8 을 CP949
  로 읽어 한글 주석이 파서를 깨뜨린다(재현됨). ② PS 함수 반환값에 파이프
  출력이 샌다 — git add 는 `| Out-Null`, 반환은 `Select-Object -Last 1`.
  ③ 0x800AC472 = 엑셀 바쁨 — 실패가 아니라 재시도 신호(Invoke-ComRetry).
- xlsx 는 `source != "sql"` 인 날만 데이터 커밋에 동승 — 순수 SQL 날은
  워킹트리에 dirty 로 남는 것이 **정상**이다(들어간 값의 출처만 리포에 남긴다).
- 오늘 수동 검증 완료: 굽기 asof 08-10(source=sql) · 게이트 1 묶음 108 pass ·
  프론트 가드 67 pass · 엑셀 갱신 exit 0(08-10 반영). **미확인 = 태스크의 첫
  실전 실행(내일 아침)** — 첫 push 는 오너가 밀린 수동 커밋을 push 한 뒤에야
  나간다(가드가 보류한다).

### Latest — 교과서 3분해(평가·캐리·롤다운) + 일별 대사 스택 (2026-08-11 오후)

[OWNER — "평가손익과, 캐리 손익, 롤다운 손익으로 분리해서 진짜 외부 리서치를
통한 Textbook의 기준에 맞게" · "탭 1개에 KRD·Bp변화·PnL변화를 몰아야 … 80일치면
240개의 가로줄"]. 발단은 3/9 1Y Rec 진입 건의 "PnL이 진짜 이게 맞냐".

- **3분해 정의 (외부 리서치: Clarus carry 정의 · Tuckman/Mathema carry-roll-
  down)**: 캐리 = 쿠폰 차 액크루얼+정산(아무것도 안 해서 확정되는 몫), 롤다운
  = 커브 불변 가정에서 잔존만기 단축의 클린 가격 변화, 평가 = 커브무브 잔여.
  셋의 합 == 전체가 **항등**(±1원)으로 성립 — 두 탭 공통. 상세는 DESIGN
  §backtest 의 갱신된 불릿.
- **백테스트** (`app/backtest.py`): 종전 평가(클린 변화 전액)를 체인 동결커브
  재평가로 평가/롤다운으로 갈랐다(`_value_on(curve_idx=...)` — 이전 평가일
  커브로 오늘 날짜 재평가 = unchanged-term-structure). 검증 픽스처 둘이
  분해의 **의미**를 못박는다: 동결 시장 → 평가 정확히 0·롤다운 = 클린 변화
  전액(test_backtest_theta), 포워드 실현 경로 → 평가가 롤다운을 정확히
  되가져감(test_backtest_neutrality — "롤은 포워드 미실현 가정"의 교과서
  문장이 필드로 보인다).
- **3/9 1Y Rec 100억의 답**: 총 +1.15M = 평가 −32.4M + 롤다운 +24.2M + 캐리
  +9.35M. "합계가 거의 0이라 이상해 보인" 이유가 분해로 설명된다 — 진입 당시
  앞단 커브가 극단적으로 가팔라(1D 2.60 → 1Y 3.055) 리시버가 롤다운+캐리를
  크게 벌고, 커브 +39bp 상승이 그만큼을 되가져갔다. 검산: Δbp×DV01 ≈ 평가,
  일별 recon 합계 == 포지션 스칼라(±3원), recon actual == points.d(±1원).
- **백테스트 일별 대사** (`recon`, 새 응답 블록): 영업일마다 북의 테너별
  KRD(범프 재평가 — 포지션 만기가 범프 집합을 자른다: 1Y 북에 10Y 리스크가
  뜨는 팬텀 클래스 방지), 실제 시장 Δbp, 전일 KRD × 당일 Δbp 추정, 그날
  실손익 3분해. `book_recon()` 은 **별도 함수**다 — KRD 범프가 백테스트
  본체보다 비싸서 run_backtest 에 얹지 않았다(속성 테스트들이 안 내던 비용).
  창 캡 250영업일(`truncated`), 밸류에이션 버짓 가드. 1Y 단건 0.6s.
- **시뮬** — 세타 버킷을 캐리/롤다운으로: 새 `carry_split.py` 가 동결 커브
  베이스 경로의 순액크루얼 경로를 엔진 **바깥에서** 재구성(동결 이식 코드
  불가침). 재구성 정산 CF 가 엔진 `scf_b` 와 **날·액수 완전 일치**
  (test_simulate_carry_split — 리시브/페이/시즌드 3케이스). decomposition/
  decompositionDaily/chartData 에 swapRolldown(+swapCashCarryPnL) 추가,
  swapCarry 는 순캐리로 재정의(캐리+롤다운 == 구 세타, float 그대로 — 골든
  재핀 전 blast-radius 스크립트로 단언: 그 외 전 키 바이트 동일). recon 행에
  carryPnl/rolldownPnl(라운딩 잔차로 가산성 보존).
- **일별 대사 스택** (`ui/ReconStack.tsx`, 공용): 하루 = 가로줄 셋(KRD 히트맵
  · Δbp · 손익 추정), 날짜와 하루 요약(평가·캐리·롤다운·그날 손익)은
  rowSpan=3. **백테스트 서랍과 시뮬 일별 대사가 같은 컴포넌트다**(WindowDrawer
  전례). 백테스트 서랍은 일별 PnL + 빈 KRD 두 탭 → "일별 대사" 한 탭으로
  (BacktestDailyPnl 은 감춘 표 목록 합류 — 파일은 남아 있다). 시뮬 쪽 렌즈
  토글(Segmented) 은퇴. 백테스트는 최신이 위(실제 이력), 시뮬은 시간순(미래
  경로) — 어댑터가 각자 정렬한다. ReconStack.test.tsx 가 "80일 = 240행"을
  문장 그대로 핀한다.
- **함정 둘, 이 세션에서 밟고 기록**: ① ui/ 가 `@/sim/**` 을 값-임포트하면
  시뮬 서브트리가 첫 로드 경로에 실린다(guards/lazy-chart) — tintFor/
  directionVar 를 `src/theme/sign-tint.ts` 로 이사, sim/theme/tint 는 재수출.
  ② krw-additivity 가드는 "손익 구성" **문자열의 첫 등장**을 표 앵커로
  삼는다 — UI 문구에 그 넉 자를 쓰면 슬라이스가 밀린다(ReconStack note 에서
  실제로 밟음; BacktestWindow 주석에 경고 남김).
- 손익 구성 표는 4열(평가·캐리·롤다운·합계), `splitKrw(pnl, val, rolldown)`
  — 롤다운도 자체 반올림, 캐리가 잔차(가산성 유지; 구 세션 복원 결과는
  rolldown 부재 → 정확히 종전 2열 표시로 강등). FE 게이트 809+4/lint 0
  err/next build 통과, 백엔드 backtest·simulate 전 스위트 green.
- **창 폭** [OWNER, 같은 세션 — "백테스트도 시뮬레이션만큼 가로 사이즈
  키우자"]: 백테스트 창이 SIM_WINDOW_W(1320)로. 차트 폭은 창 − 패딩 48 =
  1272(`BT_CHART_W`) — 928/880 시절과 같은 관계식이라 링크드 스택의 공유
  x-수식은 불변. backtest-window 가드의 훅 핀은 폭 인자를 포함하도록 갱신.
- **날짜 정렬 토글** [OWNER, 같은 세션 — "오름차순 내림차순 선택할 수
  있게"]: ReconStack 의 날짜 헤더가 정렬 버튼(InstrumentTable 의 " ↑/↓"
  문법). 행은 호출자가 항상 **오름차순**으로 넘기고 표시 방향은 컴포넌트
  상태다 — 기본값만 표면별(백테스트 desc=최신 위·실제 이력, 시뮬 asc=D+0
  위·미래 경로, 2026-08-10 룰링 유지). 어댑터의 reverse 는 사라졌다.
- **평가일 기준 관행 2건 (같은 세션 막판, 인포맥스 실측 대사)** [OWNER —
  "금요일에 튀어야" · "이게 진짜 KRD야"]: ① 백테스트 recon 의 세타 귀속이
  **포워드**로 — 행 t 의 캐리/롤다운 = (t→다음 영업일) 몫, 금요일이 주말
  사흘치를 싣는다. 평가는 종가 대 종가 그대로. 동결 스텝은 **전일 픽싱**으로
  가격해 새 CD 프린트가 평가(마켓 이벤트)로 떨어진다 — 이 규칙을 레코드
  체인(_run_one/trace)에도 맞춰 행 Σ == 스칼라가 버킷까지 일치(안 맞추면
  픽싱일마다 25만원/5개월 새는 걸 실측). ② recon KRD 가 **T+1 평가 기준**
  — 인포맥스 3/9 1Y Rec 실측과 12M 버킷 49원(0.005%)·단기 합 2원까지 일치
  (당일 평가는 2,847원 어긋나고 1.5Y 스필 — 관행이 실증으로 확정됨). 잔여
  차이는 배분뿐: 인포맥스는 변동레그를 3M에 전부, 우리는 보간이 6M에
  −2,730 흘림. 시뮬 recon 도 같은 관행으로 정렬 완료 [OWNER — "같이 맞춰"]:
  포워드 세타 3필드 + D+0 앵커 행(첫날 밤 세타·시드 KRD), totalActual =
  평가+포워드 세타, residual = 평가−추정. 골든 재핀 #2의 blast-radius 가
  "새 행 j 의 포워드 세타 == 구 행 j 의 백워드 세타(한 칸 시프트)·마지막 행
  0·그 외 필드 바이트 동일"을 단언 — 순수 재귀속임이 증명돼 있다. 계약
  테스트의 스왑 합산식이 swapRolldown 을 빼먹은 채 3분해 커밋에 실려 있던
  것도 이 패스에서 발견·수정(전체 스위트의 static-agreement 16건에 가려
  있었다 — "N failed 요약과 FAILED 라인 수가 다르면 세라"는 교훈).
- **"PnL 값이 바뀐 것 같다"의 답** [OWNER 질문, 같은 세션]: 착각 아님, 코드
  아님, **데이터**다. ① 같은 날 아침 굽기 레인(`dfa0a25`/`bd92022`)이
  데이터를 08-07 → 08-10으로 세 영업일 전진시켰고, ② 낮 동안에도 SQL 종가가
  리비전됐다 — 같은 코드·같은 로더로 30분 간격 3/9 1Y Rec 총액이
  1,151,805 → 914,693으로 이동(캐리는 동일, 평가/롤만 이동 = 커브 데이터
  갱신의 서명)한 것을 실측. 코드 쪽 총액 불변은 테스트가 못박는다(백테스트
  pnl 식 무변경 + 시뮬 골든 blast-radius에서 total 바이트 동일). 분해 **열**
  값이 달라 보이는 것은 3분해로 평가에서 롤다운이 분리된 의도된 변경.
- **동시 세션 정리**: 병합 로더 + 아침 굽기는 같은 날 `dfa0a25`(코드) +
  `bd92022`(데이터 리프레시)로 **랜딩 완료** — 한때 적색이던
  test_static_agreement 는 그쪽 레인에서 해소됐다. :8100/:3100 은 이 세션
  말미에 새 코드로 재기동해 3분해·일별 대사·새 폭을 실화면으로 확인했다
  (1Y Rec 실행 → 손익 구성 4열 → 서랍 240행 스택, 행 항등식 눈검산까지).

### Before that — KRD 팬텀 버킷 이중 계상 수정 (2026-08-11, 교과서 대사 검증에서 발견)

백테스트·시뮬레이션 PnL을 리포 코드를 임포트하지 않는 독립 교과서 프라이서로
전면 대사했다(기준: CFA/Hull 스왑가치 · Clarus 캐리/롤다운 · product-control
P&L explain "전일 민감도 × 당일 변동, 선형 북 미설명분 <1% 또는 절대 ~$5k").
**백테스트는 7개 포지션 × 전 일자에서 |앱−독립| ≤ 0.5원(반올림 한도),
시뮬 FM 엔진은 60영업일 전부 0원 일치** — 실제 P&L(완전 재평가) 경로는 양쪽
다 검증 완료. 그 대사에서 결함 하나가 나왔고 이 세션에서 고쳤다:

- **결함**: `build_bumped_curves`/`compute_irs_krd_map`(quant_engine.py)의
  "가장 가까운 노드" 매핑이, 표준 12노드 와이어 커브(6y/8y/9y 노드 없음)에서
  6Y→5y·8Y→7y·9Y→10y로 **충돌해 같은 범프 커브가 두 버킷으로 합산**됐다.
  일별 대사표 pvbp가 6Y==5Y로 매일 동일했고, totalEstPnl은 대표 북에서 매일
  +1.88M의 유령 손익(day-1 est 2,193,733 vs 실제 평가 317,874 — 7배,
  미설명분 Σ 310%). 일별 KRD 서랍에는 북에 없는 6Y 리스크가 표시됐다.
  **실제 P&L·chartData·decomposition은 무영향**(완전 재평가 경로).
- **수정**: 노드를 라벨 거리 기준 가장 가까운 버킷 **하나에만** 배속하는
  파티션(`_krd_bucket_nodes`)으로 교체 — 소유 노드 없는 버킷 KRD = 0,
  Σ버킷 = 평행 DV01(가산성 복원). 라벨:노드가 1:1인 구간 값은 종전과 동일.
  단발 경로(`compute_irs_krd_map`)도 같은 규칙으로 정렬(만기가 충돌 라벨을
  넘는 6Y+ 스왑에서 같은 결함이 잠재했다 — effective_upper가 못 자르는 영역).
- **수정 후**: day-1 est 314,621 vs 평가 317,874(1%). 미설명분 310%→21.7%,
  절대 최대 375,053원(≈$270 — product-control 절대 허용 이내; 잔여분은
  라벨 vs 실날짜 노드 보간 + 이벤트일 컨벡시티로 구조적).
- **골든 재핀**(DV01-B·2026-08-10 전례): 재캡처 전 blast radius를 단언하는
  스크립트로 검증 — 달라진 필드는 recon의 `pvbp`(팬텀 버킷→0)·`pnl`·
  `totalEstPnl`·`residual` 넷뿐, totalActual/theta/valuation/settleCf 및
  다른 모든 키는 바이트 동일. `tests/test_krd_buckets.py` 신설(팬텀 0 ·
  Σ버킷=평행 DV01 · 완전 커브 1:1 보존, 양쪽 경로).

### 시나리오 케이스 색 + 미리보기 다듬기 (2026-08-10)

트레이더가 2026-08-07의 파선 인코딩(바로 아래 §)만으로는 Base/Bull/Bear/Crisis
넷을 빨리 못 갈랐다. 파선을 걷어내고 색으로 바꿨고, 같은 세션에서 색을 세 번
손봤다(4색 독립 팔레트 → 블루톤 한 벌 → **채권시장 방향색 재사용**) — 최종
상태만 적는다:

- `theme/tokens.css`에 `--bw-case-base/bull/bear/crisis` 넷 추가 (light+dark).
  **이 트레이더의 책상 관행 — 이 제품 부호색과 정반대로 읽는다** [OWNER,
  같은 세션에서 정정됨: 처음엔 관행대로("상승=안좋음=빨강, 하락=좋음=파랑")로
  구현했다가, 몇 분 뒤 "아니 파란게 안 좋은 거라니까"로 뒤집혔다 — 최종은
  "상승=파랑(안 좋음), 하락=빨강(좋음)"]. `--bw-case-bull`은 `--bw-up`의
  헥스값(빨강), `--bw-case-bear`는 `--bw-down`의 헥스값(파랑) — **var() 별칭이
  아니라 값만 복사**다. 이 화면의 다른 곳(변동 bp 등)에서 빨강/파랑은 여전히
  "상승/하락"을 뜻하므로, 방향색 자체를 바꿔치기하면 그쪽 의미까지 뒤집힌다.
  Bull/Bear는 이 화면 자체가 "불은 하락, 베어는 상승"이라 고정해 둔 이름이라
  (CaseSection 문구) 이 반대 읽기가 케이스 안에서는 거짓말이 아니다. Crisis는
  이 파일이 이미 갖고 있던 `prefers-contrast:more` 부스트 **다운**블루
  (#004dc4 라이트 / #83b4ff 다크)를 무게감 용도로 재사용, Base는 방향이 없어
  `--bw-ref-cd`(중립 회색). 기준(오늘) 선은 그대로 액센트 주황. 앞선 세 시도
  (킷 System Colors 4색; 블루 한 벌 밝기 램프; 관행대로의 var() 별칭)는 코드에
  흔적이 없다 — git 기록에만 남는다. **다음에 또 뒤집힐 수 있다** — 이건
  객관적 사실이 아니라 이 트레이더 개인의 색 관행이라고 명시해 뒀다.
- 파선은 완전히 없앴다("파선 사용하지 말고 실선으로") — `CurvePreview`의
  `CASE_DASH`, `TermStructureChart`의 `shockedDash` prop 둘 다 삭제.
- 커브형·시계열형 미리보기가 **같은 케이스 칩**을 쓴다 — 새 컴포넌트
  `sim/ui/CaseChips.tsx`.
- 시계열형(`PathPreview`)은 **IRS만** 그린다 [OWNER — "IRS 금리만 표기하면
  됨"]. 케이스 겹쳐 보기를 처음 붙였을 때는 국고까지 같이 켜서 케이스당 두
  줄(최대 8줄)이었는데, 국고를 뺐다 — 값이 매겨지는 건 스왑뿐이다.
- 커브형(`CurvePreview`)의 호버 값은 상단 텍스트 한 줄에서 **커서를 따라다니는
  패널**로 옮겼다 [OWNER — "상단에 적지 말고 커서 옆에"] — 시계열형이 이미
  쓰던 `HoverPanel`과 같은 패턴. 상단엔 정적 정보(기준일·D+n)만 남았다.
- **1D 노드가 실제로 값을 갖게 됐다** [OWNER — "1D도 추가하고", "1D는 Call
  Rate임"]. `sim/hooks/use-input-curves.ts`의 `useSwapInputQuotes`가 1D 마디를
  `rate: null`(구멍)로 밀어넣었던 첫 시도는 틀렸다 — 백엔드가 이미
  `MarketSnapshot.on_rate`(콜금리)를 로더→라우터→`MarketDataResponse.on_rate`
  까지 다 배선해 뒀는데 이 훅만 그 필드를 안 읽고 있었다. `snap.on_rate` 로
  교체 — 새 배선이 아니라 있던 배선을 잇기만 한 것.
- **금통위 이벤트 ↔ 목표 금리 독립성**: 확인만 했고 코드는 안 건드렸다.
  `path-matrix.ts`의 `cumBpAt`을 읽어보면 tenorYears ≥ 1.0에서는 `bok` 항이
  아예 안 들어간다 — `factorAt(day) * terminal`뿐이고 `factorAt`은
  `lerpWaypoints`(웨이포인트/목표 경로)만의 함수다. 이벤트가 미치는 구간은
  <0.25(1D·3M, 전부 이벤트) 와 [0.25, 1.0)(6M, 이벤트·목표 블렌드)뿐이고 1Y
  이상은 이벤트 항이 수식에 없다. "1Y 밑에까지만 영향" 요청과 이미 일치한다.
- **UI 문구 정리** [OWNER, 2026-08-10]: `ConfigureStage.tsx` 네 군데 — 포지션
  개수 줄("상품 N개·스왑 M다리를 평가해요" → "포지션 N개를 평가해요"),
  시나리오 구획 설명(방향 관행 문장 삭제, 색이 대신 말하므로 — "네가지 시나리오
  반영을 통해서 시뮬레이션을 진행할 수 있어요"만 남음), 커브 스프레드
  캡션("짧은 쪽(CD·오버나이트)" → "1년 이하"), **금통위 이벤트 → 기준금리
  이벤트**(제목·본문 둘 다 — "금통위"는 기관명, 트레이더가 실제로 만지는 건
  기준금리 자체).
- `sim/lib/chart-theme.ts`의 `SimChartTheme`에 `case: Record<CaseId, string>`
  필드 추가, `sim/theme/bridge.ts`에 `resolveCaseColor()` 추가 — 캔버스/SVG
  둘 다 이 경로로 색을 받는다(날 CSS var를 캔버스에 넘기면 조용히 아무것도
  안 칠하는 기존 함정, `assertNoCssVars`가 여전히 지킨다).
- `docs/DESIGN.md`에 §9 색 규율 바로 앞 "Scenario case hues" 절 추가 — 이
  화면 하나의 네 번째 팔레트라고 명시하고, orange/navy 금지(§9, `palette.test.ts`)
  는 그대로 서 있다고 적었다.
- 가드: `guards/palette.test.ts`·`guards/band-hue-contrast.test.ts` 둘 다
  이름별 토큰만 검사해서 새 `--bw-case-*`엔 걸리지 않는다 — 즉 이 넷을 위한
  전용 대비 가드는 아직 없다(단, bull/bear/base는 이미 검증된 토큰을 var()로
  가리키므로 그 토큰들의 기존 가드가 간접적으로 적용된다 — crisis만 별도
  하드코딩값이라 전용 가드가 없는 유일한 토큰).
- **대사 표 daily 전환 (같은 세션 후반)**: `DailyPnlTable`은 누적을 인접 행
  차분한 **그날 값**만 보여준다(서버는 누적만 주므로 차분은 정확한 역연산 —
  두 번째 정의가 아니다). `BacktestDailyPnl`은 누적 열을 아예 없앴다("그날
  손익" 하나). `ComponentCurves` 선 색은 **최종 부호의 방향색**(끝이 플러스면
  빨강, 마이너스면 파랑)으로 바꿨다 — "잉크 농도로만 가른다"던 이전 규칙 폐기.
- **일별 KRD (같은 세션 후반)** [OWNER — "매일매일의 KRD가 나와야 대사가
  가능함"]: **백엔드 수정이 필요 없었다.** chart.py의 대사 루프가 이미
  영업일마다 그날 쇼크 커브를 부트스트랩하고 12개 테너를 범프해
  `portfolio_krd_day`로 일별 KRD를 계산, `irsDailyReconciliation`(행마다
  `pvbp`(테너별 KRD)·`dailyDbp`·`pnl`·`totalActual`(그날 실손익))으로 응답에
  실어 보내고 있었다 — 프론트가 안 그리고 있었을 뿐. 새 `KrdDailyTable`
  (ResultsTables.tsx)이 그 데이터를 날짜×테너 표로 그리고, 시뮬레이션 창
  서랍의 KRD 탭이 스냅샷(KrdGrid) 대신 이걸 쓴다(탭 이름 "일별 KRD").
  같은 세션에서 **세 렌즈 토글**로 확장 [OWNER — "일별 테너별 bp 변화까지
  넣어서 완벽하게"]: 격자 하나에 Segmented 로 KRD(`pvbp`)·Δbp(`dailyDbp`,
  소수 둘째 자리 — 정수 반올림하면 하루 0.17bp 가 전부 지워진다)·손익
  (`pnl`, 합계 열은 재합산 대신 엔진의 `totalEstPnl`)을 갈아 끼운다.
  `그날 손익`(totalActual) 열은 모든 렌즈에서 고정 — 손익 렌즈의
  합계(추정)와의 차가 곧 엔진의 선형화 잔차다. 색 규칙: KRD 는 수준이라
  잉크, Δbp·손익은 방향색(directionVar). 손익 렌즈만 꼬리 열이 넷:
  합계(추정)·**스왑평가·스왑캐리**·그날 손익 — 일별 PnL 탭과 같은 이름을
  쓰는 근거는 픽스처 검증이다: linear·shaped 전 구간에서 일별 PnL 탭의
  스왑평가Δ≡recon.valuationPnl, 스왑캐리Δ≡recon.thetaPnl, 합계Δ≡totalActual
  (최대 오차 ₩0.89 — 라운딩). "추정이랑 실제가 왜 다르냐"는 열 순서가
  답한다: 추정 vs 스왑평가 = 선형화 잔차, 스왑평가+스왑캐리 = 그날 손익.
  **폭 규율** [OWNER — "좌우 스크롤 하기 싫음"]: KRD 전 기간 0인 테너 열은
  숨긴다(pvbp 기준 한 번 판정 — 렌즈 전환에도 열 집합 고정), 날짜는
  MM-DD(연도·D+n 은 title), 꼬리 열은 11ch(한글 헤더가 9ch 를 넘는다).
  **대사 표 두 곳(일별 KRD·일별 PnL)은 원 단위 그대로**(`MoneyWon`) —
  formatKrwAxis 의 만/억 접기("원 단위는 판단을 안 바꾼다")는 대사 표에서
  거짓이 된다: 외부 시스템과 자릿수까지 맞추는 표라 24,141 이 "2만" 이면
  맞는지 다른지 말할 수 없다.
- **잠재 결함 발견, 실전 영향 없음 (2026-08-10 조사)**: `quant_engine`의
  `compute_irs_krd_map`·`build_bumped_curves`는 KRD 테너에 par 노드가 없으면
  **가장 가까운 노드를 대신 범프**한다(`closest = min(avail_t, ...)`) — 커브가
  얇으면 같은 노드가 여러 라벨에서 반복 범프되어 **꼬리 감도가 이중 계상**
  된다. FE 픽스처(linear.json, 합성 7노드 커브)에서 실증: 3Y=4Y=+148,001 ·
  6M=9M · 1Y=1.5Y 전부 중복, 그 결과 일별 추정이 −16,132/일로 실제
  커브무브(+588/일)와 부호까지 다르게 나온다. 중복을 빼면 추정 +588 vs 실제
  +588로 정확히 일치. **실전은 안전**: 프로덕션 요청은 irsdata 스냅샷
  13노드 + 1D/3M 앵커가 실려 15개 KRD 라벨 전부 자기 노드가 있다
  (swap_inputs._resolve_swap_inputs → _inject_short_anchors). 얇은 커브를
  직접 싣는 구형/테스트 페이로드에서만 문제 — 엔진은 이식 코드라 손대지
  않았고, 고치려면 노드 없는 라벨은 범프를 건너뛰는(0) 것이 최소 수술이다.
  같은 조사에서 **일별 PnL 탭 합계 == KRD 탭 그날 손익을 픽스처 전 구간
  diff 0으로 검증**(둘 다 `irs_fm_mtm` 궤적의 같은 증분 — swapMtm+swapCarry
  ≡ irs_fm_mtm, cumulative_irs_carry ≡ 0(HARDEN-1)).
  KrdGrid는 파일에 남아 있다(감춘 표 복원 규칙). ⚠ 컨벤션: 엔진의 "N일자
  KRD"는 N의 **결제일(다음 영업일) 기준** 재평가 값이다 — 시스템과 하루
  어긋나 보이면 이것부터.
- **실행 하나 = 네 케이스 전부 (같은 세션 후반)** [OWNER — "실행결과 나란히
  ㄱㄱ"]: `runCurrent`(use-simulation.ts)가 `caseParams`로 케이스별 요청 넷을
  조립해 **같은 AbortController로 병렬** 발사한다 — 취소 한 번이 넷을 끊고,
  하나라도 실패하면 전체 실패(세 케이스짜리 "비교"는 반쪽이다). 스토어에
  `caseRuns`(케이스별 {request,result})·`resultCase`·`setResultCase`·
  `ingestCaseResults`가 생겼고, **케이스 전환은 lastRun을 통째로 갈아끼우는
  것**이라 결과 화면의 모든 소비자(워터폴·성분 커브·서랍 표)는 케이스를
  모른다. ResultsStage 상단에 케이스 탭(토탈 내장, 케이스 색 견본) + "케이스
  비교" 구획(성분×케이스 표). `ingestResult`(단일 실행 경로)는 caseRuns를
  안 건드린다 — 지금 호출자 없음, 되살리면 주의(스토어 주석에 적어 둠).
  use-simulation.test.tsx가 4-요청 계약으로 갱신됨.
- **결과창 재구성 (같은 세션 막판)** [OWNER, 2026-08-10]: ① Crisis 색은
  **톤다운 보라**로 재수정(#b651c5 라이트 / #c752d8 다크 — 킷 퍼플을 킷
  회색으로 35%/30% 누른 값, 실측치는 tokens.css 주석; "무거운 베어 = 진한
  파랑" 읽기는 한 세션 만에 폐기 — 셋째 색조가 둘째 파랑보다 빨리 읽힌다).
  ② **기준(현재) 커브가 파선**("현재 금리 상황은 파선으로") — 파선의 주인이
  케이스(08-07) → 없음(08-10 오전) → 기준선(08-10 오후)으로 두 번 옮겨 온
  역사가 TermStructureChart 도입부 주석에 있다. 캡션도 "파선이 현재, 실선이
  시나리오"로. ③ 시뮬레이션 창 전용 폭 `SIM_WINDOW_W = 1320`(floatingWindow
  .ts; useFloatingWindow 가 winW 인자를 받게 됨 — 백테스트는 928 그대로),
  뷰포트가 좁으면 CSS min() 이 줄인다. ④ **서랍 폐지**: 일별 PnL 탭 삭제
  (DailyPnlTable 은 감춘 표 목록에 합류), 일별 대사 표(KrdDailyTable)가
  ResultsStage 본문 마지막 구획("일별 대사")으로 승격 — 손익 렌즈가 스왑평가·
  스왑캐리·그날 손익을 다 실으므로 일별 PnL 탭은 부분집합이었다. 트레이더
  피드백 5("서랍에 둘 다")는 이 지시로 대체됨(백테스트 서랍은 그대로).
  ⑤ KRD 렌즈는 **히트맵**(tintFor — 배경색=부호, 농도=크기(표 전체 max 기준),
  틴트 위 글자는 잉크 — tint.ts 규칙 그대로, KrdGrid 와 같은 문법).
- **평가/캐리 분해 외부 검증 + 편차 수정 (같은 세션 최종)** [OWNER —
  "외부 리서치 통해서 텍스트북 찾아서 엄중하게 검증", "편차 수정하고 부정확한
  부분 수정"]: 문헌 대조 결과 분해는 표준 정합 — 스왑캐리 = 터크만
  unchanged-term-structure 가정의 carry-roll-down(캐리+풀투파+롤다운 합산
  버킷, 리픽싱은 **동결 커브의 잔존 테너 스팟** — forward_rate_simple(0,·)
  이라 realized-forwards 가 아니다; "포워드로 픽싱"이라는 이전 설명은
  부정확했음), 스왑평가 = 전액−세타(풀 재평가 2단계, 잔차 0 — 문헌상
  재평가 방식), 조달 분리(스왑은 무자금). **수정한 편차 1건**: 일별 recon
  추정이 당일(end-of-day) KRD 를 쓰던 것을 **전일(start-of-day) KRD × 당일
  Δbp** 로 — P&L explain 민감도 방식의 교과서 관행("어제의 민감도 × 오늘의
  변동"). chart.py 에 `_krd_at()` 헬퍼 + `_pvbp_prev_r` 시드(day 0, 쇼크 전
  커브)가 생겼고, 행의 `pvbp` 필드는 계속 **그날의** KRD(수준값)다 — 바뀐
  것은 `pnl`/`totalEstPnl`/`residual` 뿐. **골든 재핀**(DV01-B 전례):
  simulate_golden_dv01_response.json 재캡처 — 이번 캡처부터
  swapContributions 포함이라 test_matches_source_backend_golden 의 extras
  화이트리스트가 빈 셋이 됐다. 백엔드 simulate 계열 35/35 통과. ⚠ FE
  픽스처(linear/shaped.json)의 recon `pnl/totalEstPnl/residual` 은 이제
  구식 값이다 — FE 테스트는 그 필드를 단언하지 않아 초록이지만, 다음에
  픽스처를 다시 뜰 때 같이 갱신된다.
- **스파게티 수술 세 건 (같은 세션, 동작 바이트 불변)** [OWNER — "다
  해봅시다"]: ① `chart.py` 806→581줄 — 일별 대사가 `recon.py`(build_
  irs_daily_recon + build_pos_trades), BOK 이벤트 당일 진단 ~120줄이
  `bok_breakdown.py` 로. 반환은 `ChartRun`(NamedTuple, 9필드) — 앞 7필드는
  종전 튜플과 위치 호환이고, decomposition dict 에 밀수하던 "daily"/
  "swapContributions" 가 자기 필드로 나왔다(orchestrator 의 pop 우회 제거,
  distribution 은 이름 접근으로 전환). ⚠ 이음새 규칙: profiling.py 가
  `chart.calculate_daily_mtm` **모듈 속성**을 감싸므로, bok_breakdown 은
  그 함수를 **인자(daily_mtm_fn)** 로 받는다 — 직접 임포트하면 프로파일러/
  몽키패치가 조용히 끊긴다. 부수 이득: skip_recon(분포 밴드) 런이
  IRS_Trade 사전 빌드까지 통째로 건너뛴다(종전엔 낭비 계산). ② t_mat/
  t_next 유도 세 벌 복사(enrichment·chart FM 사전계산·recon pos_trades)를
  `swap_schedule.resolve_swap_horizon` 하나로 — BOK 진단의 91일 롤링 변형은
  의미가 달라(시점이 이벤트 당일) 합치지 않고 그 모듈 주석에 명시. 골든
  딥-패리티가 전부 바이트 동일 증명(simulate 35/35). ③ `BacktestWindow.tsx`
  1,778→1,375줄 — 돈 포매터 가족(manUnits/fmtKrwFromMan/fmtKrw/splitKrw)이
  `ui/krw.ts` 로(창 컴포넌트에서 돈 표기를 임포트하던 BacktestDailyPnl·
  RegretLab 의 결합 해소), PnlChart+LinkedPnlChart+CARD_W 가
  `ui/BacktestPnlCharts.tsx` 로. 소스 스캔 가드 네 곳을 **의도 보존**하며
  갱신: readout-parity(toFixed=픽셀 규칙이 새 두 파일도 스캔), reorder
  (no-SPRING 목록에 추가), backtest-context(CHART_PAD 정렬 핀을 새 파일로),
  krw-additivity·regret-list(임포트 경로). BookContextChart(~180줄)는 이번
  패스에서 창에 남았다 — backtest-context 가드가 PreviewChart/useCdReference
  를 창 소스에 앵커하고 있어, 옮기려면 그 가드 재앵커가 같이 가야 한다.
  검증: FE 808 passed(이전 805+skip4 → 808+skip1 — 굳어 있던 skip 3건이
  풀려 실행·통과), lint 0 에러, next build 통과.
- **미해결**: ~~백테스트 KRD는 여전히 없다~~ → **해소됨 (2026-08-11 오후,
  위 Latest — `book_recon` 이 일별 테너별 KRD 를 계산한다).**
  BacktestWindow 의 남은 덩어리(BookContextChart·
  Result·PositionRow)와 quant_engine 의 mega 함수는 다음 패스 후보 —
  후자는 동결 이식 코드라 오너 승인 필요. 큰 SVG 누적 손익 차트 둘(`BacktestWindow`의
  `LinkedPnlChart`/`PnlChart`)은 여전히 누적 — 막대형(일별)로 바꿀지는
  별도 결정. 네 케이스 병렬 POST의 백엔드 동시성은 스레드풀이 받는다 —
  문제가 보이면 순차 발사로 낮추는 게 첫 번째 조치.

### Before that — 트레이더 피드백 다섯 건 + 활자 사다리 (2026-08-07, HEAD `0fc36c5`)

`main`은 origin보다 **42 앞서 있고 아직 푸시하지 않았다** — 푸시는 오너 몫이다.
같은 날 앞쪽에서 셸(사이드바 2단 탐색·그룹박스·MySQL 전환)이 끝났고, 그 위에
트레이더 피드백 다섯 건이 순서대로 올라갔다.

| | | |
|---|---|---|
| `50ed6c5` | 1 | 시뮬레이션 결과가 백테스트처럼 **떠 있는 창**으로. URL 파라미터는 없다 — 결과는 방금 계산한 실행이라 링크로 복원되지 않고, 파라미터를 두면 **빈 창을 복원**하게 된다 |
| `4a2ef65` | 5 | 일별 PnL·KRD가 **창 하단 접이식 서랍**(`ui/WindowDrawer.tsx`). 두 창이 같은 컴포넌트를 쓴다 — 서랍이 두 벌이면 "둘 다에 존재한다"가 곧 거짓이 된다 |
| `d35367c` | 2 | 시나리오 케이스 **Base/Bull/Bear/Crisis** + 커브 겹쳐 보기 |
| `08da811` | 3·4 | 다리별 **진입 금리 덮어쓰기**(기본 par) · **CD**를 금통위 이벤트로 |
| `0fc36c5` | — | 활자 사다리 한 칸 위로 — **자리가 있는 곳만** |

읽고 나면 다시 유도하지 않아도 되는 것들:

- **케이스는 금리 시나리오만 담는다.** 기간·앵커 테너·포지션·기준일은 넷이
  공유한다 — 그것들이 케이스마다 다르면 나란히 비교한다는 말이 성립하지 않는다.
  `ScenarioParams`를 갈아엎지 않았다: `params`는 여전히 **편집 중인 케이스의
  살아 있는 값**이고, 스토어는 **전환 시점에만** 케이스 필드를 저장·복원한다
  (`caseFromParams` / `caseParams`). 쓰기 경로가 하나라 두 값이 어긋날 자리가
  없고, 요청 빌더도 골든 픽스처도 그대로다.
- **케이스를 가르는 것은 파선이 아니라 색이다** [OWNER, 2026-08-10 — 이 절
  아래 최신 항목 참조]. 여기 적혀 있던 "색이 아니라 파선 모양" 판단은 폐기됐다
  — 트레이더가 파선만으로는 넷을 빨리 못 갈랐다. 지금은 케이스마다 고유색
  (`tokens.css --bw-case-*`)이고 파선은 없다. 어느 색이 어느 케이스인지는
  토글 칩 안에 그 색의 견본선을 그려 말한다(`CaseChips.tsx`, 커브형·시계열형
  공용).
- **CD 스프레드가 커브 스프레드에 있을 때는 3M 마디에 닿은 적이 없다.** 엔진
  `_cum_shock_r`(chart.py)은 τ ≤ 0.25에서 이벤트 계단의 누적 bp를 그대로 쓰고
  터미널 쇼크 노드를 쳐다보지 않는다 — 이벤트가 하나라도 있으면 사용자가 넣은
  CD 스프레드는 정확히 CD가 사는 마디에서 버려졌다. 그래서 손잡이를 이벤트
  안으로 내렸다(`shortEndEvents[].cdSpreadBp`), 그리고 wire의
  `fundingEvents[].shiftBp`는 **기준금리 변동 + CD 추가**다.
- **par는 서버가 준 자리에 그대로 남는다.** 덮어쓰기는 `enginePositions`를
  만드는 곳에서만 얹는다 — 여기서 덮어쓰면 par가 사라져 되돌리기도 비교도 할 수
  없다. 옮긴 줄은 진입 MtM이 0이 아니고, 화면이 그 사실을 말한다.
- **`text-body`·`text-callout`·`text-headline`은 69군데에서 쓰이면서 CSS를 한 줄도
  만들지 않고 있었다.** Tailwind는 `--text-*`가 있어야 그 이름의 유틸리티를 낸다.
  셋 다 body의 13px를 물려받아 같은 크기였다 — 위계가 있다고 믿으면서 없었다.
  이제 실제로 낸다(callout 13 / body 14 / headline 15).
- **표 영역은 활자를 못 키운다.** `OverviewColumns`·`InstrumentTable`·
  `RangeCells`의 칸 폭은 `ch`로 쓰여 있고 `ch`는 그 요소 자신의 font-size로
  풀린다 — 여기서는 **글자 크기가 곧 표의 폭**이다. 실측: 메인 개요 한 칼럼이
  13px에서 670px를 요구하는데 상자가 668px다(이미 −2px). 14px면 707px, 39px가
  삐져나온다. 사다리를 올릴 때 이 셋만 되돌린 이유가 그것이다.
- **활자를 만질 때는 넘침을 재고 나서 커밋한다.** 이번에 쓴 방법: 모든 화면에서
  `scrollWidth - clientWidth`(그리고 세로)를 훑어 `overflow: hidden|clip|visible`인
  요소만 걸러낸다. 일괄로 올린 뒤 걸린 곳만 되돌리는 것이 "자리가 있는 곳만"의
  실행 방법이다.

### Before that — the motion line: diagnose (pass A) → timing system (pass B), 2026-08-06

Pass A wrote no code. It measured the product against the reference's motion
properties and produced the rulings pass B needed; the full report lives
outside the repo (session scratchpad `sauron-motion-pass-A.md`). What it found,
condensed, because pass B acts on it:

- **7 durations, 4 easing curves, and only ONE curve chosen on purpose.** Every
  bare `{duration: x}` inherited motion's tween default `easeInOut`; both
  Tailwind transition utilities inherited `cubic-bezier(.4,0,.2,1)`. Nine of
  the ten non-spring transitions accelerated on entry.
- **There were no motion tokens at all** — not defined-and-bypassed like
  `--radius-card`, simply absent. Every value was a literal at its call site.
- **Reduced motion did not work and the guard could not have noticed.** See
  DESIGN §14 "Reduced motion is literally instant" — the mechanism is recorded
  there so it is not re-diagnosed.
- **Six surfaces overshot**, not one.
- **FLIP was already built and correct**; the one defect was `snapReorder`
  reading `offsetTop` for all 140 rows outside the cull.
- Row counts in the spec were stale (168 vs 140; "전체 ~200" vs 24).

**Rulings [OWNER, 2026-08-06]** — two went against the diagnosis' own
recommendation, and the ruling won:

1. reduced motion is **literally instant, opacity included** (recommendation
   had been movement-only);
2. **exactly one** surface overshoots — the row reorder;
3. `--ease-out` = `cubic-bezier(0.32, 0.72, 0, 1)` (recommendation had been to
   reuse the existing `.22,1,.36,1`);
4. scope = timing tokens + ease · bottom strip · backtest drag → transform ·
   reorder snapshot cap. Rolling digits and origin-anchoring are OUT.
5. `lightweight-charts` kinetic scroll off entirely, **provisional, re-check at
   QA** — it costs touch inertia for every user.

**Pass B shipped all of it**, plus DESIGN/HANDOFF rot #1–#5. New guards:
`motion-tokens.test.ts` (CSS↔TS mirror, three-durations-one-curve, and a
BUILT-CSS check that is freshness-gated so it cannot pass on a stale build);
`reduced-motion.test.ts` rewritten from a pure-function test into a per-file
call-site count. `SHEET_SPRING` and `NUMBER_FADE` are deleted rather than left
unreferenced.

**Not done, deliberately:** no stagger was added to the reorder. It was in the
candidate spec but no scope option covered it, and staggering rows that are
moving to make room for each other breaks the simultaneity that makes the set
read as one rearrangement. If it is wanted, it belongs on ENTER only and must
be derived (`min(24ms, 200ms / n)`), never fixed — 48 rows × 24ms is 1,152ms.

**Still unseen on a screen.** Pass B is verified by gates, source assertion and
built-CSS inspection, exactly like the three Toss-line passes before it. The
A7 checklist in the pass-A report is the owner's QA list.

### Before that — the Toss line, three passes, CLOSED (2026-08-05)

One line of work in three commits. **It is finished** — DESIGN §9/§15 carry the
binding rules and §7 below carries what it left open. Do not reopen it without
the owner; two of its dead ends were re-derived from stale docs already.

1. **Surface tokens `0a8448e`.** Light moved in *temperature* only (page
   `#f9fafb`, ink `#191f28`) because `--bw-up` clears the 4.5:1 text floor on
   `--bw-page` by **0.082** — 0.69 L\* of room, and the reference grey is 2.18
   L\* past it. Dark took the whole move (page `#101113` / tile `#1c1e21` /
   sheet `#25282c`, hairlines 18/55 → 16/50, separation 2.99 → **6.13 L\***).
   Dark hairline percentages are mirrored in `theme/ramp.ts EDGE_OPACITY`;
   `ramp-sync` fails on drift.
2. **Register `8a43034`.** All Korean prose → **해요체, one fact per sentence**,
   reversing the Session 15 합니다체 migration. **Vocabulary frozen** — market
   terms verbatim, 나비/양옆 still banned. 18 of 30 templates had asserted more
   than one fact. `gloss.test.ts` pins the strings, a ≤45자-per-sentence bound,
   the absence of 합니다체, and the survival of the terms.
3. **Geometry (this commit).** The correction the line was missing: **the
   reference separates light surfaces by GEOMETRY, not lightness** — which is
   why the light half of pass 1 was invisible. Binding now: the axis rule
   (horizontal → hairline, vertical → radius and gap), the theme asymmetry
   (light = geometry, dark = lightness, never both), radius as tokens
   (12/16/20), and shadows permitted on floating surfaces / banned on in-flow
   chrome. The grid-divider ban was **reversed to vertical-only**.

**The finding that explains the whole line:** a render-tree walk established
that in light, `--bw-page` **paints no canvas pixels at all** — the shell has
been full-bleed `bg-tile` since Session 16. DESIGN had claimed a "thin `p-3`
grey margin" for two sessions, and that stale sentence is what sent pass 1
fighting a contrast ceiling over a surface nobody sees. Corrected in place.

**Withdrawn mid-pass:** rounding the shell panels. Radius needs a gap, a gap
reveals `--bw-page`, and light page is effectively white — so radius + gap
would merge the two panes rather than separate them. The shell stays
full-bleed and square; the pane divider stays. Radius is for floating surfaces
only. Do not re-derive this.

### Before that — 전일종가 cutoff + full curve + 구성 금리 panel (2026-08-05)

Three owner feedbacks in one pass [OWNER, 2026-08-05], each confirmed by
choice before building:

1. **전일종가 rule (DESIGN §18).** A today-dated xlsx row is the add-in's
   LIVE quotes, not a close — `load_dataset` now drops rows dated on/after
   the current Seoul date (tz-database KST; `today` injectable for tests).
   asof = the last COMPLETED close always (on 8/5 the screen reads 8/4, 어제
   reads 8/3). Freshness semantics moved with it: age = missing closes —
   `business_days_between(asof, today−1)` server-side, ladder compared
   strictly-before-today in freshness.ts (Monday on a Friday close is
   `current`). **Cache keys carry the effective asof** (`data_hash(path,
   asof)`, SCHEMA v6→7): same bytes re-read after midnight are a DIFFERENT
   dataset, and a bytes-only key would serve yesterday's payloads as
   today's. Static tree rebuilt: asof 2026-08-04, 2615 obs (the 8/5
   intraday row dropped). refresh.ps1 needed nothing — it reads asof
   through the loader.
2. **IRS 커브 3M~10Y 빠짐없이 (DESIGN §2 right pane).** `CURVE_NODES` in
   CurveView is now all 14 nodes (3M=CD91, …, 4Y, 6Y–9Y included); labels
   all print at ≥32px/node track spacing. The spread/fly universe
   (`DISPLAY_TENORS`) deliberately untouched [OWNER choice — 커브 화면만].
3a. **Component line in the position row (DESIGN §backtest) [재피드백,
   same day: "실행 위에 진입 레벨만 나오는게 아니라 각각 나와줘야"].** A
   second line under each row's fields: every leg's own rate at the struck
   day + CD 91일 + 기준금리, pre-run, live as the date is typed. Fixed
   hook slots (3 legs + CD) in PositionRow; `policyRateOn` (exported) =
   step lookup, never past `through`. Outright rows carry references only.
3. **구성 금리 panel (DESIGN §backtest).** `ui/LinkedLegsChart.tsx` — the
   linked stack's third member between the instrument chart and the P&L:
   each leg's par rate + CD + 기준금리, all %, one axis, for a derived sole
   instrument (≥2 legs, all loaded). Same pts/CHART_PAD/x-formula, one
   crosshair by date across all THREE panels; legs are ink, graded opacity,
   named at the right end (labels nudged apart + inset 32px clear of the %
   axis column — the collision was caught live). References via the shared
   policyLine helpers + ref tokens — a sanctioned second reference surface,
   recorded in the guard.

**Close-button fix, same day** [owner report: "창을 닫는 버튼이 작동을 안
해요" — intermittent]: AnimatedNumber's nested `AnimatePresence
mode="popLayout"` blocked the WINDOW's exit removal whenever a cross-fade
was in flight at close — the window faded to opacity 0 and stayed mounted,
invisibly eating clicks. Fixed at root (default presence mode; the copies
are absolute so popLayout bought nothing) + belt (window exit ends in
`transitionEnd: {display: "none"}`); both pinned in backtest-context.
Reproduced and verified via in-page synthetic pointer sequences (run→hover→
close and quick-close-while-loading — the Chrome extension's CDP input
delivery died mid-session, so physical tool clicks were unusable; DESIGN
§14 records the ban).

Guards: `backtest-context.test.ts` gained the 구성 금리 describe (legs +
references render, outright → no panel, three-way crosshair x parity, ink
legs) and re-anchored its one-implementation pins; `freshness.test.ts` and
`test_staleness.py` rewritten to missing-closes semantics; 전일종가 loader
cases in `test_dataset_validation.py` (fixtures now end YESTERDAY by
default); agreement test pins `asof < today` and hashes with the loaded
asof. Verified live (:3100): header 2026-08-04 기준 / freshness current;
14-node curve with 기준금리 hairline; 6M/9M/1Y fly → three-panel stack, one
crosshair, readout 6M 1.4250 / 9M 1.5450 / 1Y 1.6750 / CD 1.2800 / 기준금리
1.0000 at 2022-01-10 (all plausible for that date). Gotcha: a stale :3100
dev server held the port (EADDRINUSE) — kill it like the stale :8100.

### Before that — the backtest prices the entry before 실행 (2026-08-04, backtest-context session)

Two owner feedbacks, one mechanism [OWNER: ① 싱글/개별 백테스트에서는 "원래
그래프랑 CD, Base Rate가 함께 그려져서 추적할 수 있는 거 처럼"; ② "진입
레벨이 실행 전에도 보여야"]. Both read the instrument's own series file
(static tree — no live backend needed; "it does not run on its own" holds).

- **진입 레벨 readout** in every position row, beside 진입일, live as the
  date is typed: `pointOnOrAfter` (exported from BacktestWindow) = the
  server's on-or-after snap (`_index_on_or_after` in `_span_of`), printed via
  `entryLevelText`; em dash while loading / past data end; title names the
  struck business day. Series fetched FULL resolution under PreviewPane's
  query key (`["series", id, "full"]` — cache hit off the pane; preview
  resolution would snap ~3.5 weeks off).
- **Context chart** (`BookContextChart` in BacktestWindow.tsx): when the book
  is ONE instrument (any number of rows), the window draws the instrument's
  own line ABOVE the result, pre-run too — literally `PreviewChart`
  (references, bp/% dual axis, zoom, tooltip, extremes from the one
  renderer), sliced with a lead-in of max(20bd, 25% of tested span) before
  the earliest entry. Multi-instrument book → no chart (the P&L line stays
  the book's only chart). `policy` now flows into BacktestWindow from App.
- **`ChartMark`** on PreviewChart (new optional prop): dashed ink vertical at
  the snapped date; `level: true` adds a dot ON the line + level hairline +
  the value in the label (진입 marks; 청산 = date only). Level is read from
  the plotted points, never passed in; marks outside the visible slice draw
  nothing; marks never move the y-domain (guarded byte-identical).
- Guard: `guards/backtest-context.test.ts` (snap parity incl. holiday-snaps-
  FORWARD, pre-run readout renders, marks render/skip/don't-move-the-chart,
  source pins: one renderer + one CD hook + full-resolution key). DESIGN
  §backtest gained "THE ENTRY IS PRICED BEFORE 실행".
- Verified live (:3100): 10Y pre-run readout 3.1650% == post-run server
  entryValue; 3s10s dual-axis chart with −5.0bp readout; 청산일 → 청산 mark;
  second instrument added → chart hides; run result renders below the chart.
- **Second pass** shipped an overlaid P&L; **third pass replaced it same day
  [OWNER 재피드백: "겹치는 거보다 PL은 밑에 그려지되 … far left가 진입일,
  far right가 청산일 … 완전히 수직적으로 얼라인 … 위에는 기존 그래프의
  정보가, 밑에는 PL의 당일 변화량 및 누적 PL"]** → the LINKED PAIR: after a
  matching run the context chart windows to exactly [result.from, result.to]
  and goes `still` (new PreviewChart prop — no wheel zoom while linked);
  `LinkedPnlChart` (exported from BacktestWindow.tsx) draws the P&L directly
  below, pixel-aligned by construction (same pts slice + shared `CHART_PAD`,
  now exported from PreviewChart + same index→x formula); ONE crosshair
  drives both via the shared parent (`hoverDate` prop on PreviewChart for
  the external date; both crosshair lines carry `data-crosshair`, and the
  guard pins byte-equal x for one date). Bottom card = server 누적/당일
  (fmtKrw). Result's standalone PnlChart drops when `chartLinked` (renamed
  from chartOverlaid; same every-position stale gate). `ChartOverlay` was
  DELETED from PreviewChart — the marks (`ChartMark`) stay.
- **Lighten pass [OWNER, 2026-08-05: "말들을 좀 더 가볍게 하고 전반적인
  UI를 다듬는걸"]**: window copy trimmed by cutting words, register kept
  합니다체 (rule recorded in DESIGN §15 "Lighter, not softer") — 손익 구성
  explainer and the fold's mechanics paragraph now one sentence per fact
  (`A = B` fragments), controls hint and 백엔드-필요 panel shortened, fold
  title 다리별 구성·정산. UI: chart marks print the label WITHOUT digits
  (the value collided with the 최고 extreme in the shared top band; the
  figure lives in the readouts, dot + level hairline carry it on-chart —
  guard updated), LinkedPnlChart gained a 누적 손익 caption (an unlabelled
  second chart read as a mystery). `조건을 정하고…` kept as-is (pinned by
  backtest-back, already light).
- **Motion pass [OWNER, 2026-08-05: "임페커블 활용해서 모션을 더 추가"]**:
  DESIGN §14 "Backtest window motion". `ARRIVE`/`ARRIVE_STAGGER` in
  motion.ts — the answer arrives (P&L panel + result fade/rise 8px 250ms
  ease-out quint, money 60ms after the chart, keyed by run identity);
  window entrance gains scale 0.985→1; book rows stagger IN only (index
  keys — an exit would fade the wrong row); 진입 레벨 through
  AnimatedNumber; 계산 중 = motion-safe:animate-pulse. Chart-geometry ban
  intact (containers move, paths never). Every authored transition routes
  through instant() — new pin in backtest-context guard (count of
  `transition={` === count of `transition={instant(`). Two old
  backtest-window pins retuned without losing intent: backdrop check is now
  `fixed inset-0` (bare inset-0 appears in AnimatedNumber's cross-fade
  span), and the reduced-motion pin checks the instant() ROUTE rather than
  the transition's exact shape.

### Before that — 연구실 tab + 라고 할 때 살걸 (2026-08-04, regret session, two passes)

New FAR-RIGHT tab **연구실** — the incubation surface [OWNER: experiments
enter at the right edge, graduate LEFTWARD on trader feedback]. First
resident: **라고 할 때 살걸** — each 주요-instrument log line of the last 20
business days, priced as if followed: direction = sign of deltaBp, entry at
the NEXT business day's close, flat 100억, valued to as-of by the backtest's
own `_run_one`. Signed answers stay signed. (Pass 1 shipped it inside the
change-log popover; the owner moved it out the same day — "변화 칸이 아니라,
그냥 하나 따로 빼보기" — and restricted it to 주요: "대표적인 아웃라이트,
스프레드, 버터플라이만".)

- BE: `events.replay_leading_events` — daily rule re-run on truncated
  history per day, **filtered to `derive.is_key` BEFORE the collapse** (so a
  cluster a non-주요 series would have led falls to its strongest 주요
  member), LEADING member only, 1D excluded; `app/regret.py` — pricing +
  conventions (docstring is the reference); rides in `wall_summary` as
  `regret` → static tree carries it; cached by data hash,
  **SCHEMA_VERSION 5→6** (same xlsx, different cached content — v5 trap).
- FE: `ui/RegretLab.tsx` (연구실 body + `RegretLine`; vocabulary IMPORTED
  from BacktestWindow — `directionLabel` now exported — pinned
  byte-for-byte by `guards/regret-list.test.ts`, which also pins 연구실 as
  the LAST tab); `TabId = Group | "all" | "lab"` in InstrumentTable, lab
  branch in the shared shell (sort/screeners/dividers hidden), right pane
  keeps the idle curve; ChangeLog reverted to events-only.
- Tests: `tests/test_regret.py` (per-series rule-identity on a truncated
  dataset — cluster LEADERS may differ from the full log after the 주요
  filter, so the reference is the daily FIRING membership; P&L ==
  run_backtest to the won; window/exclusion/주요 properties);
  `guards/overview-and-divider.test.ts` tab-set pin now includes `lab`.
- Gotchas: the replay range is business-day INDEX arithmetic — the first
  version quietly replayed 21 days, caught only by the window-property
  test; a **stale :8100 uvicorn** made `test_static_agreement` fail (live
  summary lacked `regret`) — restart it after any payload change.
- [TBD — owner]: 20-day lookback, flat 100억, graduation criteria for
  연구실 residents, and whether a 살걸 line may seed the backtest window
  (second entrance beside the chart-click rule). See DESIGN §12 연구실 +
  "라고 할 때 살걸".

### Before that — the pane chart zooms in place; the references get their hues (2026-08-04, later)

Two owner asks in one pass. **Zoom** [OWNER: "크게보기 버튼을 안 눌러도 이
창에서 그냥 확대하고 축소하고"]: the preview/pane chart zooms with the wheel
(anchored at the cursor), pans by drag, resets via `전체 기간` or by zooming
all the way out. `ui/chartZoom.ts` = the pure range arithmetic (null = full
span, MIN_SPAN 10); the component just slices `points` — extremes, y-domain,
overlays, date labels and crosshair were already slice-pure (pass O) and
follow for free. Wheel listener is NATIVE non-passive (React's root wheel is
passive; preventDefault there is a no-op); a drag >3px suppresses the click
that follows so a pan never opens the backtest; a clean click still does.
**Color** [OWNER: "CD랑 기준금리에 톤 안 깨면서 색" — asked 08-03, lost when
that session died uncommitted; REVISED same day: "회색 실선 / 빨간색인데
투명도 좀 올려서 실선"]: `--bw-ref-cd` grey (light `#6b7280` / dark
`#9ca3af`), `--bw-ref-policy` red = the up-red's values (light `#d92d3c` /
dark `#f16e77`) at stroke-opacity ~0.35, BOTH SOLID — the dash encoding was
retired by that instruction; used on the CD/기준금리 reference lines +
legend ONLY; both clear 3:1 per theme (band-hue-contrast extended). Canvas
gets the translucency via `withAlpha` (bridge). Wired everywhere the
references draw: PreviewChart (SVG classes), CurveView's 기준금리 hairline,
DetailChart (canvas via new `resolveRefCd`/`resolveRefPolicy` in the theme
bridge). This is a SANCTIONED palette extension recorded in DESIGN §Color —
orange/navy stay banned (`palette.test.ts` header updated). New guard
`chart-zoom.test.ts` (range arithmetic + wiring pins + ref-token usage).
Verified live: wheel zoom both directions, drag pan (no backtest opened),
전체 기간 reset, clean click still opens the backtest, both themes.

### Before that — the backtest is a floating window; the enlarged view returns (2026-08-04)

The modal backtest sheet became a draggable floating window:
`ui/BacktestWindow.tsx` (renamed from BacktestSheet), geometry in
`ui/floatingWindow.ts` — ONE instance (presence IS the `bt` URL param),
header-only drag with pointer capture, no resize / no minimize,
session-remembered position clamped so the handle never leaves the viewport,
opaque surface + `border-edge-live` hairline (no shadow, no backdrop),
`Z_WINDOW` (z-45) above chrome / below modals. The app underneath stays fully
interactive. The URL split into orthogonal namespaces (`ui/urlState.ts`):
`bt`/`bti`/`btf` for the window, `tile`/`type` for the enlarged view; every
write goes through `mergeQuery` (patches only its own keys), and window
open/close REPLACE the history entry so back/forward walk tab/tile state
UNDER the window — the structural fix for the back-wipes-the-popup family
(pass Q's nonce + session memory still restore contents; its close-is-back
rule moved to the enlarged view, which pushes). Freeing `?tile=` brought
**`EnlargedView` + `wall/DetailChart` back LIVE** — entered by the pane
header's 크게 보기 (chart click still = backtest [OWNER]) — so the
visible-range 최고/최저 built dark the day before now render, with the
선/주봉/월봉 selector riding `type` in the URL. bp instruments draw no CD
overlay there until DetailChart grows a second price scale [TBD]. Guards:
new `backtest-window.test.ts` (namespace orthogonality, clamp geometry,
opaque/no-dim markup, single instance, session-only position);
`backtest-back.test.ts` rewritten to replace-never-push;
`failure-visible`/`krw-additivity`/`readout-parity` re-anchored. Verified
live in Chrome: open→실행→drag→크게 보기 over the window→Esc→window intact
as dragged→close clears only `bt*`. Gates both modes: BE **234 passed / 21
skipped**, FE **504 passed / 1 skipped**, lint 0, build 0, agreement
**20/20**.

### Before that — visible-range 최고/최저 in the dormant zoom chart (2026-08-03)

Owner-directed follow-through of Provisional pass O's reserved extension:
`wall/DetailChart.tsx` (then unreferenced — re-wired LIVE the next session,
see Latest) now recomputes 최고/최저 marks from the
visible logical range on every zoom/pan. Pure scan in `ui/extremes.ts`
(`extremeMarks` + `lineSpans`/`candleSpans`: closes in line mode, wick
high/low in candle mode — the same data autoscale reads, so marks agree
with the picture by construction; range convention = the tooltip stats'
ceil/floor, so mark and 구간 최고 cannot disagree). Rendered via the
library's `createSeriesMarkers` primitive, wired into the ONE existing
`subscribeVisibleLogicalRangeChange` pipeline, rAF-throttled; tie rule =
MOST RECENT [OWNER task] — deliberately diverging from the preview's
first-occurrence rule, both stated; flat window = one bare ink mark.
`guards/visible-extremes.test.ts` pins scan, parity-with-slice, wiring.
DESIGN `## Provisional` has the entry. FE **489 passed / 1 skipped
(39 files)**, lint 0, build 0; backend untouched.

### Before that — table column alignment audit (2026-08-03, HEAD `c2eb62e`)

An owner report of header/number right-edge misalignment across the tabs did
NOT reproduce: measured 0.00px on every tab (sorted and unsorted) and the
overview, computed templates byte-identical — the visible effect is sub-pixel
glyph side bearing amplified by screenshot downscaling. Full evidence and
method in `docs/diagnostics/table-column-alignment.md`. What the audit DID
find and fix (`c2eb62e`): `OverviewColumns` had `text-[13px]` on its two
ch-track grid containers (the 63.3-vs-70.4 drift pattern, latent because the
value matched the inherited size) — moved to the wrapper both grids inherit
from, and `guards/table-grid.test.ts` gained a rendered-markup describe that
asserts one outer template per surface AND bans font-size utilities on any
element carrying a ch-derived `grid-template-columns` style (verified red on
the pre-fix code). Ladder thresholds unchanged. FE **472 passed / 1 skipped
(38 files)**, lint 0, build 0; backend untouched.

### Before that — the V-PASS (backtest validation, 2026-08-03, HEAD after V6)

Six phases, committed per phase, gated both modes each time. Everything is
recorded in `docs/STATE.md` (the validated/unvalidated boundary moved) and
`docs/DESIGN.md ## Provisional` (V5's two in-pass decisions). Headlines:
**forward-realization neutrality 0.0158bp of notional** (1Y held to
maturity on its own implied path); frozen-curve theta smooth at −0.066bp/
calendar-day with roll-down asserted INSIDE 평가손익; path additivity with
the cash partition exact at every payment/fixing-date cut; 3Mx3M's ten
served-0.0% dates fixed at the derivation layer (`curve_prices_span`, in
all THREE paths — the static fast path had silently diverged from the fixed
lazy path and the agreement sample couldn't see it; 3Mx3M now IS in the
sample). SCHEMA v4 → 5, tree rebuilt. Same-day backtests return exact zero
instead of 422; forwards are OUT of the backtest dropdown (the engine
refuses every 'x' id — real forward legs are an owner decision, see
Provisional). ⚠ origin push still owner's: `git push origin main`.


### Latest — passes M–Q batch 2 (2026-08-03, HEAD `406d163`)

Gates after every pass, both modes: BE **214 passed / 19 skipped / 1
xfailed**, FE **458 passed / 1 skipped (37 files)**, lint 0, build 0,
agreement 18/18. One commit per pass, each mirrored to D:. **origin pushes
after `5be9717` were blocked by the session's permission layer — run
`git push origin main` to deploy** (Vercel currently builds the data-refresh
commit; everything since is frontend-only and safe to ship together).

**A data refresh rode in first (`5be9717`, via `scripts/refresh.ps1 -Yes` —
its first real non-noop run, clean).** 2026-07-30 → **2026-08-03** (2614
observations). ⚠ The refresh REVISED history: 07-30's closes changed (3Y
3.8625→3.8925, 10Y 4.135→4.1525), which broke a backtest test twice over —
its parallel-window premise floated on exit=None AND the pinned window
stopped being parallel. Repinned on 2025-08-14 → 2026-07-24 (spread 24.5bp
at both ends, 10Y +167bp), both edges strictly inside the data (`410cfd8`).
Same family as the dv01-percentage gotcha: a data premise must be fixed
dates, never the file's last row.

The five passes (letters collide with the 2026-07-29 M/N — different work):

1. **M `187389d` — CD + base rate on spread/butterfly charts, dual axis.**
   `policyAxisMode(unit)`: % shared (unchanged), **bp secondary** (references
   keep their OWN % scale; both axes carry unit-suffixed `fmtAxis` ticks),
   ratio none. The instrument's bp path is byte-identical with the overlay
   on/off. `fmtAxis` moved to lib/format.ts (one axis grammar; CurveView
   delegates). The dead DetailChart is pinned to shared-only with a ⚠ (one
   price scale — widening its gate without a second scale puts % on a bp
   axis). Guard `policy-dual-axis.test.ts` derives its kind list from
   buildRows over the committed payloads.
2. **N `fcf9a3c` — the 52주 position track (위치).** Fourth sub-track right
   of 평균: low→high hairline + 2×12px ink marker at `(now−low)/(high−low)`,
   clamped, from the SAME `rangeValues` the numbers print (markerPct). Own
   ladder rung, FIRST to drop: **위치 671** content-px at ch 7.7431 (52주
   stays 600); the slider-only-hidden note rides the range header's filler.
   **Chips untouched** — the track is a RANGE position, the chips read the
   RANK percentile `pct`; the divergence (forwards show markers but can
   never chip; skewed years split the two statistics) is an OWNER DECISION,
   documented in DESIGN ## Provisional (pass N) with three options.
3. **O `c854aeb` — visible-window extremes + background grid** on the pane
   chart (THE detail chart now; the zoomable DetailChart is unreachable —
   choice recorded in Provisional pass O). `ui/extremes.ts::windowExtremes`,
   same scan as the y-domain; ties = first occurrence; flat window = marks
   coincide. Cost on 10Y full (2,614 pts): 4.4µs vs the ~0.97ms per-hover
   render. Grid = `stroke-edge` hairline (ink 12%/18%), horizontals at
   quarter lines, verticals on the date labels; verified both themes. The
   sanctioned exception to S14's no-vertical-gridlines default.
4. **P `ae20740` — entry level + par rate on the backtest entry row.** BOTH
   were already in the payload, computed once at backtest time (entryValue =
   quoted level lookup; legs[].entryRate = struck par from the entry-date
   bootstrap) — display-only, no backend change. Levels via `entryLevelText`
   (= fmtLevel; readout-parity pins byte-identity). Par shows only for
   one-swap positions (a package has par PER LEG, in the fold). fmtMove now
   differences DISPLAYED endpoints so `A → B (Δ)` agrees with itself on the
   0.25bp grid.
5. **Q `406d163` — back returns the backtest AS LEFT.** Root cause: close
   pushed a fresh `/` (history filled with popup entries) and the sheet's
   contents were component state. Now: `bt` nonce per open →
   `ui/backtestMemory.ts` (session Map) restores book AND result on any
   traversal (result REMEMBERED, never re-run); close IS `router.back()`
   when the app pushed (cold links replace). A pin present at MOUNT no
   longer counts as a capture (it duplicated the seed and appended a phantom
   row per traversal). Pane caption fixed ("누르면 커서 날짜부터 백테스트가
   열립니다"). Guard `backtest-back.test.ts` — its reproduction was watched
   FAIL RED on the pre-fix sheet before the fix landed.

**Open for the owner (new):** the pass-N chip/track divergence (three options
in Provisional); plus the carried items below.

## 6a. Before that (as of the 2026-07-31 session)

### Latest — the backtest (2026-07-31, HEAD `ab65fda`)

Gates: BE **232 passed / 1 skipped / 1 xfailed**, FE **418 passed / 1 skipped,
lint 0, build 0**. Static tree unchanged since `4e1b35d` (rebuilt and diffed —
only `builtAt` moved).

**A second PORT landed.** `IRS_Trade` into `engine_port.py`, and
`fixings`+`instruments`+`mtm_valuation` merged into `valuation_port.py`, bodies
byte-identical, guarded by `tests/test_valuation_port.py` (which also asserts
`CurveBundle` is the ONLY body in our file absent from the frozen source).
`docs/PORT_PROPOSAL.md` has the full record. The CLAUDE.md guardrail that said
"no portfolio valuation" was lifted by the owner for this.

**`app/backtest.py`** revalues a BOOK of positions daily on each date's own
curve, plus settled cash. Not Δrate × DV01 — that is blind to time passing.
Split into 평가손익 + 캐리손익, which is an identity, not a model.

**Things that only showed up by running numbers, all now guarded:**

- **Sub-year tenors were priced as 1-year swaps.** `VanillaSwap` annotates
  `tenor_years: int` but its body only does `round(tenor_years * 365)` — obeying
  the annotation made 1D/3M/6M/9M all 1Y and 1.5Y a 2Y. Pass the FLOAT.
- **A swap kept running past its maturity.** A 9M from 2020 was reported held
  to 2026. The cap belongs where the position's SPAN is computed, because the
  book's window is built from those spans — capping only inside the per-position
  run made the period column say 만기 while the chart drew past it.
- A maturity on a non-trading day breaks `maturity <= exit_date`; a maturity
  beyond the data clamps to the last row and falsely reads as matured.
- **Carry's sign follows the fixed rate against the CD that actually printed
  over the holding period**, not against CD on any one day. A 2025-07-30 payer
  has carry ≈ 0 because CD started below the struck rate and ended above.
- **"buy the fly" has no market standard** (Clarus and other desks define it
  oppositely; TraditionData says so outright). Directions are named by their
  LEGS. 스티프너/플래트너 IS standard and keeps its name.

**Deployment.** The site is still static and needs no backend — except the
backtest, whose answer depends on reader input. `BACKEND_ORIGIN` (server-side)
drives a Next rewrite so no origin is ever baked into the bundle; unset, the
sheet says a backend is needed. See DEPLOY_CHECKLIST. The owner's own prior
topology (krw-fi-pms: NSSM service + Cloudflare tunnel + rewrite) is the model,
and its 120s-TTFB problem does not apply here (backtest 0.6–3.4s vs simulate's
106–118s).

**Open — CORRECTED 2026-08-06: they are NOT unreferenced.** `EnlargedView` is
rendered by `App` on `?tile=` and reached by the 크게 보기 button in the preview
pane header (`PreviewPane.tsx`); it lazy-loads `DetailChart` through
`next/dynamic`. What is true is that the CHART CLICK opens the backtest instead. Deleting them costs weekly/monthly
candles and the six-basis readout, which the owner has not ruled on. They carry
a ⚠ note. [RESOLVED 2026-08-04: both live again — the backtest moved to a
floating window and `?tile=` returned to the enlarged view.]



### Latest — 전체 as three columns, a butterfly tab, three bases, and the base rate (2026-07-31)

Five owner changes landed together. Gates: BE **177 passed / 19 skipped / 1
xfailed**, FE **vitest 395 passed / 1 skipped (32 files), lint 0, build 0**. Static tree rebuilt:
**1229 files, 39.09 MB raw, 47.4 s**. `SCHEMA_VERSION` **3 → 4** (the forwards
payload's shape and its key set both changed — a v3 cache would have been
served with the old keys still in it).

1. **전체 is no longer a list — it is three columns** (`ui/OverviewColumns.tsx`).
   아웃라이트 · 스프레드 · 포워드 side by side, each showing only its 주요 set,
   each with its own chart underneath, taking the full surface with the side
   preview hidden. See DESIGN § The 전체 overview.
2. **WTD and QTD are deleted app-wide.** Three bases: 어제 · MTD · YTD. The
   ladder's full set now fits **129px earlier** (52주 at 600 content-px, was
   729). `derive.BASIS_KEYS` and `api.ts::BasisKey` are the two definitions.
3. **버터플라이 is its own tab**, split out of 스프레드.
4. **The 주요/전체 divider is on every instrument tab**, generalized from the
   forward tab. The sets are the owner's and live server-side; the browser
   reads a `key` boolean and never re-derives them.
5. **CD 91d and the BOK base rate draw on every %-unit chart, together**
   (`data/bokbaserate.xlsx`, `app/policy.py`, `ui/policyLine.ts`,
   `ui/useCdReference.ts`). See DESIGN § The two reference lines.
   - **The first pass drew only the base rate** and the owner caught it: "왜
     기준금리만 그려지고 CD금리는 안 그려지냐". The reasoning had been that the
     3M node IS CD91 so CD was already on screen where it mattered — true of
     one chart out of twenty. When an instruction names two things, draw two.
   - CD is aligned **by date**, not by position: two previews are downsampled
     per series, so index *i* is a different day in each and a zip would pair
     levels from different weeks. Plausible-looking and wrong.

**Traps this session hit, worth keeping:**

- **`DISPLAY_TENORS` was doing double duty.** Widening it for the 6M/9M
  butterfly silently widened the **변동성 tab** too, because `volatility.py`
  read the same list. Split into `VOL_TENORS` (the original six). Check what
  else reads a list before widening it.
- **`traderName` produced `6Ms9Ms1s`** for `6M-9M-1Y`: it stripped a trailing
  `Y` and appended `s` unconditionally. Sub-year legs now keep their unit and
  join on a slash (`6M/9M/1Y`). This would have shipped looking like a ticker.
- **`ch` is the ZERO advance, not the widest glyph.** The overview's 종목 track
  at 6ch truncated `2s10s` → `2s1…` because the labels are semibold letters.
  Corrected after seeing it on screen — the arithmetic looked fine.
- **The overview's density was wrong on first sight and took a second pass**
  (owner: "글자가 너무 작고 여백이 너무 많아"). 11px → 13px; the level track
  stopped being sized by a header it no longer prints; the charts moved to the
  floor and grew into the leftover. Two traps in that pass:
  - **Sizing a chart from a ResizeObserver on its own parent is a feedback
    loop** — it ran the charts off the bottom of the page. The chart is
    absolutely positioned inside the measured box now, so the child cannot
    influence what it is measured from.
  - **A `python replace` with no assert silently did nothing.** The GRID track
    edit did not apply and the "fixed" gap was still on screen; the guard
    written alongside it is what caught it. Assert every scripted replace —
    and note the second failure mode, which bit later the same session: when
    an assert DOES fire mid-script, every earlier edit in that script is
    rolled back too because nothing was written yet. Re-apply the whole
    script, not just the piece that failed.
  - **Equal-thirds columns put their slack between the columns**, which is the
    one place on the screen with nothing in it.
  - **Three charts growing independently into their own leftover** filled the
    space but produced three sizes (307/372/437) and made the curve the
    subject of a tab about numbers.
- **The page gutter is 80px now, app-wide** (`ui/pageGutter.ts`) — header, tab
  strip, table, preview pane, bottom strip. It was 20px, which is a card's
  inset on a full-bleed surface. Two things to know: it must be a LITERAL
  Tailwind class (a runtime-built `pr-20` is never generated and the padding
  silently vanishes), and the 전체 tab deliberately takes NO gutter because its
  `justify-evenly` already supplies equal outer and inner gaps — padding would
  land on the outer two only.
- **The overview's grid was a FORK, and forking it was the root mistake.** It
  shipped with its own eight-track template at its own type size, and over four
  passes that second definition drifted every time: a level track sized by a
  header it did not print, then labels clipped at 6ch, 6.5ch and 7ch because
  `ch` is the ZERO advance and `M` is far wider than a digit, then a type size
  that had to be re-picked twice. It now renders `gridTemplate(ALL_COLUMNS)`
  and `RangeCells` — the instrument table's own — at 13px, and every one of
  those defects is structurally gone. **If the overview needs a column the
  table lacks, change `columns.ts`; do not re-fork.** Placement is
  `max-content` + `justify-between` (left / centre / right) and the chart is a
  fixed 200px, which also makes "three charts, one height" true by
  construction rather than by measurement.
- **`guards/pane-still.test.ts` banned `strokeDasharray`** as a proxy for the
  removed ghost curve's draw-on animation. That is the wrong proxy: a dash
  PATTERN is static. Narrowed to `strokeDashoffset`, which is what actually
  animates a dash.
- **The base-rate carry is bounded and the bound is the whole feature.** If a
  Board meeting falls between `bokbaserate.xlsx`'s last date and the dataset's
  as-of, the step ENDS at the workbook's date rather than carrying an
  unverified rate. `through` in the payload is that bound — **it is not the
  chart's axis end**, and running the line to the axis end silently undoes it
  on every chart at once.
- **The two workbooks are refreshed separately and by hand.** `refresh.ps1`
  does not touch `bokbaserate.xlsx`. As of this session it lags: base rate to
  **2026-07-16**, IRS to **2026-07-30** — safe only because the Board's last
  meeting was 07-16 and the next is 08-27. **After 2026-08-27 the step will
  truncate and warn until the workbook is refreshed.**

**Payload cost of the wider tenor set:** derived series 35 → 84 (spreads 15→28,
flies 20→56), so `summary.json` went **17,580 → 30,885 bytes raw** (+76%;
gzip is what ships). Series files 196 → 245. The combinatorics are quadratic
and cubic in `DISPLAY_TENORS` — do not widen it casually.

### Before that — data refresh to 2026-07-30, and the gate's one data-dependent test

- **The dataset now runs to 2026-07-30** (2612 observations, +4 business days:
  07-27/28/29/30). Static tree rebuilt: 984 files, 31.52 MB raw, 28.7 s,
  integrity 983 declared / 984 on disk / 0 problems. `SCHEMA_VERSION` stayed 3 —
  no payload shape changed, so no bump.
- **Freshness is `current` again**, so the red 지연 chip is gone and the level
  header reads today's date. Screenshots in this file from earlier passes show
  the stale chip; that was the 07-24 file, not a defect.
- **A backend test failed on the new data, and it was the TEST that was wrong.**
  `test_dv01.py::test_fly_weights_are_dv01_neutral` divided the shipped residual
  by the BELLY's gross DV01 and demanded <1%. But the residual is exactly the
  wings' integer rounding priced at their own DV01s, and `1Y-2Y-10Y`'s long wing
  needs ~11.7 units at a 10Y DV01 four times the belly's — half a unit of
  rounding there is 2.1% of the belly gross on its own. It passed at 0.880% on
  the 07-24 curve and failed at 1.111% on 07-30 with nothing but the data
  moving, while the same trade passed the table-wide test at 0.261% because that
  one divides by the largest leg. Two tests, one trade, two denominators.
  - **Now asserted structurally**: `|residual| ≤ ½ · Σ d` over the rounded legs,
    which holds at every curve, plus a line asserting the notionals are integers
    (the assumption that makes the bound half a unit). Verified across all 50
    derived payloads on BOTH datasets — the worst case sits at 97.9% (old) and
    99.2% (new) of the bound, i.e. the bound is tight, which is why any
    percentage picked by hand was going to expire.
  - **If you ever ship non-integer notionals**, the integer assertion is the
    line that will tell you the bound must become `½ · 10⁻ᵈ · Σ d`.
- **`~$*.xls*` is now gitignored.** Excel's lock file was sitting untracked in
  `data/` during the refresh and `git add -A` would have committed it. **It is
  HIDDEN**, so `ls`, `dir` and Explorer all report `data/` clean while it sits
  there — check with `ls -la` / `Get-ChildItem -Force`. This cost a wrong
  statement in-session: the folder was declared clean off a plain `ls`.
- **`scripts/refresh.ps1` is the morning routine** — the owner asked whether
  "open the workbook, save, close" is the whole job; it is step 1 of 3, and this
  is 2 and 3. It refuses while the lock file exists, refuses to commit unless
  the xlsx's `asof` **advanced** (holiday / no-recalculation / already-run all
  land there), checks the rebuilt manifest against the file it was built from,
  runs the 18 agreement tests against a backend started from that tree, prints
  the diff, then asks y/n before commit → mirror → push. `-FullGate`, `-Yes`,
  `-NoPush`, `-Force`.
  - Its mode-2 mechanism is lifted from `gate.ps1` deliberately (start uvicorn,
    wait on the port, `finally` stop it) rather than reinvented.
  - **Only the no-op path has been exercised end to end** — there was no new
    data left to refresh the day it was written. The rebuild / agreement /
    commit branches are the same commands run by hand that morning, and the
    file parses clean, but the first real run will be its first real test.
  - Excel rewrites the xlsx on open even when no value changes (measured
    775,811 → 775,934 bytes at an identical 2612 observations), so `git status`
    shows it modified after any peek. The script says so instead of committing
    byte churn.
- **Gates after the refresh**: see the numbers in the commit for the refresh
  itself; the two-mode gate was run to green before it landed.

### Before that — pass N: the curve got the history line's readout

One owner ask: hovering the IRS curve should say what hovering an outright's
time series says. Frontend only, no payload change — every number it shows was
already in the summary row.

- **Hovering a curve node** draws a crosshair + a fattened dot and floats a
  card: **만기 · 레벨 · 52주 최고 · 52주 최저 · 52주 평균 · 당일 변화**. That is
  `PREVIEW_READOUTS` with the **tenor where the date is**.
- **`ui/ReadoutCard.tsx` is new and is THE card** — `ReadoutCard` /
  `ReadoutLevel` / `ReadoutChange` + `READOUT_LABEL`. `PreviewChart` was
  refactored onto it in the same pass, so the two tooltips are one component;
  its tooltip markup and its `Line` helper are gone. Levels print through
  `fmtLevel`, the change through `fmtDelta` + `dirClass`, and there is **no
  `toFixed` in the card**. Same reasoning as `ui/cells.ts` for the table's two
  level cells: two call sites of one quantity must be one function.
- **§16 held**: the card reads `deltas.d1` and `range1y.max/min/avg` off the
  summary row — the same fields the table's 어제 and 52주 columns print, so the
  curve and the table cannot disagree about a node. **Do not difference
  `now − prev` in the browser** to save a field; the guard fails on it and it
  would also disagree with the table at the displayed precision.
- **The two y-axis gridline labels keep their coarser 2dp** (`axisLabel`, the
  only rounding left in `CurveView`). They are orientation marks; `4.2446` in
  that role reads as data. Deliberate, not an oversight.
- **`CURVE_READOUTS`** joins the registry in `ui/readouts.ts`, and
  `guards/readout-parity.test.ts` now pins it against the preview's set: they
  may differ **only** in `date` ↔ `tenor`. It also fails if either surface stops
  using the shared card or hardcodes a label.
- **Verified live** against the payload, not just on screen: hovering 1.5Y
  printed 3.7500 / 3.8750 / 2.3200 / 3.0155 / +4.0 and
  `/api/wall/summary` gives `now 3.75`, `range1y {min 2.32, max 3.875, avg
  3.0155}`, `deltas.d1 4.0`. 10Y printed 4.2675 / +5.0, matching the bottom
  strip's `10Y 4.2675 +5.0`. The card clamps inside the pane at the 10Y edge.
- **Gates**: FE 361 passed / 1 skipped, lint 0, build 0.

### Before that — pass M: one idle curve, and the level header is a date

Two owner asks, both about what a surface CLAIMS. No new data, no backend
change; the whole pass is in five frontend files, two guards and DESIGN.

- **The idle right pane is the IRS par curve on every tab** [OWNER]. It used to
  dispatch on the tab — the 1YF ladder on forwards, the two-point-spread curve
  on spreads, the relative-ATR curve on volatility. Those three restated
  columns the table already prints, in a shape that takes longer to read, and
  they kept the IRS curve — the product's whole subject — off three of five
  tabs. `CurveView` no longer takes `tab` / `forwards` / `volatility`; it takes
  the summary, and draws `parNodes`.
- **`VolatilityPayload.curve` is now served and rendered by nothing.** Left in
  place on purpose (it is a backend payload field with static-tree tests
  behind it), and listed under "Open" so it is a decision rather than a
  leftover. **Do not delete it without also rebuilding the static tree** — that
  is a `SCHEMA_VERSION` bump, not a component edit.
- **The level column's header is the data's date, not the word 현재** [OWNER].
  `2026-07-24`, from the payload's `asof`, via `lib/format.ts::levelHeadText`
  — shared by the table header, the 주요 포워드 block, and the idle curve's
  legend (`2026-07-24 · 어제`). The word named the quantity and not the day, and
  these are closes: on any day the xlsx has not been rebuilt, 현재 asserted a
  currency the numbers did not have. **The date is the DATASET's, never
  `new Date()`** — a header off the reader's clock would print today over last
  Friday's closes and contradict the freshness chip sitting inches away. Pinned:
  `guards/label-quantity.test.ts` fails on a rendered 현재 or a clock call in
  any of the three surfaces.
- **The level column is now sized by its HEADER** — ten glyphs of ISO date
  (`WIDEST.levelHead`), not the six a value needs — the one column whose width
  comes from its label. `LEVEL_GLYPHS` is that max; the 52주 sub-columns
  deliberately still derive from `WIDEST.level`, since letting the date's width
  leak into them would widen three columns to fit a header they do not carry.
  **Every drop threshold moved +31px** at the measured ch: 52주 729 · QTD 518 ·
  MTD 453 · WTD 389 · YTD 324 · 어제 260 · 종목+레벨 196. Ladder order
  untouched, and 729 still fits the 840px table pane.
- **Gates**: FE 357 passed / 1 skipped, lint 0, build 0 (TypeScript clean).
  Backend untouched, so its suite was not re-run in this pass.
- **Verified live** (dev server + live backend on :8100): the header reads
  `2026-07-24` above the levels with no clipping, the 주요 포워드 block carries
  the same header (its cell widened 74 → 104px), and the 포워드 tab's idle pane
  now draws the IRS curve where the 1YF ladder used to be.

### Before that — pass L: 52-week high/low/mean replaced the 한 줄 column

One pass, one commit. The last table column kept its slot, its width behaviour
and its role as the elastic column; only its contents changed, from a dynamic
Korean sentence to three numbers.

- **Deleted**: the `한 줄` column, its four-rung ladder
  (`classify_one_liner` / `apply_level_extreme` / `apply_solo_direction` and
  the `MOVE_PCT_CUT` / `LEVEL_BAND` / `LEVEL_CAP` / `SOLO_MIN_BP` thresholds),
  the `oneLiner` field on every payload row, `OneLiner`/`OneLinerKind`,
  `renderOneLiner`, and the one-liner fragment in the preview pane's header.
  The `일간 변동 상위 N%` outlier signal went with it — it was the column's
  only frequent occupant.
- **Deliberately kept, because the one-liner was only one consumer**: `movePct`
  / `day_move_pct` (the tint DENSITY scale + the 오늘 많이 움직인 것 chip),
  `range1y` (고점권/저점권 chips, tooltip stats, key-forward gauge, curve
  banner, and now the column), and the backend `kind`/legs classification
  (`ui/gloss.ts` → popup description + Pay/Receive mode diagram). **Deleting a
  consumer and leaving its feed behind** is what left a 150-point sparkline at
  92% of the payload; the reverse mistake was the one to avoid here.
- **New**: forward GRID cells gained `range1y` (`{min, max, avg}` — no `pct`,
  see Provisional). `_cell_move_pct` + `_level_range` became one repricing pass
  (`_cell_history`), so this is strictly LESS backend work than before and the
  outputs are byte-identical (verified: 0 differences across 168 cells'
  `movePct`/`values`/`deltas`, and the 6 keyForward `range1y` records).
- **Payload, measured before and after** (committed static tree, raw bytes):
  summary 19,756 → **17,747**; forwards 50,209 → **51,745**; volatility
  2,654 → **2,414**. Stage-1 total 72,619 → **71,906** — it went DOWN by 713
  bytes, not up. The ~3× growth the pass anticipated did not happen because the
  52-week stats were already in stage-1 for 56 of the 196 listed rows, and the
  `oneLiner` object cost about what `range1y` costs. gzip: summary
  3,506 → 3,430, forwards 7,121 → 8,368.
- **Ladder thresholds recomputed** (the 606 figure was stale the moment the
  cell's contents changed): at the live-measured ch = 7.7431 the fixed-width
  sum is now **698px** (was 607) — the last column's floor went from a flat
  120px sentence floor to three sub-columns (211px), so the table needs ~92px
  MORE room, not less. Every narrower threshold is unchanged: QTD 487 ·
  MTD 422 · WTD 358 · YTD 293 · 어제 229 · 종목+현재 165. **Verified live**:
  present at 702px of content, dropped at 698px with "1열 숨김" in its slot.
- **A defect the live check caught, which no test would have.** The header's
  `text-[11px]` sat on the GRID CONTAINER. `RANGE_TEMPLATE` is written in
  `ch`, which resolves against the element's OWN font size — so the header
  grid's tracks came out 63.3px against the body's 70.4px and every sub-label
  sat left of the numbers it named (7px, 14px, 21px). Fixed by sizing the
  spans; `guards/range-column.test.ts` now fails if a sub-grid container
  carries a text size. Also live-verified after the fix: identical 70.45px
  tracks in both grids, 0.00px label-to-number offset, 25 rows sharing one
  right edge per sub-column, one ink colour throughout, and the 52주 header
  with zero interactive descendants leaving all 196 rows in order when
  clicked.
- **`SCHEMA_VERSION` 2 → 3** and the static tree rebuilt. The bump fired
  correctly: `test_static_agreement` went red on the stale tree before the
  rebuild, which is the annual-stats session's gotcha working as designed.
- **§16 re-examined, not left standing.** The exception's most visible subject
  was the 한 줄. DESIGN §16 now names the two that remain (the instrument
  gloss, the curve banner) and says to retire the exception if both ever go.
- **New guard** `guards/range-column.test.ts` (no colour token, no sort
  affordance, a click leaves order unchanged — with a non-vacuous counter-check
  that change columns DO reorder). `readout-parity` extended to byte-identity
  between the 현재 and 52주 render paths across every kind. `wire-format`
  rewritten to the new shape: it fails on `oneLiner` anywhere, and still fails
  on a per-row series under ANY name (keyed on value shape, not field name).

## 6b. Before that — the static conversion (2026-07-29)

- **HEAD** = the static-conversion commit `550349a` on `master`, mirrored to
  D:. Gates: FE **295 passed / 1 skipped**, lint 0, build 0; BE **131 passed /
  19 skipped / 1 xfailed** (the 19 skips are 18 agreement tests that need a
  running backend, plus the parked calendar guard).

### The data ships as static JSON — read this before touching the backend

- **The deployed site has no backend.** `backend/scripts/build_static.py`
  precomputes every response into `frontend/public/api/**` (984 files, ~31 MB,
  ~20 s) and **that tree is committed**. Vercel runs `next build` only.
  DESIGN §21 and `docs/diagnostics/static-feasibility.md` have the reasoning.
- **Refreshing data is now three steps, not one**: replace
  `data/irsdata.xlsx`, run the pipeline, commit **both**. Committing the xlsx
  without rebuilding ships a site that disagrees with its own data file;
  `test_static_agreement.py::test_the_static_tree_is_current_for_this_data_file`
  catches it, but only with a backend running.
- **`backend/app/payloads.py` is the single source of every response body.**
  Both the FastAPI handlers and the pipeline call it. If you add or change an
  endpoint's content, change it there — anywhere else creates two answers.
- **Ids map to filenames through one rule, `:` → `/`** — stated in
  `app/static_paths.py`, mirrored in `lib/staticPaths.ts`, and it **raises**
  rather than guessing. Do not interpolate an id into a path by hand: on NTFS a
  colon silently redirects the write into an alternate data stream (Pass A lost
  24 files that way with a clean exit code).
- **`.gitattributes` pins `frontend/public/api/**` to LF.** This machine has
  `core.autocrlf=true`, which would otherwise rewrite every line on checkout,
  making a rebuild on unchanged data look like ~980 modified files. Verified:
  after a rebuild, `git status` reports exactly one changed file
  (`manifest.json`, whose `builtAt` is meant to change).
- **The FastAPI app is still the reference implementation** for local
  development. Set `NEXT_PUBLIC_API_BASE` in `frontend/.env.local` to use it;
  unset means "read the static files", which is what production does.
- **Deploying is the owner's step**: no git remote exists, and the Vercel
  project needs Root Directory = `frontend`. `docs/DEPLOY_CHECKLIST.md` covers
  what only a deployed site can show — the case-sensitivity sweep especially,
  which fails in production and nowhere else.

### Before that — the stability session (Passes A–F)
- **The stability session ran A–F.** A diagnosed the failure paths
  (`docs/diagnostics/failure-modes.md`); B gave the client visible failure
  (independent error boundaries, `ui/DataState.tsx`, a persistent retryable
  error, `?tile=` self-clearing, `NEXT_PUBLIC_API_BASE`); C made the server
  refuse untrustworthy data at load and recompute a torn cache loudly; D put
  every source-scanning guard on one comment/string stripper
  (`guards/_source.ts`); E measured before optimising
  (`docs/diagnostics/perf-baseline.md` — §20); F closed the two label items.
- **Read `docs/diagnostics/perf-baseline.md` before any performance work.** It
  records what was changed (per-row `spark` deleted, gzip on, chart lazy) AND
  what measured healthy and was deliberately left alone (tab render, heap,
  chart disposal, the four parallel stage-1 requests). Two traps in there:
  the automation tab is **occluded**, so rAF, paint timing and DOM polling all
  lie — use the performance timeline; and gate timings mean nothing unless the
  dev servers are stopped (201s vs 70s for the same suite).
- **Stage 1 carries no series** (§20). A summary row is numbers about an
  instrument, never history — enforced by shape, not just size, in
  `backend/tests/test_wire_format.py`.
- **"Popup-only" ≠ "loaded with the popup"** (§20). lightweight-charts obeyed
  §11 and still shipped in the initial chunk. `guards/lazy-chart.test.ts` pins
  the import edge. Note that guard uses `code()`, not `identifiers()` — a
  module specifier IS a string literal, so the stronger stripper erases the
  very thing being matched.
- **Blue's double duty was re-checked at its worst case and stands** (§9). The
  old revisit trigger is retired, not re-armed; reopen only on evidence of a
  reader misreading a stroke as a direction. `--bw-line` must stay its own
  token (`guards/label-quantity.test.ts`) — same value as `--bw-down` is fine,
  one shared name is not.
- **Carry & roll is GONE** (popup block, `app/carry.py`, its endpoint, FE
  types/fetcher, tests). Two recorded faults: the headline and the breakeven
  printed the same number, and the components did not sum to the total at the
  displayed precision. **If it returns it is a sortable table COLUMN, not a
  popup block** — screening question, so sorting is the point; and with the
  column ladder already tight it would be first to drop in a narrow window.
  **The freed popup space is deliberately empty** — two features have now
  been removed from that spot; do not fill it to balance the layout.
- **The calendar is DISCONNECTED from the UI but KEPT.** `ui/calendar.ts`,
  `data/calendar.json` and `guards/calendar.test.ts` stay, unreferenced by
  design — verified 2026 dates, sources, `verified` filtering, LPR rule. **A
  session reading only the code will see an unused module: do NOT delete
  it.** Removed: the strip's next-event slot, the chart's meeting rules (with
  their density + average-gap thresholds and the transparent-canvas underlay
  that existed only for them), and the `일정 파일 갱신 필요` state.
  **Re-wiring means restoring the strip slot, the chart rules AND the
  staleness guard together.**
- **The staleness gate is PARKED, not disabled.** It skips while
  `ui/calendar.ts` has no importer — computed by a source scan, not
  hard-coded — and the reason prints in the test title beside the skip
  marker. Adding any consumer revives it automatically (proved both ways with
  a throwaway importer).
- **Strip layout without the calendar**: the collapse chevron moved to sit
  with the anchors (it was a lone control ~1,700px from them); the collapsed
  handle keeps its centred grabber pill but the whole 12px bar is the hit
  target.
- Owner-open: real-narrow-window eyeball (carried); vol carry one-liner
  glance is now moot (carry removed); verified PRC holiday dates remain
  relevant only if the calendar is ever re-wired.

### Earlier — calendar session (Passes A–G, 2026-07-28)

- **HEAD** = the calendar-session Pass G commit on `master`, mirrored to D:.
  Gates: FE **191 vitest / 23 files**, lint 0, build 0 (BE untouched,
  79/1s/1xf).
- **The fabricated calendar is gone.** All 182 reconstructed entries were
  DELETED, not repaired (~1 in 8 was on the wrong weekday and there was no way
  to tell which from inside the file). In their place: **32 entries, 2026
  only**, read off the publishing banks and carrying their source — 금통위,
  FOMC, BOJ, ECB, eight each. **Historical entries are not replaced**; nothing
  renders before `CALENDAR_FROM` = 2026-01-01, deliberately.
- **`verified` is load-bearing and structural**: the raw file is reachable
  from one module only (`ui/calendar.ts`), which exports filtered lists — a
  render path cannot obtain an unverified row. Unverified rows do not count
  toward the horizon, so staging a 2027 cannot silence the gate. Guards
  enforce both. Staging IS allowed (the file is a staging area); presence is
  counted, never fatal.
- **PBOC LPR is generated, not listed**: the 20th of the month rolled forward
  to a business day. **`PRC_HOLIDAYS` ships EMPTY** — weekend rolling works,
  holiday rolling does not yet, so an LPR rule can sit a few days early in a
  month whose roll lands on a holiday (**check 2026-02 first, 춘절 is near the
  20th**). LPR draws chart rules only and never counts down.
- **Countdown scope**: 금통위, FOMC, BOJ only. ECB and LPR are rules, never
  the next event.
- **The staleness gate fires on 2026-10-19** (60 days before 2026-12-18). That
  is the design. The failure message and README §"Policy calendar" name the
  four sources and say to READ THE DATES OFF THE SOURCE, never from memory.
- **Defect found and fixed in Pass G**: the meeting-rule density threshold was
  count-only, which assumed events spread across the view; a 2026-only
  calendar bunches 25 rules into ~35px at the right edge of a 10y chart and
  the count passed (25 ≤ 32) while the screen showed a hatch. A minimum
  average-gap test (6px) was added alongside the count.
- Owner-open: real-narrow-window eyeball (carried); vol carry one-liner glance
  (carried); verified PRC holiday dates for `PRC_HOLIDAYS`.

### Earlier — strip session (Passes A–F, 2026-07-28)

- **HEAD** = the strip-session Pass F commit on `master`, mirrored to D:.
  Gates: FE **177 vitest / 23 files**, lint 0, build 0 (BE untouched, 79/1s/1xf).
- Passes (commits in dependency order — D lands before C, which reads it):
  1. **A — the curve gesture is REMOVED** (component, trigger, `ui/gesture.ts`).
     Too small to read at a 10px peak against a 136bp curve, big enough to
     distract; the popup's schematic diagram does the job properly. What
     survives is the pane's corner label (pinned instrument · mode).
     `guards/pane-still.test.ts`. `diagramSpec`/`toBand`/`modeShape` stay.
  2. **B — the carry block speaks the product's register**: label + total,
     breakdown + directional breakeven beneath. `carrySentence` →
     `carryReadout`. Zero components print unsigned.
  3. **D — `src/data/calendar.json`** (182 entries, 2016→2026; 금통위 + FOMC
     only) + `ui/calendar.ts`. **`verified: false` — the dates are a SEED
     reconstructed from the published-schedule pattern; ~23 fail a weekday
     cross-check, so some are wrong. The owner must check them against
     bok.or.kr / federalreserve.gov and flip the flag.** The horizon guard
     catches a file that STOPS, never one that is WRONG.
  4. **C — the bottom strip**: three anchors (10Y / 3s10s / 1Yx1Y) + the next
     meeting, fixed chrome, collapsible+remembered, app root pads by its
     height. No backend change; change shown vs D-1.
  5. **E — meeting rules** on the enlarged chart only, behind the series via a
     transparent canvas + DOM underlay; dropped above 32 in view.
  6. **F — verified** (DESIGN §2 "Verified [strip session, Pass F]").
- **Gotchas this session**: the compiler lint rejects setState-in-effect —
  client-only reads (wall clock, localStorage) go through
  `useSyncExternalStore`. `vitest.config` needed the `@/` alias for the first
  RUNTIME `@/…` import in src. Backticks in a bash-quoted commit message get
  eaten by the shell — use a heredoc (`git commit -F -`).
- Owner-open: verify the calendar dates; real-narrow-window eyeball
  (carried); vol carry one-liner glance (carried).

### Earlier — columns session (Passes A–C, 2026-07-28)

- **HEAD** = the columns-session Pass C commit on `master`, mirrored to D:.
  Gates: FE **141 vitest / 20 files**, lint 0, build 0 (BE untouched).
- **The column priority ladder** (`ui/columns.ts::visibleColumns`): when the
  measured container cannot hold every fixed-width column, columns DROP in
  priority order instead of shrinking — 종목 · 현재 · [sorted, never
  dropped] · 어제 · YTD · WTD · MTD · QTD · 한 줄 (first out, last back).
  Arithmetic against the fixed widths + a runtime-measured ch (probe span +
  fonts.ready re-measure); container via ResizeObserver on the table
  element; displayed columns keep canonical order; header/body share one
  `gridTemplate(visible)`; drops never animate; header states "N열 숨김"
  (names on hover, no picker); overflow-x-auto backstop only below
  종목+현재. Verified live by pane-width sweep — thresholds and ladder
  order recorded in DESIGN §2; sorted-QTD-at-460px keeps QTD ↓ on screen.
- **Environment gotcha (recurring)**: the occluded/emulated renderer
  delivers ResizeObserver callbacks (and rAF) only on FORCED frames — take
  a screenshot between mutating and reading when driving the app remotely.
- Owner-open: single-column narrow eyeball on a real screen (same code
  path), carried over from the carry session.

### Earlier — carry session (Passes A–E, 2026-07-28)

- **HEAD** = the carry-session Pass E commit on `master`, mirrored to D:.
  Gates: BE **79 pass / 1 skip / 1 xfail**, FE **135 vitest / 20 files**,
  lint 0, build 0 — every gate its own command, exit code read directly.
- Passes:
  1. **A — ONx\* dropped from the forward list** (spot curve in a forward's
     name; matrix keeps the ON row as the spot anchor labelled 현물).
     Forward list = 20 starts × 7 tenors = 140 rows. `guards/sort-key`.
  2. **B — no separator rules inside grids**: the matrix's year-boundary
     border-t rules removed; the live-quoted CELL border stays (a cell cue,
     not a rule). Pinned in `guards/scroll-affordance.test.ts`.
  3. **C — carry & roll replaced the curve heatmap** (endpoint + cache +
     component deleted). `app/carry.py`: carry_pay = S(T)−F(h,T−h), roll_pay
     = S(T−h)−S(T); quote-weight leg combination (dv01 ratios deliberately
     NOT re-applied — embedded in bp-of-quote); forwards pure roll; off-grid
     tenors priced on an end-anchored stub schedule (naive interpolation
     EXTRAPOLATED past the 10y node — caught by test; raw engine quantized
     1M roll to 0). FE: CarryPanel sentence (three shapes + 셈할 수 없습니다
     + vol one-liner), NEAR_ZERO_BP=0.5, horizons 1M/3M/6M/1Y default 3M,
     side LIFTED so one toggle signs diagram + sentence.
     `tests/test_carry.py` + `guards/carry-copy.test.ts`.
  4. **D — padding**: 한 줄 track floor (ONE_LINER_MIN_PX=120) +
     overflow-x-auto (narrow scrolls instead of clipping flush), pb-8 bottom,
     `devIndicators: false`. The owner's narrow screenshot state did NOT
     reproduce remotely (extension emulates a wide viewport) — fixes are
     by-construction; owner eyeball on a real narrow window open.
  5. **E — verified** (DESIGN §2 carry block "Verified"): signs hand-checked
     on the live curve (payer negative, roll exact to 0.01bp), Receive
     negation live, legs test-pinned, horizons monotone, light+dark, grids
     continuous. Open: narrow-window eyeball + vol one-liner glance.
- Backend :8100 restarted on this code; FE dev :3100; theme left dark.

### Earlier — annual-stats session (Passes A–C, 2026-07-28)

- **HEAD** = the annual-stats Pass C commit on `master`, mirrored to D:.
  Gates: BE **70 pass / 1 skip / 1 xfail**, FE **126 vitest / 19 files**,
  lint 0, build 0 — each gate run as its own command, exit code read (the
  piped-gate trap fired twice before; never gate through `tail`).
- Passes:
  1. **A — LEVEL stats are 52-week** (`range1y` {min,max,avg,pct}, trailing
     `ANNUAL_OBS`=252): gauge (+average hairline tick, ends 52주 최저/최고),
     preview tooltip 52주 최고/최저/평균, screener chips 52주 고점권/저점권,
     banner, 한 줄 level rung, event range-transitions. **CHANGE stats stay
     FULL-history on purpose** (movePct, tint, move rung, event 'move') —
     pinned by `test_move_pct_stays_on_the_full_history`. PreviewChart's
     y-domain now derives from plotted points (stats would clip the line).
  2. **B — dates under the charts**: `ui/timeAxis.ts` ladder (year→month→day
     round boundaries, 3–4 labels), PreviewChart bottom pad + DetailChart
     18px strip replacing LWC's hidden time axis; labels track zoom and
     candle buckets. `guards/date-labels.test.ts`.
  3. **C — verified**: change-based counts byte-identical (1 / 2 / 165 / 1);
     level percentiles un-saturated structurally (22→27 unique; the day's
     genuine 52w-high regime keeps outrights ~90-99 honestly); all label
     rungs seen live at five zoom depths, light + dark.
- **Gotcha (new, in cache.py):** the disk cache is keyed by data hash +
  `SCHEMA_VERSION` — the range1y rename silently served the old cached shape
  until the version was added. Bump SCHEMA_VERSION on ANY cached-payload
  shape change.
- Backend :8100 restarted on this code (uvicorn, background); FE dev :3100.

### Earlier — motion session (Passes A–F, 2026-07-28)

- **HEAD** = the motion-session Pass F commit on `master`, mirrored to D:.
  Gates: FE **119 vitest / 18 files**, lint exit 0, build clean.
- Passes (one commit each + one lint fixup):
  1. **A `fa5a8dd` — the column grid is frozen.** Widths derive from the
     FORMAT's widest rendering (`ui/columns.ts` GRID_TEMPLATE — `1s1.5s10s`,
     six tabular glyphs per numeric column), 한 줄 is the only flexible
     track, one template shared by header + body, `scrollbar-gutter: stable`.
     **The `<table>` became a CSS-grid row list** (role semantics kept) —
     transforms don't reach `table-row` and Pass C needs transformable rows.
     `guards/table-grid.test.ts`.
  2. **B `705a643` — §14 motion inventory** (present / stale-spec / missing).
  3. **C `02be623` + fix `a42fc86` — FLIP reorder** on sort & screener
     (transform-only `layout="position"`, popLayout exits fade in place,
     cause-gated, viewport-culled, `FLIP_MAX_ROWS`=400; snapshot measured at
     EVENT time — compiler lint forbids ref/DOM reads in render; NOTE the
     Pass C commit itself went in red because `pnpm lint | tail` masks the
     exit code — pipe swallows it, don't gate through a pipe).
     `guards/reorder.test.ts`.
  4. **D `aea1500` — Pay/Receive morph + preview cross-fade.** One factor
     q ∈ [−1,1] morphs the ghost (deformation is linear in sign); preview
     pane cross-fades 150ms on series switch.
  5. **E `cc2de57` — curve gesture on pin.** Dashed-ink ghost on the par
     curve springs to the wanted shape / holds / fades (400/600/300ms),
     `GESTURE_AMP_PX`=10 fixed, geometry reused via `ui/gesture.ts` +
     `modeShape` (exported from payReceiveModel). Replay = re-pin (recorded
     choice). Vol rows play nothing. `guards/curve-gesture.test.ts`.
  6. **F — verified** (see DESIGN §14 "Verified"): grid stable, morphs and
     gestures correct in both themes; reorder commits 0.6–1.4ms. **Open for
     the owner:** an eyeball frame-rate pass on a live screen (the session's
     display was occluded → rAF throttled, FPS unsampleable) and an OS-level
     `prefers-reduced-motion` check (mechanism is guarded + MotionConfig).

### Earlier — band session (Passes A–C, 2026-07-28)

- **HEAD `807b043`** on `master`, mirrored to D:. Gates: FE **97 vitest / 15
  files**, lint exit 0, build clean. Three passes, one commit each:
  1. `b586cc8` **A — orange/navy sweep confirmed.** No component carries a
     retired hue; the guard (`guards/palette.test.ts`) already existed. Only
     leftovers were six stale comments/labels still saying "orange"/"navy"
     (component headers, the band-hue-contrast test label, ramp.ts) — scrubbed.
  2. `17a026f` **B — every kind gets the positional band** in the Pay/Receive
     mode picture (`payReceiveModel.ts`): outright = tenor (narrow), spread =
     leg-to-leg, butterfly = wing-to-wing, forward = period; deformation
     confined to the band (level = smoothstep plateau), `MIN_BAND` = 30% of the
     plot, band neutral/unlabelled. Guard extended (span, min width, identity
     outside the band, single unlabelled rect).
  3. `807b043` **C — verified live both themes:** 1s2s vs 5s10s and 1s2s3s vs
     2s5s10s now distinguishable at a glance; no tuning needed.

### Earlier — closing session, part 2 (Passes A–F, 2026-07-27)

- **HEAD** = the closing-session-2 Pass F commit on `master`, mirrored to D:.
  See `docs/STATE.md` for the full works-verified / works-unverified / known-
  accepted / missing boundary.
- Gates: FE **54 vitest** (the prior handoff's "57" was a miscount — the suite
  has been 54 all session), backend **68 pass / 1 skip / 1 xfail** (skip = the
  reference-sheet harness awaiting a file; xfail = the documented, now
  owner-accepted round-trip finding), build+lint clean.
- **This session ran A–F end to end** (the earlier closing session stopped at A1;
  the owner has now decided). One commit per pass, mirrored:
  1. **A — accepted residual recorded.** The owner accepted the ≤0.25bp
     bootstrap round-trip residual (frozen code, not re-ported). The strict
     `xfail` now documents an accepted limitation; `CONVENTIONS.md` + `STATE.md`
     record what it does (level reads) and doesn't (change columns cancel)
     affect, and that byte-identical krw-fi-pms carries it too.
  2. **B — first live browser look.** Dark mode across every surface,
     single-column bottom-sheet fallback, deep-zoom heatmap rebucketing, candles
     never comb (interval user-chosen, no auto step-up), quiet-day tint reads
     clean (own-history percentile floor). No defect found.
  3. **C — stale data made loud.** `staleness.py` + `/api/health` freshness;
     header chip scales with KR-business-day age (quiet / visible / red words).
     README documents the manual refresh.
  4. **D — change log surfaced** (`ui/ChangeLog.tsx`): header popover on the
     events rule with 연관 N건 expansion + click-to-focus. Chosen over deletion
     (the rule is good; surfacing was the orphaned Pass B of the diagnostic).
  5. **E — key-forward gauges** (10y min→max track + marker + percentile, accent
     at the tails; backend `range10y`) and the shared **tint legend**
     (`ui/TintLegend.tsx`, matrix + heatmap). E1 also removed the per-basis LEVEL
     columns that shared the table's change-column headers.
  6. **F — this handover.**
- **Still the owner's call:** run **Pass A2** (drop a forward-matrix sheet into
  `data/reference/`) — the only external correctness check, never run. The
  bootstrap re-port is now closed (accepted).

### Earlier — the preceding session landed 5 passes (A–E):

- **FINAL HEAD** = its Pass E commit on `master`, mirrored to D:.
- Gates: FE **57 vitest tests**, `pnpm build` clean, `pnpm lint` exit 0.
  Backend **53 tests**.
- **Backend startup: ~17s cold, ~2s warm.** The own-history distributions are
  persisted to `backend/.cache/` keyed by a SHA-256 of `data/irsdata.xlsx`
  (final §D); recomputed (loudly logged) only when the data changes. `.cache/`
  is gitignored.
- The final session landed 5 passes (A–E), one commit each:
  1. `4a773a4` **A — Pay/Receive curve diagram** (`ui/PayReceive.tsx`): the
     missing feature (spec'd S15 Pass J, dropped). Beside the DV01 ratio; one
     rule (Pay profits when the value rises); arrows + desk-term per kind.
  2. `8340b4d` **B — outlier cue is a leading-edge rule**, not the invisible
     0.04 fill (a fill behind coloured text can't clear contrast). `columnCue`.
  3. `9153559` **C — curve heatmap synced to the chart**: x-domain bound to the
     visible range, crosshair through both.
  4. `d292507` **D — own-history cache** (`app/cache.py`), 17s→2s warm boot.
  5. **E — closeout** (this): resolved the Provisional list, settled vol
     warm-up 65→**61** and floor 0.05→**0.1** (max ratio 3M 12.0 / 1D 6.0 is
     genuine step-behaviour, not an artefact), removed dead `usePan.ts`,
     reconciled docs, confirmed the mirror.
- **Earlier: Session 16 landed 10 passes (A–J):**
  1. `2d998d9` **E — chart line → blue**, orange back to selection/focus.
  2. `8f062e7` **H — full-bleed**: dropped the outer card, header is a
     full-width band.
  3. `7fad8ed` **I — curve-level 한 줄 banner** (커브 전 구간이 10년 고점권),
     pin clears on tab change, `{start}xSPOT` dropped from the forward list.
  4. `7dfbdd9` **B — DV01-neutral leg weights** (`dv01.py`, par-swap annuity off
     the bootstrapped curve; `/api/dv01/{id}`; popup ratio).
  5. `c150df1` **J — own-history colour scale**: change-column binary tint 0.04
     (not 0.12 — text contrast), forward matrix graded 0.45, grid-max dropped.
  6. `a3af070` **F — 당일 변화 +0.0 diagnosed** (genuine flat day, d correct);
     구간 vs 10년 stat labels.
  7. `505007c` **C — popup ⊇ preview**: DetailChart crosshair tooltip + stats +
     last-value badge; `readout-parity.test.ts`.
  8. `fc19cb9` **G — candlesticks** 주봉/월봉 (`?interval=w|m`, OHLC from closes,
     상승 빨강/하락 파랑, `?type=` in URL).
  9. `3fc5a52` **D — tenor × date curve heatmap** in the popup (own-history
     tint, shows the curve not the instrument).
- **New backend endpoints:** `/api/dv01/{id}`, `/api/curve-heatmap`;
  `/api/series/{id}?interval=w|m` for OHLC. **New DTO fields:** ForwardCell
  `movePct`; WallSummary `curveBanner`.

### Session 15 (superseded head, kept for the pass ledger)

- Session 15 FINAL HEAD was `94931a3`, landing 9 passes (A–I; E split E1
  autonomous / E2 report-and-stop):
  1. `a088f4c` **A — whole window.** No max-width; table pane 880px, preview
     fills the rest (floor 600), curve fills height; single-column bottom-sheet
     fallback below ~1520px (`ui/useIsWide.ts`).
  2. `557a746` **B — weight is structure.** Instrument name + `현재` at 600,
     changes at 400; outlier emphasis moved to colour intensity (§5 updated).
  3. `a53b7b9` **C1 — popup gloss.** Subtitle + 합니다체 explanation keyed to
     kind (`ui/gloss.ts`, rendered from kind+legs; `gloss.test.ts` pins copy).
  4. `70fed5a` **C2 — 한 줄 ladder.** move-extreme (own-history) → level
     extreme (capped) → solo direction → empty. `day_move_pct` new BE input.
  5. `fa07d9d` **D — screener chips.** `ui/screener.ts` predicates; `movePct`
     exposed on the DTO.
  6. `7236fe8` **E1 — up-color.** `#f04452`→`#d92d3c` (4.5:1 text); hue-contrast
     guard split by usage (text 4.5 / stroke 3).
  7. `7269c9e` **E2 — colour-density diagnostic (report, STOP).**
     `docs/diagnostics/color-density.md` + `backend/scripts/color_density.py`.
     Colour normalization NOT implemented — owner picks the scale.
  8. `ebfca5a` **F — matrix full-width mode.** pinned 시작/날짜, key block
     wraps; `scroll-affordance.test.ts`.
  9. `0f78ecd` **G — sticky opaque.** header `<tr>` opacity → text-ink/50 alpha;
     `sticky-opaque.test.ts`. `94931a3` **H — 합니다체 + terminology (§15)**.
     `e2f8d5d` **I — removed the preview heatmap** (tooltip is the sole readout).
- **Owner decision pending (Pass E2):** the colour-intensity normalization —
  recommended own-history percentile (floor pct70, full pct97), same scale for
  the forward-matrix tint (which today lights ~96–99% of cells). Backend needs a
  normalized magnitude per cell (§16). Not built.

### Session 14 (superseded head, kept for the pass ledger)

- Session 14 FINAL HEAD was `04bce8f`, landing 4 passes, one commit each:
  1. `0dda57c` **Computation boundary (§16).** Backend computes, frontend
     renders. Moved FE→BE: the 한 줄 classification (ships as `{kind,value}`,
     rendered on the client — the §16 exception), sort keys, the quoted flag,
     series range stats (min/max/avg), per-point daily change, the calendar's
     daily-change series, and preview downsampling (`?res=preview` ~150 pts;
     `res=full` for the enlarged view). New guard `row-vm-source.test.ts`:
     every `buildRows` field is declared `dto|format` in `ROW_FIELD_SOURCE`,
     dto fields checked against the API source.
  2. `0e33443` **Volatility engine.** `relative_atr` in `volatility.py`:
     `mean(ATR 5) / mean(ATR 60)`, close-only form `TR=|Δr|` bp (no intraday
     high/low in the export). Warm-up 65 obs→null, 60-obs mean floor 0.05 bp→
     null, windows in observations. Generic over any series id, cached.
  3. `908b030` **Vol endpoints.** `/api/volatility` (SeriesSummary-shaped rows
     + across-tenor curve) and `/api/series/vol:{tenor}` (history via the
     shared builder, unit `"ratio"`). Nulls stay null end to end.
  4. `04bce8f` **Vol tab, display-only.** unit `"ratio"` (2dp, no bp suffix),
     ratio-difference changes, `null`→"—", direction colour, idle relative-ATR
     curve. Placeholder + reserved-slot removed. Verified live (tab, hover
     preview, enlarged chart) — no console errors, domain guard passes.

### Session 13 (superseded head, kept for the pass ledger)

- Session 13 FINAL HEAD was `fadf7ce`; it landed 6 passes, one commit each:
  1. `affae6f` Tabs — sliding underline (`motion` `layoutId`), press-scale
     removed from tabs (§14: no transform press-feedback on alignment-sharing
     elements).
  2. `9b7993d` Heatmap/cells — `MiniBar` deleted; change columns = colored text;
     grids use shared background tint (`ui/tint.ts`).
  3. `ad16a42` Forwards — full 21×8 list, 6 pinned key forwards, start-filter,
     matrix toggle, and **real history** (per-date curve bootstrap).
  4. `f527e9e` Curve — idle right pane shows the tab's curve (`CurveView`);
     forwards render the **1YF ladder, x = start point**.
  5. `cc536fb` Shell — one continuous surface, page never scrolls, table body is
     the scroll container, rows h-12 + hairline. Shadow tokens removed.
  6. `fadf7ce` Correctness — 한 줄 never restates a column; quoted/interpolated
     dot; `sort-key` guard; notation + fly weighting documented.

### Gotchas — Session 14 (keep in mind)

- **Preview vs enlarged share `/api/series/{id}` — key by resolution.** Preview
  fetches `?res=preview` (~150 pts) under `["series", id, "preview"]`; the
  enlarged chart fetches `?res=full` under `["series", id, "full"]`. Same key
  for both would clobber the full series with the downsampled one.
- **`sort-key.test.ts` fixtures now carry the DTO fields** (`sortKey`, `quoted`,
  `oneLiner`) because those moved to the backend. `tsconfig` typechecks
  `guards/`, so a fixture missing a DTO field fails `pnpm build`, not just
  vitest.
- **Vol needs a third unit.** `unit: "ratio"` (2dp, no bp suffix, ratio-diff
  changes) lives alongside `%`/`bp`; `fmtLevel`/`fmtDelta` in `lib/format.ts`
  are the unit-aware formatters — use them, don't re-inline `toFixed`.
- **`relative_atr` is scale-invariant** (the ratio cancels units); `scale` only
  sets the denominator floor's unit (bp). Don't rely on `scale` to change the
  ratio.

### Gotchas — Session 13 (keep in mind)

- **`useMeasure` blank-pane trap:** a `useRef`+`useEffect` width hook left the
  measured width stuck at 0 (right pane rendered nothing). Fix = a **callback
  ref** that reads `clientWidth` synchronously on mount and attaches a
  ResizeObserver. This is the current `ui/useMeasure.ts`; don't regress it.
- **Sort key / "3M lands last":** a tenor added after the original node set
  (CD91 / 3M) had no sort key and sorted to the bottom. Every tenor now maps
  through `tenor_years()`; unknown → `inf` so a genuinely unmapped tenor sorts
  loudly. `guards/sort-key.test.ts` fails on any empty/non-finite key.
  (Session 14: this map moved to the backend `dataset.py`; the FE reads
  `sortKey` from the DTO.)
- Don't chain `pnpm vitest run | grep … && git commit` in one shell line — a
  non-matching grep breaks the `&&` chain and the commit silently doesn't run.
  Run the gate, then commit as a separate step.

---

## 7. Open / provisional (confirm or override with the owner)

### OPEN AFTER 2026-08-07 (트레이더 피드백 + 활자)

- **백테스트에 KRD가 없다.** 응답은 `points`(일별 손익)와 포지션별 기록만 든다.
  서랍의 KRD 탭은 **숨기지 않고 비워** 두고 이유를 적어 뒀다 — 없다는 사실이
  화면에서 보여야 "왜 한쪽에만 있지"를 묻지 않는다. 채우려면 백엔드에 테너별
  범프 재평가(`dv01.py`의 `build_dv01_table` 같은 것)를 붙여야 하고, 그건 별도
  결정이다.
- **CD를 이벤트로 내리면서 진 빚 둘** (둘 다 산술은 테스트로 못 박아 뒀다):
  - wire의 `fundingEvents`를 엔진이 **1D 노드에도** 먹인다 → 오버나이트가 CD
    추가만큼 따라 움직인다. 갈라내려면 포팅된 `chart.py`를 고쳐야 해서 안 했다.
  - 같은 배열을 `fundingStepping`이 켜지면 조달비용 계단으로도 쓴다 → 조달비용이
    기준금리가 아니라 CD만큼 걸음을 한다. 이 화면에 그 토글이 없고 값이
    구조적으로 false라 지금은 닿지 않는다. 되살리면 먼저 이 자리를 고쳐야 한다.
- **메인 개요가 −2px 넘친다.** 이번 변경 이전부터 그렇다(13px에서 670 필요 /
  668 가용). 표 활자를 키우려면 개요에서 열을 하나 덜어내야 하는데, 그건 활자가
  아니라 **내용의 결정**이라 가져오지 않았다. 어느 열을 뺄지가 오너 몫이다.
- **1D(콜금리)는 xlsx와 다른 계열이다.** MySQL 전환 때 실측: 3M~10Y는 1e-9까지
  일치하는데 1D는 80.8%가 다르고 최대 61bp다. [OWNER "무조건 SQL 쪽이 정답"]으로
  그대로 받았다. 숫자가 예전과 다른 이유를 다시 묻게 되면 여기다.
- **`main`이 origin보다 42 앞서 있다.** 푸시는 오너만 한다. 미러도 아직이다.
- 실행은 **활성 케이스 하나**다. 네 케이스를 한 번에 돌려 결과를 비교하는 것은
  결과창 자체가 달라지는 일이라 별건으로 남겨 뒀다.
- 조건 폼의 **필터 문법**(`.filters` — checkbox/radio/slider/switch를 `.fgroup`
  행으로)은 2026-08-07에 "이거 끝나고"로 미뤄 둔 그대로다.

### OPEN AFTER THE TOSS LINE (surface `0a8448e` → register `8a43034` → geometry)

The three-pass line is **finished and closed out**; DESIGN §9/§15 carry the
binding rules. What it did NOT resolve, gathered here so the next session does
not have to re-derive it:

- **NOTHING IN THE LINE HAS BEEN SEEN ON A SCREEN.** Every pass was verified by
  arithmetic, source assertion and built-CSS inspection — never by eye. Owner
  eyeball is the outstanding step for all three. See STATE.md §2 for what
  specifically is unverified and why headless verification is banned here.
- **`--bw-page`'s second job.** The geometry pass established it paints **no
  canvas pixels in light** — it is a recessed control fill (forward-tab
  `select`, backtest inputs, the backend-down note) plus a transient state tint
  (hover/active rows, four hover fills, three scrims). Whether the recessed
  fill deserves its own token, so `page` can mean only "state tint", is open.
- **The two bottom sheets disagree about elevation.** `EnlargedView`'s sheet
  carries `shadow-lg`; `App.tsx`'s preview sheet does not. Same object type,
  both over a scrim. Legal either way under the corrected shadow rule
  (permitted on floating surfaces), so it is drift rather than a defect —
  observed in the geometry pass and deliberately not fixed, since the
  authorised change was the backtest window only.
- **`lib/api.ts`'s `BacktestUnavailable` message is copy with no surface.** It
  was moved to 해요체 with the rest, but the window renders its own
  `백엔드가 필요한 화면이에요` block instead and the message never appears.
  Either surface it or drop it.
- **Accessibility SHOULD items from the 2026-08-05 Vercel-guidelines audit**
  (`02520e0` fixed the MUST items only):
  - the active **tab is not deep-linked** — `tile` and the whole `bt` namespace
    ride the URL, but the tab is plain `useState`, so a reload loses it;
  - **mobile is formally out of spec** — 14px inputs (iOS zooms on focus), no
    `touch-action: manipulation`, ~28px close target, pinned-viewport shell;
  - **no `aria-live`** on the backtest result arriving (errors have `role="alert"`);
  - **`<title>` is static** — it does not follow the enlarged view or the window;
  - **140 rows render unvirtualized** on the 포워드 tab (the guideline says
    >50). This said "~200 rows on the 전체 tab" until 2026-08-06 and both
    halves were wrong: 전체 is the 24-row three-column overview, not a list.
    Note the reorder does NOT depend on virtualization landing — FLIP's cost is
    O(animated rows) and is capped at 48 (§14);
  - no `<meta name="theme-color">`; loading copy lacks the `…` character.
- **Layout sizing after the register change was ESTIMATED, not measured.** Text
  metrics (Hangul ≈ 1.0em, Latin ≈ 0.52em) say no container changed line count
  and none is near a wrap boundary; the only template that grew (+4자) sits in
  the one fixed-size box, `PayReceive`'s 340×180 volatility note, with ~140px
  of slack. Confirm by eye, not by rerunning the estimate.

- **MOOT since pass M — forward curve x-axis = start point** (1YF ladder across
  starts), not x = tenor. There is no per-tab idle curve any more, so the choice
  has no live subject; the reasoning stays in DESIGN only because it still rules
  out "one line per tenor" if a forward curve returns elsewhere.
- **OPEN (pass M) — `VolatilityPayload.curve` is served and rendered by
  nothing.** The vol tab's idle curve was its only consumer. Two options: keep
  it (a small dormant field, ~240 bytes, and the vol curve is the obvious first
  thing to want back) or remove it with `_vol_curve` in the backend, which is a
  `SCHEMA_VERSION` bump + a static-tree rebuild + golden updates. Kept for now
  — deliberately, not by oversight. **The precedent cuts both ways**: leaving a
  feed behind after deleting its consumer is what left a 150-point sparkline at
  92% of the payload (see pass L), so this should not sit open indefinitely.
- **CLOSED by deletion (pass L) — 한 줄 thresholds.** The ladder's cutoffs were
  an open implementer's call for several sessions; the column is gone, so the
  question is moot rather than answered. The last column now shows the 52-week
  high/low/mean, which has no threshold to tune. What replaced the open item:
  three choices recorded under DESIGN `## Provisional` → "Pass L" (the
  sub-label wording, the unshipped forward percentile, and the un-eyeballed
  drop threshold).
- **Volatility = relative ATR [Session 14, built; constants SETTLED final
  session].** `mean(ATR 5)/mean(ATR 60)`, close-only form `TR=|Δr|` bp (the
  export has no intraday high/low). Generic over any series id. Constants are no
  longer "to confirm": **warm-up = 61 observations** (the mathematical minimum,
  corrected from 65) and **denominator floor = 0.1 bp** on the 60-obs mean
  (raised from 0.05 to trim the divide-by-near-zero tail). Recorded in DESIGN
  `## Provisional`. Open only: whether the tab is *useful* (unreviewed by a user).
- **This session's features are CONFIRMED (Passes C–E), not provisional:**
  stale-data freshness, the change-log popover, the key-forward gauges, and the
  tint legend — all built, gated, and verified live. See DESIGN's "Settled
  decisions" for each.
- **Computation boundary (§16) is now enforced** — if you add a row field,
  declare it `dto|format` in `ROW_FIELD_SOURCE` or the guard fails. Anything
  that needs a calculation goes in the backend.
- **CLOSED by the stability session, do not carry forward as open:** the
  key-forward level/change header collision (resolved earlier by removal,
  re-verified against the code in Pass F) and blue's double duty (re-checked
  at its worst case in Pass F, strokes stay blue, trigger retired).
- **Still open, and NOT exercisable from a headless session** — these need a
  real screen and stay with the owner: the real-narrow-window eyeball
  (carried), frame rate, the single-column narrow layout, and OS-level
  `prefers-reduced-motion`. Pass E could not measure true first paint or
  frames-to-pixels for the same reason (occluded renderer); it measured
  time-to-DOM-committed instead and says so.
- **No longer out of scope, and now decided:** the stability session left
  deployment open on purpose. The static conversion settled it — Vercel, no
  runtime backend, data committed as JSON. See DESIGN §21.
- **Open for the owner, in order:** create the git remote; set the Vercel
  project's Root Directory to `frontend`; work `docs/DEPLOY_CHECKLIST.md`. The
  case-sensitivity sweep in §1 of that file is the one that matters — Windows
  builds it, Linux serves it, and a case mismatch resolves locally while 404ing
  in production for perhaps one instrument out of 196.

---

## 8. Working agreement (owner standing rules)

- Completion claims need **commit hashes** + `git show --stat` evidence; a
  false "closeout" has happened before, so verify report claims against the repo.
- Memory / record instructions are authoritative **only when typed directly by
  the owner**, not relayed inside a session report.
- Run passes end-to-end without stopping to ask; **commit at each pass
  boundary with gates green, mirror after each commit**, patch `docs/DESIGN.md`
  as you go, and record uncovered choices under DESIGN's `## Provisional`.
