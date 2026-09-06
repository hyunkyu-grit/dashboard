# MR 성과지표·근사 최적화 + Backtest 다리 대사 — 이어받기 프롬프트 (2026-09-04)

> 아래 전체를 새 세션에 그대로 붙여넣으면 이어서 할 수 있습니다.
>
> **⚠ 이 세션의 일감은 다 끝났습니다.** 오너 지시 다섯 가지(§2)가 전부 구현·
> 검증됐고 게이트도 초록입니다. 남은 것은 **커밋**과 **미결 여섯**(§4)뿐입니다.
>
> **⚠⚠ 작업 트리에 커밋 안 된 변경이 두 세션분 섞여 있습니다.** 먼저 §1-A 를
> 읽고 어느 것이 누구 것인지 가른 뒤에 손대세요.

---

## 0. 너의 임무

`Projects\apps\sauron-v2` 에서

1. **§1-A 를 읽고** 작업 트리 상태를 파악한다(두 세션분이 섞여 있다).
2. 오너가 커밋을 지시하면 §5 의 순서로 커밋한다.
3. §4 의 미결 여섯 중 오너가 고르는 것을 한다.

시작 전에 반드시:

- `CLAUDE.md` 를 읽는다 — 캐논·얼라인·말줄임 금지·낱말 중간 줄바꿈 금지.
- UI 를 건드리면 **`cds-code` 스킬을 먼저 부른다**(CLAUDE.md 규칙 1).
- `docs/MR_LANE_STATE.md` 꼬리(2026-09-04 다리 대사 절)를 읽는다.
- 이 문서 **§6 함정**을 읽는다 — 오늘 내가 실제로 밟은 것들이다.

---

## 1. 절대 규칙

- **커밋은 오너가 지시할 때만.** 완료 보고는 커밋 해시 + `git show --stat`.
- **`git stash` 금지**(동시 세션과 pop 이 조용히 실패). 커밋은 반드시
  `git commit --only -- <경로>` 로 경로를 못 박는다.
- **원격이 둘이다.** 둘 다 밀어야 한다:
  ```
  origin     github.com/wwoo1116-cell/rateslab.git    ← Vercel 배포
  dashboard  github.com/hyunkyu-grit/dashboard.git
  ```
  `git push origin master:main && git push dashboard master:main`
  ⚠ **에이전트는 push 가 하네스에 막힌다.** 오너에게 명령을 드려야 한다.
- **백엔드는 push 로 안 바뀐다.** `:8200` 은 예약 작업 `SauronV2Backend` 가
  `backend/serve.ps1` 로 띄운 로컬 프로세스다:
  ```powershell
  Stop-ScheduledTask -TaskName SauronV2Backend
  # 포트가 안 비면 Get-NetTCPConnection -LocalPort 8200 로 PID 확인 후 Stop-Process
  Start-ScheduledTask  -TaskName SauronV2Backend
  ```
  :8200 은 Funnel 로 공개돼 있어 재기동 중 수 초 끊긴다.
- **지어낸 데이터 금지.** 없는 것은 화면에도 시험에도 없어야 한다.
- `.premove.bak` 294장은 **그대로 둔다** [오너 2026-09-01].

### 1-A. 작업 트리 — **두 세션분이 섞여 있다** ⚠

HEAD 는 `cc113aec`. 그 위에 커밋 안 된 변경이 **2,084줄** 있고, 그게 **두
세션의 것**이다. 파일로 갈린다:

**(가) 앞 세션(09-04 오전) — 선물 넷 실가격 대사. 내가 안 건드렸다.**

    backend/app/backtest.py          (+63)   book_recon(with_krd=False)
    backend/tests/test_mr_legrecon.py (±292)

