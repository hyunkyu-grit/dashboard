# -*- coding: utf-8 -*-
"""ECOS Open API loader — same fetch/cache pattern as monitor/taylor_monitor.py:
raw responses cached to data/raw/*.csv with retrieval date; reruns end-to-end
from cache when the API is unreachable or BIGFOOT_OFFLINE=1.

Series codes were discovered via StatisticTableList/StatisticItemList catalog
search (2026-08-05), not guessed:
    core CPI    901Y010 / DB      / Q  식료품 및 에너지제외 지수
    real GDP SA 200Y108 / 10601   / Q  국내총생산에 대한 지출 (실질, 계절조정)
    call rate   721Y001 / 1010000 / Q  무담보콜금리(1일), quarterly average
"""
import os
import sys
from datetime import date
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from statsmodels.tsa.ar_model import AutoReg
from statsmodels.tsa.filters.hp_filter import hpfilter

ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = ROOT / "data" / "raw"
ECOS_BASE = "https://ecos.bok.or.kr/api"

# name -> (stat, cycle, item, start, end)
SERIES = {
    "bigfoot_core_cpi_q": ("901Y010", "Q", "DB", "1995Q1", "2030Q4"),
    "bigfoot_gdp_real_sa_q": ("200Y108", "Q", "10601", "1970Q1", "2030Q4"),
    "bigfoot_call_rate_q": ("721Y001", "Q", "1010000", "1991Q1", "2030Q4"),
    # GDP expenditure components (real SA, for WIRING_SHARES_DATA; extended
    # to 1995Q1 in Phase 4 for residual extraction)
    "bigfoot_gdp_c_priv_q": ("200Y108", "Q", "1010110", "1995Q1", "2030Q4"),
    "bigfoot_gdp_c_gov_q": ("200Y108", "Q", "1010120", "1995Q1", "2030Q4"),
    "bigfoot_gdp_i_fac_q": ("200Y108", "Q", "1020112", "1995Q1", "2030Q4"),
    "bigfoot_gdp_i_con_q": ("200Y108", "Q", "1020111", "1995Q1", "2030Q4"),
    "bigfoot_gdp_x_q": ("200Y108", "Q", "10301", "1995Q1", "2030Q4"),
    "bigfoot_gdp_m_q": ("200Y108", "Q", "10401", "1995Q1", "2030Q4"),
    # ---- Phase 4 residual-extraction series (catalog-verified 2026-08-05
    # via StatisticTableList/StatisticItemList — codes searched, not guessed)
    "bigfoot_cpi_headline_q": ("901Y009", "Q", "0", "1995Q1", "2030Q4"),
    # item "*AA/W": second dimension = 원화기준 (won basis; C/D/W exist)
    "bigfoot_import_price_q": ("401Y015", "Q", "*AA/W", "1995Q1", "2030Q4"),
    "bigfoot_gdp_nom_sa_q": ("200Y107", "Q", "10601", "1995Q1", "2030Q4"),
    "bigfoot_hh_credit_q": ("151Y001", "Q", "1000000", "2002Q4", "2030Q4"),
    "bigfoot_loan_rate_hh_q": ("121Y006", "Q", "BECBLA03", "1996Q1", "2030Q4"),
    "bigfoot_loan_rate_firm_q": ("121Y006", "Q", "BECBLA02", "1996Q1", "2030Q4"),
    "bigfoot_housing_kb_m": ("901Y062", "M", "P63A", "199001", "203012"),
    "bigfoot_corp3y_d": ("817Y002", "D", "010300000", "19950103", "20301231"),
    "bigfoot_ktb3y_d": ("817Y002", "D", "010200000", "19981113", "20301231"),
    "bigfoot_ktb10y_d": ("817Y002", "D", "010210000", "20001218", "20301231"),
    "bigfoot_base_rate_d": ("722Y001", "D", "0101000", "19990506", "20301231"),
    # ---- Phase 5a CD-transmission series (catalog-verified 2026-08-05)
    "bigfoot_cd91_d": ("817Y002", "D", "010502000", "20090101", "20301231"),
    "bigfoot_call_d": ("817Y002", "D", "010101000", "20090101", "20301231"),
    "bigfoot_msb1y_d": ("817Y002", "D", "010400001", "20090101", "20301231"),
    # ---- Phase 5b KTB legs (catalog-verified 2026-08-05; 2y starts 2021-03)
    "bigfoot_ktb1y_d": ("817Y002", "D", "010190000", "20150101", "20301231"),
    "bigfoot_ktb2y_d": ("817Y002", "D", "010195000", "20210310", "20301231"),
    "bigfoot_ktb5y_d": ("817Y002", "D", "010200001", "20150101", "20301231"),
    # ---- 외부 블록 (2026-08-21). 9.1.4.1 국제 주요국 경제성장률(전기대비).
    # eq (18) 의 수출수요 지수는 파트너 블록의 활동을 필요로 하는데 중국이
    # 통째로 빠져 있었다(가중치 0.20). FRED 에는 2024년 이후까지 사는 중국
    # 분기 실질 계열이 없다 — ECOS 의 이 표가 유일한 길이다.
    #
    # **중국은 2011Q1 부터다.** OECD 원본이 그 앞의 중국 분기 GDP 를 싣지
    # 않는다. 그래서 지수는 «그 분기에 자료가 있는 블록만» 으로 가중치를
    # 다시 세운다(아래 `residuals.py` 참조) — 없는 값을 0 으로 채우면 중국이
    # 2000~2010 내내 «갭 0» 인 나라가 된다.
    "bigfoot_gr_chn_q": ("902Y015", "Q", "CHN", "2011Q1", "2030Q4"),
    # ---- 논문 식이 부르는데 없던 계열 (2026-08-21). 항목코드는 전부
    # StatisticItemList 로 확인했다 — 추측한 코드는 하나도 없다.
    #
    # eq (11) 설비투자 단기식:
    #     Δln I = α_I0(EC) + α_I1 Δln I_{t-1} + E[Σ d_k ln ΔI*]
    #             + γ_I1 Δŷ + γ_I2 Δln P_I + **γ_I3 ln DRAM**
    # γ_I3 는 «반도체 생산» 이 아니라 **D램 가격**이다(논문 18쪽에 그렇게
    # 인쇄돼 있다). 로그 **수준**으로 들어간다 — 차분이 아니다.
    "bigfoot_defl_fi_q": ("200Y112", "Q", "1020112", "1960Q1", "2030Q4"),
    # eq (11) 의 `ln DRAM` 은 **여기 없다.** ECOS 402Y016/30911201AA 가
    # «DRAM» 이라는 이름을 달고 있지만 그건 수출물가지수이고, 논문이 말하는
    # DRAM_t 는 "the excess demand index of semi-conductor from **Gartner**"
    # (19쪽)다 — 유료 계열이다. 이름이 같다고 집으면 다른 변수를 넣는다.
    #
    # ---- 아래 셋은 **아직 안 쓴다.** eq (12)~(16)(건설·정부)이 Phase 2 에서
    # 외생 경로로 얼어 있어(`EXOG_V1`) 소비할 자리가 없다. 그 블록을 살릴 때
    # 필요한 것이 정확히 이것들이고, 코드를 찾는 데 든 품을 다음 사람이 다시
    # 치르지 않도록 여기 남긴다.
    #
    # eq (14): Δln IH = ... + γ_IH2 Δln P_IH + γ_IH3 Δln HPI + γ_IH4 Δ₄ln BCI
    "bigfoot_defl_con_q": ("200Y112", "Q", "1020111", "1960Q1", "2030Q4"),
    # BCI = "Building Construction Initiated index" — 건축착공 **연면적**이지
    # 기업경기실사지수가 아니다(논문 Figure 5 범례). **ECOS 는 2013.01 부터만
    # 싣는다** — 논문 Figure 5 는 2006년부터 그리므로 원저자는 다른 판을 썼다.
    # 잔차 창(2000Q1~)의 절반이 비므로 그대로는 못 쓴다.
    # 둘째 차원이 자재별 분해라 총계(`I47AA`)를 집는다 — 안 집으면 한 달에
    # 열 줄이 겹쳐 온다.
    "bigfoot_bci_m": ("901Y103", "M", "1/I47AA", "201301", "203012"),
    # eq (15): ln G* = β_G0 + β_G1 ln Ȳ + β_G2 EDEPR — "elderly-rate index".
    # 연간이지만 인구 계열이라 매끄럽고, 2072년까지 추계가 실려 있다.
    "bigfoot_edepr_a": ("901Y028", "A", "I35D", "1960", "2072"),
}


