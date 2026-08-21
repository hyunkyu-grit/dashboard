# Foundation 진단 — 엔진 이관 · Model 셸 · 계약 · 리베이크 파이프라인

CC SESSION 1/3 Part C. 2026-08-21. **아직 아무것도 안 만들었다.** 이 문서가 Part D
의 입력이고, 세션 2·3 이 읽는 기준이다.

측정 환경: `C:\Users\infomax\Desktop\project_bigfoot` (BIGFOOT, 커밋 `f888201`) ·
`C:\Users\infomax\Desktop\Assistant\Projects_AS\sauron-v2` (커밋 `3fc2ef2`).

---

## 요약 — 세 줄

1. **재현 기준선은 깨끗하다.** BIGFOOT 재빌드 · sauron-v2 사본 세 파일이 전부
   `bd7b5b5241235460bb2c7706b4493cd2` 로 **바이트 동일**하고, 서로 다른 시각의 두
   빌드가 같은 해시를 냈다. 이관 후 비교의 증거로 쓸 수 있다.
2. **`pyfrbus` 는 안 따라온다.** `bigfoot/` 패키지가 그 이름을 **한 번도
   import 하지 않는다** — 52건 전부 주석·문자열이다. 실제 import 는
   `scenarios/` 두 파일에만 있고 그건 연구 스크립트다.
3. **Layer 2 계획이 진단과 충돌한다.** 편차 기저에는 미국 경로·유가 수준·해외
   성장 **가정이 애초에 안 들어 있고**, `r*` 는 효과가 **정확히 0** 으로 실측됐다.
   D.6 의 `assumptions.json` 은 계획된 모양대로 만들면 거짓말이 된다. §C.8 참조.

---

## C.4 재현 기준선 — **이관 게이트의 기준값**

```
bd7b5b5241235460bb2c7706b4493cd2   project_bigfoot/output/scenario_basis.json  (재빌드)
bd7b5b5241235460bb2c7706b4493cd2   sauron-v2/src/lab/scenario/basis.json
```

세 번 구워 세 번 같았다. **선행 차이 없음** — 지금 두 리포는 갈려 있지 않다.

기저 요약: `as_of 2026-08-21` · `horizon_q 24` · `irs_h 13` · `policy_step_bp 25` ·
기저 15개(policy_q1‥q8 · cpi · gap · exports · us_2q/4q/6q · oil) · 변수 11개
(`i_kr y_gap cpi_yoy s hpi debt kr10y x m kr3y irs`) · 선형 게이트 `1e-4 bp`.

---

## C.1 인벤토리 — 무엇이 옮겨 가나

**옮겨 갈 것 — `bigfoot/` 패키지 36파일 5,997줄.**

| 하위 | 파일 | 역할 |
|---|---|---|
| `equations/` | base · korea · foreign · us · sync · loader | 44개 인쇄 방정식 + Appendix D 로더 |
| `solve/` | system · irf · phase3 · tpus{,2,3} | 해법기 · IRF · 최종 옵션 상수 · tp 커널 보정 |
| `expectations/` | engine | 위성 VAR(Appendix A) |
| `conditional/` | invert · hfl · residuals | Appendix B 역산 · HFL · 과거 잔차 추출 |
| `cd_layer/` | adapter · study | 정책→CD 통과(0.113 / 0.558 / τ 78.8bd) |
| `irs_curve/` | assembler · data · satellite | CD평균 + OU 스프레드 → 13테너 |
| `scenario_basis/` | build · parity_vectors · replay_ref | **기저 생성기 · 패리티 벡터 생성기** |
| `data/` | ecos · fred | 공개 API 로더 + 캐시 |

**안 옮길 것.** `pyfrbus/`(§C.2) · `scenarios/`(pyfrbus 연구 스크립트) ·
`monitor/` · `venv/` · `data_only_package/` · `docs/` · BIGFOOT git 이력.

**두 리포에 이미 다른 모양으로 있는 것 — 충돌 위험.**