**(나) 앞 세션이 만들었고 내가 **그 위에 더** 얹었다 — 섞여 있으니 조심.**

    backend/app/futures.py           (+263)  앞: dv01_of·roll_cost·level_at
                                             나: with_legs·_bucket_leg
    backend/app/main.py              (+418)  앞: _mr_fut_recon·MR_FUT_MAP
                                             나: _mr_optimize·mr_optimize·spans
    src/mr/StrategyWindow.tsx        (+744)  앞: 선물 블록 렌더
                                             나: 성과 열둘·최적화 절·구간
    src/mr/api.ts                    (+255)  앞: MrReconBlocks
                                             나: MrPerf·MrOptimize*·MR_SPANS
    guards/mr-span.test.ts           (+76)   앞: 다리 레벨   나: 구간 재정의

**(다) 온전히 이 세션 것.**

    backend/app/mrmetrics.py         (신규)  절대수익형 지표 + 구간 채점
    backend/tests/test_mrmetrics.py  (신규)  18건
    guards/mr-optimize.test.ts       (신규)  23건
    backend/app/mixedbook.py         (+35)
    backend/app/mrbacktest.py        (+12)   simulate(roll=…) 캐시 손잡이
    backend/tests/test_futures.py    (+61)
    backend/tests/test_mixedbook.py  (+33)
    guards/mr-canon.test.ts          (+40)
    src/backtest/BacktestWindow.tsx  (+31)
    src/backtest/recon.ts            (+26)
    src/lib/staticPaths.ts           (+5)
    src/mr/KnobBar.tsx               (+110)

`backend/data/raw/bigfoot_*.csv` 12장도 M 인데 **자동 갱신본**이라 손대지 마라.

---

## 2. 오너 지시와 그 구현 (2026-09-04)

> "v2 수정하기,, 1. Strategy에서 명목이 아니라 Delta라고 하기 2. 비용기준은
> 0.25/0.5/1로 설정하기, 지금 주어진 진입, 청산, 손절, 룩백, 진입 규칙을
> 바탕으로 전략 실험시에 근사 최적화 세트를 바탕으로 결과를 보여주고, 그 밑에
> TOP 5 조건을 매트릭스로 보여주기, 그리고 지난 1년, 지난 1분기, 지난 1개월을
> 전역 설정값으로 두고 이를 조정하면 성과도 바뀌게 해주기. 그리고 샤프가
> 아니라 절대수익형펀드(헤지펀드)에서 사용하는 성과지표 가져와서 사용해주기
> 2. 그리고 지금 Backtest의 퓨처스왑과 자산스왑도 Strategy/Mean Reversion에서
> 대사 및 검산하는 것과 마찬가지로 하루당 행 7개로 구성하기"

세션 중 오너가 답한 갈림길 둘:

- 성과지표 세트 = **「위 다섯 + Omega·Ulcer/Martin」**(열둘 카드)
- Backtest FSW = **「선물 표로 옮겨 7줄」**(IRS 다리를 스왑 표에서 뺀다)

### ① 명목 → Delta

노브(`KnobBar`)와 카드(`StrategyWindow`) 둘 다. **낱말만 바꾼 게 아니다** —
이 칸의 단위는 처음부터 `₩/bp`(DV01)인데 「명목」은 채권·스왑에서 **액면**을
가리키는 말이라, 같은 카드 안의 「액면 약 35.4억」과 충돌하고 있었다.
「원」이 한글인 판례(Pretendard SR 의 `₩` 가 반각 「W」로 선다)는 그대로 산다.

### ② 비용 프리셋 0.05/0.2/0.5 → **0.25/0.5/1**

기본은 여전히 오너 실측 **0.5**. 0.05 를 내린 이유는 「이 데스크의 호가폭이
아닌 값으로 통과한 판정이 나온다」는 것(이웃 레인 손익분기 0.479bp 판례).
자유 입력에는 여전히 적을 수 있다 — **사라진 게 아니라 화면이 안 권한다.**

⚠ **칸 폭 220 → 212 는 «유도» 지 실측이 아니다.** §4-1 을 봐라.

