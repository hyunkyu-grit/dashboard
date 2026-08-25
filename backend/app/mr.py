# -*- coding: utf-8 -*-
"""Mean Reversion 측정면 — 밴드 위치 보드 (Strategy 둘째 세입자, 2026-08-25).

**측정이지 신호가 아니다.** `Desktop\\bollinger-mr` 의 사전등록 검증(누적 108구성)이
「볼린저 재진입」 신호 문법을 NO-GO 로 닫았다(REPORT.md·PREREG.md) — 이 화면은
그 결론 위에 선다: 각 계열이 평소 밴드(SMA20 ± 2σ) 대비 어디에 있는지를 재서
늘어난 순서로 세울 뿐, 진입·청산·추천을 말하지 않는다. 검증이 남긴 두 사실
(살아남은 방향은 BSS 가족뿐이었다는 것, 즉시체결판의 엣지는 체결 불가 속도라는
것)은 코드 주석으로만 남는다 — 화면이 말하면 그 순간 신호가 된다.

숫자는 전부 여기서 끝난다(§16): 밴드·z·%B·상태 판정·정렬까지. 브라우저는
포맷만 한다.

유니버스는 검증 레인의 12계열 그대로다 — 잰 적 없는 계열을 화면이 먼저
말하지 않는다. IRS 일곱은 기동 스냅샷(`_dataset`)에서, BSS·선물 다섯은
`universe_series`(호출 시 SQL)에서 온다. 두 소스의 as-of 는 갈라질 수 있고
(2026-08-25 실측: IRS 08-21 대 universe 08-24), 갈라진 날은 그렇다고 말해야
하므로 as-of 는 소스별이다(rv 의 B-2 와 같은 판단).
"""
from __future__ import annotations

import math
from typing import Any, Callable

from . import payloads
from .universe import universe_series

# 검증 레인(mr_backtest.py)과 같은 창·배수 — 화면과 검증이 딴 밴드를 말하면
# 안 된다. 바꾸려면 두 곳을 같이 바꾼다.
WINDOW = 20
K = 2.0
# 재진입 «최근» 판정 상한 — 검증 레인의 EXPIRE_N 과 같은 5영업일.
RECENT_N = 5

# (id, 라벨, 묶음) — 검증 레인 SERIES 와 같은 12계열. id 는 URL 에 든다.
SERIES: list[tuple[str, str, str]] = [
    ("BSS-3Y", "BSS 3Y", "bss"),
    ("BSS-5Y", "BSS 5Y", "bss"),
    ("BSS-10Y", "BSS 10Y", "bss"),
    ("FUT-KTB3", "KTB 3년 선물", "futures"),
    ("FUT-KTB10", "KTB 10년 선물", "futures"),
    ("IRS-1Y", "IRS 1Y", "outright"),
    ("IRS-3Y", "IRS 3Y", "outright"),
    ("IRS-10Y", "IRS 10Y", "outright"),
    ("IRS-1Y-3Y", "IRS 1s3s", "spread"),
    ("IRS-3Y-10Y", "IRS 3s10s", "spread"),
    ("IRS-2Y-3Y-5Y", "IRS 2-3-5 플라이", "fly"),
    ("IRS-3Y-5Y-10Y", "IRS 3-5-10 플라이", "fly"),
]

GROUP_LABEL = {"bss": "본드스왑", "futures": "국채선물", "outright": "IRS",
               "spread": "커브", "fly": "플라이"}

# 히스토리 차트가 드는 길이 — 대략 1년.
HISTORY_N = 260


def _bands(vals: list[float]) -> tuple[list, list, list]:
    """SMA(WINDOW) ± K·SD(ddof=1). 창이 차기 전은 None — 0 이 아니다."""
    n = len(vals)
    ma: list[float | None] = [None] * n
    up: list[float | None] = [None] * n
    lo: list[float | None] = [None] * n
    if n < WINDOW:
        return ma, up, lo
    s = sum(vals[:WINDOW])
    s2 = sum(x * x for x in vals[:WINDOW])
    for i in range(WINDOW - 1, n):
        if i >= WINDOW:
            old, new = vals[i - WINDOW], vals[i]
            s += new - old
            s2 += new * new - old * old
        m = s / WINDOW
        # ddof=1. 수치 오차로 음수가 될 수 있어 0 에서 자른다.
        var = max(0.0, (s2 - WINDOW * m * m) / (WINDOW - 1))
        sd = math.sqrt(var)
        ma[i], up[i], lo[i] = m, m + K * sd, m - K * sd
    return ma, up, lo


def _out(vals: list[float], up: list, lo: list, i: int) -> int:
    """밴드 밖 방향 — +1 하단 밖, −1 상단 밖, 0 안(또는 창 미달)."""
    if up[i] is None:
        return 0
    if vals[i] < lo[i]:
        return 1
    if vals[i] > up[i]:
        return -1
    return 0