| 개념 | BIGFOOT | sauron-v2 | 판정 |
|---|---|---|---|
| ECOS 클라이언트 | `bigfoot/data/ecos.py` (분기·캐시 CSV) | `backend/app/ecos.py` · `labmacro.py` (3계열 카드용) | **둘 다 남긴다.** 목적이 다르다 — 하나는 추정 표본, 하나는 화면 카드. 합치면 캐시 의미가 섞인다 |
| 기준금리 | `data/raw/bigfoot_base_rate_d.csv` | `funding.py` (ECOS `722Y001`) | sauron-v2 것이 정본. 엔진은 자기 캐시를 계속 쓴다 |
| 영업일 달력 | 없음(분기 모형) | `holidays` + `calendar_cache.py` | 충돌 없음 |
| MPC 날짜 | 없음 | `app/policy.py::MPC_DATES` + `reserve.py` | §C.11 |
| `output/` | 14개 JSON | 없었음(이번에 생성) | 경로 규약을 정해야 한다 — §C.3 |

---

## C.2 의존성 델타

**`pyfrbus` 는 런타임 의존이 아니다.** 실측:

```
bigfoot/ 안의 "pyfrbus" 문자열 52건 → 전부 주석·독스트링·caveat 문자열
실제 import 문 → scenarios/higher_for_longer.py, scenarios/tp_paths.py 두 곳뿐
tpus.py::pyfrbus_half_life() 는 output/hfl_paths.csv 를 읽는다 — 얼어붙은 산출물
```

즉 pyfrbus 는 **tp_us 커널을 보정할 때 한 번 쓰인 연구 도구**이고, 그 결과는 CSV·
JSON 으로 굳어 있다. **BIGFOOT 자리에 남긴다.**

**기저 빌드가 실제로 끌어오는 서드파티(import 추적):**
`numpy · pandas · scipy · statsmodels · plotly · requests · yaml`

sauron-v2 백엔드가 이미 가진 것: `numpy · scipy`.
**새로 추가할 것: `pandas · statsmodels · requests · pyyaml`.**

> **결함 발견 — 고치지 않고 기록한다.** `plotly` 가 런타임에 딸려 온다.
> `build.py` 가 상수(`FINAL_OPTIONS` · `FINAL_EQ24` · `BETA_SYNC_ADOPTED`)를
> `solve/phase3.py` 에서 가져오는데, 그 모듈이 **차트를 그리는 모듈**이라 모듈
> 스코프에서 plotly 를 import 한다. 상수를 별도 모듈로 빼면 사라지지만 그건
> 리팩터링이고, D.3 게이트(바이트 동일)를 지키려면 이관 커밋에서 손대면 안 된다.
> **`plotly` 를 requirements 에 넣고 이관한 뒤, 별도 커밋에서 분리한다.**

---

## C.3 목표 배치

```
backend/
  engine/                     ← bigfoot/ 가 통째로 여기로 (패키지명 engine)
    equations/ solve/ expectations/ conditional/ cd_layer/ irs_curve/
    scenario_basis/ data/
  engine_config/              ← config/*.yaml (appendix_d, resolved, conditioning_map)
  engine_data/raw/            ← data/raw/*.csv (52개, 공개 API 캐시)
  engine_out/                 ← 산출 계약 JSON — **UI 가 읽는 유일한 자리**
  tests/engine/               ← tests/*.py 11파일
```

**읽기 전용 규칙 유지.** UI 는 `engine_out/*.json` 만 읽는다. `backend/app/*.py`
가운데 `engine` 을 import 하는 것은 **리베이크 커맨드 하나뿐**이고, FastAPI 라우트는
아무도 import 하지 않는다. 프런트는 지금처럼 `src/lab/**/basis.json` 사본을
번들한다(빌드 시 `engine_out` 에서 복사).

이름을 `bigfoot` 이 아니라 `engine` 으로 바꾸는 이유: 이 리포에서 «bigfoot» 은
출처를 가리키는 말이 되고 현재형 이름이 아니다. 다만 **모듈 내부 문자열·플래그
이름은 안 건드린다**(`BIGFOOT_OFFLINE`, `bigfoot_*.csv` 캐시 이름) — 그걸 바꾸면
캐시가 통째로 미아가 되고 D.3 게이트가 깨진다.

---

## C.5 데이터와 비밀

| 대상 | 지금 | 이관 뒤 |
|---|---|---|
| `ECOS_API_KEY` · `FRED_API_KEY` | BIGFOOT `.env`(gitignore) | sauron-v2 백엔드 환경변수 규약을 따른다. `.env` 를 복사하지 않는다 |
| `data/raw/*.csv` 52개 | **git 추적됨** | 그대로 추적. 공개 API 캐시라 위생 가드 면제 대상 |
| `data/krwswapdata/raw/*.xlsx` · `clean.parquet` | **gitignore** | 그대로 제외. Infomax 터미널 자료 |
| `data/krd_ladder.json` | gitignore | 그대로 |

