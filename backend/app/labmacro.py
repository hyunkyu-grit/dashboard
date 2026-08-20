# -*- coding: utf-8 -*-
"""모형이 딛고 선 거시 실측 — 한국은행 ECOS [OWNER, 2026-08-20].

## 왜 이 파일이 있나

「모형」 탭이 «이 모형은 물가와 경기를 본다» 고 말하면서 그 물가와 경기가 지금
얼마인지는 안 보여주고 있었다. 그러면 읽는 사람이 그 말을 검사할 방법이 없다.

여기서 가져오는 것은 **모형의 손잡이가 가리키는 바로 그 계열**이다. 손잡이가
«물가 +0.5pp» 라고 할 때, 그 0.5pp 가 무엇에 얹히는 값인지가 화면에 같이 선다.

## 무엇을 가져오나

    근원물가   901Y010 / DB      / Q   식료품·에너지 제외 지수 → YoY %
    실질GDP    200Y108 / 10601   / Q   국내총생산(실질·계절조정) → HP 갭 %
    수출       200Y108 / 10301   / Q   재화와 서비스의 수출(실질) → YoY %

유가는 없다. ECOS 가 안 내는 계열이고, 지어내는 대신 화면이 «없음» 이라고 적는다.

## GDP 갭은 통계가 아니라 우리가 만든 값이다

한국은행은 GDP 갭을 발표하지 않는다. 잠재성장률이 필요한데 그건 추정이기 때문이다.
그래서 실질GDP 에 HP(1600) 필터를 걸어 만든 **프록시**이고, 화면이 그렇게 적는다.

`hp_trend_padded` 는 `project_bigfoot/bigfoot/data/ecos.py` 의 것을 **글자 그대로**
옮겼다. 이 포팅이 실제로 같은 값을 내는지는 `tests/test_labmacro.py` 가 bigfoot 의
캐시 CSV 를 입력으로 양쪽을 돌려 검사한다 — 그 검사가 이 파일의 하중을 진다.

두 가지 한계를 화면에 같이 싣는다:

* **끝점 편의** — 양방향 필터라 마지막 몇 분기의 추세는 그 뒤 자료가 들어오면
  바뀐다. AR(4) 로 네 분기를 덧대 완화하지만 없애지는 못한다(bigfoot 의
  `# LOOKAHEAD` 주석이 말하는 그것).
* **개정** — 한국은행이 GDP 를 개정하면 과거 갭도 같이 움직인다.

## 캐시

분기 계열이라 하루에도 여러 번 부를 이유가 없다. `app/ecos.py` 의 기준금리와 같은
규약으로 파일 캐시를 두고, 실패하면 **오래된 캐시로 연명하되 그 사실을 payload 에
적는다** — 조용히 옛 숫자를 오늘 숫자인 척 내놓지 않는다.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.tsa.ar_model import AutoReg
from statsmodels.tsa.filters.hp_filter import hpfilter

from app.ecos import EcosError, fetch_series

log = logging.getLogger("app.labmacro")

CACHE_PATH = Path(__file__).resolve().parents[1] / ".cache" / "ecos-macro.json"
CACHE_TTL_HOURS = 12.0

#: 화면에 세우는 분기 수. 8분기면 손잡이가 덮는 구간(4분기)의 두 배다.
QUARTERS = 8

#: (키, 통계표, 주기, 항목, 시작, 기대하는 항목 이름의 조각)
SERIES: dict[str, tuple[str, str, str, str, str]] = {
    "core_cpi": ("901Y010", "Q", "DB", "1995Q1", "제외"),
    "gdp_real_sa": ("200Y108", "Q", "10601", "1970Q1", "국내총생산"),
    "exports": ("200Y108", "Q", "10301", "1995Q1", "수출"),
}


class MacroUnavailable(RuntimeError):
    """ECOS 를 못 읽었고 쓸 만한 캐시도 없다."""


# ── bigfoot 에서 글자 그대로 옮긴 둘 ────────────────────────────────────────────


def hp_trend_padded(series: pd.Series, lamb: float = 1600.0, pad: int = 4) -> pd.Series:
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
    """HP(1600) output gap in %, AR(4)-padded — identical method to the monitor."""
    logy = np.log(gdp)
    trend = hp_trend_padded(logy)
    return 100.0 * (logy - trend)


# ── ECOS → 분기 계열 ───────────────────────────────────────────────────────────


def to_qseries(rows: list[dict]) -> pd.Series:
    """`{TIME: '2026Q1', DATA_VALUE: '...'}` 행들 → 분기 인덱스 계열."""
    if not rows:
        return pd.Series(dtype=float)
    v = pd.to_numeric(pd.Series([r["DATA_VALUE"] for r in rows]), errors="coerce")
    idx = pd.PeriodIndex([str(r["TIME"]) for r in rows], freq="Q")
    return pd.Series(v.values, index=idx).dropna().sort_index()


def _fetch_all() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for key, (stat, cycle, item, start, expect) in SERIES.items():
        out[key] = fetch_series(stat, cycle, item, start, expect_name=expect)
    return out


# ── 캐시 ──────────────────────────────────────────────────────────────────────


def _read_cache() -> dict | None:
    try:
        return json.loads(CACHE_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_cache(raw: dict[str, list[dict]]) -> None:
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    CACHE_PATH.write_text(
        json.dumps(
            {"retrieved_at": dt.datetime.now().isoformat(timespec="seconds"), "raw": raw},
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def _cache_age_hours(payload: dict) -> float | None:
    stamp = payload.get("retrieved_at")
    if not stamp:
        return None
    try:
        got = dt.datetime.fromisoformat(stamp)
    except ValueError:
        return None
    return (dt.datetime.now() - got).total_seconds() / 3600.0


def load_raw() -> tuple[dict[str, list[dict]], str | None]:
    """(원본 행들, 오래됐다면 그 사유). 신선하면 사유는 `None`."""
    cached = _read_cache()
    age = _cache_age_hours(cached) if cached else None
    if cached and age is not None and age < CACHE_TTL_HOURS:
        return cached["raw"], None
    try:
        raw = _fetch_all()
    except EcosError as exc:
        if cached:
            log.warning("ECOS 실패, 캐시로 연명: %s", exc)
            return cached["raw"], f"ECOS 를 못 읽어 {age:.0f}시간 전 값을 쓰고 있어요"
        raise MacroUnavailable(str(exc)) from exc
    _write_cache(raw)
    return raw, None


# ── 화면이 받는 것 ─────────────────────────────────────────────────────────────


def build(quarters: int = QUARTERS) -> dict:
    """모형이 딛고 선 거시 실측 — 최근 `quarters` 분기.

    갭은 **전 표본**으로 필터를 돌린 뒤 뒤에서 잘라 낸다. 잘라 놓고 필터를 돌리면
    같은 분기가 다른 값을 갖는다(HP 는 표본 전체를 보는 필터다).
    """
    raw, stale = load_raw()

    cpi = to_qseries(raw["core_cpi"])
    gdp = to_qseries(raw["gdp_real_sa"])
    xpt = to_qseries(raw["exports"])

    pi = (cpi / cpi.shift(4) - 1.0) * 100.0
    gap = output_gap_hp(gdp)
    xg = (xpt / xpt.shift(4) - 1.0) * 100.0

    def tail(s: pd.Series) -> list[dict]:
        s = s.dropna().iloc[-quarters:]
        return [{"q": str(p), "v": round(float(v), 4)} for p, v in s.items()]

    series = [
        {
            "key": "cpi",
            "label": "근원물가",
            "unit": "% YoY",
            "knob": "물가 손잡이가 얹히는 값",
            "source": "ECOS 901Y010",
            "official": True,
            "points": tail(pi),
        },
        {
            "key": "gap",
            "label": "GDP 갭",
            "unit": "%",
            "knob": "갭 손잡이가 얹히는 값",
            "source": "ECOS 200Y108/10601 → HP(1600)",
            "official": False,
            "points": tail(gap),
        },
        {
            "key": "exports",
            "label": "수출",
            "unit": "% YoY",
            "knob": "수출 손잡이가 얹히는 값",
            "source": "ECOS 200Y108/10301",
            "official": True,
            "points": tail(xg),
        },
    ]

    notes = [
        "GDP 갭은 한국은행이 발표하는 통계가 아니에요. 실질GDP에 HP(1600) 필터를 "
        "걸어 우리가 만든 프록시라, 마지막 몇 분기는 다음 자료가 들어오면 바뀌어요.",
        "유가는 ECOS에 없어요. 그 손잡이만 실측 없이 서요.",
    ]
    if stale:
        notes.insert(0, stale)

    return {
        "asof": max((s["points"][-1]["q"] for s in series if s["points"]), default=None),
        "quarters": quarters,
        "series": series,
        "notes": notes,
        "stale": bool(stale),
    }