### ③ 구간이 **전역 설정값**

고르개(`PeriodSelector`)가 창 본문 → **노브 줄 위 자기 줄**로 올라갔다.
이제 성과 카드와 최적화 격자가 그 구간에서 채점된다.

**엔진은 다시 안 돈다.** 룩백 워밍업이 구간 앞에 있어야 z 가 서기 때문이다
(1개월 창에서 120일 룩백은 아예 못 선다). 바뀌는 것은 **채점**뿐:

- 구간 안의 봉만 더한다
- 구간 안에서 **청산된** 거래만 센다(화면 곡선의 「걸친 거래」와 같은 규약)
- 누적은 구간 시작 0 재기준(종전 그대로)

서버가 **네 구간을 한 번에** 보낸다(`MrStrategyRun.spans`) → 고르개가
**재실행도 stale 도 안 만든다.** 달력 산술은 **서버에만** 있다
(`mrmetrics._months_before`) — 화면의 `monthsBefore` 는 지웠다. 두 자가 하루라도
갈리면 카드(서버 채점)와 곡선(화면 산술)이 다른 구간을 말한다.

실측 BSS-3Y: 전체 +4,759만 / 1년 −347만 / 1분기 −454만 / 1개월 −761만.

### ④ 샤프 → **절대수익형 지표 일곱** (`backend/app/mrmetrics.py` 신설)

    Sortino   평균 / 하방편차 × √252     — 손실 쪽 변동만 벌한다(MAR = 0)
    Calmar    연환산 손익 / 최대낙폭     — 절대수익형의 표준(= MAR 비율)
    Martin    연환산 손익 / Ulcer
    Ulcer     RMS 낙폭(₩)                — 낙폭의 «깊이 × 길이»
    GPR       Σ월손익 / Σ|음의 월손익|   — Schwager, **월 버킷**
    Omega     Σ이익일 / Σ손실일          — θ=0, **일별**
    Profit F. Σ이긴 거래 / |Σ진 거래|    — **거래** 기준
    + 회복일(최대낙폭의 **골**에서 전고점까지) · 회복 여부

**GPR 을 월 버킷으로 재는 이유**: 같은 일별 계열에서 재면 `GPR = Omega − 1` 이
항등이라 카드 하나가 중복이 된다(`test_mrmetrics` 가 그 항등을 수로 잰다).

**단위는 원/원이다** — 이 데스크엔 AUM 이 없다. 문헌의 수익률 기반 값과 크기를
직접 비교하면 안 되고, 화면 각주가 그 사실을 적는다.

**못 잰 값은 0 이 아니다.** `null` = 「그 구간에서 그 지표가 안 선다」이고,
카드가 **왜인지**를 적는다(「손실 난 달이 없어요」 대 「월 버킷 1개라 못 세요」 —
그래서 `gprMonths` 가 계약에 있다).

**샤프는 화면에서만 내려갔다.** 계약(`summary.sharpe`)과 엔진
(`mrbacktest.summarize`)에는 남는다 — 적합성 벡터가 그 수를 잠그고 있다.

손익분기 비용도 구간을 따라간다(`c* = c₀·(1 + PnL/문 돈)` — 건수를 안 세고
«문 돈» 하나로 낸다. 엔진의 `breakeven_cost_bp` 와 같은 산술을 비율로 다시 쓴 것).

### ⑤ 근사 최적화 — 새 라우트 `/api/mr/optimize`

다섯 노브의 **프리셋 전부** = 3×3×3×3×2 = **162칸**. 연속 최적화가 아닌 이유는
내렸던 이웃 칸 표의 규율과 같다: **화면이 못 고르는 조합을 최적이라 적으면 그
수를 재현할 손잡이가 없다.** 프리셋 밖의 현재 값(자유 룩백)은 한 칸으로 낀다.