**위생 가드로 검증할 것**(눈으로가 아니라): 이관 후 `git ls-files` 에
`krwswapdata` 가 0건이어야 한다.

---

## C.6 테스트 인벤토리

```
BIGFOOT     tests/ 11파일 · 65 collected
sauron-v2   backend/tests/ 59파일 · 786 collected (+1 수집 에러, 환경성)
합계 기대   851
```

수집 에러 1건은 `test_static_agreement.py` — 백엔드가 :8200 에 이미 떠 있으면
«남의 포트» 라고 거절한다. 이관과 무관한 기존 성질이다.

환경 의존 후보: `test_irs_curve.py` 가 `data/krwswapdata/clean.parquet` 를 읽는다
(gitignore 대상) → **CI/클린체크아웃에서 스킵되어야 한다.** 지금은 그 스킵 가드가
있는지 확인이 필요하고, 없으면 D.2 에서 스킵 조건을 붙인다(삭제가 아니라).

알려진 빨강 1건: `test_ou_fit_sane_and_json_locked` — OU 적합 `mu_bp −24.1` 대
박아 둔 `−24.0`. **데이터 드리프트이고 이관 전부터 있었다.** 이관 탓으로 읽히지
않게 여기 적어 둔다.

---

## C.7 빌드 트리거와 비용

```
리베이크 wall-clock   10.8 초 (온라인)
                      9.7 초 (BIGFOOT_OFFLINE=1)
```

**이벤트 구동으로 충분하다.** 야간 배치가 필요할 이유가 없다. 10초짜리 작업이라
MPC/FOMC/CPI 발표 직후 트리거해도 부담이 없고, 실패해도 재시도가 싸다.

빌드가 읽는 것(open 추적, 10개 파일뿐):
`appendix_d.yaml` ×3 · `bigfoot_gdp_real_sa_q.csv` ×2 · `gdp_c_priv` · `gdp_c_gov`
· `gdp_i_fac` · `gdp_i_con` · `gdp_x` · `gdp_m` · `core_cpi_q` · `call_rate_q`

빌드가 쓰는 것: `output/scenario_basis.json` 하나.

---

## C.8 무엇이 기저에 구워져 있나 — **여기서 계획이 어긋난다**

### 실측 1 — `r*` 는 편차 기저에 **효과가 0** 이다

```
r* 1.5% → 전 15개 기저의 10y IRS 최대 절대차 = 0.000000 bp
r* 2.5% → 전 15개 기저의 10y IRS 최대 절대차 = 0.000000 bp
```

이유는 구조적이다. eq (35) 는

```
i_t = φ_i·i_{t−1} + (1−φ_i)[ r* + π_t + φ_π(π_t − π*) + φ_y·ŷ_t ]
```

이고 `r*` 와 `−φ_π·π*` 는 **가법 상수**다. 기저는 베이스라인 0 인 편차 공간이라
상수가 소거된다. 모형이 선형이므로(게이트 `1e-4`) 상태의존성도 없다.

> **함의.** 「`r*` 2.0% 가정이에요 — ±0.5%면 10년이 ±XXbp 움직여요」 라는 줄은
> 이 제품에서 **XX = 0** 이다. `r*` 는 **레벨**을 움직이지 **델타**를 못 움직인다.
> 그리고 이 앱이 파는 것은 델타다(레벨은 시장 스팟에서 온다). 숫자를 지어내지
> 말고 그 사실을 문장으로 쓰는 것이 맞다. 세션 2 에 넘길 문장은 §F 참조.

### 실측 2 — 미국 경로·유가·해외성장 «가정»은 기저에 **없다**

기저는 **단위 충격 15개**다. `us_2q/4q/6q` 와 `oil` 은 «가정된 경로» 가 아니라
«이만큼 때리면» 이다. 그러므로 FOMC 닷이나 브렌트 선물을 새로 받아와도 **기저는
안 바뀐다**. 바뀌는 것은 사용자가 그 손잡이를 어디에 놓느냐뿐이다.

### 실제로 구워져 있는 것

