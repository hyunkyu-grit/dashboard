"""On-disk cache for the own-history distributions (Session final Pass D).

The forward-matrix own-history percentiles bootstrap each historical date's
curve once and reprice all 168 forwards (~13s), and the curve heatmap scans
every node's history. That is a one-time computation over a file that changes
once a day, so it should not be paid on every restart.

The cache is keyed by a hash of the source data file. On a hash match the
payload is loaded; on a miss or mismatch it is recomputed and rewritten — and
that recompute is logged LOUDLY, because a cache keyed to the wrong data is
worse than no cache, and this project's recurring defect is silent degradation.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Callable

log = logging.getLogger("sauron.cache")

DEFAULT_CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"


def data_hash(path: Path) -> str:
    """SHA-256 of the source file's bytes — changes iff the data changes."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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
        except (OSError, ValueError, KeyError) as e:
            log.warning("[cache] %s: unreadable (%s), recomputing", name, e)
    else:
        log.warning("[cache] %s: MISSING, computing", name)

    payload = compute()
    Path(cache_dir).mkdir(parents=True, exist_ok=True)
    f.write_text(
        json.dumps({"hash": current_hash, "payload": payload}), encoding="utf-8"
    )
    return payload
