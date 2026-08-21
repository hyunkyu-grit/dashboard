# P4 진단 — eq (9) 배선 · 잔차 감쇠 · 운영 결함 둘

2026-08-21. 세션 P4. **아직 아무것도 안 고쳤다.** 이 문서는 고치기 전에 잰
것이고, D 의 모든 측정이 여기 §5 를 기준으로 선다.

측정 도구는 `backend/scripts/p4_measure.py` 한 벌이다. 한 번 고칠 때마다
같은 잣대로 다시 돌린다.

---

## C.1 결함과 폭발 반경 — eq (9) 의 `− UC_I`

### 어디가 `0.0` 인가

`bigfoot/solve/system.py:455`:

```python
new["di"] = (self.inv.alpha.value * (0.0 - lag("i_fi", t))
             + self.inv.extras["dy_lag"].value * lag("di", t)
             + self.inv.extras["gap"].value * d_gap
             + res["investment"][t])
new["i_fi"] = lag("i_fi", t) + new["di"]
```

`0.0` 이 **설비투자 목표의 편차**다. 같은 자리가 잔차 추출에도 있다
(`bigfoot/conditional/residuals.py:423`, `inv.alpha * (0.0 - L(d["i_fi"]))`).
둘은 한 벌이라 같이 고쳐야 한다 — 한쪽만 고치면 역사 잔차가 솔버가 푸는
식과 다른 식의 잔차가 된다.

목표식 자체는 `equations/korea.py:333` 에 있고, 사용자비용 항이 **아예
없다**:

```python
def investment_fi_target() -> BehavioralEquation:
    """Eq. 9: i_fi* = β_I0 + β_I1·potential + β_I2·Covid (all RESOLVED)."""
```

인쇄식은 넷째 항을 든다. PDF 를 렌더해서 확인했다(PDF 24쪽 = 인쇄 p.18):

```
ln I*_t = β_I,0 + β_I,1 ln Ȳ_t + β_I,2 Dummy_20Q2 − UC_I,t            (9)
UC_I,t  = (i_Firm,t + i_CB,t)/2 − π^yoy_cpi,t/4 + δ_I,t               (10)
Δln I_t = α_I,0(ln I*_{t−1} − ln I_{t−1}) + α_I,1 Δln I_{t−1}
          + E_t[Σ_{k=1}^∞ d_k ln ΔI*_{t+k}]
          + γ_I,1 Δŷ_t + γ_I,2 Δln P_I,t + γ_I,3 ln DRAM_t + u_I,t     (11)
```

**렌더에서 새로 확인한 것 셋.**

1. eq (11) 의 오차수정은 **목표의 t−1 값**을 쓴다(`ln I*_{t−1}`). 그래서
   목표를 상태변수로 세우고 **지연**해서 넣어야 한다 — 건설(eq 14)이 이미
   그렇게 돼 있다(`lag("ih_star", t)`).
2. `γ_I,3` 는 `ln DRAM_t` 를 **수준**으로 곱한다. 차분이 아니다.
3. `δ_I,t` 에 시간 첨자가 붙어 있다. eq (13) 의 `δ_IH,t` 도 마찬가지다 —
   렌더해서 확인했다(PDF 26쪽 = 인쇄 p.20).

### `i_fi` 를 쓰는 곳 (배선이 살아나면 무엇이 같이 움직이나)

배선 그래프에서 실측한 소비처는 셋이다.

| 소비처 | 자리 | 가중치 |
|---|---|---|
| `y_gap` (GDP 항등식) | `system.py:353` | `sh["i_fi"]` = 지출비중 |
| `m` (eq 21 수입수요, LR) | `system.py:340` | `zm["fi"]` |
| `m` (eq 21 수입수요, SR) | `system.py:343` | 〃 (전분기) |

그리고 `y_gap` 에서 소비(eq 8)·건설(eq 14)·수출입·물가·준칙으로 전부
퍼진다. **설비투자는 갭의 한 성분이므로 폭발 반경은 사실상 모형 전체다.**

### 살아나는 계수 슬롯 — **하나도 없다**

이것이 이 수리의 성질을 정한다.

| 슬롯 | 값 | 상태 | 편차 공간에서 |
|---|---|---|---|
| `investment_fi.target.slots[0]` β_I0 | −4.6240 | RESOLVED | 상수 → 소거 |
| `investment_fi.target.slots[1]` β_I1 | 1.2121 | RESOLVED | 잠재산출이 **곧 추세** → 0 |
| `investment_fi.target.slots[2]` β_I2 | 0.0274 | RESOLVED | 더미 → 0 |
| `− UC_I` 의 계수 | **−1, 인쇄됨** | 슬롯 없음 | **여기가 살아난다** |
| `investment_fi.growth.slots[0]` α_I0 | 0.1983 | RESOLVED | 이미 배선됨 (EC 적재) |
| `[1]` α_I1 | 0.0248 | RESOLVED | 이미 배선됨 (AR) |
| `[2]` γ_I1 | 0.6182 | RESOLVED | 이미 배선됨 (Δŷ) |
| `[3]` γ_I2 | −0.1000 | RESOLVED | §C.3 — 편차에서 구조적 0 |
| `[4]` γ_I3 | −0.0066 | RESOLVED | **부재**(Gartner 유료) |

