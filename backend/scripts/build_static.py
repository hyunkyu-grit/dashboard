"""Build the static API: read data/irsdata.xlsx, write frontend/public/api/**.

Static conversion, Pass B.

    python backend/scripts/build_static.py

**This runs locally and its output is committed.** It is deliberately not part
of Vercel's build: the curve engine needs QuantLib, a heavy native dependency,
and installing it in the build image is risk with no payoff. Vercel runs
`next build` and nothing else. Updating the data stays the manual rhythm it
already is — re-export the xlsx, run this, commit, push — with a deploy on the
end.

Three properties this script has to have, each for a concrete reason:

**Deterministic.** Sorted keys, no timestamps inside payloads, floats formatted
by the same rounding the API already applies. A rebuild on unchanged data must
produce byte-identical files or every commit shows the whole tree as modified
and the diff stops meaning anything. `test_build_static.py` runs it twice and
compares. The manifest is the single exception and says so in its own field.

**One observation per line.** This is a storage decision, not cosmetics. A
daily update appends one point to each of ~196 histories; as line appends git's
delta compression makes the commit a few KB, and as single-line blobs every
file rewrites whole and each update costs the full ~31 MB — roughly 7.5 GB a
year versus a few MB. See the README.

**Loud about ids.** `app/static_paths.py` refuses any id that cannot round-trip
to a filename, because the failure it guards is silent (Pass A lost 24 files to
NTFS alternate data streams with a clean exit code).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import shutil
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend"))

from app import payloads  # noqa: E402
from app.cache import SCHEMA_VERSION, cached, data_hash  # noqa: E402
from app.curves import build_basis_curves, par_rates_at_index  # noqa: E402
from app.dataset import load_dataset  # noqa: E402
from app.derive import (  # noqa: E402
    basis_dates,
    derived_ids,
    ohlc_buckets,
    series_history,
)
from app.dv01 import build_dv01_table  # noqa: E402
from app.engine_port import (  # noqa: E402
    _KR_HOLIDAYS,
    _is_kr_business_day,
    bootstrap_zero_curve,
)
from app.events import detect_event_clusters  # noqa: E402
from app.forwards import FWD_TENORS, START_POINTS, forwards_payload  # noqa: E402
from app.static_paths import (  # noqa: E402
    FORWARDS_PATH,
    MANIFEST_PATH,
    RESOLUTIONS,
    SUMMARY_PATH,
    VOLATILITY_PATH,
    assert_writable_path,
    dv01_path,
    series_path,
)
from app.staleness import _BEHIND_AT as BEHIND_AT  # noqa: E402
from app.staleness import _STALE_AT as STALE_AT  # noqa: E402
from app.volatility import volatility_payload  # noqa: E402

DATA = REPO / "data" / "irsdata.xlsx"
OUT_ROOT = REPO / "frontend" / "public"

# Arrays written one element per line (see the module docstring). Everything
# else stays compact — only the append-per-day series benefit.
LINE_KEYS = {"points", "bars", "calendar"}

# How many business days past `asof` the manifest's freshness ladder covers.
# 400 ≈ 18 months: long past the point where the badge already says "stale", so
# running off the end is not a correctness question, only a precision one — and
# the client clamps there. Costs ~4 KB.
FRESHNESS_HORIZON = 400


class HolidayCoverageError(RuntimeError):
    """The ladder ran past the calendar that is supposed to define it."""


def _covered_years() -> set[int]:
    """Years for which the KR holiday table actually holds entries."""
    return {d.year for d in _KR_HOLIDAYS}


def _business_days_after(asof: dt.date, n: int) -> list[str]:
    """The next `n` KR business days strictly after `asof`, using the frozen
    engine's own calendar so freshness and the curve can never disagree.

    **Every emitted date is verified to come from a POPULATED calendar year**
    (Pass J). The failure being guarded is specific: if the holiday table ever
    stops covering a year, `_is_kr_business_day` degrades to a weekend-only
    test and the ladder fills with plausible, wrong dates — Chuseok and Seollal
    move with the lunar calendar and cannot be guessed, so the error is
    invisible and lands at the tail where nobody looks. It is the same class as
    the fabricated calendar this project already deleted once.

    Measured (Pass J): today the table is constructed for 2016–2035 and the
    400th business day lands in 2028, ~7.7 years inside it — and `holidays.KR`
    populates further years on demand anyway (probed to 2050: 22 entries,
    lunar dates and substitute holidays correct). So there is no cliff today.
    This asserts that rather than trusting it, because both facts are
    properties of a dependency, not of this code.
    """
    out: list[str] = []
    d = asof
    while len(out) < n:
        d += dt.timedelta(days=1)
        if _is_kr_business_day(d):
            out.append(d.isoformat())

    covered = _covered_years()
    ladder_years = {dt.date.fromisoformat(x).year for x in out}
    uncovered = sorted(ladder_years - covered)
    if uncovered:
        raise HolidayCoverageError(
            f"the business-day ladder reaches {uncovered} but the KR holiday "
            f"table only holds entries for {min(covered)}–{max(covered)}. Those "
            "dates would be weekend-rolls, not business days — silently wrong. "
            "Extend the holiday table or shorten FRESHNESS_HORIZON."
        )
    return out


# ── serialisation ───────────────────────────────────────────────────────────

def _scalar(v) -> str:
    """One JSON scalar, rejecting non-finite floats.

    `allow_nan=False` is the equivalent knob on json.dumps and this reproduces
    it for the hand-rolled path. Python emits bare `NaN`/`Infinity` by default,
    which is not valid JSON and which `response.json()` rejects in the browser —
    a payload that parses everywhere except the one place it is used.
    """
    if isinstance(v, float):
        if not math.isfinite(v):
            raise ValueError(
                f"non-finite float {v!r} reached the serializer — JSON has no "
                "NaN/Infinity; convert it to null upstream"
            )
        # repr() is shortest-round-trip and stable; the API already rounds.
        return repr(v)
    if v is None:
        return "null"
    if v is True:
        return "true"
    if v is False:
        return "false"
    if isinstance(v, int):
        return str(v)
    return json.dumps(v, ensure_ascii=False)


def _compact(v) -> str:
    if isinstance(v, dict):
        return "{" + ",".join(
            f"{json.dumps(k, ensure_ascii=False)}:{_compact(v[k])}"
            for k in sorted(v)
        ) + "}"
    if isinstance(v, (list, tuple)):
        return "[" + ",".join(_compact(x) for x in v) + "]"
    return _scalar(v)


def dumps(obj) -> str:
    """Deterministic JSON: keys sorted at every level, and the top-level arrays
    named in LINE_KEYS written one element per line.

    Only the top level explodes, and only those keys. They are the ones a daily
    update APPENDS to (`points`, `bars`, `calendar`); everything else — summary
    rows, the forward grid — is rewritten wholly every day regardless, so
    spreading it over lines would add bytes and buy no delta.
    """
    if not isinstance(obj, dict):
        return _compact(obj)
    parts = []
    for k in sorted(obj):
        v = obj[k]
        key = json.dumps(k, ensure_ascii=False)
        if k in LINE_KEYS and isinstance(v, list) and v:
            body = ",\n".join(_compact(x) for x in v)
            parts.append(f"{key}:[\n{body}\n]")
        else:
            parts.append(f"{key}:{_compact(v)}")
    return "{" + ",\n".join(parts) + "}"


class Writer:
    def __init__(self, root: Path):
        self.root = root
        self.count = 0
        self.bytes = 0
        self.written: list[str] = []

    def write(self, rel: str, payload) -> None:
        # Validate the FINAL path before touching the filesystem (Pass G). The
        # fixed paths never go through series_path()/dv01_path(), so without
        # this they would be the one unchecked route to the writer.
        assert_writable_path(rel)
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        body = (dumps(payload) + "\n").encode("utf-8")
        p.write_bytes(body)
        self.count += 1
        self.bytes += len(body)
        self.written.append(rel)


class IntegrityError(RuntimeError):
    """The build produced something it cannot vouch for."""


def verify_tree(root: Path, declared: list[str], manifest_rel: str) -> dict:
    """Every declared artifact exists, is non-empty and parses; and the tree
    holds nothing else (Pass G).

    Both directions matter. A MISSING file is the NTFS alternate-data-stream
    bug: `series/vol:1Y.json` wrote a zero-byte `vol` with the content in a
    stream, and an existence check on the wrong name passes. An ORPHAN file is
    the rename bug: an id changes, the new artifact is written, the old one
    stays, and the client keeps resolving a series that no longer exists —
    served happily, quietly wrong.

    Size and parse are checked because existence is not enough: the ADS failure
    leaves a real file of zero bytes, and a truncated write leaves a real file
    that is not JSON.
    """
    problems: list[str] = []

    for rel in declared:
        p = root / rel
        if not p.is_file():
            problems.append(f"MISSING  {rel}")
            continue
        size = p.stat().st_size
        if size == 0:
            problems.append(f"EMPTY    {rel} (0 bytes — an ADS write looks like this)")
            continue
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except (ValueError, OSError) as e:
            problems.append(f"UNPARSED {rel}: {e}")

    on_disk = {
        p.relative_to(root).as_posix()
        for p in (root / "api").rglob("*")
        if p.is_file()
    }
    expected = set(declared) | {manifest_rel}
    for orphan in sorted(on_disk - expected):
        problems.append(f"ORPHAN   {orphan} (on disk, not declared)")
    for absent in sorted(expected - on_disk):
        if f"MISSING  {absent}" not in problems:
            problems.append(f"UNWRITTEN {absent} (declared, not on disk)")

    if problems:
        raise IntegrityError(
            f"{len(problems)} artifact integrity problem(s):\n  "
            + "\n  ".join(problems[:40])
            + ("\n  …" if len(problems) > 40 else "")
        )
    return {"declared": len(declared), "onDisk": len(on_disk)}


# ── the id space, enumerated exactly as ui/rows.ts does ─────────────────────

def series_ids(dataset, fwd, vol) -> list[str]:
    ids = list(dataset.tenor_order)
    ids += [sid for sid, _kind, _legs in derived_ids()]
    for sp in fwd["startPoints"]:
        if sp["label"] == "ON":
            continue  # ON start IS spot; the list never shows it (rows.ts)
        for tenor in fwd["tenors"]:
            clean = tenor.replace("F", "")
            if clean == "SPOT":
                continue  # spot column is the outright; matrix only (rows.ts)
            ids.append(f"{sp['label']}x{clean}")
    ids += [r["id"] for r in vol["rows"]]
    return ids


def build(out_root: Path, quiet: bool = False) -> dict:
    t0 = time.perf_counter()
    say = (lambda *_a: None) if quiet else (lambda *a: print(*a, flush=True))

    dataset = load_dataset(DATA)
    bases = basis_dates(dataset)
    curves = build_basis_curves(dataset)
    events = detect_event_clusters(dataset)
    vol = volatility_payload(dataset, bases)
    dv01_table = build_dv01_table(curves["now"], derived_ids)

    # ONE bootstrap per date, shared by every forward (Pass A: the per-series
    # path costs 1.58s each, so 140 forwards would be 3.7 minutes; the shared
    # pass is 1.5s total and Pass A verified the two agree bit for bit).
    say("  bootstrapping every date once…")
    zcs = [
        bootstrap_zero_curve(p) if len(p) >= 2 else None
        for p in (par_rates_at_index(dataset, i) for i in range(len(dataset.dates)))
    ]

    hash_ = data_hash(DATA)
    fwd = cached("forwards", hash_, lambda: forwards_payload(dataset, curves))

    out = out_root / "api"
    if out.exists():
        shutil.rmtree(out)  # stale files from a removed id must not survive
    w = Writer(out_root)

    w.write(SUMMARY_PATH, payloads.wall_summary(dataset, bases, events))
    w.write(FORWARDS_PATH, fwd)
    w.write(VOLATILITY_PATH, payloads.volatility(dataset, bases, vol))

    ids = series_ids(dataset, fwd, vol)
    say(f"  {len(ids)} series → {len(ids) * (len(RESOLUTIONS) + 1)} files")
    for n, sid in enumerate(ids, 1):
        pairs, unit = payloads.series_pairs(dataset, sid, zcs)
        head = {"id": sid, "asof": dataset.asof.isoformat()}
        for res in RESOLUTIONS:
            if res in ("w", "m"):
                body = {**head, "unit": unit, "interval": res,
                        "bars": ohlc_buckets(pairs, res)}
            else:
                body = {**head, **series_history(pairs, unit, res)}
            w.write(series_path(sid, res), body)
        w.write(dv01_path(sid), dv01_table.get(sid, payloads.empty_dv01(sid)))
        if not quiet and n % 50 == 0:
            say(f"    {n}/{len(ids)}")

    # The manifest is the ONE payload carrying a build time, which is why the
    # determinism test compares every file byte-for-byte and this one with
    # `builtAt` removed. `dataHash` reuses cache.py's scheme (file bytes +
    # SCHEMA_VERSION) rather than inventing a second one — two hashing schemes
    # drift and only one of them ever gets checked.
    #
    # `businessDaysAfter` is how freshness moves to the client without moving
    # the calendar with it. Staleness is a "now" question (Pass A, class (b)),
    # so the browser must compare `asof` against ITS clock — but the comparison
    # counts KR business days, which needs the holiday table, and porting that
    # to TypeScript would be a second copy of a calendar that must never
    # disagree with the curve's. Instead the pipeline emits the answer: the
    # next N business days after `asof`, straight from the frozen engine's own
    # `_is_kr_business_day`. The client counts how many are <= today. Exact,
    # no duplicated logic, ~4 KB.
    ladder = _business_days_after(dataset.asof, FRESHNESS_HORIZON)
    manifest = {
        "asof": dataset.asof.isoformat(),
        "dataHash": hash_,
        "schemaVersion": SCHEMA_VERSION,
        "rows": len(dataset.dates),
        "missingNodes": dataset.missing_nodes,
        "seriesCount": len(ids),
        "businessDaysAfter": ladder,
        "freshnessThresholds": {"behind": BEHIND_AT, "stale": STALE_AT},
        # What calendar produced the ladder, published so the horizon is
        # auditable from the artifact rather than only from the build log
        # (Pass J). `constructedThrough` is the last year the table is built
        # for at import; `holidays.KR` populates beyond it on demand, which is
        # why `ladderThrough` can legitimately exceed it.
        "holidayCoverage": {
            "constructedThrough": max(_covered_years()),
            "ladderThrough": ladder[-1],
            "ladderDays": len(ladder),
        },
        # Every artifact this build claims to have written, so integrity is
        # checkable against a declaration rather than against the tree's own
        # opinion of itself (Pass G). The manifest is not in its own list — it
        # is the thing doing the declaring — and verify_tree accounts for that
        # explicitly rather than fudging the count by one.
        "artifacts": sorted(w.written),
        "artifactCount": len(w.written),
        "builtAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
    }
    declared = list(w.written)
    w.write(MANIFEST_PATH, manifest)

    # Verify AFTER writing, against what the manifest declares. Existence alone
    # is not enough: the NTFS alternate-data-stream failure leaves a real file
    # of zero bytes, so size and parse are both checked, in both directions.
    counts = verify_tree(out_root, declared, MANIFEST_PATH)
    say(f"  integrity: {counts['declared']} declared, {counts['onDisk']} on disk, 0 problems")

    secs = time.perf_counter() - t0
    say(f"\n  {w.count} files, {w.bytes / 1e6:.2f} MB raw, {secs:.1f}s")
    say(f"  asof {dataset.asof}  ({len(dataset.dates)} observations)")
    return {"files": w.count, "bytes": w.bytes, "seconds": secs, "ids": ids}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, default=OUT_ROOT,
                    help="output root (default: frontend/public)")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    print(f"building static API from {DATA.name} → {a.out}")
    build(a.out, quiet=a.quiet)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