def _state(vals: list[float], up: list, lo: list) -> dict[str, Any]:
    """오늘의 밴드 상태 — 밖이면 며칠째인지, 안이면 최근 재진입인지.

    검증 레인의 상태기계와 같은 어휘(밖/재진입)를 쓰되 판정만 있고 행동이 없다.
    """
    n = len(vals)
    now = _out(vals, up, lo, n - 1)
    if now != 0:
        d = 1
        while n - 1 - d >= 0 and _out(vals, up, lo, n - 1 - d) == now:
            d += 1
        return {"kind": "below" if now == 1 else "above", "days": d}
    i = n - 2
    while i >= 0 and _out(vals, up, lo, i) == 0:
        i -= 1
    if i >= 0 and (n - 1 - i) <= RECENT_N:
        side = _out(vals, up, lo, i)
        return {"kind": "reentry-low" if side == 1 else "reentry-high",
                "days": n - 1 - i}
    return {"kind": "inside", "days": None}


def _assemble(sid: str, label: str, group: str, unit: str,
              dates: list[str], vals: list[float]) -> tuple[dict, dict]:
    """한 계열의 보드 행과 히스토리 조각. 반환 = (row, history)."""
    if len(vals) < WINDOW + 1:
        raise ValueError(f"{sid}: 창({WINDOW})보다 짧은 이력({len(vals)})")
    ma, up, lo = _bands(vals)
    v, m, u, l = vals[-1], ma[-1], up[-1], lo[-1]
    sd = (u - m) / K if (u is not None and m is not None) else None
    z = (v - m) / sd if sd else None
    pct_b = (v - l) / (u - l) * 100.0 if (u is not None and u != l) else None
    d1 = v - vals[-2]
    width = (u - l) if u is not None else None
    # %-계열의 차·폭은 bp 로 끝내서 보낸다 — 브라우저는 계산하지 않는다(§16).
    scale = 100.0 if unit == "%" else 1.0
    d_unit = "bp" if unit == "%" else unit
    row = {
        "id": sid, "label": label, "group": group,
        "groupLabel": GROUP_LABEL[group], "unit": unit,
        "v": round(v, 4),
        "d1": round(d1 * scale, 4), "dUnit": d_unit,
        "ma": round(m, 4) if m is not None else None,
        "upper": round(u, 4) if u is not None else None,
        "lower": round(l, 4) if l is not None else None,
        "z": round(z, 2) if z is not None else None,
        "pctB": round(pct_b, 1) if pct_b is not None else None,
        "width": round(width * scale, 4) if width is not None else None,
        "asof": dates[-1],
        "state": _state(vals, up, lo),
    }
    lo_i = max(0, len(vals) - HISTORY_N)
    history = {
        "id": sid, "label": label, "unit": unit,
        "points": [
            {
                "t": dates[i], "v": round(vals[i], 4),
                "ma": round(ma[i], 4) if ma[i] is not None else None,
                "up": round(up[i], 4) if up[i] is not None else None,
                "lo": round(lo[i], 4) if lo[i] is not None else None,
            }
            for i in range(lo_i, len(vals))
        ],
    }
    return row, history


def build_mr(dataset, *,
             fetch_irs: Callable[[str], dict] | None = None,
             fetch_uni: Callable[[str], dict] | None = None) -> dict[str, Any]:
    """보드 + 히스토리 전부. 라우트는 이 페이로드를 썰어서만 답한다.

    fetch_* 는 시험 주입 자리다 — 기본은 실제 소스(기동 스냅샷·SQL)를 읽는다.
    """
    fetch_irs = fetch_irs or (lambda sid: payloads.series_detail(dataset, sid, "full", None))
    fetch_uni = fetch_uni or universe_series

    rows: list[dict] = []
    histories: dict[str, dict] = {}
    asof: dict[str, str | None] = {"irs": None, "bss": None, "futures": None}
    for sid, label, group in SERIES:
        if sid.startswith("IRS-"):
            body = fetch_irs(sid[len("IRS-"):])
            fam = "irs"
        else:
            body = fetch_uni(sid)
            fam = "bss" if group == "bss" else "futures"
        pts = [p for p in body["points"] if p.get("v") is not None]
        dates = [p["t"] for p in pts]
        vals = [float(p["v"]) for p in pts]
        row, history = _assemble(sid, label, group, body["unit"], dates, vals)
        rows.append(row)
        histories[sid] = history
        if dates and (asof[fam] is None or dates[-1] > asof[fam]):
            asof[fam] = dates[-1]

    # 늘어난 순서 — |z| 내림차순, 창 미달(None)은 끝. 랭킹은 여기서 끝난다(§16).
    rows.sort(key=lambda r: (-abs(r["z"]) if r["z"] is not None else math.inf))
    return {
        "asof": asof,
        "params": {"window": WINDOW, "k": K, "recentN": RECENT_N},
        "rows": rows,
        "history": histories,
    }
