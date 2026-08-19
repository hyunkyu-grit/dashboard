"""The BOK base rate — the policy anchor every % chart is drawn against.

[OWNER, 2026-07-31] CD and the base rate are always drawn together, and the
base rate rides along on every %-unit chart (outrights + forwards). Spread,
butterfly and volatility charts are bp / ratio and are excluded: a 2.75 line
on a ±30bp axis is not a comparison, it is a rescale.

Two things make this file more than a second `dataset.py`:

**It is a STEP, not a series.** The rate changes only on a Monetary Policy
Board decision and holds flat in between, so it is drawn with square corners
and read as a level that was *in force* on a date, never interpolated.

**Carrying it forward is a claim.** `data/bokbaserate.xlsx` is a static
snapshot like the IRS workbook, and the two are refreshed by hand, separately.
Holding the last observed rate out to the IRS as-of date is correct exactly
when no Board meeting fell in the gap — and silently wrong when one did, in
the one direction that matters: it would draw the OLD rate through the day it
changed, on every chart at once, with nothing on screen to say so.

So the carry is bounded by the meeting calendar. If a meeting sits between the
workbook's last date and the dataset's as-of date, the step **ends at the last
date it can vouch for** and a warning is recorded. The line visibly stops
short rather than asserting a rate nobody checked; a missing tail is a
question the reader can see, a fabricated one is not.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from bisect import bisect_right
from dataclasses import dataclass, field
from pathlib import Path

import openpyxl

log = logging.getLogger(__name__)

# Sheet geometry — the Infomax add-in's export, same shape as irsdata.xlsx:
# row 1 metadata, row 2 the code (`한국:기준금리`) + unit, row 3 field names,
# then data. Unlike the IRS workbook this one is DESCENDING (newest first).
FIRST_DATA_ROW = 4
DATE_COL = 0
VALUE_COL = 1

# Plausible band for a policy rate in percent. A nonsense check, not a view.
RATE_MIN_PCT = -1.0
RATE_MAX_PCT = 15.0

# Monetary Policy Board rate-decision dates. A SECOND COPY of the `mpc`
# entries in `frontend/src/data/calendar.json`, which is the owner-verified
# original. It is copied rather than imported because the backend must not
# reach into the frontend source tree at runtime, and
# `tests/test_policy.py::test_mpc_dates_match_the_calendar` fails if the two
# ever disagree — so the duplication cannot rot silently.
MPC_DATES = [
    dt.date(2026, 1, 15),
    dt.date(2026, 2, 26),
    dt.date(2026, 4, 10),
    dt.date(2026, 5, 28),
    dt.date(2026, 7, 16),
    dt.date(2026, 8, 27),
    dt.date(2026, 10, 22),
    dt.date(2026, 11, 26),
]

# V2-LOCAL: v1 은 `frontend/src/data/`, v2 는 프론트가 리포 루트라 `src/data/`.
# 이 파일은 v2 에 아직 없고(그래서 아래 함수는 None 을 돌려준다) 그건 정상이다 —
# 테스트 보조이지 런타임이 아니다. 다만 경로는 v2 의 실제 자리를 가리켜야, 파일이
# 생긴 날 조용히 안 읽히는 일이 없다.
CALENDAR_JSON = (
    Path(__file__).resolve().parents[2] / "src" / "data" / "calendar.json"
)


def mpc_dates_from_calendar() -> list[dt.date] | None:
    """The `mpc` dates in the frontend's verified calendar, or None if the file
    is not there (a backend-only checkout). Test support, not runtime."""
    if not CALENDAR_JSON.exists():
        return None
    doc = json.loads(CALENDAR_JSON.read_text(encoding="utf-8"))
    return sorted(
        dt.date.fromisoformat(e["date"])
        for e in doc["events"]
        if e.get("kind") == "mpc"
    )


class PolicyFileError(Exception):
    """The workbook cannot be trusted at all — a wrong number, not an old one."""


@dataclass
class BaseRate:
    dates: list[dt.date]          # ascending, one per observation in the file
    values: list[float]           # percent, aligned to `dates`
    warnings: list[str] = field(default_factory=list)

    @property
    def asof(self) -> dt.date:
        return self.dates[-1]

    @property
    def latest(self) -> float:
        return self.values[-1]

    def at(self, date: dt.date) -> float | None:
        """The rate IN FORCE on `date` — the last decision at or before it.
        None before the file's first observation; never interpolated."""
        i = bisect_right(self.dates, date)
        return self.values[i - 1] if i > 0 else None