- **비용·Delta·실전 규칙은 안 흔든다** — 통상값이 아니라 그날의 호가폭이고
  이 데스크의 포지션 크기다. 실전 규칙 다섯은 긴 표본에서 이미 기각됐다.
- **회계는 엔진 근사다.** 162칸을 실가격으로 매기면 못 돈다 — 화면이 각주로
  그 사실을 적고, 「채택」이 칸을 노브에 꽂으면 정식 실행에서 실가격이 붙는다.
  **채택은 실행하지 않는다**(사람이 「실행」을 눌러야 두 회계의 차이가 화면에
  선다. 그 사이 stale 배너가 「지금 노브가 실행과 다르다」를 말한다).
- **정렬은 화면**이 한다(`rankCells`). 서버는 칸마다 지표를 다 실어 보낸다 —
  「기준을 바꾸면 1등이 바뀐다」가 이 표가 말해야 하는 것이라 전환이 즉각이어야
  한다. 못 잰 칸은 **뒤로** 보낸다(0 으로 채우면 순위가 거짓이 된다).
- 화면은 **1등 카드 + TOP 5 매트릭스 + 지금 칸의 등수**. TOP 5 밖이면 지금 칸이
  여섯째 줄로 붙고 **자기 실제 등수**를 단다(실측 31등).

**성능**: `simulate` 에 `roll=` 캐시 손잡이를 냈다(산술 아님, 순수 함수 결과
재사용). 룩백 셋을 54칸씩 나눠 쓰는데 `rolling_series` 가 칸마다 다시 돌아
격자 시간의 63% 였다 → **4.08s → 0.95s**. 페이로드 59KB.

### ⑥ Backtest 대사 — 자산스왑·퓨처스왑 **하루 7행**

    다리마다 KRD·Δbp·손익 셋 + 합계 한 줄 = 7

- **자산스왑**: `mixedbook.book_recon` 이 `cb.book_recon(..., with_legs=True)`
  를 부른다. 그 기계는 이미 있었고(2026-09-04 MR 레인) 켜기만 했다. 비용은
  IRS 다리 KRD 범프(250일 창 5.55배)라 **자산스왑 줄이 있을 때만** 문다.
- **퓨처스왑**: `futures.book_recon(..., with_legs=True)` 를 새로 만들었다.
  IRS 다리는 **스왑 표에서 뺀다**(안 빼면 같은 돈이 두 표에 선다).

  ⚠ **2026-08-25 「엔진 단위 분리」가 FSW 에 한해 뒤집혔다.** 한 거래의 두
  다리가 다른 표에 서면 「이 거래가 그날 얼마를 벌었나」를 화면이 한 줄로 못
  말한다는 것이 오너 판단이다. 표 자체는 여전히 자기 엔진 달력 위에 선다.

  **두 달력을 한 표에 세우는 법 = 버킷**(`_bucket_leg`). IRS 다리는 IRS 달력에서
  **스왑 엔진이** 값매기고(여기서 다시 가격하지 않는다 — 두 번째 정의 금지),
  선물 행마다 «직전 선물 행 다음부터 이 행까지» 의 IRS 행을 담는다.
  → **돈이 보존된다.** IRS 가 쉰 날은 0 이고 다음 행이 두 밤을 한 번에 진다.
  Δbp 는 더한다(수준의 차라 이어 붙는다: a−b + b−c = a−c). KRD 는 버킷 **첫**
  행 것(그 블록의 시작 감도이고 추정이 곱한 값).
  `test_futures.py::test_fsw_legs_conserve_the_swap_leg_money_across_the_two_calendars`
  가 스왑 엔진 단독 결과와 세로합을 대조한다.
- 화면: 세 표 다 `tenors={reconTenors(...)}` 로 바꿨다(두 다리 열의 합집합,
  만기순). 민평 목록만 넘기면 IRS 전용 노드가 **소리 없이** 사라진다.
