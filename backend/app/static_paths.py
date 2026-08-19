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

# Characters that must never appear in a path handed to the writer. This is the
# LAST line, checked on the finished relative path rather than on the id, so it
# catches a path assembled by some future caller that skipped `slug()`.
_PATH_FORBIDDEN = set(':?*|<>"\\') | {chr(c) for c in range(32)}

# Windows reserves these as device names in EVERY directory, with or without an
# extension: `series/CON.json` is not a file. ext4 does not care, so this is
# another Windows-only trap of the same family as the colon — it would pass
# review, pass on Linux CI, and fail on the machine that builds the data.
_RESERVED_STEMS = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class UnsafeId(ValueError):
    """An id that cannot round-trip to a filename. Raised loudly on purpose."""


class UnsafePath(ValueError):
    """A derived path that is not legal on both NTFS and ext4."""


def assert_writable_path(rel: str) -> str:
    """Refuse any path that is not legal on BOTH NTFS and ext4 (Pass G).

    Checked on the finished path, immediately before writing, because that is
    the only place that sees what actually reaches the filesystem. `slug()`
    guards the id; this guards the path, and the two are not the same check —
    the NTFS alternate-data-stream bug happened at the WRITE, where a colon
    turned `series/vol:1Y.json` into a zero-byte file named `vol` with the
    content hidden in a stream, no error, exit 0.

    It never sanitises. A silent rename would desynchronise the file from the
    id in the manifest, which is a worse bug than the one being prevented: the
    build would succeed and the client would 404 on exactly one instrument.
    """
    if not rel or rel.startswith("/") or rel.endswith("/"):
        raise UnsafePath(f"malformed path {rel!r}")
    if "\\" in rel:
        raise UnsafePath(f"{rel!r} uses a backslash; paths are posix-style")
    for segment in rel.split("/"):
        if not segment:
            raise UnsafePath(f"{rel!r} has an empty path segment")
        if segment in (".", ".."):
            raise UnsafePath(f"{rel!r} traverses")
        bad = sorted(set(segment) & _PATH_FORBIDDEN)
        if bad:
            shown = [repr(c) for c in bad]
            raise UnsafePath(
                f"segment {segment!r} of {rel!r} contains {', '.join(shown)} — "
                "illegal on NTFS (a colon opens an alternate data stream, "
                "which fails SILENTLY) and unsafe in a URL path"
            )
        if segment[-1] in " .":
            raise UnsafePath(
                f"segment {segment!r} of {rel!r} ends in a space or dot; "
                "Windows strips those on create, so the file written would not "
                "be the file requested"
            )
        stem = segment.split(".", 1)[0].upper()
        if stem in _RESERVED_STEMS:
            raise UnsafePath(
                f"segment {segment!r} of {rel!r} uses the reserved Windows "
                f"device name {stem}; it is not a file on NTFS"
            )
    return rel


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
    return assert_writable_path(f"api/series/{slug(series_id)}.{res}.json")


def dv01_path(series_id: str) -> str:
    return assert_writable_path(f"api/dv01/{slug(series_id)}.json")


# Fixed paths, mirroring the live endpoints with a `.json` suffix.
SUMMARY_PATH = "api/wall/summary.json"
FORWARDS_PATH = "api/forwards.json"
VOLATILITY_PATH = "api/volatility.json"
SURFACE_PATH = "api/surface.json"
MANIFEST_PATH = "api/manifest.json"