| 종류 | 무엇 | 갱신하려면 |
|---|---|---|
| 계수 | `appendix_d_resolved.yaml` 전부 | 논문이 바뀌지 않는 한 불변 |
| 지출 비중 | `z_C·z_I·z_IH·z_G·z_X` — ECOS 국민계정에서 계산 | 리베이크 |
| 위성 VAR | 근원CPI·콜금리·실질GDP 로 추정(Appendix A) | 리베이크 |
| 엔진 상수 | β_sync 1.05 · `PHI_I_TAIL` 0.85 · cd_layer 0.113/0.558/τ78.8 · r* · π* | 코드 |

**즉 리베이크가 실제로 갱신하는 것은 «비중과 위성 VAR» 두 가지뿐이다.** 그 둘은
분기 데이터라 분기마다 움직인다. MPC 날짜에 리베이크하는 것은 «달력을 맞추는
일»이지 «숫자를 새로 받는 일»이 아니다 — 화면이 그걸 반대로 말하면 안 된다.

---

## C.9 소스 도달성 — 실측

| 소스 | 엔드포인트 | 결과 | 케이던스 · as_of |
|---|---|---|---|
| ECOS | `StatisticSearch` | **HTTP 200** | 분기물은 분기 확정 시, 일물은 D+1 |
| FRED 일반 | `series/observations` | **HTTP 200** | `realtime_start 2026-08-20` |
| 미 정책금리 **수준** | FRED `DFEDTARU` | **HTTP 200** | 일 |
| 브렌트 **현물** | FRED `DCOILBRENTEU` | **HTTP 200** | `2026-08-19` (2일 지연) |
| 미 정책 **선도 경로** | — | **도달 불가** | SEP 닷은 분기 PDF · SOFR 선물은 CME 유료 |
| 브렌트 **선물 커브** | — | **도달 불가** | FRED 는 현물만 |
| 해외성장 **컨센서스** | — | **도달 불가** | 유료 |

**세 개 중 두 개가 «선도»를 못 받는다.** 그런데 §C.8 이 말하듯 기저는 그 값을
애초에 안 쓴다. 그래서 D.7 의 페처는 **레벨 전망을 만들 때에야** 의미가 생긴다.

`r*` · `π*` 위치: `config/appendix_d_resolved.yaml` →
`calibration.r_star.named.r_star = 0.02` (basis: `CALIBRATED_LW`, 각주 24) ·
`policy_rule.named.pi_star = 0.02`. 코드에서는 `korea.PolicyRule.__init__`.

---

## C.10 빈티지 스큐 — **세션 2 가 렌더할 문장**

`data/raw` 전 계열의 마지막 관측(실측):

| 계열군 | 마지막 | 지연 |
|---|---|---|
| 기준금리(일) | 2026-08-21 | 당일 |
| KTB·회사채(일) | 2026-08-20 | D+1 |
| **콜·CD91·통안1년(일)** | **2026-08-04** | **17일** |
| KB주택(월) | 2026-07 | 1.5개월 |
| 건축착공 BCI(월) | 2026-06 | 2.5개월 |
| 국민계정·CPI·대출금리(분기) | **2026Q2** | 2개월 |
| **투자·건설 디플레이터 · 명목GDP(분기)** | **2026Q1** | **5개월** |
| 중국 성장(분기) | 2026Q2 | — (2011Q1 시작) |

**모형의 as-of 문장(세션 2 는 이걸 그대로 쓴다):**

> 이 모형은 **분기 모형이고, 마지막으로 본 분기는 2026년 2분기**예요. 날짜
> `2026-08-21` 은 기저를 구운 날이지 데이터가 거기까지 왔다는 뜻이 아니에요.
> 투자·건설 디플레이터는 2026년 1분기까지만 있어서 그 한 분기는 추정으로
> 메워요.

지금 기저의 `as_of: 2026-08-21` 을 화면이 그대로 「기준일」이라고 부르면
**5개월 낡은 입력이 하루 전 것처럼 보인다.** D.9 의 `engine_status.json` 은
`basis_as_of`(구운 날) 와 `data_edge_q`(2026Q2) 를 **따로** 실어야 한다.

---

## C.11 이벤트 달력

**재사용이 맞다.** sauron-v2 가 이미 둘을 갖고 있다.

- `backend/app/policy.py::MPC_DATES` — 2026년 8건, `calendar.json` 의 사본이고
  코드가 그 중복을 스스로 적어 두었다(`policy.py:206`).
- `backend/app/reserve.py::MPC_IN_TABLE` — 8/21 신설. 한은 연간 PDF 원문에서
  읽었고 `calendar.json` 과 **8/8 일치** 검증됨. `SOURCE_URL` 도 들고 있다.