- 선물 각주가 갈린다 — 다리 판에서는 「**선물 다리는** 손익이 전부 평가」로
  좁힌다. 안 좁히면 바로 다음 문장(「캐리·롤다운은 IRS 다리에서 와요」)과
  앞뒤가 어긋나 화면이 자기 표에 서 있는 열을 「없다」고 말한다.

---

## 3. 지금 상태 — 게이트

    pytest   1,060 통과 · 7 skip · 1 xfail · 0 실패   (기준선 1,039 + 신규 21)
    vitest   1,683 통과 · 1 skip · **2 실패**

**vitest 2 실패는 기존 문제다.** `guards/production-env.test.ts` 가 낡은
`.next` 청크를 읽는다. 내 변경을 stash 하고 돌려도 똑같이 실패했다(17:10 실측).
`.next` 를 지우고 다시 빌드하면 풀린다 — 이 레인의 일이 아니다.

    실행: cd backend && python -m pytest tests -q --ignore=tests/test_static_agreement.py
          npx tsc --noEmit && npx eslint src && npx vitest run

⚠ `test_static_agreement.py` 는 :8200 이 «내가 띄운 개발 백엔드」가 아니면
거절한다(Funnel 로 공개된 라이브라서). `--ignore` 로 빼고 돌린다.

### 라이브 실측 (2026-09-04, 실제 SQL·민평 위에서)

    /api/mr/strategy  BSS-3Y  2.55s · spans 넷 · all 이 옛 summary 와 일치
    /api/mr/optimize  BSS-3Y  0.52s · 162칸 · current 정확히 하나 · 59KB
    /api/backtest     ASW     legTenors ['국고','IRS'] · 59행 · 합계 = 다리 합
    /api/backtest     FSW     swap 표 None(다리가 옮겨감) · 합계 = 다리 합 위반 0
                              세로합 4,187,332 = 선물 6,000,000 + IRS −1,812,668

**화면 실측도 했다**(:3200 + :8299). 성과 열둘·최적화 절·TOP5·구간 전환·
Backtest 두 표의 7행이 다 섰다. 스크린샷은 세션에만 있다.

---

## 4. 미결 여섯

### 4-1. 비용 칸 폭 212 를 **실측으로 바꿔라** ⭐

`src/mr/KnobBar.tsx` 의 비용 `<Box width={212}>` 는 **유도값**이다 —
문서화된 옛 실측(0.05/0.2/0.5 + 자유 입력 64 = 잉크 219.3px)에서 「셋째 알약이
3글자 → 1글자」만큼 뺀 수(숫자 ≈7.7 · 마침표 ≈3.5 → ≈208, 여유 4).
화면에서 잘림은 없었지만 **잉크를 재지는 않았다**(CLAUDE.md 얼라인 6).

재는 법 — 앱 띄우고 전략 실험 창에서:
```js
const f=[...document.querySelectorAll('label,div')].find(e=>e.textContent?.trim().startsWith('비용 (bp)'));
const row=f.querySelector('div[class*=HStack],div'); // 알약+입력 줄
[...row.children].reduce((a,c)=>a+c.getBoundingClientRect().width,0) + 4*(row.children.length-1)
```
잰 뒤 주석의 「**폭 212 = 유도**(실측 아님)」을 「폭 N = 실측」으로 바꾸고
가드(`mr-canon.test.ts` 의 `/폭 212 = 유도/`·`/실측이 아니라/`)도 같이 고쳐라.
가드의 폭 정규식은 이미 `실측|유도` 둘 다 받는다.

### 4-2. **MR 창의 FSW 대사는 아직 두 블록이다** — 통일할지 오너 결정 ⭐

오늘 7행으로 바꾼 것은 **Backtest 뿐**이다. MR(전략 실험) 창의 FSW 는 여전히
「선물 대사 — 선물 달력」 + 「IRS 대사 — IRS 달력」 두 블록이다
(`main._mr_fut_recon` 이 blocks 로 낸다).

