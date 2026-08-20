"""Payload builders — the single source of every response body.

Static conversion, Pass B. These used to live inline in `main.py`'s handlers.
They were lifted out for one reason: the static pipeline has to produce byte-
identical bodies, and the only way to guarantee that is for both to call the
same function. Two implementations of "what the summary looks like" would drift
silently, and the drift would look like data.

So `main.py` is now transport (routing, status codes, errors) and this module
is content. Nothing here knows about HTTP, and nothing here reads the clock —
see `docs/diagnostics/static-feasibility.md` for why that second property is
load-bearing: every number below is a pure function of the xlsx, so freezing
them at build time cannot make the page answer yesterday's question.
"""

from __future__ import annotations

import datetime as dt

import numpy as np

from .dataset import DISPLAY_TENORS, SPEC_NODE_ORDER, Dataset
from .derive import (
    curve_banner,
    derived_ids,
    ohlc_buckets,
    series_history,
    series_values,
    summarize,
)
from .theta import theta_table
from .volatility import relative_atr_for


def outright_label(tenor: str) -> str:
    return "Call (1D)" if tenor == "1D" else f"IRS {tenor}"


def _iso_bases(bases: dict[str, dt.date | None]) -> dict[str, str | None]:
    return {k: (d.isoformat() if d else None) for k, d in bases.items()}


def wall_summary(dataset: Dataset, bases: dict, events: list,
                 policy: dict) -> dict:
    outrights = [
        summarize(dataset, t, outright_label(t), "outright", bases)
        for t in dataset.tenor_order
    ]
    derived = [
        summarize(dataset, sid, sid.replace("-", "/"), kind, bases)
        for sid, kind, _legs in derived_ids()
    ]
    # 세타 [OWNER, 2026-08-13]. `summarize` 안이 아니라 여기서 붙는다 — 그
    # 함수는 한 시리즈의 값만 보는 순수 함수고, 세타는 커브 전체를 본다.
    # 스프레드·플라이도 받는다 [OWNER, 같은 날 — "스프레드랑 버터플라이까지"]:
    # DV01 중립이라 순 DV01 은 0 이지만, 커브 트레이드의 리스크 단위는 순
    # DV01 이 아니라 다리 DV01 이다 (theta.theta_for_package 에 근거).
    # 값이 없는 종목에는 키 자체가 없다 — 화면이 그 부재를 em dash 로 그린다.
    thetas, theta_basis = theta_table(dataset)
    for row in (*outrights, *derived):
        row["theta"] = thetas.get(row["id"])
    # The whole-curve extreme (§I) is the one cross-sectional statement left
    # here: it is a fact about the CURVE, stated once above the table. The 한 줄
    # ladder's two cross-sectional rungs used to run at this point and are gone
    # with the column (pass L) — nothing else needed the whole table built.
    banner = curve_banner(outrights)
    return {
        "asof": dataset.asof.isoformat(),
        "basisDates": _iso_bases(bases),
        "specNodeOrder": SPEC_NODE_ORDER,
        "displayTenors": DISPLAY_TENORS,
        "missingNodes": dataset.missing_nodes,
        "curveBanner": banner,  # §I: whole-curve extreme stated once, not per row
        "outrights": outrights,
        "derived": derived,
        # 세타 열이 자기를 설명하는 데 필요한 기준 — 호라이즌·노셔널·부호
        # 방향·그날의 CD. 행마다 되풀이할 값이 아니라 표 전체에 한 번이다.
        "thetaBasis": theta_basis,
        # BOK base rate as step corners (§policy). Every %-unit chart draws it;
        # `through` bounds the carry and is not the reader's axis end.
        "policy": policy,
        # Change-log EVENTS (D-1 fixed, collapsed) — DESIGN §12 rule (c).
        "events": events,
        # `regret`(라고 할 때 살걸)이 여기 있었다 — v1 이 2026-08-14 에 Lab 탭을
        # 비우며 은퇴시켰고, v2 는 그 뒤로도 **읽는 화면 없이 계속 굽고** 있었다.
        # [OWNER, 2026-08-20] v2 도 은퇴. 20일 이벤트 리플레이 + 줄마다 ~2회
        # 평가라 굽는 값이 실했다. 이미 구워져 트리에 남은 summary.json 에는
        # 다음 굽기 전까지 그 키가 남지만, 읽는 쪽이 없다.
    }


