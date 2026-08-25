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

from sqlalchemy import text

from .mysqldb import engine
from .universe import universe_series

# 기본은 검증 레인(mr_backtest.py)과 같은 창·배수 — 화면과 검증이 딴 밴드를
# 말하면 안 된다. 기본을 바꾸려면 두 곳을 같이 바꾼다.
WINDOW = 20
K = 2.0
# 화면 선택지 [OWNER 2026-08-25 — "외부 리서치로 보통 사용하는 값들을 선택지로"].
# 근거 있는 값만 둔다: 20일·2σ 는 볼린저의 관례 기본값(그의 문헌 표준 조합).
# 60·120·252 는 채권 RV 리서치가 흔히 쓰는 분기·반기·1년 창이고, 252 는 이
# 리포의 universe·rv 화면 52주 창과 같은 낱말이다. 1.5σ·2.5σ 는 볼린저 문헌의
# 통상 변형(민감/보수 밴드). 자유 입력을 안 두는 이유: 근거 없는 조합을 화면이
# 권하는 셈이 되고, 검증 레인의 시행 장부와도 어긋난다.
WINDOWS = (20, 60, 120, 252)
KS = (1.5, 2.0, 2.5)
# 재진입 «최근» 판정 상한 — 검증 레인의 EXPIRE_N 과 같은 5영업일.
RECENT_N = 5

# (id, 라벨, 종류) — BSS 전 테너 + 국채선물 내재금리 + 퓨처스왑 [OWNER
# 2026-08-25 — "선물 들어왔는데 국채선물 롱숏이랑 선물 − IRS = 퓨처스왑 롱숏도
# 반영하기"]. 검증이 잰 것은 BSS 3·5·10Y 셋이고 나머지는 측정만 싣는 계열이다
# (측정 화면이라 문제없되, 사실은 사실대로 적어 둔다).
#
# 선물 값은 **내재수익률**이다 — 새 표(`mkt_futures_investor_close`)에는 종가만
# 있고, «선물 − IRS» 가 성립하려면 금리끼리 빼야 하므로 KRX 표준 합성채
# (표면 5%·반기 이표·3Y=6기/10Y=20기)로 종가를 환산한다(`_implied_yield`).
# 이 화면의 낱말은 전부 금리 bp 다 — 가격 계열을 섞으면 전략 실험 창의
# 명목(₩/bp)이 그 행에서만 거짓이 된다.
SERIES: list[tuple[str, str, str]] = [
    ("BSS-6M", "BSS 6M", "bss"),
    ("BSS-9M", "BSS 9M", "bss"),
    ("BSS-1Y", "BSS 1Y", "bss"),
    ("BSS-1.5Y", "BSS 1.5Y", "bss"),
    ("BSS-2Y", "BSS 2Y", "bss"),
    ("BSS-3Y", "BSS 3Y", "bss"),
    ("BSS-5Y", "BSS 5Y", "bss"),
    ("BSS-7Y", "BSS 7Y", "bss"),
    ("BSS-10Y", "BSS 10Y", "bss"),
    ("FUT-KTB3", "KTB3 내재금리", "fut"),
    ("FUT-KTB10", "KTB10 내재금리", "fut"),
    ("FSW-3Y", "퓨처스왑 3Y", "fsw"),
    ("FSW-10Y", "퓨처스왑 10Y", "fsw"),
]

# 행의 정의 문장 — 화면 서브라인이 그대로 읽는다(혼합 유니버스에서 숫자 옆에
# 무엇인지가 없으면 두 단위를 같은 자로 읽게 된다 — rv 랭킹 표의 그 판단).
KIND_DEFN = {
    "bss": "국고 − IRS",
    "fut": "선물 종가의 내재수익률 (5% 합성)",
    "fsw": "선물내재 − IRS",
}

# 퓨처스왑의 IRS 다리 — 선물 상장 만기와 같은 테너.
FSW_IRS_COL = {"FSW-3Y": ("3Y", "irs_3y"), "FSW-10Y": ("10Y", "irs_10y")}