즉 **배선을 살려도 새로 켜지는 추정 계수가 없다.** 사용자비용의 계수는
논문이 −1 로 인쇄했고 부록 D 에 슬롯이 없다. 이 수리에 「밴드에 맞춘
모수」가 들어갈 자리가 구조적으로 없다는 뜻이고, 그래서 E 의 자제 조항과
충돌하지 않는다.

### `UC_I` 를 지금 있는 계열로 조립할 수 있나 — **된다**

건설이 작동하는 선례다(`korea.py:573`):

```python
@staticmethod
def user_cost_dev(i_firm, i_cb, cpi_yoy) -> float:
    """eq (13) in deviations — delta_IH is a constant and drops out."""
    return (i_firm + i_cb) / 2.0 + cpi_yoy / 4.0
```

솔버가 부르는 인자도 이미 다 있다(`system.py:472`):
`i_firm=new["r_firm"]`, `i_cb=new["kr10y"] + new["cb"]`,
`cpi_yoy=new["cpi_yoy"]`. **셋 다 내생이고 이미 풀려 있다.**

**FI 와의 차이는 π 의 부호 하나뿐이다.** eq (10) 은 `− π/4`, eq (13) 은
`+ π/4`. 둘 다 인쇄된 대로다(양쪽 다 렌더해서 확인). 그래서 FI 의
`user_cost_dev` 는 건설 것의 복사가 아니라 **부호를 바꾼 짝**이어야 한다.

### 그래서 D.1 이 시험하는 가설

논문 앵커 실패 넷은 지금 「금리 → 주택 → 부채 → 소비 **진폭**」 사슬로
귀속돼 있고, 뿌리를 「논문이 안 박은 금리 단위 규약」이라고 적어 놨다.
**설비투자로 가는 통로가 죽어 있으면 금리 충격이 갈 곳이 하나 줄고, 그
진폭이 살아 있는 통로로 몰린다.** D.1 이 그 가설의 시험이다.

---

## C.2 δ_I — 지금은 «없다», 그리고 그게 정당하다

`grep -rn "delta_I\|depreciation" bigfoot/` → 코드에 δ 가 **하나도 없다.**
건설의 `user_cost_dev` 는 docstring 에서 «delta_IH is a constant and drops
out» 이라고 명시하고 항 자체를 안 쓴다.

- 계열인가 상수인가: 인쇄식은 `δ_I,t` 로 **시간 첨자**를 단다. 상수가
  아니다. ECOS 에서 자산유형별 고정자본소모를 받아 오면 만들 수는 있으나
  **지금 적재된 52개 계열에 없다.**
- 편차 공간에서 무엇이 되나: `δ_I,t` 는 어떤 기저도 안 건드리는 **외생**
  변수다. 그러니 그 편차는 기저에서 정확히 0 이고, 상수로 두는 것과 결과가
  **같다**. 레벨 전망에만 영향을 준다.
- 건설의 처리가 그대로 옮겨 가나: **그대로 간다.** 같은 근거, 같은 결과.
  단 건설 쪽 docstring 이 «상수라서» 라고 적은 것은 정확하지 않다(인쇄식은
  `δ_IH,t`). 새 코드는 «외생이라서 편차가 0» 이라고 적는다 — 그게 참인
  이유다.

**결론: δ_I 를 위해 새 계열을 받아 올 필요가 없다. 새 플래그로 이름만
단다.**

---

## C.3 eq (11) γ_I2 (디플레이터) — **계열은 있는데 편차에서 구조적 0 이다**

- 계열: `data/raw/bigfoot_defl_fi_q.csv` **있다**(ECOS 200Y112/1020112,
  8/21 적재). `rebake/status.py::data_edges` 가 이미 이 파일을 빈티지
  구속으로 읽고 있다(2026Q1 — 5개월 지연, 이 리포에서 제일 낡은 계열).
- 잔차 쪽은 **이미 배선돼 있다**(`residuals.py:425`):
  `- inv.extras["deflator"].require() * D(d["p_i"])`.
- 솔버 쪽은 **안 돼 있다**. 그리고 배선해도 **정확히 0 이 더해진다** —
  `p_i` 는 외생이고 어떤 기저도 그걸 안 흔들기 때문이다. 건설의
  `g_deflator`(eq 14 의 `Δln P_IH`)도 **똑같이** 솔버에서 빠져 있고, 그
  자리에 이유가 적혀 있다:

  > `ln GB` 와 `ln P_IH` 는 외생이고 안 흔들려서 → 여기서 0

