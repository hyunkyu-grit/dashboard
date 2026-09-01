"""Which calendar decides a Seoul business day? — measured, not assumed.

D0.3(b) found FIVE `holidays.KR()` constructions in this backend, with four
different year windows, and no QuantLib `SouthKorea` anywhere:

    app/engine_port.py:27                      holidays.KR(2016..2035)
    irs_pricer/core/errors.py:22               holidays.KR(2010..2035)
    irs_pricer/engine/quant_engine.py:31       holidays.KR(2020..2034)
    irs_pricer/services/simulation/kr_calendar.py:21   holidays.KR(2020..2034)
    kr_calendar.py:29,42,126                   per-call dynamic ranges

`app/calendar_cache.py` notes that `holidays.HolidayBase.__keytransform__`
auto-expands past the constructed window, so the four windows MAY agree
functionally. That is a claim to measure, not to assume, and it is measured
below (`window_sensitivity`).

The substantive question is different and is why this module exists at all:
CD91 fixing and bond settlement follow **bank** business days, while
`exchange_calendars` XKRX is a **trading** calendar. They are not the same set
— the KRX year-end closure (31 Dec) is an exchange holiday while banks are
open. Pricing that resets on the wrong set is wrong by a day, silently.

Emits `docs/q1/calendar_divergence.csv`: every date in 2015..2026 on which any
two sources disagree, with what each one says.
"""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path
from typing import Callable

START_YEAR = 2015
END_YEAR = 2026

# ── sources ─────────────────────────────────────────────────────────────────
# Each source answers one question: "is `d` a business day in Seoul?"
# A source that cannot load returns None for everything and is reported as
# unavailable — never silently treated as agreeing.


def _weekend(d: dt.date) -> bool:
    return d.weekday() >= 5


def src_holidays_bank(years: range) -> tuple[str, Callable[[dt.date], bool] | None, str]:
    """`holidays.KR` — the package this backend already depends on.

    This is a **public/bank holiday** list, which is the set CD91 fixing and
    settlement actually follow.
    """
    try:
        import holidays as h

        cal = h.KR(years=years)
    except Exception as exc:  # noqa: BLE001 - report, never degrade
        return ("holidays.KR", None, f"unavailable: {type(exc).__name__}: {exc}")

    def is_bd(d: dt.date) -> bool:
        return (not _weekend(d)) and (d not in cal)

    return ("holidays.KR", is_bd, f"holidays {h.__version__}")


def src_quantlib(variant: str) -> tuple[str, Callable[[dt.date], bool] | None, str]:
    """QuantLib `SouthKorea`. Installed in this environment but imported by no
    application module (D0.3a) — included here only so the comparison is
    complete, not because anything reads it."""
    name = f"QuantLib.SouthKorea.{variant}"
    try:
        import QuantLib as ql

        market = getattr(ql.SouthKorea, variant)
        cal = ql.SouthKorea(market)
    except Exception as exc:  # noqa: BLE001
        return (name, None, f"unavailable: {type(exc).__name__}: {exc}")

    def is_bd(d: dt.date) -> bool:
        return bool(cal.isBusinessDay(ql.Date(d.day, d.month, d.year)))

    return (name, is_bd, f"QuantLib {ql.__version__}")


def src_exchange_calendars() -> tuple[str, Callable[[dt.date], bool] | None, str]:
    """`exchange_calendars` XKRX — a **trading** calendar. Present in the
    environment; imported by no application module."""
    name = "exchange_calendars.XKRX"
    try:
        import exchange_calendars as xcals

        cal = xcals.get_calendar(
            "XKRX",
            start=f"{START_YEAR}-01-01",
            end=f"{END_YEAR}-12-31",
        )
        sessions = {s.date() for s in cal.sessions}
    except Exception as exc:  # noqa: BLE001
        return (name, None, f"unavailable: {type(exc).__name__}: {exc}")

    def is_bd(d: dt.date) -> bool:
        return d in sessions

    return (name, is_bd, f"exchange_calendars {xcals.__version__}")