기계는 이미 있다 — `futures.book_recon(..., with_legs=True)` 한 줄이면 된다.
안 한 이유는 **오너가 Backtest 만 말했고**, MR 쪽은 응답 모양이 `blocks` 라
화면(`reconBlocks`·롤 비용 각주)도 같이 고쳐야 해서다. 화면 둘이 같은 상품을
다른 모양으로 그리는 상태이므로 **오너에게 물어라.**

### 4-3. `/api/cashbond/backtest` 는 `with_legs` 를 안 켰다

구 라우트(2026-08-21 에 프런트에서 부르는 데가 없어졌다)라 일부러 안 건드렸다.
자기 테스트를 지고 있고 화면이 안 읽는다. 되살리면 그때 켜라.

### 4-4. TOP 5 표가 상자를 **10px** 넘는다

`.sr-mr-drawertable` 의 보이는 가로 스크롤이 받는다(ReconStack 판례와 같다).
「채택」 버튼은 다 보인다(실측). 「노브에 넣기」 → 「채택」으로 줄여 38 → 10px
로 줄인 상태다. 더 줄이려면 열 폭 실측: 조건 238 · 총손익 105 · 최대낙폭 92 ·
채택 92 · 나머지 54~77 (합 1,080 대 상자 1,071).

### 4-5. `production-env` 가드 2건 (기존, 이 레인 무관)

### 4-6. 커밋 안 됨 — §5

---

## 5. 커밋 순서 (오너 지시 후)

두 세션분이 섞여 있으니 **경로를 못 박아** 나눠 커밋한다. 제안:

```bash
# ① 선물 실가격 대사 — 앞 세션 것 (오너에게 이 커밋의 소유를 먼저 확인)
git commit --only -- backend/app/backtest.py backend/tests/test_mr_legrecon.py

# ② 절대수익형 성과지표 + 구간 전역화
git commit --only -- backend/app/mrmetrics.py backend/tests/test_mrmetrics.py

# ③ 근사 최적화 격자
git commit --only -- backend/app/mrbacktest.py

# ④ Backtest 다리 대사 (FSW 7행 + ASW with_legs)
git commit --only -- backend/app/futures.py backend/app/mixedbook.py \
  backend/tests/test_futures.py backend/tests/test_mixedbook.py \
  src/backtest/BacktestWindow.tsx src/backtest/recon.ts

# ⑤ 화면 — Delta·비용 프리셋·구간·성과 열둘·최적화 절
git commit --only -- src/mr/KnobBar.tsx src/mr/StrategyWindow.tsx src/mr/api.ts \
  src/lib/staticPaths.ts guards/mr-canon.test.ts guards/mr-span.test.ts \
  guards/mr-optimize.test.ts

# ⑥ 라우트 (main.py 는 앞 세션 것과 섞여 있어 마지막)
git commit --only -- backend/app/main.py
```

⚠ ②~⑥ 을 쪼개면 **중간 커밋이 안 돈다**(main.py 가 마지막이라 `mrm` import 가
없는 상태가 생긴다). 오너가 「한 커밋」을 원하면 그게 더 정직하다 — 물어라.

⚠ **백엔드를 고쳤으므로 배포 뒤 `SauronV2Backend` 재기동이 필요하다**(§1).

---

## 6. 함정 — 오늘 내가 실제로 밟은 것들

1. **가드가 파일의 첫 `aside={` 를 창 머리로 읽었다.** `optPane` 의 `Panel` 이
   자기 aside(순위 기준 세그먼트)를 갖게 되면서 `mr-canon` 의 「창 머리 부제는
   caption」이 패널 활자를 쟀다. 닻을 `windowKey=` 로 못 박아 고쳤다 —
   **파일 안에 같은 prop 이 둘이 될 수 있으면 닻을 구조로 잡아라.**