- 살릴 방법이 있나: `P_I` 를 내생으로 만들어야 한다. 논문은 **P_I 의
  방정식을 인쇄하지 않는다.** 본문이 적은 것은 «FI 투자 디플레이터 변화가
  표본에서 명목환율 변화와 79% 상관» 이라는 **관찰**이지 배선이 아니다.
  `s → P_I` 를 우리가 만들면 그건 지어낸 배선이고, E 가 금지하는 종류다.

**결론: γ_I2 는 «못 채운 자리» 가 아니라 «편차 공간에서 구조적으로 0 인
자리» 다.** D.2 는 그 사실을 코드가 스스로 말하게 하고(건설과 같은 문장),
Method 면 한계표에 줄을 세우는 일이다. 숫자는 하나도 안 움직인다 — 그게
예측이고, D.2 의 측정이 그 예측을 시험한다.

γ_I3 (Gartner 반도체 초과수요 지수)는 유료라 **부재로 남는다.** ECOS 의
「DRAM」(402Y016/30911201AA)은 수출물가지수라 다른 변수다 — 8/21 에 잘못
배선했다가 되돌린 자리다. 다시 안 넣는다.

---

## C.4 번호 — `eq_no='10'` 은 인쇄 (11) 이다

- 자리: `bigfoot/equations/korea.py:422`,
  `ECMGrowth("investment_growth", "10", ...)`. docstring 도 «Eq. 10» 이라
  적는다(`korea.py:416`).
- 인쇄 확인: PDF 24쪽에서 (10) 은 **사용자비용 정의**, (11) 이 설비투자
  PAC 성장식이다. 코드가 틀렸다.
- 지금 무엇이 이 번호를 타나:
  - `wiring/edges.py::EQ_NO_CORRECTIONS` 가 **표로 우회**하고 있다.
    엔진이 동결이었기 때문이다. 이제 엔진을 고치므로 이 표는 은퇴한다.
  - 엣지의 번호는 실제로는 `EQ_NO_CORRECTIONS` 가 아니라
    **`SLOT_EQ["investment_fi.growth"] = "11"`** 이 준다(슬롯 그룹이
    번호를 정한다). 그래서 현재 엣지리스트의 `y_gap → i_fi` 는 이미 eq
    11 로 서 있다. 실측:

    ```
    into i_fi: [('y_gap','SR','+','11','investment_fi.growth.slots[2]')]
    ```

  - `EQ_OF["i_fi"] = ("9", "11")` 도 이미 11 이다.

  즉 **번호 수정의 효과는 엔진 소스와 정정표에 국한되고, 엣지의 키는 안
  바뀐다.** D.3 이 그 사실을 실측으로 확인한다.

---

## C.5 기준선 — 여기가 D 의 모든 측정이 딛는 자리

`backend/output/p4/baseline.json` 에 기계가 쓴 것이 있다. 아래는 그 요약이다.

### 산출물 md5 (2026-08-21)

```
scenario_basis.json   bd7b5b5241235460bb2c7706b4493cd2   78,959 B
assumptions.json      123c591b96d8f497d104772a3554d99d    2,796 B
engine_status.json    400bad6262330c67b5511553a7ed0df8    4,518 B
wiring_graph.json     16965323fc0ca9da54745307f050f296   26,480 B
residual_moments.json 82ce048ae7ca06f0a2dbd25590419815    5,016 B
irf_summary.json      09667a6e89885214a0a11d162a4cdf96    4,189 B
```

`src/lab/scenario/basis.json` 도 `scenario_basis.json` 과 **바이트 동일**
(같은 md5). §C.8 을 보라 — 리베이크가 이 사본은 안 옮긴다.

### 스코어카드 9/13 — 칸마다 실측값

`bigfoot/solve/irf.py::SCORECARD` + `SHAPE_CHECKS`, 수치 8 + 모양 5.

| | IRF | 지표 | 실측 | 밴드 |
|---|---|---|---|---|
| PASS | A | gdp_gap_trough_pp | −0.0867 | [−0.09, −0.05] |
| PASS | A | cpi_yoy_trough_pp | −0.0390 | [−0.07, −0.03] |
| **MISS** | A | housing_trough_pct | **−0.9290** | [−0.50, −0.30] |
| **MISS** | A | debt_gdp_change_pp | **−0.7539** | [−0.40, −0.20] |
| PASS | B | gdp_gap_trough_pp | −0.0254 | [−0.06, −0.02] |
| PASS | C | cpi_yoy_peak_pp | +0.1711 | [+0.12, +0.20] |
| **MISS** | C | gdp_gap_trough_pp | **−0.0836** | [−0.07, −0.03] |
| **MISS** | C | consumption_trough_pct | **−0.1473** | [−0.11, −0.05] |
| PASS | A | shape:fx_appreciation | — | |
| PASS | B | shape:fx_depreciation | — | |
| PASS | B | shape:inflation_up_then_down | — | |
| PASS | A | shape:gdp_hump | — | |
| PASS | C | shape:gdp_hump | — | |

