"""Server-side derivations: time bases, deltas, spreads/flies, downsampling.

Everything the wall shows is computed here — the browser never derives a
series (design spec §4).
"""

from __future__ import annotations

import datetime as dt
from bisect import bisect_left, bisect_right
from itertools import combinations

from .dataset import (
    DISPLAY_TENORS,
    QUOTED_NODES,
    SPEC_NODE_ORDER,
    Dataset,
    tenor_years,
)

# THE change bases. Three, not five [OWNER, 2026-07-31]: WTD and QTD were
# dropped from the product. Between 어제 and MTD a week is rarely the interval
# anyone reasons in, and QTD only differs from MTD in two months of three — two
# columns that mostly restated their neighbours. What is left is a day, a
# month, and a year, and the 52주 statistics carry the longer view.
BASIS_KEYS = ["d1", "mtd", "ytd"]

PREVIEW_POINTS = 150  # ~150-pt downsampled preview series (§4/§16)
CALENDAR_DAYS = 130  # ~26 trading weeks of daily changes for the heatmap (§2)

# LEVEL statistics window (annual-stats session): trailing one year of
# observations, the 52-week convention. A ten-year window straddles the
# 2020-21 near-zero regime, so every level sat at the 99th-100th percentile
# of it permanently — no discriminating power. Trailing (not calendar-YTD:
# a January YTD range is a handful of days). CHANGE-based statistics
# (movePct, tint, move-extreme rung) deliberately stay on the FULL history:
# daily changes are far more stationary than levels, so the regime break
# does not distort them and the longer window estimates better.
ANNUAL_OBS = 252

#: 이동평균 창 — **벤더 표준을 그대로 쓴다** [OWNER, 2026-08-26 — "차트 회사들에서
#: 제공하는 표준 MA로"]. 키움 HTS 의 공장 기본값이 «종가 단순 5·10·20·60·120» 이고,
#: 주 5거래일이라 5=1주 · 20=1개월 · 60=1분기 · 120=반기라는 뜻이 붙어 있다
#: (10 은 2주). TradingView 계열 리본(5·10·20·50·100·200)도 같은 계열이다.
#:
#: 새 어휘를 만들지 않는 것이 요점이다 — 이 리포의 MR 보드가 이미 20·60·120·252
#: 를 쓰고 있어(`app/mr.py` WINDOWS) 세 창이 겹친다. 두 화면이 「MA120」이라는
#: 같은 낱말로 같은 수를 말한다.
MA_WINDOWS: tuple[int, ...] = (5, 10, 20, 60, 120)


def moving_averages(
    values: list[float], windows: tuple[int, ...] = MA_WINDOWS
) -> dict[int, list[float | None]]:
    """단순이동평균(종가 기준) — 창마다 값 배열 하나.

    **창이 차기 전은 `None` 이고 0 이 아니다.** TA-Lib 이 lookback 구간을 NaN 으로
    두는 그 규약이고, 이 리포가 볼린저 밴드(`app/mr.py::_bands`)에서 이미 지키는
    규약이기도 하다 — 0 으로 채우면 화면이 «그 날 평균이 0 이었다» 고 말한다.
    프런트는 `connectNulls={false}` 로 그 구간을 잇지 않는다.

    브라우저는 시계열을 평균 내지 않는다(§16). 여기가 그 한 자리다.
    """
    n = len(values)
    out: dict[int, list[float | None]] = {}
    for w in windows:
        col: list[float | None] = [None] * n
        if w <= 0 or n < w:
            out[w] = col
            continue
        run = sum(values[:w])
        col[w - 1] = run / w
        for i in range(w, n):
            run += values[i] - values[i - w]
            col[i] = run / w
        out[w] = [None if v is None else round(v, 6) for v in col]
    return out



def annual_stats(values: list[float | None]) -> dict:
    """52-week level stats: min/max/avg of the trailing ANNUAL_OBS non-null
    observations + the percentile of the latest level within that window."""
    clean = [v for v in values if v is not None][-ANNUAL_OBS:]
    if not clean:
        return {"min": None, "max": None, "avg": None, "pct": None}
    now = clean[-1]
    s = sorted(clean)
    return {
        "min": s[0],
        "max": s[-1],
        "avg": round(sum(clean) / len(clean), 4),
        "pct": round(bisect_left(s, now) / len(s) * 100, 1),
    }


def basis_dates(dataset: Dataset) -> dict[str, dt.date | None]:
    """Last close strictly BEFORE each period containing the as-of date.

    d1 = previous available business day; mtd/ytd = last close before the
    month/year start.
    """
    dates = dataset.dates
    asof = dataset.asof

    def last_before(cutoff: dt.date) -> dt.date | None:
        i = bisect_left(dates, cutoff)
        return dates[i - 1] if i > 0 else None

    month_start = asof.replace(day=1)
    year_start = asof.replace(month=1, day=1)

    return {
        "d1": last_before(asof),
        "mtd": last_before(month_start),
        "ytd": last_before(year_start),
    }