def volatility(dataset: Dataset, bases: dict, vol: dict) -> dict:
    return {"asof": dataset.asof.isoformat(), "basisDates": _iso_bases(bases), **vol}


def series_pairs(
    dataset: Dataset,
    series_id: str,
    zcs: list[np.ndarray | None] | None = None,
) -> tuple[list[tuple[str, float]], str]:
    """(iso-date, value) pairs for a series id, plus its unit. Raises KeyError
    on an unknown id.

    `zcs` is the optional shared bootstrap — the whole history's zero curves,
    built ONCE. Forward histories are derived from it when supplied; without it
    each forward bootstraps its own copy, which is the live server's lazy
    behaviour and is 1.58s per series. Pass A verified the two paths agree to
    the last digit across six sampled forwards (max|diff| = 0.0), so this is a
    speed switch, not a fidelity one.
    """
    # imported here: forwards imports derive, and a module-level import would
    # close the cycle
    from .forwards import (
        curve_prices_span,
        forward_history,
        forward_par_rate,
        parse_forward_id,
    )

    if series_id.startswith("vol:"):
        # Volatility history: the relative-ATR ratio for a tenor. Ratio levels
        # are dimensionless; warm-up / floor nulls are simply absent.
        ratios = relative_atr_for(dataset, series_id[len("vol:"):])
        return [(t, r) for t, r in ratios if r is not None], "ratio"

    if "x" in series_id:
        # Forward ids carry an 'x' (2Yx1Y); history comes from each date's curve.
        start_y, tenor_y = parse_forward_id(series_id)
        if zcs is None:
            hist = forward_history(dataset, series_id)
            return [(p["t"], p["v"]) for p in hist], "%"
        return [
            (d.isoformat(), round(forward_par_rate(z, start_y, tenor_y) * 100, 4))
            for d, z in zip(dataset.dates, zcs)
            # the SAME skip the lazy path applies inside forward_history —
            # this fast path bypassed it and kept emitting the ten 0.0% rows
            # after the fix, and the agreement suite's series sample happens
            # not to include a span-sensitive forward, so only a direct look
            # at the emitted file caught it (V-PASS V5)
            if z is not None and curve_prices_span(z, start_y)
        ], "%"

    values = series_values(dataset, series_id)
    # outright levels are %, derived spreads/flies are already bp.
    unit = "%" if series_id in dataset.series else "bp"
    # A missing observation produces NO POINT — it is not carried through as a
    # null. That is the live behaviour and the static build must keep it; see
    # the gap note in docs/diagnostics/static-feasibility.md.
    return [
        (d.isoformat(), round(v, 4))
        for d, v in zip(dataset.dates, values)
        if v is not None
    ], unit


def series_detail(
    dataset: Dataset,
    series_id: str,
    res: str = "full",
    interval: str | None = None,
    zcs: list[np.ndarray | None] | None = None,
) -> dict:
    """One `/api/series/{id}` body. `res=preview` → ~150 downsampled points;
    `res=full` → every day. `interval=w|m` → weekly/monthly OHLC instead (§G).
    Stats, per-point daily change and the calendar are always precomputed here —
    the browser never differences or aggregates a series (§16)."""
    pairs, unit = series_pairs(dataset, series_id, zcs)
    head = {"id": series_id, "asof": dataset.asof.isoformat()}
    if interval in ("w", "m"):
        return {**head, "unit": unit, "interval": interval,
                "bars": ohlc_buckets(pairs, interval)}
    return {**head, **series_history(pairs, unit, res)}


def empty_dv01(series_id: str) -> dict:
    """Forwards / volatility / unknown ids get an empty block (kind null)."""
    return {"id": series_id, "kind": None, "legs": [], "residual": None}
