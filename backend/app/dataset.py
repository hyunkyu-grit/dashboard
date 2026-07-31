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
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl
from openpyxl.utils import get_column_letter

log = logging.getLogger(__name__)


class DataFileError(ValueError):
    """The workbook cannot be trusted, so the server does not start.

    Raised for the failures Pass A classified PLAUSIBLE-WRONG: a duplicated or
    out-of-order date silently misdirects every basis lookup, and an unbounded
    value (a decimal slip) flows into the bootstrap and out through every
    derived number. Both used to load without a word.

    The message always names the CELL — `D57`, not "row 57" and not "the 3Y
    series" — because the person fixing this is looking at a spreadsheet, and
    a cell reference is what they can type into the name box.
    """


# Sheet geometry: metadata, merged labels, field names, then data.
FIRST_DATA_ROW = 4

# Plausible band for a KRW par rate in percent. Wide on purpose — this is a
# nonsense check, not a view. It catches a decimal slip (4135 for 4.135) and a
# sign error, and would not fire on any rate this market has printed.
RATE_MIN_PCT = -5.0
RATE_MAX_PCT = 25.0

# Calendar days between consecutive observations before the file is called
# stale. Four-day weekends and Chuseok/Seollal clusters are ordinary; ten days
# means the update stopped. STALE, not unusable — the numbers are still true,
# they are just old, and refusing to start would be the wrong answer.
MAX_GAP_DAYS = 10


def _cell(row_no: int, col: int) -> str:
    """`(57, 3)` → `'D57'`. Columns are 0-based here, 1-based in the sheet."""
    return f"{get_column_letter(col + 1)}{row_no}"

# Wall node order. 3M (CD91) is in the product spec but ABSENT from the
# current data export — the loader records it in `missing_nodes` instead of
# faking it. Keep this list in spec order so consumers never re-sort.
SPEC_NODE_ORDER = [
    "1D", "3M", "6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y",
]

