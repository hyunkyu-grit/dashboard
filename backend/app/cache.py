"""On-disk cache for the own-history distributions (Session final Pass D).

The forward-matrix own-history percentiles bootstrap each historical date's
curve once and reprice all 168 forwards (~13s), and the curve heatmap scans
every node's history. That is a one-time computation over a file that changes
once a day, so it should not be paid on every restart.

The cache is keyed by a hash of the source data file PLUS a schema version.
On a match the payload is loaded; on a miss or mismatch it is recomputed and
rewritten — and that recompute is logged LOUDLY, because a cache keyed to the
wrong data is worse than no cache, and this project's recurring defect is
silent degradation.

SCHEMA_VERSION exists because the trap fired (annual-stats session): the
forwards payload's `range10y` was renamed `range1y`, the DATA had not
changed, and the disk cache silently served the old shape to new frontend
code. Bump it whenever a cached payload's SHAPE changes.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from pathlib import Path
from typing import Callable

log = logging.getLogger("sauron.cache")

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"

# Bump on ANY change to a cached payload's shape (field renames included).
SCHEMA_VERSION = 2  # 2 = range1y (annual-stats session)


def data_hash(path: Path) -> str:
    """SHA-256 of the source file's bytes + the payload schema version —
    changes iff the data OR the cached payloads' shape changes."""
    digest = hashlib.sha256(Path(path).read_bytes()).hexdigest()
    return f"{digest}:v{SCHEMA_VERSION}"


def cached(
    name: str,
    current_hash: str,
    compute: Callable[[], object],
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> object:
    """Return the cached payload for `name` if its stored hash matches
    `current_hash`; otherwise compute, persist, and return it. Loud on miss."""
    f = Path(cache_dir) / f"{name}.json"
    if f.exists():
        try:
            blob = json.loads(f.read_text(encoding="utf-8"))
            if blob.get("hash") == current_hash:
                log.info("[cache] %s: loaded from disk (hash match)", name)
                return blob["payload"]
            log.warning(
                "[cache] %s: STALE — source data changed, recomputing", name
            )
        # AttributeError/TypeError are in here for a reason: a file holding
        # valid JSON that is not an object (`[1,2,3]`, `null`) has no `.get`,
        # and that used to escape as a crash on startup rather than a
        # recompute. Every unreadable cache must degrade the same way.
        except (OSError, ValueError, KeyError, AttributeError, TypeError) as e:
            log.warning("[cache] %s: unreadable (%s), recomputing", name, e)
    else:
        log.warning("[cache] %s: MISSING, computing", name)

    payload = compute()
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    # Write through a temp file and rename. A direct write that dies partway
    # leaves a half file which the next start recovers from — correctly, but
    # only after paying the full recompute. os.replace is atomic on both
    # POSIX and Windows, so a killed process leaves either the old file or
    # the new one, never a torn one.
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"hash": current_hash, "payload": payload}), encoding="utf-8"
    )
    os.replace(tmp, f)
    return payload