### ⚠ 실린 실패 넷 중 하나가 틀렸다 — 확인했다

`config/paper_anchors.json` 의 `scorecard.misses` 는 네 번째를
`oil_10pct.imports` 로 적는다. **엔진에서 미달인 것은 `oil_10pct.gdp`
다.**

```
oil_10pct.imports   실측 −0.0905   밴드 [−0.098, −0.042]   → PASS
oil_10pct.gdp       실측 −0.0836   밴드 [−0.070, −0.030]   → MISS
```

그리고 `irf.py` 의 13줄에는 수입 칸이 **아예 없다.** 그러니 「9/13」을
만드는 실패 넷은 {A 주택, A 부채, C GDP갭, C 소비} 이고, 화면이 실린
목록을 그대로 보여 주면 **네 칸 중 하나가 거짓말**이다. D.7 에서 고친다.

같은 파일의 `measured` 값들은 **기저**에서 잰 것이고(`policy_q1`,
hpi −0.94391 / debt −0.76602), `irf.py` 의 13줄은 **IRF 실행**에서 잰다
(hpi −0.92897 / debt −0.75390). 두 잣대가 섞여 있다. 새 측정은 둘 다 적는다.

### 논문 앵커 13칸 (IRF 잣대, 밴드 = 앵커 ±40%)

| 앵커 | 논문 | IRF 실측 | 판정 |
|---|---|---|---|
| kr_policy_25bp.gap | −0.07%p | −0.0867 | PASS |
| kr_policy_25bp.cpi | −0.05%p | −0.0390 | PASS |
| kr_policy_25bp.hpi | −0.4% | −0.9290 | MISS |
| kr_policy_25bp.debt_krw | −5.1조원 | — | 대조불가(편차공간에 없음) |
| kr_policy_25bp.debt_ratio | −0.3%p | −0.7539 | MISS |
| us_policy_25bp.kr10y | +0.06%p | +0.0592 | PASS(핀) |
| us_policy_25bp.gdp | −0.04%p | −0.0254 | PASS |
| **us_policy_25bp.fi** | **−0.02%** | **−0.0324** | **MISS** |
| us_policy_25bp.cpi | (모양) | +0.0378 | 모양 |
| oil_10pct.cpi | +0.16%p | +0.1711 | PASS |
| oil_10pct.consumption | −0.08% | −0.1473 | MISS |
| oil_10pct.gdp | −0.05%p | −0.0836 | MISS |
| oil_10pct.imports | −0.07% | −0.0905 | PASS |

**미 정책 +25bp 의 설비투자 응답이 지금도 −0.0324% 다** — 논문의 −0.02%
보다 **62% 크다**. 사용자비용이 안 배선된 상태에서 산출갭 통로 하나만으로
이미 넘친다. 사용자비용을 배선하면 금리가 오르면서 목표가 내려가므로
**더 깊어질 것이 예상된다.** D.1 이 그 예측을 시험한다.

### 기저 꼬리 |q24|/max

| 기저 | y_gap | cpi_yoy | hpi | debt | i_kr | x | m |
|---|---|---|---|---|---|---|---|
| policy_q1 | 0.216 | 0.070 | 0.255 | 0.014 | 0.077 | 0.313 | 0.252 |
| policy_q4 | 0.160 | 0.082 | 0.191 | 0.093 | 0.156 | 0.207 | 0.166 |
| policy_q8 | 0.061 | 0.407 | 0.073 | 0.375 | 0.249 | 0.109 | 0.106 |
| cpi | 0.058 | 0.027 | 0.284 | 0.133 | 0.216 | 0.134 | 0.104 |
| gap | 0.077 | 0.066 | 0.864 | 0.992 | 0.209 | 0.946 | 0.291 |
| exports | 0.183 | 0.322 | 0.614 | 0.870 | 0.172 | 0.276 | 0.019 |
| us_2q | 0.187 | 0.700 | 0.188 | 0.525 | 0.945 | 0.083 | 0.229 |
| us_4q | 0.263 | 0.761 | 0.260 | 0.589 | 0.965 | 0.083 | 0.306 |
| us_6q | 0.360 | 0.830 | 0.345 | 0.661 | 0.983 | 0.092 | 0.402 |
| oil | 0.664 | 0.105 | 0.889 | 0.986 | 0.025 | 0.415 | 0.630 |

전건은 `backend/output/p4/baseline.json`. **국내 정책 기저의 꼬리는 이미 짧다.**
길게 남는 것은 `gap`·`exports`·`oil`·`us_*` 쪽이다.

### 12개월(h=4) IRS 델타, 기저 단위 bp

