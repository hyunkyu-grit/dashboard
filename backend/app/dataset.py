"""Load data/irsdata.xlsx into an in-memory store of daily par-rate series.

Sheet layout (Infomax export):
  row 1: query metadata (start/end/count/...)
  row 2: series codes, merged cells ("원화 IRS 종합코드 6개월", ..., "...콜금리")
  row 3: field names ("일자", "MID종가" x13, "수익률")
  row 4+: data rows, dates DESCENDING

Columns B..N are the 13 IRS par tenors, column O is the call rate (1D).
Values are percent (e.g. 4.135 = 4.135%).
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl

# Wall node order. 3M (CD91) is in the product spec but ABSENT from the
# current data export — the loader records it in `missing_nodes` instead of
# faking it. Keep this list in spec order so consumers never re-sort.
SPEC_NODE_ORDER = [
    "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y",
]

# Display tenor set for spreads/flies. [OWNER]
DISPLAY_TENORS = ["1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]

# Tenor id → years, for explicit numeric sort keys (§6/§16). Unknown → +inf so
# a genuinely unmapped tenor sorts to the end loudly, never silently mid-list.
TENOR_YEARS: dict[str, float] = {
    "1D": 1.0 / 365.0, "3M": 0.25, "6M": 0.5, "9M": 0.75, "1Y": 1.0,
    "1.5Y": 1.5, "2Y": 2.0, "3Y": 3.0, "4Y": 4.0, "5Y": 5.0, "6Y": 6.0,
    "7Y": 7.0, "8Y": 8.0, "9Y": 9.0, "10Y": 10.0,
}


def tenor_years(tenor: str) -> float:
    return TENOR_YEARS.get(tenor, float("inf"))


# Live-quoted curve nodes (the actual node set); every other tenor is
# interpolated (§6). The quoted/interpolated dot marker reads this.
QUOTED_NODES = frozenset(
    {"1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"}
)


def _tenor_id(label: str) -> str:
    """Map a Korean series label to a tenor id like '6M', '1.5Y', '1D'."""
    if "콜금리" in label:
        return "1D"
    if "CD" in label:
        return "3M"  # CD 91d average — the spec's 3M node (IRS 3M = CD91)
    m = re.search(r"(\d+)개월", label)
    if m:
        months = int(m.group(1))
        if months % 12 == 0:
            return f"{months // 12}Y"
        if months == 18:
            return "1.5Y"
        return f"{months}M"
    m = re.search(r"(\d+)년", label)
    if m:
        return f"{m.group(1)}Y"
    raise ValueError(f"unrecognized series label: {label!r}")


@dataclass
class Dataset:
    dates: list[dt.date]                       # ascending
    series: dict[str, list[float | None]]      # tenor id -> values aligned to dates
    tenor_order: list[str]                     # as found in the sheet, 1D first
    missing_nodes: list[str] = field(default_factory=list)

    @property
    def asof(self) -> dt.date:
        return self.dates[-1]

    def latest(self, tenor: str) -> float | None:
        return self.series[tenor][-1]


def load_dataset(xlsx_path: Path) -> Dataset:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)

    next(rows)                 # row 1: metadata
    labels = next(rows)        # row 2: codes (merged -> None gaps)
    fields = next(rows)        # row 3: field names

    if fields[0] != "일자":
        raise ValueError(f"expected date column first, got {fields[0]!r}")

    # Resolve merged-cell label gaps: a None label belongs to the previous
    # cell's series (the code cell is merged across two columns).
    n_cols = len(fields)
    col_tenors: dict[int, str] = {}
    prev_label: str | None = None
    for col in range(n_cols):
        raw = labels[col] if col < len(labels) else None
        if raw is not None:
            prev_label = str(raw)
        if col == 0:
            continue  # date column
        if prev_label is None:
            raise ValueError(f"no series label for column {col}")
        col_tenors[col] = _tenor_id(prev_label)

    tenor_order = [col_tenors[c] for c in sorted(col_tenors)]
    if len(set(tenor_order)) != len(tenor_order):
        raise ValueError(f"duplicate tenor columns: {tenor_order}")

    dates_desc: list[dt.date] = []
    values_desc: dict[str, list[float | None]] = {t: [] for t in tenor_order}
    for row in rows:
        raw_date = row[0]
        if raw_date is None:
            continue
        if not isinstance(raw_date, dt.datetime):
            raise ValueError(f"unexpected date cell: {raw_date!r}")
        dates_desc.append(raw_date.date())
        for col, tenor in col_tenors.items():
            v = row[col] if col < len(row) else None
            values_desc[tenor].append(float(v) if v is not None else None)
    wb.close()

    if not dates_desc:
        raise ValueError("no data rows found")

    ascending = dates_desc[0] < dates_desc[-1]
    dates = dates_desc if ascending else list(reversed(dates_desc))
    series = {
        t: (vals if ascending else list(reversed(vals)))
        for t, vals in values_desc.items()
    }

    # 1D (call) first, then the sheet's IRS tenor order.
    ordered = sorted(tenor_order, key=lambda t: (t != "1D", tenor_order.index(t)))
    missing = [t for t in SPEC_NODE_ORDER if t not in series]
    return Dataset(dates=dates, series=series, tenor_order=ordered,
                   missing_nodes=missing)