def value_at(dataset: Dataset, values: list[float | None],
             date: dt.date | None) -> float | None:
    """Value on `date`, falling back to the most recent prior close."""
    if date is None:
        return None
    i = bisect_left(dataset.dates, date)
    if i < len(dataset.dates) and dataset.dates[i] == date:
        j = i
    else:
        j = i - 1
    while j >= 0:
        if values[j] is not None:
            return values[j]
        j -= 1
    return None


def spread_series(dataset: Dataset, short: str, long: str) -> list[float | None]:
    """Two-point curve spread in bp: long tenor minus short tenor."""
    a, b = dataset.series[short], dataset.series[long]
    return [
        (y - x) * 100 if x is not None and y is not None else None
        for x, y in zip(a, b)
    ]


def fly_series(dataset: Dataset, short: str, belly: str,
               long: str) -> list[float | None]:
    """Butterfly in bp: 2×belly − short − long."""
    a = dataset.series[short]
    b = dataset.series[belly]
    c = dataset.series[long]
    return [
        (2 * y - x - z) * 100
        if x is not None and y is not None and z is not None else None
        for x, y, z in zip(a, b, c)
    ]


def derived_ids() -> list[tuple[str, str, list[str]]]:
    """All 84 derived series: (id, kind, legs). 28 spreads + 56 flies."""
    out: list[tuple[str, str, list[str]]] = []
    for a, b in combinations(DISPLAY_TENORS, 2):
        out.append((f"{a}-{b}", "spread", [a, b]))
    for a, b, c in combinations(DISPLAY_TENORS, 3):
        out.append((f"{a}-{b}-{c}", "fly", [a, b, c]))
    return out


# The 주요 sets [OWNER, 2026-07-31]. Each tab lists its 주요 members first
# under a 주요 heading and everything else under 전체 — the same split the
# forward tab already had, generalized. So these are SUBSETS, never a
# separate universe: an id here that `derived_ids()` cannot produce is a bug,
# and `tests/test_derive.py::test_key_sets_are_subsets` fails on it.
#
# 주요 아웃라이트 is exactly the live-quoted node set, which is why the 호가만
# screener was deleted in the same pass — the divider now says what that chip
# used to say, permanently and in place.
KEY_OUTRIGHTS = frozenset(QUOTED_NODES)

KEY_SPREADS = frozenset({
    "1Y-2Y", "1Y-3Y", "2Y-3Y", "2Y-5Y",
    "2Y-10Y", "3Y-5Y", "3Y-10Y", "5Y-10Y",
})

KEY_FLIES = frozenset({
    "6M-9M-1Y", "1Y-1.5Y-2Y", "2Y-3Y-5Y", "2Y-5Y-10Y",
})


def is_key(series_id: str, kind: str) -> bool:
    """Is this series 주요 — the top block of its tab? Forwards carry their own
    flag from `forwards.KEY_FORWARDS` and never reach here."""
    if kind == "outright":
        return series_id in KEY_OUTRIGHTS
    if kind == "spread":
        return series_id in KEY_SPREADS
    if kind == "fly":
        return series_id in KEY_FLIES
    return False


def series_values(dataset: Dataset, series_id: str) -> list[float | None]:
    """Values for an outright tenor id or a derived id like '1Y-2Y[-3Y]'."""
    if series_id in dataset.series:
        return dataset.series[series_id]
    legs = series_id.split("-")
    if len(legs) == 2 and all(t in dataset.series for t in legs):
        return spread_series(dataset, *legs)
    if len(legs) == 3 and all(t in dataset.series for t in legs):
        return fly_series(dataset, *legs)
    raise KeyError(series_id)


# A second decimator, `downsample()` over (date, value) pairs, lived here to
# build the per-row spark line. That field is gone (see summarize), and it was
# its only caller, so the function went with it. `downsample_triples` below is
# the live one: it thins the preview line and is not interchangeable — it
# carries the precomputed daily change `d` through the thinning.