| 기저 | 1Y | 2Y | 3Y | 5Y | 10Y |
|---|---|---|---|---|---|
| policy_q1 | −13.971 | −11.432 | −8.645 | −4.533 | −1.962 |
| policy_q2 | −5.268 | −7.737 | −6.621 | −3.510 | −1.389 |
| policy_q3 | +2.059 | −4.660 | −5.044 | −2.810 | −0.978 |
| policy_q4 | +9.841 | −1.094 | −3.163 | −1.984 | −0.508 |
| policy_q5 | +16.971 | +2.691 | −1.138 | −1.129 | −0.030 |
| policy_q6 | +13.745 | +4.239 | −0.576 | −1.206 | −0.028 |
| policy_q7 | +9.607 | +5.833 | +0.095 | −1.269 | −0.031 |
| policy_q8 | +4.871 | +7.356 | +0.894 | −1.298 | −0.034 |
| cpi | −0.476 | −14.768 | −16.123 | −10.234 | −3.662 |
| gap | −16.202 | −12.178 | −7.098 | −0.371 | +0.925 |
| exports | −39.368 | −24.854 | −9.693 | +6.317 | +2.852 |
| us_2q | −3.477 | +1.835 | +10.722 | +15.222 | +0.428 |
| us_4q | +4.083 | +26.009 | +71.894 | +100.569 | +2.396 |
| us_6q | −18.304 | −29.848 | −50.370 | −66.034 | −1.408 |
| oil | −6.746 | −9.983 | −7.638 | −2.651 | −1.112 |

### 화면이 인용하는 경로 둘

지속 −25bp × 8분기:

```
q9~q12 되돌림   +8.44 / +15.90 / +22.35 / +27.79 bp
룰 이탈 σ       RMS 0.217 · max 0.510
```

| 테너 | 합계 | 경로 그대로 | 준칙 되돌림 | CD 전달 | 준칙 몫 |
|---|---|---|---|---|---|
| 1Y | +0.019 | +0.000 | +0.000 | +0.019 | — |
| 2Y | +8.145 | +12.500 | −3.190 | −1.165 | −39.2% |
| 3Y | +11.676 | +8.333 | +3.854 | −0.511 | **33.0%** |
| 5Y | +7.557 | +5.000 | +2.469 | +0.088 | **32.7%** |
| 10Y | +2.555 | +2.500 | +0.051 | +0.004 | 2.0% |

계단 −25/−50×7:

```
q9~q12 되돌림   +16.34 / +30.82 / +43.41 / +54.05 bp
```

| 테너 | 합계 | 준칙 되돌림 | 준칙 몫 |
|---|---|---|---|
| 1Y | −8.285 | +0.000 | −0.0% |
| 2Y | +11.544 | −6.923 | −60.0% |
| 3Y | +19.942 | +7.133 | **35.8%** |
| 5Y | +13.243 | +4.790 | **36.2%** |
| 10Y | +4.253 | +0.099 | 2.3% |

> **과제지의 «5Y 44%» 는 재현이 안 된다.** 지속 경로 32.7%, 계단 경로
> 36.2% 다. 3Y 의 33% 는 지속 경로에서 **정확히** 나온다(33.0%). 5Y 숫자의
> 출처를 못 찾았고, D.4 는 **여기 실측한 값**을 전·후 기준으로 쓴다.

### 선형성 게이트

```
a_policy_cpi   curve 0.0001bp · macro 1e-06pp   PASS
b_us_exports   curve 0.0001bp · macro 1e-06pp   PASS
```

### 게이트 기준선

```
backend pytest tests/engine   46 passed · 1 failed · 1 skipped
  실패 = test_irs_curve.py::test_ou_fit_sane_and_json_locked
         (10y OU μ 가 실린 json −24.0bp 대 재적합 −24.1bp, 문턱 0.05)
         **P4 이전부터 빨갛다.** 회사 자료(krwswapdata)가 앞으로 가서
         `irs_curve_forecast.json` 이 낡은 것이고, 기저와 무관하다.
vitest                        1246 passed · 2 failed (75 파일 중 1)
  실패 = guards/production-env.test.ts 둘. 개발용 `.next` 가 남아 있어서다.
         게이트 순서(`pnpm build` → `vitest`)를 지키면 사라진다.
```

---

## C.6 잔차가 지평에서 0 으로 떨어지는 자리

### 어디서 떨어지나

떨어뜨리는 코드가 따로 있는 게 아니다. **없어서 0 이다.**

기저 `policy_qN` 은 `pin["i_kr"][N] = 0.25`, 나머지 분기는 `NaN` 으로
푼다(`scenario_basis/build.py:100`). 솔버는 못 박힌 분기에서만 준칙을
덮어쓰고, 그 분기의 준칙 잔차를 역산해 `diagnostics.pin_residuals` 에
담는다(`system.py:504`). **못이 없는 분기의 잔차는 0 이다.**

화면은 여덟 점을 전부 못 박으므로(`path.ts::PINNED_Q = 8`), 조합된 경로의
암묵 잔차는 q1~q8 에만 있고 q9 부터 정확히 0 이다. 그 순간부터 준칙이
자기 힘으로 되돌린다 — 그것이 실측 +8.4 / +15.9 / +22.4 / +27.8bp 다.

