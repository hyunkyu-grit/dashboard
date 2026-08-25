# -*- coding: utf-8 -*-
"""Mean Reversion 측정면 — BSS 전 테너 밴드 위치 랭킹 (Strategy 둘째 세입자).

**측정이지 신호가 아니다.** `Desktop\\bollinger-mr` 의 사전등록 검증(누적 108구성)이
「볼린저 재진입」 신호 문법을 NO-GO 로 닫았다(REPORT.md·PREREG.md) — 이 화면은
그 결론 위에 선다: 각 테너가 평소 밴드(SMA20 ± 2σ) 대비 어디에 있는지를 재서
늘어난 순서로 세울 뿐, 진입·청산·추천을 말하지 않는다.

**유니버스는 본드스왑 스프레드(국고 − IRS)뿐이다** [OWNER 2026-08-25 — "일단
본드스왑만"]. 첫 판은 검증 레인의 비교군 12계열(선물·IRS 포함)을 그대로 실었는데
그건 범위를 잘못 읽은 것이었다 — 비교군은 검증을 위한 것이었고 화면은 오너가
지정한 유니버스만 싣는다. 선물·IRS 행은 여기서 내려갔다. 대신 BSS 는 일부
테너가 아니라 **전 테너**(6M~10Y, credit_matrix × mkt_irs_close 가 주는 아홉)다.

숫자는 전부 여기서 끝난다(§16): 밴드·z·%B·상태 판정·정렬·순위까지. 브라우저는
포맷만 한다. 데이터는 `universe_series`(호출 시 SQL, 두 다리 inner join)라
전 행이 한 소스·한 as-of 다 — 첫 판의 소스별 as-of 갈림도 같이 은퇴했다.
"""
from __future__ import annotations

import math
from typing import Any, Callable

from .universe import universe_series

# 검증 레인(mr_backtest.py)과 같은 창·배수 — 화면과 검증이 딴 밴드를 말하면
# 안 된다. 바꾸려면 두 곳을 같이 바꾼다.
WINDOW = 20
K = 2.0
# 재진입 «최근» 판정 상한 — 검증 레인의 EXPIRE_N 과 같은 5영업일.
RECENT_N = 5

# (id, 라벨) — universe 의 BSS 전 테너. 검증이 잰 것은 3·5·10Y 셋이고 나머지는
# 측정만 싣는 테너다(측정 화면이라 문제없되, 사실은 사실대로 적어 둔다).
SERIES: list[tuple[str, str]] = [
    ("BSS-6M", "BSS 6M"),
    ("BSS-9M", "BSS 9M"),
    ("BSS-1Y", "BSS 1Y"),
    ("BSS-1.5Y", "BSS 1.5Y"),
    ("BSS-2Y", "BSS 2Y"),
    ("BSS-3Y", "BSS 3Y"),
    ("BSS-5Y", "BSS 5Y"),
    ("BSS-7Y", "BSS 7Y"),
    ("BSS-10Y", "BSS 10Y"),
]

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


def _assemble(sid: str, label: str, unit: str,
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
    # (BSS 는 bp 라 scale=1 이지만, 단위 규칙은 계열이 아니라 함수의 것이다.)
    scale = 100.0 if unit == "%" else 1.0
    d_unit = "bp" if unit == "%" else unit
    row = {
        "id": sid, "label": label, "unit": unit,
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


def build_mr(dataset=None, *,
             fetch_uni: Callable[[str], dict] | None = None) -> dict[str, Any]:
    """보드 + 히스토리 전부. 라우트는 이 페이로드를 썰어서만 답한다.

    `dataset` 은 이제 안 읽는다 — BSS 두 다리가 전부 호출 시 SQL 이라 기동
    스냅샷 의존이 없다. 자리는 남긴다: 라우트가 캐시 키로 `_dataset.data_key`
    를 계속 쓰고(universe 와 같은 판단), 서명을 바꾸면 그 호출부가 흔들린다.

    fetch_uni 는 시험 주입 자리 — 기본은 실제 SQL 을 읽는다. 못 읽은 테너는
    조용히 빼지 않고 `excluded` 에 사유와 함께 선다(rv 의 exclusions 문법).
    """
    fetch_uni = fetch_uni or universe_series

    rows: list[dict] = []
    histories: dict[str, dict] = {}
    excluded: list[dict] = []
    asof: str | None = None
    for sid, label in SERIES:
        try:
            body = fetch_uni(sid)
            pts = [p for p in body["points"] if p.get("v") is not None]
            row, history = _assemble(sid, label, body["unit"],
                                     [p["t"] for p in pts],
                                     [float(p["v"]) for p in pts])
        except (KeyError, ValueError) as exc:
            excluded.append({"id": sid, "label": label, "reason": str(exc)})
            continue
        rows.append(row)
        histories[sid] = history
        if asof is None or row["asof"] > asof:
            asof = row["asof"]

    # 늘어난 순서 — |z| 내림차순, 창 미달(None)은 끝. 랭킹과 순위 숫자까지
    # 여기서 끝난다(§16).
    rows.sort(key=lambda r: (-abs(r["z"]) if r["z"] is not None else math.inf))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return {
        "asof": {"bss": asof},
        "params": {"window": WINDOW, "k": K, "recentN": RECENT_N},
        "rows": rows,
        "excluded": excluded,
        "history": histories,
    }
