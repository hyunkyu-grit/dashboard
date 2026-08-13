"""Data-folder change detection — NEW in this deployment, no frozen counterpart.

The source app got fresh workbooks through an upload endpoint, which cleared the
derived caches on the way past (upload.py: `ttl_cache.clear(); curve_cache.clear()`).
Here the owner refreshes `data/` directly, so nothing gets a chance to clear
anything and the app would keep serving pre-refresh numbers.

The loaders' own cache is keyed on (path, mtime) and re-parses correctly on its
own. The problem is everything derived FROM the parse: fixings, the available-date
list, sector/tenor shift tables, and above all the bootstrapped curves — curve_cache
is keyed on RATE VALUES, which is exactly what a refresh changes. Those caches have
no idea a file moved underneath them.

So: stamp the data folder (name, mtime, size per workbook) and, when the stamp
changes, clear the derived caches. Checked once per request from a FastAPI
dependency. Cost is a handful of stat() calls — measured well under a millisecond
against a 92 MB folder, because it never opens a file.

The stamp deliberately includes SIZE as well as mtime: a copy that preserves
timestamps (robocopy /COPY:DAT, some sync tools) changes neither the name nor the
mtime, and serving stale curves after a refresh is the one failure this module
exists to prevent.
"""

from __future__ import annotations

import logging
import threading

from ..config import DATA_DIR
from ..engine import curve_cache
from . import ttl_cache

logger = logging.getLogger(__name__)

# The workbooks the loaders actually read. Globbing the whole folder would also
# pick up the .cache/ pickles the loaders write themselves, and those change as
# a RESULT of a read — the stamp would never settle.
#
# TWO NAMES NOW [OWNER, 2026-08-07]. The simulation's five workbooks were
# deleted; market data comes from this repo's own `irsdata.xlsx` and the BOK
# series from its `bokbaserate.xlsx` (see loaders/irsdata.py, loaders/base_rate.py).
# The old five are gone from this tuple rather than left as harmless misses:
# a watch list naming files the project does not have reads as "these are
# expected", and the next person adds a sixth instead of asking why none of
# them are there.
WATCHED = (
    "irsdata.xlsx",
    "bokbaserate.xlsx",
)

_lock = threading.Lock()
_stamp: tuple | None = None


def current_stamp() -> tuple:
    """(name, mtime_ns, size) per watched workbook that exists, sorted."""
    out = []
    for name in sorted(WATCHED):
        p = DATA_DIR / name
        try:
            st = p.stat()
        except OSError:
            continue  # absent is a legitimate state — see config.require_data_dir
        out.append((name, st.st_mtime_ns, st.st_size))
    return tuple(out)


def check() -> bool:
    """Clear the derived caches if the data folder changed. True if it did.

    First call after startup only records the stamp — there is nothing cached
    yet, so clearing would be theatre.
    """
    global _stamp
    now = current_stamp()
    with _lock:
        if _stamp is None:
            _stamp = now
            return False
        if now == _stamp:
            return False
        changed = {n for n, *_ in now} ^ {n for n, *_ in _stamp} or {
            n for n, m, s in now if (n, m, s) not in set(_stamp)
        }
        _stamp = now
    ttl_cache.clear()
    curve_cache.clear()
    logger.info("data folder changed (%s) — derived caches cleared", ", ".join(sorted(changed)))
    return True


def reset() -> None:
    """Forget the stamp (tests)."""
    global _stamp
    with _lock:
        _stamp = None
