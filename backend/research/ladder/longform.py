"""Long-format risk ladder — shadow implementation.

Adapted from a pattern in Goldman Sachs' `gs-quant` (Apache-2.0). No gs-quant
code is vendored and gs-quant is NOT a dependency of this repo: it pins
`numpy<2.4` while this application runs numpy 2.5.1. The two ideas borrowed are
(1) representing a bucketed ladder as one row per bucket with a single `value`
column, so aggregation is `concat -> groupby(everything except value).sum()`,
and (2) ordering tenor labels by DAYS rather than by string.

## What this shadows, and why it is worth shadowing

D0.3c found the ladder is built three times, independently, as a dict keyed by
tenor label:

    app/backtest.py:882,908     {"krd": {label: value}}
    app/cashbond.py:1139,1157   {"krd": {label: value}}
    app/futures.py:711,730      {"krd": {label: value}}

Each accumulates with `krd[label] += ...` into a dict **pre-seeded from its own
label list**, and the label lists differ:

    app/curves.TENOR_T          14 labels, includes 1D / 4Y / 6Y
    app/creditmatrix.TENOR_LABELS 13 labels, includes 2.5Y / 20Y, no 1D / 4Y / 6Y
    app/cashbond.ASW_TENORS     10 labels, no 1D / 2.5Y / 4Y / 6Y / 20Y

That pre-seeding IS the manual alignment. Two instruments on different grids
cannot be added without deciding, by hand, which grid wins and what to do with
the buckets the other one has.

There is a second, quieter dependency. `app/backtest.py:719` reads

    labels = list(TENOR_T)  # insertion order == ascending tenor

so the ladder's ORDER is carried by the order in which the literal happens to
be written in `app/curves.py`. It is correct today. Nothing enforces it.
`tenor_days()` below replaces that with an ordering derived from the label.

## Scope

Shadow only. Nothing here is wired into a product surface, and the existing
wide ladder is unchanged. §5.3's equivalence proof is the deliverable: the long
form must reproduce the wide ladder exactly, cell for cell, on the live book.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pandas as pd

# ── tenor ordering, by days ─────────────────────────────────────────────────

_UNIT_DAYS = {"D": 1.0, "W": 7.0, "M": 30.0, "Y": 365.0}
_TENOR_RE = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*([DWMY])\s*$", re.IGNORECASE)


def tenor_days(label: str) -> float:
    """Tenor label -> days, for ordering.

    `'18M'` -> 540 lands between `'1Y'` (365) and `'2Y'` (730), which is the
    whole point: sorted as strings, `'10Y'` sorts before `'1Y'` and `'3M'`
    sorts after `'2Y'`.

    The month factor is 30, not 365/12, purely so that the common labels are
    exact integers; only the ORDER is used, never the magnitude, so the choice
    cannot leak into a number anyone sees.

    Raises on an unparseable label rather than sorting it to an arbitrary
    place — a silently mis-ordered bucket is the defect this replaces.
    """
    m = _TENOR_RE.match(label)
    if not m:
        raise ValueError(f"unparseable tenor label: {label!r}")
    qty, unit = m.group(1), m.group(2).upper()
    return float(qty) * _UNIT_DAYS[unit]


def sort_tenors(labels) -> list[str]:
    return sorted(labels, key=tenor_days)


# ── long format ─────────────────────────────────────────────────────────────

DIMENSIONS = ["instrument", "curve", "tenor_label", "tenor_days"]
VALUE = "value"


@dataclass(frozen=True)
class LadderRow:
    instrument: str
    curve: str
    tenor_label: str
    tenor_days: float
    value: float


def from_wide(krd: dict[str, float], *, instrument: str, curve: str) -> pd.DataFrame:
    """`{tenor_label: value}` -> one row per bucket.

    Zero-valued buckets are KEPT. In the wide form a zero and an absent bucket
    look identical; in long form they are different facts, and the equivalence
    proof needs the difference to reproduce the wide grid exactly.
    """
    rows = [
        LadderRow(instrument=instrument, curve=curve, tenor_label=lb,
                  tenor_days=tenor_days(lb), value=float(v))
        for lb, v in krd.items()
    ]
    return pd.DataFrame(
        [r.__dict__ for r in rows],
        columns=DIMENSIONS + [VALUE],
    )


def aggregate(frames) -> pd.DataFrame:
    """concat -> groupby(all dimensions except value).sum().

    This is the entire aggregator. It needs no knowledge of any tenor grid,
    which is what makes instruments on different grids addable.
    """
    frames = [f for f in frames if f is not None and len(f)]
    if not frames:
        return pd.DataFrame(columns=DIMENSIONS + [VALUE])
    df = pd.concat(frames, ignore_index=True)
    out = df.groupby(DIMENSIONS, as_index=False, dropna=False)[VALUE].sum()
    return out.sort_values(["curve", "tenor_days", "instrument"]).reset_index(drop=True)


def collapse_to_curve(df: pd.DataFrame) -> pd.DataFrame:
    """Net across instruments, keeping the curve and tenor dimensions."""
    if not len(df):
        return df
    out = df.groupby(["curve", "tenor_label", "tenor_days"], as_index=False,
                     dropna=False)[VALUE].sum()
    return out.sort_values(["curve", "tenor_days"]).reset_index(drop=True)


def to_wide(df: pd.DataFrame, labels: list[str] | None = None) -> dict[str, float]:
    """Long -> the existing `{label: value}` shape, for the equivalence proof.

    `labels` pins the output grid so the comparison is against the wide
    ladder's own buckets. Buckets present in the long form but absent from
    `labels` are reported by the caller, never dropped silently.
    """
    netted = collapse_to_curve(df)
    got = dict(zip(netted["tenor_label"], netted[VALUE]))
    if labels is None:
        return {lb: got[lb] for lb in sort_tenors(got)}
    return {lb: float(got.get(lb, 0.0)) for lb in labels}


def extra_buckets(df: pd.DataFrame, labels: list[str]) -> list[str]:
    """Buckets the long form carries that the given wide grid has no column
    for — i.e. exactly what the wide representation would have to discard."""
    present = set(collapse_to_curve(df)["tenor_label"])
    return sort_tenors(present - set(labels))