# The 한 줄 ladder and its three rungs lived here and are gone (pass L). The
# last column now carries the 52-week high / low / mean instead — three numbers
# in the 현재 grammar, not a sentence. Deleted with it: `classify_one_liner`
# (rung 1, own-history move extreme) and its MOVE_PCT_CUT, `apply_level_extreme`
# (rung 2) and its LEVEL_BAND/LEVEL_CAP, `apply_solo_direction` (rung 3) and its
# SOLO_MIN_BP, and the `oneLiner` key on every row of every payload.
#
# What did NOT go with it, because the one-liner was only one of its consumers:
# `day_move_pct` below. Its percentile is the tint DENSITY scale (the 어제
# column's outlier rule, the forward matrix wash) and the "오늘 많이 움직인 것"
# screener chip. Likewise `annual_stats` — the 고점권/저점권 chips, the curve
# banner, the key-forward gauge and now the range column all read it.


def day_move_pct(values: list[float | None], scale: float,
                 today_change_bp: float | None) -> float | None:
    """Percentile (0–100) of today's |D-1 change| within the series' OWN history
    of |daily changes| (in bp). This is the signal the table showed nowhere:
    +5bp is ordinary for 10Y and an event for 3M. None if too little history."""
    if today_change_bp is None:
        return None
    diffs: list[float] = []
    prev: float | None = None
    for v in values:
        if v is not None and prev is not None:
            diffs.append(abs(v - prev) * scale)
        if v is not None:
            prev = v
    if len(diffs) < 30:
        return None
    x = abs(today_change_bp)
    return round(100.0 * sum(1 for d in diffs if d <= x) / len(diffs), 1)


# When most of the curve sits in one extreme band, "this tenor is at a decade
# high" is a fact about the CURVE, not any row — it belongs in one line above
# the table, not repeated down it (§I). Above this fraction of outrights, the
# per-row level rung is suppressed and the banner speaks instead.
CURVE_REGIME_FRAC = 0.6


def curve_banner(outrights: list[dict]) -> dict:
    """Classify whether the outright curve as a whole sits at a 52-week
    extreme (§I; annual window per the annual-stats session). Backend decides
    WHAT is true; the browser renders the Korean."""
    pcts = [o["range1y"]["pct"] for o in outrights if o["range1y"]["pct"] is not None]
    if not pcts:
        return {"kind": None}
    hi = sum(1 for p in pcts if p >= 90) / len(pcts)
    lo = sum(1 for p in pcts if p <= 10) / len(pcts)
    if hi >= CURVE_REGIME_FRAC:
        return {"kind": "curve_high"}
    if lo >= CURVE_REGIME_FRAC:
        return {"kind": "curve_low"}
    return {"kind": None}


def downsample_triples(points: list[dict], target: int = PREVIEW_POINTS) -> list[dict]:
    """Stride decimation of {t,v,d} points to ≤ target, always keeping the last.
    Each surviving point keeps its own true daily change `d` (computed on the
    full series before thinning), so a preview point's tooltip stays honest."""
    if len(points) <= target:
        return points
    stride = len(points) / target
    picked = [points[int(i * stride)] for i in range(target)]
    if picked[-1] is not points[-1]:
        picked[-1] = points[-1]
    return picked


def series_history(pairs: list[tuple[str, float]], unit: str,
                   resolution: str = "full") -> dict:
    """Precompute everything the preview/enlarged panes display for a series
    (§16): the line points (downsampled for preview, full otherwise), the
    range stats, and the recent daily-change calendar. `pairs` is the full,
    chronological list of (iso-date, value) with no gaps. The browser never
    differences or averages a series — it all leaves here."""
    scale = 100 if unit == "%" else 1  # deltas quoted in bp even for % levels
    triples: list[dict] = []
    prev: float | None = None
    for t, v in pairs:
        d = round((v - prev) * scale, 2) if prev is not None else None
        triples.append({"t": t, "v": v, "d": d})
        prev = v

    values = [x["v"] for x in triples]
    stats = None
    if values:
        # 52-week stats (annual-stats session): the tooltip's range statistics
        # narrow to the trailing year even though the chart still shows the
        # full history — the 10y min/max straddle the regime break.
        year = values[-ANNUAL_OBS:]
        stats = {
            "min": min(year),
            "max": max(year),
            "avg": round(sum(year) / len(year), 4),
        }

    # ── 이동평균 ────────────────────────────────────────────────────────────
    # **솎기 전에** 전 계열에서 내고 각 포인트에 얹는다. 그래야 프리뷰 해상도로
    # 솎여도 i 번째 MA 가 i 번째 관측의 것이다 — 따로 계산해 zip 하면 다른 날의
    # 평균을 이 날 옆에 그리게 된다(`chart/references.ts` 가 기준선에 대해 적어
    # 둔 그 함정과 같은 것이고, 그럴듯해 보이고 그냥 틀린다).
    mas = moving_averages(values)
    for i, x in enumerate(triples):
        for w in MA_WINDOWS:
            x[f"_ma{w}"] = mas[w][i]

    points = (
        downsample_triples(triples) if resolution == "preview" else triples
    )

    # 솎고 나서 창별 배열로 되꺼낸다 — 응답에서는 **`points` 와 같은 첨자**의
    # 배열 다섯이고, 포인트마다 키 다섯을 다는 것보다 훨씬 작다.
    ma = {str(w): [x.pop(f"_ma{w}") for x in points] for w in MA_WINDOWS}
    # Calendar wants DAILY resolution regardless of the line's resolution.
    calendar = [
        {"t": x["t"], "d": x["d"]} for x in triples if x["d"] is not None
    ][-CALENDAR_DAYS:]

    return {"unit": unit, "points": points, "stats": stats, "calendar": calendar,
            "ma": ma, "maWindows": list(MA_WINDOWS)}