def build_sources() -> list[tuple[str, Callable[[dt.date], bool] | None, str]]:
    yrs = range(START_YEAR, END_YEAR + 1)
    return [
        src_holidays_bank(yrs),
        src_quantlib("Settlement"),
        src_quantlib("KRX"),
        src_exchange_calendars(),
    ]


# ── comparison ──────────────────────────────────────────────────────────────


def weekdays(start_year: int = START_YEAR, end_year: int = END_YEAR) -> list[dt.date]:
    """Weekdays only. Weekends are non-business everywhere and would swamp the
    diff with agreement."""
    d = dt.date(start_year, 1, 1)
    end = dt.date(end_year, 12, 31)
    out = []
    while d <= end:
        if not _weekend(d):
            out.append(d)
        d += dt.timedelta(days=1)
    return out


def divergences(sources=None, days=None) -> tuple[list[dict], dict]:
    """Symmetric difference: every weekday on which the available sources do
    not unanimously agree. Returns (rows, meta)."""
    sources = build_sources() if sources is None else sources
    days = weekdays() if days is None else days

    live = [(n, f, note) for n, f, note in sources if f is not None]
    dead = [(n, note) for n, f, note in sources if f is None]

    rows: list[dict] = []
    for d in days:
        verdicts = {n: f(d) for n, f, _ in live}
        if len(set(verdicts.values())) > 1:
            row = {"date": d.isoformat(), "weekday": d.strftime("%a")}
            row.update({n: ("business" if v else "holiday") for n, v in verdicts.items()})
            row["n_say_business"] = sum(1 for v in verdicts.values() if v)
            row["n_say_holiday"] = sum(1 for v in verdicts.values() if not v)
            rows.append(row)

    meta = {
        "years": f"{START_YEAR}..{END_YEAR}",
        "weekdays_examined": len(days),
        "sources_live": [n for n, _, _ in live],
        "sources_unavailable": dead,
        "source_notes": {n: note for n, _, note in live},
        "divergent_days": len(rows),
    }
    return rows, meta


def window_sensitivity() -> list[dict]:
    """Does the `holidays.KR(years=...)` window actually change any answer?

    `app/calendar_cache.py` asserts auto-expansion makes the window
    irrelevant to OUTPUT. This measures that claim against the four windows
    that exist in this backend rather than repeating it.
    """
    import holidays as h

    windows = {
        "engine_port 2016..2035": range(2016, 2036),
        "irs_pricer.errors 2010..2035": range(2010, 2036),
        "quant_engine 2020..2034": range(2020, 2035),
        "kr_calendar 2020..2034": range(2020, 2035),
    }
    cals = {k: h.KR(years=v) for k, v in windows.items()}
    out = []
    for d in weekdays():
        verdicts = {k: (not _weekend(d)) and (d not in c) for k, c in cals.items()}
        if len(set(verdicts.values())) > 1:
            out.append({"date": d.isoformat(), **{k: v for k, v in verdicts.items()}})
    return out


def main() -> None:
    repo = Path(__file__).resolve().parents[3]
    outdir = repo / "docs" / "q1"
    outdir.mkdir(parents=True, exist_ok=True)

    rows, meta = divergences()

    print(f"weekdays examined : {meta['weekdays_examined']}  ({meta['years']})")
    print(f"sources live      : {meta['sources_live']}")
    for n, note in meta["sources_unavailable"]:
        print(f"  UNAVAILABLE     : {n} — {note}")
    for n, note in meta["source_notes"].items():
        print(f"  {n:38s} {note}")
    print(f"DIVERGENT DAYS    : {meta['divergent_days']}")

    if rows:
        cols = list(rows[0].keys())
        path = outdir / "calendar_divergence.csv"
        with path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)
        print(f"wrote {path} ({len(rows)} rows)")
    else:
        print("NO DIVERGENCE — treat as suspicious; check that every source loaded.")

    ws = window_sensitivity()
    print(f"holidays.KR window sensitivity: {len(ws)} days differ across the "
          f"four windows this backend constructs")


if __name__ == "__main__":
    main()
