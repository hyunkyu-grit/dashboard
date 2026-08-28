# -*- coding: utf-8 -*-
"""BSS 계열의 **긴 표본** 출처 [OWNER 2026-08-28 — "옮기고"].

화면이 쓰던 `credit_matrix` 는 2020-01-02 부터라 BSS 가 6.7년이었다. 그 길이로는
다중검정 문턱을 못 넘는다(SR 1.05·시행 118 이면 최소 8.7년이 필요한데 3.5년밖에
없었다). `imx_data.timeseries` 에 **2014-05-28 부터의 국고채커브·스왑 IRS·CD 91일**
이 있어 12.0년이 된다.

## 이음매를 안 만든다

두 출처를 붙이면 그 자리에서 수준이 튀고, 그 튐이 z 에서 신호로 잡힌다. 겹치는
1,633일에서 **상관 0.9996~1.0000 · 중앙 차이 0.00~0.10bp · 최대 3.0bp** 로 같은
계열임을 확인했으므로 전 기간을 이 출처 하나로 쓴다.

## 보드의 오늘 숫자는 안 바뀐다

z·밴드·상태는 전부 **트레일링 창**이라 마지막 점의 값은 앞이 얼마나 길든 같다.
바뀌는 것은 (ㄱ) 전략 실험의 표본 길이와 (ㄴ) 히스토리 차트가 담을 수 있는 구간
뿐이다. 다만 두 출처의 차이가 0.1bp 언저리라 표시 소수 첫째 자리가 하루 이틀
다를 수는 있다.

## `universe_series` 를 안 건드리는 이유

그 함수는 Main·rv·시뮬이 같이 쓴다. MR 만 출처를 바꾸는 일에 앱 전체의 계열
유도를 흔들 이유가 없다 — 여기서 MR 몫만 따로 세운다.

## 캐시

한 번에 세 카테고리를 다 읽고(90,594행·0.85초) **워터마크(`MAX(trade_date)`,
0.014초)를 열쇠로** 메모한다. 이 리포의 캐시 규약이 그것이다. 카테고리별로 아홉
만기를 따로 읽으면 보드 한 번에 27번을 읽게 된다.
"""
from __future__ import annotations

import datetime as dt
from functools import lru_cache
from typing import Any

from sqlalchemy import text

from .mysqldb import engine

CAT_KTB = "국고채커브"
CAT_IRS = "스왑-IRS(종합ALL)"
CAT_CD = "단기금리"
CD_ITEM = "CD 91일물"

#: 만기 라벨 → 그 카테고리의 항목명. 두 다리의 이름이 서로 달라서 표가 둘이다.
KTB_ITEM = {
    "6M": "6월이하(당일)", "9M": "9월이하(당일)", "1Y": "1년이하(당일)",
    "1.5Y": "1.5년이하(당일)", "2Y": "2년이하(당일)", "3Y": "3년이하(당일)",
    "5Y": "5년이하(당일)", "7Y": "7년이하(당일)", "10Y": "10년이하(당일)",
}
IRS_ITEM = {
    "6M": "6개월", "9M": "9개월", "1Y": "1년", "1.5Y": "18개월", "2Y": "2년",
    "3Y": "3년", "5Y": "5년", "7Y": "7년", "10Y": "10년",
}


def _watermark() -> str:
    with engine().connect() as conn:
        row = conn.execute(text("SELECT MAX(trade_date) FROM imx_data.timeseries")).fetchone()
    return "" if row is None or row[0] is None else str(row[0])


@lru_cache(maxsize=2)
def _bundle(_watermark_key: str) -> dict[str, Any]:
    """세 카테고리를 한 번에. 열쇠는 워터마크라 적재가 돌면 저절로 갈린다."""
    with engine().connect() as conn:
        rows = conn.execute(text(
            "SELECT trade_date, category, item, value FROM imx_data.timeseries "
            "WHERE category IN (:a, :b, :c) ORDER BY trade_date"
        ), {"a": CAT_KTB, "b": CAT_IRS, "c": CAT_CD}).fetchall()
    ktb: dict[str, dict[str, float]] = {}
    irs: dict[str, dict[str, float]] = {}
    cd: dict[str, float] = {}
    want_k = {v: k for k, v in KTB_ITEM.items()}
    want_i = {v: k for k, v in IRS_ITEM.items()}
    for d, cat, item, val in rows:
        if val is None:
            continue
        day = d.isoformat() if isinstance(d, (dt.date, dt.datetime)) else str(d)[:10]
        if cat == CAT_KTB and item in want_k:
            ktb.setdefault(want_k[item], {})[day] = float(val)
        elif cat == CAT_IRS and item in want_i:
            irs.setdefault(want_i[item], {})[day] = float(val)
        elif cat == CAT_CD and item == CD_ITEM:
            cd[day] = float(val)
    return {"ktb": ktb, "irs": irs, "cd": cd}


def bundle() -> dict[str, Any]:
    return _bundle(_watermark())


def reset_cache() -> None:
    """시험이 부른다 — 라이브 경로는 워터마크가 알아서 갈아 낀다."""
    _bundle.cache_clear()


def tenor_of(sid: str) -> str:
    """`BSS-3Y` → `3Y`. 이 모듈은 BSS 만 다룬다."""
    return sid.split("-", 1)[1]


def legs(sid: str, *, need_cd: bool = False) -> tuple[list[str], list[float], list[float], list[float]]:
    """(날짜, 국고, 스왑, CD) — **세(또는 두) 다리가 다 찍힌 날에만** 선다.

    한쪽을 이월해 채우면 없던 스프레드를 지어내게 된다(`universe._align` 의 그
    규율). `need_cd` 는 캐리를 쓸 때만 참이다 — 값 자체는 CD 없이도 선다.
    """
    t = tenor_of(sid)
    b = bundle()
    g = b["ktb"].get(t)
    s = b["irs"].get(t)
    if not g or not s:
        raise KeyError(f"{sid}: 긴 표본에 없는 만기다 ({t})")
    days = set(g) & set(s)
    if need_cd:
        days &= set(b["cd"])
    dates = sorted(days)
    if not dates:
        raise ValueError(f"{sid}: 두 다리가 같이 찍힌 날이 없다")
    cd = b["cd"]
    return (dates, [g[d] for d in dates], [s[d] for d in dates],
            [cd.get(d, 0.0) for d in dates])


def points(sid: str) -> dict[str, Any]:
    """`mr.series_points` 가 먹는 모양 — 값은 **bp**(국고 − 스왑, ×100)."""
    dates, govt, swap, _cd = legs(sid)
    return {
        "id": sid, "unit": "bp",
        "points": [{"t": d, "v": round((govt[i] - swap[i]) * 100.0, 4)}
                   for i, d in enumerate(dates)],
    }