def ohlc_buckets(pairs: list[tuple[str, float]], interval: str) -> list[dict]:
    """Aggregate closes into weekly ('w') or monthly ('m') OHLC bars (§G). A
    true daily candle is impossible (closes only — open would equal close), so
    a bar is: open = first close in the period, high = max, low = min, close =
    last. The bar's date is the last close in the period. Aggregation is
    calculation, so it happens here, not the browser (§16)."""

    def key(iso: str) -> tuple:
        y, m, d = (int(x) for x in iso.split("-"))
        if interval == "m":
            return (y, m)
        iso_y, iso_w, _ = dt.date(y, m, d).isocalendar()
        return (iso_y, iso_w)

    def bar(group: list[tuple[str, float]]) -> dict:
        vals = [v for _t, v in group]
        return {
            "t": group[-1][0],
            "o": round(vals[0], 4),
            "h": round(max(vals), 4),
            "l": round(min(vals), 4),
            "c": round(vals[-1], 4),
        }

    bars: list[dict] = []
    group: list[tuple[str, float]] = []
    cur = None
    for t, v in pairs:
        k = key(t)
        if cur is not None and k != cur:
            bars.append(bar(group))
            group = []
        cur = k
        group.append((t, v))
    if group:
        bars.append(bar(group))
    return bars


def summarize(dataset: Dataset, series_id: str, label: str, kind: str,
              bases: dict[str, dt.date | None]) -> dict:
    values = [None if v is None else round(v, 4)
              for v in series_values(dataset, series_id)]
    now = None
    for v in reversed(values):
        if v is not None:
            now = v
            break

    unit = "%" if kind == "outright" else "bp"
    # Outright deltas are quoted in bp even though levels are in %.
    scale = 100 if unit == "%" else 1

    deltas: dict[str, float | None] = {}
    basis_values: dict[str, float | None] = {}
    for key in BASIS_KEYS:
        bv = value_at(dataset, values, bases[key])
        basis_values[key] = bv
        deltas[key] = round((now - bv) * scale, 4) \
            if now is not None and bv is not None else None

    # Sort key + quoted flag are computed HERE, not in the browser (§16).
    # Legs map to years; an outright is a single-leg key.
    sort_key = [tenor_years(leg) for leg in series_id.split("-")]
    quoted = (series_id in QUOTED_NODES) if kind == "outright" else None
    move_pct = day_move_pct(values, scale, deltas["d1"])

    return {
        "id": series_id,
        "label": label,
        "kind": kind,
        "unit": unit,
        "now": now,
        "deltas": deltas,
        "basisValues": basis_values,
        # 52-week LEVEL stats (annual-stats session) — never widen back to the
        # full history: the 10y window straddles the 2020-21 regime break and
        # pinned every level at the 99th-100th percentile. min/max/avg are the
        # table's last column (pass L); pct drives the 고점권/저점권 chips.
        "range1y": annual_stats(values),
        "sortKey": sort_key,
        "quoted": quoted,
        # 주요 membership — the tab's 주요/전체 divider reads this (§3). Decided
        # server-side like every other classification (§16); the browser must
        # not carry a second copy of the owner's list.
        "key": is_key(series_id, kind),
        # own-history move percentile — powers the "오늘 많이 움직인 것" screener
        # (§D) and the tint density scale; the browser never recomputes it
        # (§16). CHANGE-based, so it deliberately stays on the FULL history
        # (see ANNUAL_OBS note) — do not "fix" it to the annual window.
        "movePct": move_pct,
    }
    # No per-row history here. A 150-point `spark` line used to ride along on
    # every row, left over from the retired band-card layout whose tiles drew a
    # sparkline. The list-first table draws no per-row line and no component
    # ever read the field — it was 92.3% of the stage-1 payload (215 KB of
    # 235 KB) purely to be discarded. See docs/diagnostics/perf-baseline.md.
    # Stage 2 (/api/series) is where a line comes from; keep it that way.