2. **Ulcer 를 카드에 실린 반올림 값으로 되나누면 Martin 이 안 맞는다**
   (65.328 대 65.421). 시험은 반올림 **전** 값으로 검산해야 한다.

3. **`GPR = Omega − 1` 이 항등이다** — 같은 일별 계열에서 재면. 카드 둘이
   같은 수를 두 번 적게 되므로 GPR 은 월 버킷으로 갈랐다.

4. **선물 각주가 자기 표의 열을 「없다」고 말했다.** 「선물은 손익이 전부
   평가예요 — 캐리·롤다운이 없어요」 + 「캐리·롤다운은 IRS 다리에서 와요」가
   한 문단에 섰다. 다리 판에서는 base 를 **덧붙이지 말고 갈아 끼워라.**

5. **`stripComments` 한 `src()` 는 인자가 하나다.** 주석을 재려면
   `fs.readFileSync` 로 raw 를 따로 읽어야 한다(가드에서 `src(f, true)` 로
   썼다가 죽었다).

6. **Bash 힙독에 따옴표가 든 한글 패치 스크립트를 넣지 마라.** `cat > x.py`
   를 입력 없이 쓰면 stdin 을 기다려 2분 타임아웃. 패치는 Write 로 파일에
   쓰고 `python <파일>` 로 돌려라.

7. **`rolling_series` 가 격자 시간의 63%였다.** 순수 함수인데 칸마다 다시
   돌고 있었다. 엔진에 `roll=` 손잡이를 낸 것은 **산술이 아니라 캐시**이고,
   `test_the_roll_handoff_does_not_change_a_single_number` 가 그 사실을 잠근다.

8. **:8200 은 라이브다.** 내 백엔드는 `:8299` 로 띄웠다
   (`.env.development.local` 이 이미 8299 를 가리킨다):
   ```bash
   cd backend && SAURON_DEV_LOCAL=1 PYTHONUTF8=1 python -m uvicorn app.main:app --port 8299
   cd .. && pnpm dev      # :3200
   ```
   MR 화면 주소: `http://127.0.0.1:3200/?g=strategy&s=mean-reversion`
   Backtest 북 딥링크: `?g=outright&bt=<encodePositions>`

---

## 7. 새 표면 요약 (계약)

```
GET /api/mr/strategy      → + spans: MrSpanPerf[]   (all·1y·1q·1m, 한 번에)
GET /api/mr/optimize      → { id, label, real:false, headReal, span, from, to,
                              days, cells: MrOptimizeCell[] }   ← 신규
```
```ts
// src/mr/api.ts
MR_SPANS / MR_SPAN_TABS / MR_SPAN_LABEL / MrSpan
MrPerf { from,to,days, totalPnl,maxDrawdown, sortino,calmar,gpr,gprMonths,
         omega,profitFactor,ulcer,martin, recoveryDays,recovered,
         winRate,numTrades, breakevenCostBp,breakevenCostMult }
MrOptimizeCell = MrPerf & { lookback,entryZ,exitZ,stopZ,entryMode,current }
MR_RANK_KEYS / rankCells() / fetchMrOptimize()
MR_COST_PRESETS = [0.25, 0.5, 1]
```
```python
# backend/app/mrmetrics.py
SPANS · span_start(dates, months) · score(dates, points, trades, start, cost_bp)
· spans_for(dates, points, trades, cost_bp)
# backend/app/main.py
MR_ENTRY_MODES_ALL · MR_OPT_MAX_CELLS · _mr_optimize(...) · mr_optimize(route)
# backend/app/futures.py
book_recon(..., with_legs=False) · _bucket_leg(rows, labels)
# backend/app/mrbacktest.py
simulate(..., roll=None)   # 캐시 손잡이, 산술 아님
```

가드: `guards/mr-optimize.test.ts` 23건 · `backend/tests/test_mrmetrics.py` 18건