def gdp_shares(window: str = "2015Q1") -> dict:
    """Average real expenditure shares of GDP (WIRING_SHARES_DATA — measured
    from national accounts, not invented; used to aggregate component
    deviations into the GDP gap)."""
    gdp = to_qseries(fetch_ecos("bigfoot_gdp_real_sa_q"))
    out = {}
    for key, name in [("c", "bigfoot_gdp_c_priv_q"), ("g", "bigfoot_gdp_c_gov_q"),
                      ("i_fi", "bigfoot_gdp_i_fac_q"), ("i_con", "bigfoot_gdp_i_con_q"),
                      ("x", "bigfoot_gdp_x_q"), ("m", "bigfoot_gdp_m_q")]:
        s = to_qseries(fetch_ecos(name))
        ratio = (s / gdp).loc[window:].dropna()
        out[key] = float(ratio.mean())
    return out


def _api_key() -> str:
    key = os.environ.get("ECOS_API_KEY")
    if key:
        return key
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("ECOS_API_KEY="):
                return line.split("=", 1)[1].strip()
    sys.exit("ECOS_API_KEY not set (env var or .env)")


def fetch_ecos(name: str) -> pd.DataFrame:
    """StatisticSearch with pagination; cache to csv; fall back to cache offline."""
    stat, cycle, item, start, end = SERIES[name]
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    cache = RAW_DIR / f"{name}.csv"
    if os.environ.get("BIGFOOT_OFFLINE") == "1":
        return _read_cache(cache, name, forced=True)
    key = _api_key()
    rows, first = [], 1
    try:
        while True:
            url = (f"{ECOS_BASE}/StatisticSearch/{key}/json/kr/"
                   f"{first}/{first + 999}/{stat}/{cycle}/{start}/{end}/{item}")
            j = requests.get(url, timeout=30).json()
            if "StatisticSearch" not in j:
                raise RuntimeError(f"ECOS error for {name}: {j}")
            block = j["StatisticSearch"]
            rows += block["row"]
            if first + 999 >= int(block["list_total_count"]):
                break
            first += 1000
    except (requests.RequestException, RuntimeError) as e:
        print(f"[warn] fetch failed for {name} ({e}); using cache")
        return _read_cache(cache, name)
    df = pd.DataFrame(rows)[["TIME", "DATA_VALUE"]]
    df["retrieved_at"] = date.today().isoformat()
    df.to_csv(cache, index=False, encoding="utf-8-sig")
    return df