# Volatility rows — one relative-ATR ratio per tenor. Its OWN list, deliberately
# not DISPLAY_TENORS (2026-07-31): the two were the same six by coincidence, and
# widening the derived universe for a 6M/9M butterfly would otherwise have grown
# the 변동성 tab as a silent side effect of an unrelated decision. Nobody asked
# for 6M/9M volatility rows; if that is wanted it is a separate ruling here.
VOL_TENORS = ["1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]

# Display tenor set for spreads/flies. [OWNER] Widened to include 6M and 9M
# on 2026-07-31, because 6M/9M/1Y is one of the four 주요 버터플라이 and 주요
# has to be a SUBSET of 전체 for the divider between them to mean anything.
# The combinatorics are quadratic/cubic in this list — 6→8 tenors takes
# spreads 15→28 and flies 20→56 — so do not widen it casually.
DISPLAY_TENORS = ["6M", "9M", "1Y", "1.5Y", "2Y", "3Y", "5Y", "10Y"]

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
    # Things wrong with the file that do NOT make it untrustworthy: gaps,
    # blanks, an old last observation. STALE is not UNUSABLE — these are
    # logged at startup and the server runs. Anything that would make a
    # displayed number wrong raises DataFileError instead.
    warnings: list[str] = field(default_factory=list)

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
        raise DataFileError(
            f"A3: expected the date column header '일자', found {fields[0]!r} "
            f"— is this the Infomax export, with its metadata row on top?"
        )

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
            raise DataFileError(f"{_cell(2, col)}: no series label")
        try:
            col_tenors[col] = _tenor_id(prev_label)
        except ValueError as exc:
            raise DataFileError(f"{_cell(2, col)}: {exc}") from None

    tenor_order = [col_tenors[c] for c in sorted(col_tenors)]
    if len(set(tenor_order)) != len(tenor_order):
        dupes = sorted({t for t in tenor_order if tenor_order.count(t) > 1})
        cols = [
            _cell(2, c) for c in sorted(col_tenors) if col_tenors[c] in dupes
        ]
        raise DataFileError(
            f"two columns carry the same tenor {dupes}: {', '.join(cols)}"
        )

    dates_desc: list[dt.date] = []
    sheet_rows: list[int] = []   # sheet row per observation, for error messages
    values_desc: dict[str, list[float | None]] = {t: [] for t in tenor_order}
    blanks: dict[str, int] = {t: 0 for t in tenor_order}

    for row_no, row in enumerate(rows, start=FIRST_DATA_ROW):
        raw_date = row[0]
        if raw_date is None:
            continue
        if not isinstance(raw_date, dt.datetime):
            raise DataFileError(
                f"{_cell(row_no, 0)}: expected a date, found {raw_date!r}"
            )
        dates_desc.append(raw_date.date())
        sheet_rows.append(row_no)
        for col, tenor in col_tenors.items():
            v = row[col] if col < len(row) else None
            if v is None:
                blanks[tenor] += 1
                values_desc[tenor].append(None)
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                raise DataFileError(
                    f"{_cell(row_no, col)} ({tenor}): expected a number, "
                    f"found {v!r}"
                ) from None
            # A decimal slip is invisible without this: 4135 bootstraps just
            # as happily as 4.135, and every derived number inherits it.
            if not RATE_MIN_PCT <= fv <= RATE_MAX_PCT:
                raise DataFileError(
                    f"{_cell(row_no, col)} ({tenor}): {fv} is outside "
                    f"{RATE_MIN_PCT}%..{RATE_MAX_PCT}% — check for a "
                    f"misplaced decimal point or a sign"
                )
            values_desc[tenor].append(fv)
    wb.close()

    if not dates_desc:
        raise DataFileError("no data rows found")

    # Every date lookup in the product is a bisect on an assumed-ascending,
    # assumed-unique list (`derive.value_at`). A duplicate or a swapped pair
    # does not crash it — it silently returns the wrong row, so D-1/MTD/YTD
    # all read the wrong day while the levels look perfect. This is
    # the single most dangerous thing a hand-updated sheet can do.
    first_seen: dict[dt.date, int] = {}
    for date, row_no in zip(dates_desc, sheet_rows):
        if date in first_seen:
            raise DataFileError(
                f"{_cell(row_no, 0)}: {date} already appears at row "
                f"{first_seen[date]} — every date must be unique"
            )
        first_seen[date] = row_no

    ascending = dates_desc[0] < dates_desc[-1]
    dates = dates_desc if ascending else list(reversed(dates_desc))
    order_rows = sheet_rows if ascending else list(reversed(sheet_rows))
    series = {
        t: (vals if ascending else list(reversed(vals)))
        for t, vals in values_desc.items()
    }

    # Orientation is decided from the first and last row alone, so a swapped
    # pair in the middle survives that check untouched. Check every step.
    for i in range(1, len(dates)):
        if dates[i] <= dates[i - 1]:
            raise DataFileError(
                f"rows {order_rows[i - 1]} and {order_rows[i]}: dates run "
                f"{dates[i - 1]} then {dates[i]} — rows must be in date "
                f"order, with no repeats"
            )

    warnings: list[str] = []

    # A column of nothing is not a series. Everything downstream would read
    # `None` forever and show an em dash where a rate belongs.
    for tenor, n in blanks.items():
        if n == len(dates_desc):
            raise DataFileError(f"{tenor}: every value is blank")
        if n:
            warnings.append(f"{tenor}: {n} blank value(s)")

    # STALE, not unusable: say it and carry on.
    gaps = [
        (dates[i] - dates[i - 1]).days
        for i in range(1, len(dates))
    ]
    if gaps and max(gaps) > MAX_GAP_DAYS:
        i = gaps.index(max(gaps)) + 1
        warnings.append(
            f"{max(gaps)}-day gap between {dates[i - 1]} and {dates[i]} "
            f"(row {order_rows[i]}) — the file may have gone unupdated"
        )
    age = (dt.date.today() - dates[-1]).days
    if age > MAX_GAP_DAYS:
        warnings.append(f"last observation {dates[-1]} is {age} days old")

    for w in warnings:
        log.warning("[dataset] %s", w)

    # 1D (call) first, then the sheet's IRS tenor order.
    ordered = sorted(tenor_order, key=lambda t: (t != "1D", tenor_order.index(t)))
    missing = [t for t in SPEC_NODE_ORDER if t not in series]
    return Dataset(dates=dates, series=series, tenor_order=ordered,
                   missing_nodes=missing, warnings=warnings)