### ρ 는 설정값인가, 새 자리가 필요한가

**새 자리가 필요하다.** 지금 리포에 있는 감쇠 상수 둘은 다른 것이다.

- `assembler.PHI_I_TAIL = 0.85` — 기저 지평(24분기) **밖**에서 정책 편차가
  잦아드는 속도. 지평 안의 잔차와 무관하다.
- `PolicyRule.phi_i` — 준칙 자체의 평활. 잔차가 아니라 금리의 지속성이다.

부록 D 에 넣으면 **안 된다.** 부록 D 는 논문이 인쇄한 계수의 자리이고,
ρ 는 우리가 **역사 잔차에서 추정한** 값이다. `system.py` 의 명명 상수 +
플래그로 세우고, 기저가 그 값과 표준오차를 같이 싣는다.

### AR(1) = 0.801 재확인 + 표준오차

과제지는 `conditioning_residuals[policy_qN].policy_rule` 에서 확인하라고
하는데, **그 배열로는 확인할 수 없다.** 그것은 기저마다 «그 분기를 못
박으려면 준칙을 얼마나 미나» 인 8개 숫자이고, 구성상 **한 칸만 0 이 아니다**
(못이 한 분기뿐이므로). 자기상관을 잴 시계열이 아니다.

0.801 의 실제 출처는 **역사 잔차**다 — `conditional/residuals.py::
extract_residuals()` 의 `policy_rule` 열, 그리고 그것을 요약한
`output/residual_moments.json`. 거기서 다시 풀었다
(`backend/scripts/p4_ar1.py`, 결과 `backend/output/p4/ar1.json`):

```
표본        2000Q1–2026Q2 · n = 106 (회귀 관측 105)
평균        −0.1855 pp        표준편차   0.4981 pp
피어슨 자기상관              0.8015     ← 실린 0.801 과 같다
OLS(상수 포함)   ρ = 0.8007   SE(OLS) 0.0589   SE(NW, L=4) 0.0745
OLS(상수 없음)   ρ = 0.8277   SE(OLS) 0.0554   SE(NW) 0.0727
추세 제거 후     ρ = 0.7808   SE(OLS) 0.0609   SE(NW) 0.0781
반감기          3.12 분기 (상수 포함 판)
```

**밴드가 좁다.** NW 표준오차로 95% 구간이 대략 [0.65, 0.95] 이고, ρ = 0
(급단절)은 **10σ 밖**이다. 상수 포함/제외/추세 제거 어느 판으로 가도
0.78~0.83 안이다. 화면이 «0.801» 을 인용해도 되고, 인용할 때 **표준오차를
같이 실어야** 한다.

### 어떻게 구현하는가 (D.4 의 설계)

기저 구조를 바꾸지 않고, **프런트를 한 줄도 안 고치고** 된다.

관찰: 화면의 경로는 항상 여덟 분기를 다 못 박는다. 조합된 경로의 q8 잔차는
`Σ_q c_q · u^(q)_8` 인데 `u^(q)_8 = 0` (q ≠ 8) 이므로 **`c_8 · u^(8)_8` 하나**
다. 그러니 «q8 의 잔차를 ρ 로 끌고 간다» 를 솔버에 넣으면, 그 꼬리는
`policy_q8` 기저 **하나에만** 실리고 선형결합이 자동으로 크기를 맞춘다.

```
u_t = ρ^(t−7) · pin_resid[7]      t ≥ 8   (0-베이스 색인)
```

- `policy_q1`~`q7` 은 q8 에 못이 없어 `pin_resid[7] = 0` → 꼬리 없음.
- `policy_q8` 만 꼬리를 진다.
- 여덟 점을 다 못 박는 정확해도 같은 규칙을 받으므로 **선형성 게이트가
  그대로 성립한다.**
- 급단절은 `ρ = 0` 또는 스위치 `off` 로 정확히 복원된다.

---

## C.7 운영 결함 둘

### (a) `bigfoot/data/ecos.py` 의 `sys.exit()`

두 자리다(과제지는 165 하나를 짚었다).

```
ecos.py:130   sys.exit("ECOS_API_KEY not set (env var or .env)")     ← _api_key()
ecos.py:165   sys.exit(f"no cache for {name} at {cache} ...")        ← _read_cache()
```

같은 모양이 FRED 에도 있다: `fred.py:26`, `fred.py:45`.

**호출자가 기대하는 것.** `_read_cache` 는 `pd.DataFrame` 을 돌려주기로
돼 있고, 부르는 쪽(`fetch_ecos`)은 그 자리에서 예외를 잡을 준비가 돼
있다 — 바로 위 `except (requests.RequestException, RuntimeError)` 가 그
증거다. `sys.exit` 는 `SystemExit` 를 던지는데 그것은 `BaseException` 이라
**`except Exception` 이 안 잡는다.**