def _read_cache(cache: Path, name: str, forced: bool = False) -> pd.DataFrame:
    if not cache.exists():
        sys.exit(f"no cache for {name} at {cache} and API unavailable")
    df = pd.read_csv(cache, dtype={"TIME": str})
    if forced:
        print(f"[offline] {name} from cache (retrieved {df['retrieved_at'].iloc[0]})")
    return df


def to_qseries(df: pd.DataFrame) -> pd.Series:
    v = pd.to_numeric(df["DATA_VALUE"], errors="coerce")
    idx = pd.PeriodIndex(df["TIME"].astype(str), freq="Q")
    return pd.Series(v.values, index=idx).dropna().sort_index()


def daily(name: str) -> pd.Series:
    """Fetch a registered D-cycle series as a daily DatetimeIndex Series
    (trading days as published; no calendar fill)."""
    stat, cycle, item, start, end = SERIES[name]
    if cycle != "D":
        raise ValueError(f"{name} is cycle {cycle}, not D")
    df = fetch_ecos(name)
    v = pd.to_numeric(df["DATA_VALUE"], errors="coerce")
    idx = pd.to_datetime(df["TIME"].astype(str), format="%Y%m%d")
    return pd.Series(v.values, index=idx).dropna().sort_index()


def quarterly(name: str) -> pd.Series:
    """Fetch any registered series and return it at QUARTERLY frequency.

    Q series pass through; M (TIME=YYYYMM) and D (TIME=YYYYMMDD) series are
    averaged within the quarter (mean of available observations)."""
    cycle = SERIES[name][1]
    df = fetch_ecos(name)
    if cycle == "Q":
        return to_qseries(df)
    v = pd.to_numeric(df["DATA_VALUE"], errors="coerce")
    t = df["TIME"].astype(str)
    fmt = "%Y%m" if cycle == "M" else "%Y%m%d"
    idx = pd.PeriodIndex(pd.to_datetime(t, format=fmt), freq="Q")
    s = pd.Series(v.values, index=idx).dropna()
    return s.groupby(level=0).mean().sort_index()