**소유권 충돌 없음**: `reserve.py` 는 발행 캘린더 레인이 만들었지만 상수 테이블일
뿐이고, 읽기는 누구나 한다. 리베이크 스케줄러는 `policy.py::MPC_DATES` 를 읽는다
(그쪽이 정본이고 `reserve.py` 는 그것을 검증하는 쪽이다).

**FOMC·CPI 날짜는 두 리포 어디에도 없다.** 새로 만들어야 하고, FOMC 는 연 8회
공표 일정이 고정이라 상수 테이블이 맞다(한은 PDF 와 같은 방식). CPI 는 통계청
공표일정.

---

## C.12 결정성 — 통과

같은 입력으로 세 번 구워 세 번 `bd7b5b52…`. RNG·딕셔너리 순서·HP 필터 끝점 중
어느 것도 흔들리지 않았다. 자동화해도 된다.

다만 **결정성 잠금 테스트가 없다.** D.11 에서 «두 번 굽고 비교» 를 테스트로 박는다.

---

## C.13 실패 모드 — 세 가지 결함

1. **조용한 캐시 대체.** ECOS 실패 시 `print("[warn] ... using cache")` 뒤 캐시로
   진행한다(`ecos.py:154`). 산출물 어디에도 «이 빌드는 캐시로 구웠다» 가 안 남는다.
   → D.9 `engine_status.json` 이 `blocked`/`stale` 로 받아야 한다.
2. **캐시 없고 API 죽으면 `sys.exit()`** (`ecos.py:165`). 예외가 아니라 프로세스
   종료라 서버 컨텍스트에서 못 잡는다. → 이관 시 예외로 바꾼다(**동작 변경이라
   D.1 이관 커밋과 분리한다**).
3. **원자적이지 않은 쓰기.** `build.py:232` 가 `write_text` 로 최종 경로에 바로
   쓴다. 중간에 죽으면 잘린 기저가 남는다. → D.8 이 임시파일+rename 으로 감싼다.

---

## C.14 계약 인벤토리

| 파일 | 생산자 | 소비자 | 상태 |
|---|---|---|---|
| `scenario_basis.json` | `scenario_basis/build.py` | 프런트(번들 사본) | **있음** 79KB |
| `engine_status.json` | 없음(손으로 갱신된 듯) | 세션 2·3 | **낡음** — `as_of 2026-08-05`, `scorecard 12/13`(**과적합 판**), `tests 65` |
| `assumptions.json` | — | 세션 2 Strategy | **없음** — D.6 에서 신설, 다만 §C.8 때문에 모양을 다시 정해야 한다 |
| 배선 엣지리스트 | — | 세션 3 Model | **없음** — §C.15 |
| `paper_anchors.json` | — | 세션 2·3 | **없음** — D.15 에서 신설 |
| `taylor_summary.json` | `monitor/` | — | 있음 679B |
| `hfl_summary.json` · `hfl_conditional.json` | `conditional/hfl.py` | — | 있음 |
| `irs_curve_forecast.json` | `irs_curve/assembler.py` | — | 있음 10.9KB |
| `irf_summary.json` | `solve/irf.py` | 세션 3 D.18 | 있음 4.2KB |
| `residual_moments.json` · `cd_passthrough.json` · `tpus_*.json` | 각 모듈 | 진단용 | 있음 |

`engine_status.json` 이 **12/13 을 싣고 있는 것이 가장 위험하다** — 그건 순열
과적합 판이고 현재는 9/13 이다. D.9 에서 반드시 덮어써야 한다.

---

## C.15 엣지리스트 원천 — **코드에서 뽑는다**

AST 시제품을 돌려 봤다(`system.py` 의 solve 루프에서 `new["X"] = … lag("Y") …`
패턴을 추출):

```
노드 23개 · 엣지 51개
y_gap ← [c, g, i_con, i_fi, m, x]      ← eq (21) 의 IH·G 가 보인다
hpi   ← [dhpi, hpi]
debt  ← [ddebt, debt]
```

`y_gap` 줄이 **정확히 8/21 에 고친 그 결함이 보이는 자리**다. 이 방식이 맞다.

**다만 시제품은 세 패턴을 못 잡는다.** 세션 3 의 생성기는 이걸 다뤄야 한다:

1. `x_t = np.array([...])` 뒤 `w40 @ x_t` — 상태벡터를 거치는 `kr10y` · `kr3y`
2. 변수 키 루프 — `for key, ekey, eq, rname in [...]: new[key] = …` (`r_hh` · `r_firm`)
3. 중간 지역변수 — `d_m` · `uc` · `hpi_star_lag` 를 거쳐 들어오는 항

**완결성 테스트**(생성기의 하중): `KOREA_VARS` 의 모든 키가 엣지리스트에 **타깃으로**
한 번씩 나와야 한다. 지금 23/31 이라 8개가 빠져 있고, 그 8개가 위 세 패턴이다.

계수 메타는 `config/appendix_d_resolved.yaml` 이 이미 완비하고 있다 — 슬롯마다
`symbol` · `value` · `status`(RESOLVED / EXOG_V1 / …) · `basis`(출처 문장). 배지
세 종(논문 부록 D / 자유모수 / 논문 미공표)은 그 `status` 와 `basis` 에서 기계적으로
나온다. **손으로 옮겨 적지 않는다.**

---

## C.16 소유권 지도 — 세션 2·3 구속

세션 2(Strategy)와 세션 3(Model·Method)은 **동시에** 돈다.

| 자리 | 소유 | 비고 |
|---|---|---|
| `src/lab/model/ModelSpace.tsx` (셸·라우팅·탭) | **세션 1** | 완성해서 넘긴다. 둘 다 수정 금지 |
| `src/lab/model/strategy/**` | 세션 2 | |
| `src/lab/model/model/**` | 세션 3 | |
| `src/lab/model/method/**` | 세션 3 | |
| `src/lab/model/contracts.ts` (계약 타입) | **세션 1** | 둘 다 읽기만 |
| `src/lab/model/anchors.ts` (앵커 ID) | **세션 1** | D.14 |
| `backend/engine/**` | **세션 1** | 동결 |
| `backend/engine_out/*.json` | **세션 1** 이 생성 | 둘 다 읽기만 |
| `backend/app/labscenario.py` | 세션 3 | 시나리오 은퇴와 함께 |
| `guards/scenario-*.test.ts` | 세션 3 | 은퇴/재조준 |
| `guards/model-*.test.ts` | 각자 접두어 — `model-strategy-*` 세션 2 · `model-wiring-*` 세션 3 | |
| `src/theme/type.css` | **분할 금지** — 각자 파일 끝에 자기 블록을 append, 주석으로 소유 표시 | 가장 큰 충돌 위험 |
| `backend/tests/test_register.py::COVERED` | 세션 2 가 «Strategy», 세션 3 이 «Model·Method» 를 각각 한 줄씩 추가 | 같은 리스트라 순서 합의: 알파벳 |
| `docs/MODEL_LANE_CONTEXT.md` | **세션 1** | 둘 다 읽기만 |

---

## Part D 에 대한 반대 소견 — 세 건

**D.6 `assumptions.json` 은 계획된 모양으로 만들면 안 된다.** §C.8 이 실측으로
보였듯 편차 기저에는 미국 경로·유가·해외성장 «가정»이 없다. 「미 정책금리: FOMC
닷 8/20」 같은 줄은 **그 값이 이 화면의 숫자에 하나도 안 들어갔는데 들어간 것처럼**
읽힌다. 대신 실을 것은 «이 기저가 실제로 쓴 것» — 지출 비중과 위성 VAR 의 추정
끝점(2026Q2), 엔진 상수(β_sync 1.05 · r* 2.0 · π* 2.0), 그리고 **각 항목이
델타에 영향을 주는지 레벨에만 주는지**다.

**D.8 `r*` 민감도 줄은 숫자가 0 이다.** 지어내지 않고 문장으로 쓴다.

**D.7 페처는 지금 만들 이유가 약하다.** 세 소스 중 둘이 선도를 못 주고, 셋 다
기저에 안 들어간다. 레벨 전망(세션 3 D.17 백테스트)이 실제로 서는 날 만드는 것이
맞다. Part D 에서는 **도달 가능한 둘(FRED 정책금리 수준 · 브렌트 현물)만** 캐시해
두고, 화면에는 «이 값은 참고이고 기저에 안 들어가요» 라고 적는다.

---

## 다음 걸음

Part D 로 간다. 순서: D.1 이관 → **D.3 게이트(`bd7b5b52…` 재확인)** → D.2 테스트
→ D.4 시나리오 레인 유지 → D.5 프로비넌스 → 파이프라인 → 셸·계약.