def _implied_yield(price: float, years: int) -> float:
    """KRX 국채선물 이론가의 역함수 — 표면 5%·반기 이표 합성채 가격 → 연 수익률(%).

    P(r) = Σ_{t=1..2y} 2.5/(1+r/2)^t + 100/(1+r/2)^{2y}. 단조 감소라 이분법이면
    충분하다(60회 ≈ 1e-16 폭). P(5%) = 100 이 자명한 핀이다(테스트가 잰다).
    """
    n = 2 * years

    def pv(r: float) -> float:
        d = 1.0 + r / 2.0
        return sum(2.5 / d ** t for t in range(1, n + 1)) + 100.0 / d ** n

    lo_r, hi_r = -0.05, 0.30
    for _ in range(60):
        mid = (lo_r + hi_r) / 2.0
        if pv(mid) > price:
            lo_r = mid
        else:
            hi_r = mid
    return (lo_r + hi_r) / 2.0 * 100.0


def _fut_bundle() -> dict[str, dict[str, Any]]:
    """새 선물 표 + IRS 종가에서 넉 장을 한 번에 — 내재금리 2, 퓨처스왑 2.

    두 표 모두 `sim_portfolio` 라 같은 커넥션의 두 스캔이고, 퓨처스왑은 BSS 와
    같은 inner join 규율(양쪽 다 있는 날만, 보간·이월 없음)이다.
    """
    with engine().connect() as conn:
        fut = conn.execute(text(
            "SELECT deal_date, ktb_type, CLOSE FROM mkt_futures_investor_close "
            "WHERE CLOSE IS NOT NULL ORDER BY deal_date ASC"
        )).fetchall()
        irs = conn.execute(text(
            "SELECT irs_date, irs_3y, irs_10y FROM mkt_irs_close ORDER BY irs_date ASC"
        )).fetchall()

    yields: dict[str, list[tuple[str, float]]] = {"3Y": [], "10Y": []}
    for d, typ, close in fut:
        if typ not in yields or close is None:
            continue
        years = 3 if typ == "3Y" else 10
        yields[typ].append((d.isoformat(), _implied_yield(float(close), years)))

    irs_by_date: dict[str, dict[str, float]] = {}
    for d, y3, y10 in irs:
        irs_by_date[d.isoformat()] = {"irs_3y": y3, "irs_10y": y10}

    out: dict[str, dict[str, Any]] = {}
    for sid, typ in (("FUT-KTB3", "3Y"), ("FUT-KTB10", "10Y")):
        out[sid] = {"unit": "%", "points": [{"t": t, "v": round(v, 4)} for t, v in yields[typ]]}
    for sid, (typ, col) in FSW_IRS_COL.items():
        pts = []
        for t, v in yields[typ]:
            leg = irs_by_date.get(t, {}).get(col)
            if leg is None:
                continue
            pts.append({"t": t, "v": round((v - float(leg)) * 100.0, 4)})
        out[sid] = {"unit": "bp", "points": pts}
    return out

# 히스토리 차트가 드는 길이 — 대략 1년.
HISTORY_N = 260


def _bands(vals: list[float], window: int = WINDOW, k: float = K) -> tuple[list, list, list]:
    """SMA(window) ± k·SD(ddof=1). 창이 차기 전은 None — 0 이 아니다."""
    n = len(vals)
    ma: list[float | None] = [None] * n
    up: list[float | None] = [None] * n
    lo: list[float | None] = [None] * n
    if n < window:
        return ma, up, lo
    s = sum(vals[:window])
    s2 = sum(x * x for x in vals[:window])
    for i in range(window - 1, n):
        if i >= window:
            old, new = vals[i - window], vals[i]
            s += new - old
            s2 += new * new - old * old
        m = s / window
        # ddof=1. 수치 오차로 음수가 될 수 있어 0 에서 자른다.
        var = max(0.0, (s2 - window * m * m) / (window - 1))
        sd = math.sqrt(var)
        ma[i], up[i], lo[i] = m, m + k * sd, m - k * sd
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