def load_base_rate(xlsx_path: Path) -> BaseRate:
    wb = openpyxl.load_workbook(xlsx_path, read_only=True, data_only=True)
    ws = wb[wb.sheetnames[0]]
    rows = ws.iter_rows(values_only=True)

    next(rows)                 # row 1: metadata
    next(rows)                 # row 2: code + unit
    fields = next(rows)        # row 3: field names
    if fields[DATE_COL] != "일자":
        raise PolicyFileError(
            f"{xlsx_path.name}: expected 일자 in the first field column, "
            f"found {fields[DATE_COL]!r} — is this the base-rate export?"
        )

    pairs: list[tuple[dt.date, float]] = []
    for n, row in enumerate(rows, start=FIRST_DATA_ROW):
        raw_date, raw_value = row[DATE_COL], row[VALUE_COL]
        if raw_date is None:
            continue           # the export pads to a fixed row count
        if not isinstance(raw_date, dt.datetime):
            raise PolicyFileError(f"{xlsx_path.name} row {n}: bad date {raw_date!r}")
        if raw_value is None:
            continue
        value = float(raw_value)
        if not RATE_MIN_PCT <= value <= RATE_MAX_PCT:
            raise PolicyFileError(
                f"{xlsx_path.name} row {n}: {value} is not a policy rate in percent"
            )
        pairs.append((raw_date.date(), value))
    wb.close()

    if not pairs:
        raise PolicyFileError(f"{xlsx_path.name}: no observations")

    pairs.sort(key=lambda p: p[0])   # the export is newest-first
    return BaseRate(
        dates=[d for d, _v in pairs],
        values=[v for _d, v in pairs],
    )


def decisions(base: BaseRate) -> list[tuple[dt.date, float]]:
    """The step's CORNERS: the first date, plus every date the rate changed.
    Two thousand daily rows describe about a dozen decisions; the chart only
    needs the corners, and sending the rest would be sending the same number
    over and over (§20)."""
    out = [(base.dates[0], base.values[0])]
    for d, v in zip(base.dates[1:], base.values[1:]):
        if v != out[-1][1]:
            out.append((d, v))
    return out


def policy_step(base: BaseRate, asof: dt.date) -> dict:
    """The payload the charts draw: step corners, plus the date the step is
    entitled to run to.

    `through` is `asof` when the carry is safe and the workbook's own last
    date when it is not — see the module docstring. Consumers draw the final
    level flat out to `through` and STOP; they must not extend to their own
    axis end, which is the mistake this field exists to prevent.
    """
    warnings: list[str] = []
    through = asof
    if base.asof < asof:
        missed = [d for d in MPC_DATES if base.asof < d <= asof]
        if missed:
            through = base.asof
            warnings.append(
                f"[policy] base rate is stale to {base.asof} and the Board met "
                f"{', '.join(d.isoformat() for d in missed)} — the step ends at "
                f"{base.asof} rather than carrying an unverified rate to {asof}. "
                f"Refresh data/bokbaserate.xlsx."
            )
    for w in warnings:
        log.warning(w)
    return {
        "unit": "%",
        "asof": base.asof.isoformat(),
        "through": through.isoformat(),
        "steps": [
            {"date": d.isoformat(), "rate": v}
            for d, v in decisions(base)
            if d <= through
        ],
        "latest": base.at(through),
        # V2-LOCAL, 2026-08-14 — 앞으로 남은 금통위 날짜. 시뮬레이션의 기준금리
        # 이벤트가 이걸 읽어 날짜 칸을 채운다.
        #
        # 프론트에 두 번째 목록을 두지 않는 이유는 이 모듈이 이미 겪은 것이다:
        # `MPC_DATES` 자체가 `calendar.json` 의 사본이고, 그 중복이 조용히 썩지
        # 않도록 테스트가 둘을 대조한다. 세 번째 사본을 브라우저에 두면 그
        # 대조에서 빠진 사본이 하나 생긴다.
        #
        # `asof` 이후만 보낸다 — 지난 회의는 이미 `steps` 에 결과로 들어 있고,
        # 시뮬레이션이 놓을 수 있는 것은 아직 안 온 회의뿐이다.
        "upcoming": [d.isoformat() for d in MPC_DATES if d > asof],
        "warnings": warnings,
    }