**리베이크의 원자성 경로가 보는 것.** 지금은 엔진을 **서브프로세스**로
돌린다(`rebake/__main__.py::_run_engine`). 그래서 `SystemExit` 는 종료코드
1 이 되고 `RebakeError` 로 승격돼 이전 산출물이 복원된다 — **이 경로는
지금도 산다.** 진짜 결함은 둘이다.

1. **`blocked` 상태가 안 선다.** ECOS 가 막혀서 캐시로 때웠으면
   `[warn] fetch failed` 를 stdout 에서 건져 `staleness.state = "blocked"`
   가 뜬다(`status.py:170`). 그런데 **캐시조차 없어서** `sys.exit` 하면
   엔진이 죽고 `engine_status.json` 이 아예 새로 안 써진다. 화면은 어제
   상태를 그대로 보여 준다 — 「막혔다」가 아니라 「신선하다」로.
2. **프로세스 안에서 부르면 못 잡는다.** `bigfoot.solve.system` 이
   모듈 스코프에서 `gdp_shares` 를 부르므로, `BigfootSystem` 을 import 하는
   모든 인-프로세스 경로(`wiring/edges.py`, `wiring/surfaces.py`,
   `tests/engine/**`, 앞으로 있을 인-프로세스 리베이크)가 **SystemExit 로
   죽는다.** 서버(`app/`)는 자기 ECOS 클라이언트(`app/ecos.py`,
   `EcosError`)를 쓰므로 지금은 안 닿는다 — 그 경계가 사라지는 날 서버가
   같이 죽는다.

**고칠 모양.** `EcosDataError(RuntimeError)` 를 새로 세우고 두 자리를
`raise` 로 바꾼다. `RuntimeError` 를 상속하면 `fetch_ecos` 의 기존
`except` 가 그대로 잡는다. 리베이크는 그 실패를 **`blocked` 로 승격**해
이전 기저를 그대로 두고 `engine_status.json` 만 갱신한다.

### (b) plotly

`requirements.txt` 가 이미 정확히 진단해 놨다:

```
bigfoot/scenario_basis/build.py:39
    from bigfoot.solve.phase3 import BETA_SYNC_ADOPTED, FINAL_EQ24, FINAL_OPTIONS
bigfoot/solve/phase3.py:13
    import plotly.graph_objects as go
```

`phase3.py` 는 **차트를 그리는 모듈**인데, 최종 옵션 상수 셋이 거기 살아서
기저를 굽는 런타임 경로가 plotly 를 끌고 온다. 같은 import 를 하는 곳이
넷이다: `conditional/hfl.py:33`, `irs_curve/assembler.py:100`,
`scenario_basis/build.py:39`, `wiring/edges.py:605`, `wiring/surfaces.py`,
그리고 엔진 테스트 둘.

**다시 쓸 필요 없다.** 상수를 `bigfoot/solve/config.py`(순수 데이터, import
없음)로 옮기고 `phase3.py` 가 거기서 재수출하면, 런타임 경로에서 plotly 가
사라진다. plotly 를 실제로 쓰는 것은 **차트를 그리는 넷뿐**이고
(`phase3.py` · `cd_layer/study.py` · `conditional/hfl.py` ·
`irs_curve/assembler.py`), 그중 셋은 이미 **함수 안에서** import 한다.
`hfl.py` 만 모듈 스코프라 같이 내린다. 그러면 `requirements.txt` 의
`plotly>=5.0` 은 «개발·리포트용» 으로 분리할 수 있다.

---

## C.8 계약에 무엇이 닿나

### 모양이 바뀌는 것

| 파일 | 무엇이 바뀌나 | 어느 단계 |
|---|---|---|
| `backend/output/scenario_basis.json` | 값 전부. `caveats` 에 줄 추가, 잔차 감쇠 블록 추가 | D.1·D.2·D.4 |
| `src/lab/model/artifacts/scenario_basis.json` | 위의 사본 | 리베이크가 옮김 |
| **`src/lab/scenario/basis.json`** | **세 번째 사본. 리베이크가 안 옮긴다** | 손으로 (또는 §아래) |
| `backend/output/assumptions.json` | `written_at` 만 | 매 리베이크 |
| `backend/output/engine_status.json` | 스코어카드 실패 목록·수치 | D.1·D.7 |
| `backend/config/paper_anchors.json` | `misses` 넷 교체(`.imports`→`.gdp`), 실측값 | D.7 |
| `backend/output/wiring_graph.json` | 노드 +1(`i_fi_star`), 엣지 +4~5, `eq_no_corrections` 비움 | D.1·D.3 |
| `src/lab/model/model/wiring_graph.json` | 위의 사본 (`wiring/surfaces.py` 가 옮김) | 〃 |
| `src/lab/model/fixtures/wiring_graph.fixture.json` | 세션 1 픽스처 | D.7 |
| `backend/output/model_surface.json` (+ 프런트 사본) | 등록부의 배선 여부, 계수표 | D.1~D.4 |
| `backend/output/method_surface.json` (+ 프런트 사본) | 원장 `fi-usercost` 행, 한계표, 스코어카드 | D.1~D.4 |
| `backend/output/residual_moments.json` | investment 잔차의 모멘트 | D.1 |
| `backend/output/irf_summary.json` · `irf_charts.html` | IRF 값 | D.1~D.4 |
| `guards/scenario-parity.vectors.json` | **기계가 다시 뽑는다** — `python -m bigfoot.scenario_basis.parity_vectors <경로>` | 기저가 바뀔 때마다 |