def hp_trend_padded(series: pd.Series, lamb: float = 1600.0,
                    pad: int = 4) -> pd.Series:
    """HP trend with AR(4) end-padding (same treatment as the Taylor monitor).

    # LOOKAHEAD: full-sample filter — the trend at time t uses data after t.
    # Phase 4 replaces this with a recursive (one-sided) estimate.
    """
    vals = series.values.astype(float)
    dif = np.diff(vals)
    ar = AutoReg(dif, lags=4, trend="c").fit()
    fc = ar.forecast(steps=pad)
    ext = np.concatenate([vals, vals[-1] + np.cumsum(fc)])
    _, trend = hpfilter(ext, lamb=lamb)
    return pd.Series(trend[: len(vals)], index=series.index)


def output_gap_hp(gdp: pd.Series) -> pd.Series:
    """HP(1600) output gap in %, AR(4)-padded — identical method to the monitor.

    # LOOKAHEAD: full-sample filter (see hp_trend_padded).
    """
    logy = np.log(gdp)
    trend = hp_trend_padded(logy)
    return 100.0 * (logy - trend)


def korea_core_dataset(sample_start: str = "2000Q1"):
    """Return (core, endpoints) quarterly DataFrames with columns [pi, gap, r].

    pi   core CPI YoY %          endpoint: constant (default 2.0, set by caller)
    gap  output gap, HP proxy %  endpoint: constant 0.0
    r    call rate, % (q avg)    endpoint: HP(1600) trend of the call rate,
                                 AR(4)-padded, last value held flat off-sample
    Endpoint *values* are attached by the engine constructor; this function
    returns the raw ingredients: core data plus the rate-trend series.
    """
    cpi = to_qseries(fetch_ecos("bigfoot_core_cpi_q"))
    gdp = to_qseries(fetch_ecos("bigfoot_gdp_real_sa_q"))
    call = to_qseries(fetch_ecos("bigfoot_call_rate_q"))

    pi = (cpi / cpi.shift(4) - 1.0) * 100.0
    gap = output_gap_hp(gdp)
    r_trend = hp_trend_padded(call)  # LOOKAHEAD (v1): two-sided HP trend

    start = pd.Period(sample_start, "Q")
    core = pd.DataFrame({"pi": pi, "gap": gap, "r": call}).loc[start:].dropna()
    r_star = r_trend.reindex(core.index)
    return core, r_star