def _assemble(sid: str, label: str, kind: str, unit: str,
              dates: list[str], vals: list[float],
              window: int = WINDOW, k: float = K) -> tuple[dict, dict]:
    """한 계열의 보드 행과 히스토리 조각. 반환 = (row, history)."""
    if len(vals) < window + 1:
        raise ValueError(f"{sid}: 창({window})보다 짧은 이력({len(vals)})")
    ma, up, lo = _bands(vals, window, k)
    v, m, u, l = vals[-1], ma[-1], up[-1], lo[-1]
    sd = (u - m) / k if (u is not None and m is not None) else None
    z = (v - m) / sd if sd else None
    pct_b = (v - l) / (u - l) * 100.0 if (u is not None and u != l) else None
    d1 = v - vals[-2]
    width = (u - l) if u is not None else None
    # %-계열의 차·폭은 bp 로 끝내서 보낸다 — 브라우저는 계산하지 않는다(§16).
    # (BSS 는 bp 라 scale=1 이지만, 단위 규칙은 계열이 아니라 함수의 것이다.)
    scale = 100.0 if unit == "%" else 1.0
    d_unit = "bp" if unit == "%" else unit
    row = {
        "id": sid, "label": label, "kind": kind, "defn": KIND_DEFN[kind],
        "unit": unit,
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


def series_points(sid: str, *, fut_bundle: dict | None = None) -> dict[str, Any]:
    """한 계열의 원 시계열 — 보드와 전략 실험이 **같은 유도**를 쓰는 단일 창구."""
    kinds = {s: kd for s, _, kd in SERIES}
    kind = kinds.get(sid)
    if kind is None:
        raise KeyError(sid)
    if kind == "bss":
        return universe_series(sid)
    bundle = fut_bundle if fut_bundle is not None else _fut_bundle()
    return bundle[sid]


def build_mr(dataset=None, *, window: int = WINDOW, k: float = K,
             fetch_uni: Callable[[str], dict] | None = None,
             fetch_fut: Callable[[], dict] | None = None) -> dict[str, Any]:
    """보드 + 히스토리 전부. 라우트는 이 페이로드를 썰어서만 답한다.

    `dataset` 은 이제 안 읽는다 — 모든 다리가 호출 시 SQL 이라 기동 스냅샷
    의존이 없다. 자리는 남긴다: 라우트가 캐시 키로 `_dataset.data_key` 를 계속
    쓰고(universe 와 같은 판단), 서명을 바꾸면 그 호출부가 흔들린다.

    window·k 의 허용값 검증(WINDOWS·KS)은 라우트가 한다 — 여기는 계산만.

    fetch_uni·fetch_fut 은 시험 주입 자리 — 기본은 실제 SQL 을 읽는다. 못 읽은
    계열은 조용히 빼지 않고 `excluded` 에 사유와 함께 선다(rv exclusions 문법).
    """
    fetch_uni = fetch_uni or universe_series

    rows: list[dict] = []
    histories: dict[str, dict] = {}
    excluded: list[dict] = []
    # 소스별 as-of — BSS(민평×IRS)와 선물(선물표×IRS)이 갈라질 수 있고, 갈라진
    # 날은 화면이 그렇다고 말해야 한다(rv 의 B-2).
    asof: dict[str, str | None] = {"bss": None, "fut": None}
    fut: dict | None = None
    for sid, label, kind in SERIES:
        try:
            if kind == "bss":
                body = fetch_uni(sid)
            else:
                if fut is None:
                    fut = (fetch_fut or _fut_bundle)()
                body = fut[sid]
            pts = [p for p in body["points"] if p.get("v") is not None]
            row, history = _assemble(sid, label, kind, body["unit"],
                                     [p["t"] for p in pts],
                                     [float(p["v"]) for p in pts],
                                     window, k)
        except (KeyError, ValueError) as exc:
            excluded.append({"id": sid, "label": label, "reason": str(exc)})
            continue
        rows.append(row)
        histories[sid] = history
        fam = "bss" if kind == "bss" else "fut"
        if asof[fam] is None or row["asof"] > asof[fam]:
            asof[fam] = row["asof"]

    # 늘어난 순서 — |z| 내림차순, 창 미달(None)은 끝. 랭킹과 순위 숫자까지
    # 여기서 끝난다(§16).
    rows.sort(key=lambda r: (-abs(r["z"]) if r["z"] is not None else math.inf))
    for i, r in enumerate(rows, start=1):
        r["rank"] = i
    return {
        "asof": asof,
        "params": {"window": window, "k": k, "recentN": RECENT_N},
        "rows": rows,
        "excluded": excluded,
        "history": histories,
    }