### ⚠ 리베이크가 못 옮기는 사본이 하나 있다

`rebake/__main__.py::MIRRORED` 는 `src/lab/model/artifacts/` 만 채운다.
그런데 `src/lab/scenario/basis.json` 도 **바이트 동일한 기저 사본**이고
(md5 확인), 「전략」 면의 대조축인 `guards/model-strategy-basis.test.ts`
와 `guards/scenario-parity.test.ts` 가 **그 사본**을 통해 값을 읽는다.
리베이크만 돌리면 그 사본이 낡고, 새 패리티 벡터와 안 맞아 **가드가
빨개진다.** 리베이크의 미러 목록에 넣어서 닫는다.

### 손봐야 할 가드와 픽스처

| 가드 | 왜 |
|---|---|
| `guards/model-contracts.test.ts` | 「스코어카드는 9/13」·「실패 넷」이 하드코딩. 값이 바뀌면 같이 |
| `guards/model-wiring-graph.test.ts` | 「설비투자로 오는 배선은 산출갭 하나뿐이다」가 **D.1 로 거짓이 된다.** 뒤집어 세운다 |
| `guards/model-strategy-risk.test.ts` | 되돌림 27.79bp · σ RMS 0.22 · max 0.51 핀 · `RESIDUAL_TREATMENT` 이름 |
| `guards/model-strategy-decompose.test.ts` | 준칙 몫 핀 |
| `guards/model-strategy-basis.test.ts` · `guards/scenario-parity.test.ts` | 패리티 벡터 재생성 필요 |
| `guards/model-method-ledger.test.ts` | 원장 행 `fi-usercost` 의 내용이 바뀐다 |
| `guards/model-irf-reference.test.ts` | 앵커 값 |
| `src/lab/model/model/layout.ts::PRINTED_NOT_WIRED` | **유령 셋이 실재 엣지가 된다** (r_firm·cb·cpi_yoy → i_fi) |
| `src/lab/model/fixtures/wiring_graph.fixture.json` | 세션 1 소유. 새 그래프로 다시 |
| `backend/tests/engine/test_equations.py` · `test_scenario_basis.py` | 새 목표식·새 상태변수 |

### 프런트는 안 고쳐도 되나 — **한 자리만 고쳐야 한다**

계산 쪽은 안 고쳐도 된다. `path.ts` 는 기저 상수의 선형결합이고, 잔차
감쇠는 `policy_q8` 기저 **안에** 들어가므로 결합식이 그대로다. 새 상태변수
`i_fi_star` 는 `VARS` 에 안 담기므로 계약이 안 커진다.

고쳐야 하는 한 자리는 `layout.ts::PRINTED_NOT_WIRED` 다. 그건 계산이 아니라
**엔진에 대한 주장**이고, D.1 이 그 주장을 거짓으로 만든다. 「논문에만 있는
화살표」 목록에 실재하는 배선을 남겨 두면 화면이 거짓말을 한다. 이건 계약
파손이 아니라 **주장의 갱신**이므로 보고서에 그렇게 적는다.

---

## 진단 요약 — D 로 가는 순서

1. **D.1** eq (9) 의 `− UC_I` 배선. 새 상태변수 `i_fi_star`, eq (10) 의
   `−π/4` 부호, 목표는 **지연**해서 EC 에 넣는다. `residuals.py` 도 같이.
   → 새 계수 0개. 예측: 설비투자 −0.0324% 가 **더 깊어진다**, 앵커에서
   멀어진다. 실패 넷이 어떻게 움직이는지가 이 세션의 답이다.
2. **D.2** γ_I2 — 편차에서 구조적 0 임을 코드와 한계표가 말하게. 숫자
   불변이 예측.
3. **D.3** `eq_no` `'10'` → `'11'`, `EQ_NO_CORRECTIONS` 은퇴. 엣지 키는
   안 바뀌는 것이 예측.
4. **D.4** ρ = 0.801 (SE 0.074) AR 감쇠. `policy_q8` 기저에만 꼬리가
   실린다. 스위치 `residual_tail`, 기본 `decay`.
5. **D.5** `EcosDataError` + 리베이크가 `blocked` 로 승격.
6. **D.6** `bigfoot/solve/config.py` 로 상수 분리.
7. **D.7** 산출물·픽스처·가드 전건 재생성 + 실린 실패 넷 수정.
