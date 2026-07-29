"""Series id → static file path. One rule, stated once, used by both sides.

Static conversion, Pass B. This module exists because of a hazard Pass A found
by measuring rather than assuming (docs/diagnostics/static-feasibility.md §3):

    `vol:1Y` contains a colon. On NTFS a colon is the alternate-data-stream
    separator, so writing `series/vol:1Y.json` does NOT create that file and
    does NOT raise — it creates a zero-byte file named `vol` and hides the
    content in a stream. The prototype lost all 24 volatility artefacts that
    way, with a clean exit code.

And even on Linux, where the colon is a legal filename character, the frontend
sends `encodeURIComponent("vol:1Y")` = `vol%3A1Y`, so the request path and a
literally-named file disagree anyway.

**The rule: `:` becomes `/`.** The colon in `vol:1Y` is already a namespace
separator, so a directory is what it always meant — `series/vol/1Y.full.json`.
No escaping, no percent-encoding, legal on both platforms, readable in a
directory listing, and no id can collide with another by construction (a
`vol:` id lands in its own directory; nothing else does).

Nothing here interpolates an id into a path without going through `slug()`,
and `slug()` refuses anything it does not recognise. Silence was the whole
problem; a KeyError is the fix.
"""

from __future__ import annotations

import re

# Everything an id may contain AFTER the colon rule has been applied. Letters,
# digits, dot (1.5Y), dash (spread/fly legs), slash (the mapped colon).
_SAFE = re.compile(r"[A-Za-z0-9./-]+")

# Characters that are illegal, reserved, or meaning-bearing on Windows, plus
# the ones a URL would have to escape. Listed explicitly so a future id
# containing one fails here rather than in a directory listing nobody reads.
_HOSTILE = set('<>:"\\|?*%#&+ ')

RESOLUTIONS = ("full", "preview", "w", "m")


class UnsafeId(ValueError):
    """An id that cannot round-trip to a filename. Raised loudly on purpose."""


def slug(series_id: str) -> str:
    """Filename stem for a series id. Raises `UnsafeId` rather than producing
    something that silently means a different file."""
    if not series_id:
        raise UnsafeId("empty series id")
    mapped = series_id.replace(":", "/")
    bad = sorted(set(mapped) & _HOSTILE)
    if bad:
        raise UnsafeId(
            f"id {series_id!r} maps to {mapped!r}, which contains "
            f"{bad} — unsafe as a filename or a URL path"
        )
    if not _SAFE.fullmatch(mapped):
        raise UnsafeId(
            f"id {series_id!r} maps to {mapped!r}, which is outside the "
            "allowed set [A-Za-z0-9./-]"
        )
    if mapped.startswith("/") or mapped.endswith("/") or "//" in mapped:
        raise UnsafeId(f"id {series_id!r} maps to a malformed path {mapped!r}")
    if ".." in mapped:
        raise UnsafeId(f"id {series_id!r} maps to a traversing path {mapped!r}")
    return mapped


def series_path(series_id: str, res: str) -> str:
    """`/api/series/…` path for one resolution. `res` is full | preview | w | m.

    The resolution rides in the FILENAME, not a query string: a static host
    cannot select a file by `?res=`. `1.5Y` contains a dot and that is fine —
    the suffix is always appended, never parsed off, so there is nothing to
    disambiguate.
    """
    if res not in RESOLUTIONS:
        raise UnsafeId(f"unknown resolution {res!r}; expected one of {RESOLUTIONS}")
    return f"api/series/{slug(series_id)}.{res}.json"


def dv01_path(series_id: str) -> str:
    return f"api/dv01/{slug(series_id)}.json"


# Fixed paths, mirroring the live endpoints with a `.json` suffix.
SUMMARY_PATH = "api/wall/summary.json"
FORWARDS_PATH = "api/forwards.json"
VOLATILITY_PATH = "api/volatility.json"
MANIFEST_PATH = "api/manifest.json"
