"""The static build pipeline (Pass B).

Four things are pinned here, each because getting it wrong fails quietly:

  determinism  — a rebuild on unchanged data must be byte-identical, or every
                 commit shows the whole tree as modified and diffs stop meaning
                 anything.
  ids          — an id that cannot round-trip to a filename must RAISE. On NTFS
                 a colon silently redirects the write into an alternate data
                 stream; Pass A lost 24 files that way with a clean exit code.
  non-finite   — Python emits bare NaN by default, which is not valid JSON and
                 which response.json() rejects in the browser: a payload that
                 parses everywhere except where it is used.
  gaps         — a missing observation is an ABSENT POINT, not a null and not a
                 NaN. That is the live behaviour and the static build keeps it.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / "backend" / "scripts"))

import build_static as B  # noqa: E402

from app.dataset import load_dataset  # noqa: E402
from app.static_paths import UnsafeId, dv01_path, series_path, slug  # noqa: E402

DATA = REPO / "data" / "irsdata.xlsx"


# ── ids → filenames ─────────────────────────────────────────────────────────

def test_ordinary_ids_pass_through_unchanged():
    for sid in ["1Y", "10Y", "1.5Y", "1Y-10Y", "2Y-5Y-10Y", "6Mx3M", "4Y6Mx2Y"]:
        assert slug(sid) == sid


def test_the_colon_becomes_a_directory():
    """The rule, stated as a test. `vol:` is already a namespace, so a
    directory is what the colon always meant."""
    assert slug("vol:1Y") == "vol/1Y"
    assert slug("vol:1.5Y") == "vol/1.5Y"
    assert series_path("vol:10Y", "full") == "api/series/vol/10Y.full.json"
    assert dv01_path("vol:10Y") == "api/dv01/vol/10Y.json"


def test_the_resolution_rides_in_the_filename():
    # a static host cannot select a file by ?res=
    assert series_path("10Y", "full") == "api/series/10Y.full.json"
    assert series_path("10Y", "preview") == "api/series/10Y.preview.json"
    assert series_path("10Y", "w") == "api/series/10Y.w.json"
    # a dot inside the id is fine: the suffix is appended, never parsed off
    assert series_path("1.5Y", "m") == "api/series/1.5Y.m.json"


@pytest.mark.parametrize("bad", [
    "a b",        # space
    "a?b",        # URL query
    "a%2Fb",      # pre-encoded
    "a\\b",       # windows separator
    "a|b", "a*b", "a<b", 'a"b',
    "..", "../etc/passwd",
    "/leading", "trailing/",
    "",
])
def test_an_id_that_cannot_round_trip_raises(bad):
    """Loudly, not silently. This is the whole point of the module."""
    with pytest.raises(UnsafeId):
        slug(bad)


def test_an_unknown_resolution_raises():
    with pytest.raises(UnsafeId):
        series_path("10Y", "daily")


# ── serialisation ───────────────────────────────────────────────────────────

def test_non_finite_floats_are_refused():
    for v in (float("nan"), float("inf"), float("-inf")):
        with pytest.raises(ValueError, match="non-finite"):
            B.dumps({"points": [{"t": "2026-01-01", "v": v}]})


def test_nulls_are_ordinary_and_survive():
    # deltas/basisValues/range1y carry None legitimately — null is correct JSON
    out = B.dumps({"a": None, "b": {"c": None}})
    assert json.loads(out) == {"a": None, "b": {"c": None}}


def test_keys_are_sorted_at_every_level():
    out = B.dumps({"z": 1, "a": {"z": 1, "a": 2}})
    assert out.index('"a"') < out.index('"z"')
    assert json.loads(out) == {"z": 1, "a": {"z": 1, "a": 2}}


def test_series_arrays_are_one_observation_per_line():
    """A storage decision: as line appends a daily update is a few KB of git
    delta; as one long line every file rewrites whole, ~31 MB per update."""
    body = B.dumps({
        "id": "10Y",
        "points": [{"t": "2026-01-01", "v": 1.0, "d": None},
                   {"t": "2026-01-02", "v": 1.1, "d": 10.0}],
    })
    assert '{"d":null,"t":"2026-01-01","v":1.0},\n{"d":10.0' in body
    assert json.loads(body)["points"][1]["v"] == 1.1


def test_only_the_append_arrays_explode():
    # summary rows are rewritten wholly every day; spreading them costs bytes
    # and buys no delta
    body = B.dumps({"outrights": [{"id": "1Y"}, {"id": "2Y"}]})
    assert "\n" not in body


# ── the pipeline end to end ─────────────────────────────────────────────────

@pytest.fixture(scope="module")
def two_builds(tmp_path_factory):
    """Run the whole pipeline twice into separate trees."""
    a = tmp_path_factory.mktemp("build_a")
    b = tmp_path_factory.mktemp("build_b")
    B.build(a, quiet=True)
    B.build(b, quiet=True)
    return a, b


def test_the_build_is_deterministic(two_builds):
    a, b = two_builds
    fa = sorted(p.relative_to(a).as_posix() for p in a.rglob("*") if p.is_file())
    fb = sorted(p.relative_to(b).as_posix() for p in b.rglob("*") if p.is_file())
    assert fa == fb, "the two builds produced different file sets"

    differing = []
    for rel in fa:
        x, y = (a / rel).read_bytes(), (b / rel).read_bytes()
        if x == y:
            continue
        if rel.endswith("manifest.json"):
            # the ONE payload carrying a build time, by design; compare the rest
            jx, jy = json.loads(x), json.loads(y)
            jx.pop("builtAt"), jy.pop("builtAt")
            if jx == jy:
                continue
        differing.append(rel)
    assert differing == [], f"non-deterministic output: {differing[:10]}"


def test_every_emitted_file_is_valid_json(two_builds):
    a, _ = two_builds
    for p in a.rglob("*.json"):
        json.loads(p.read_text(encoding="utf-8"))  # raises on NaN


def test_a_known_gap_is_an_absent_point_not_a_null(two_builds):
    """The history has blanks — the loader reports 9 for 1D and 10 for 3M. A
    blank must produce NO point, matching the live API. A null would render as
    a gap in the chart; a NaN would not parse at all."""
    a, _ = two_builds
    ds = load_dataset(DATA)
    gaps = {
        tenor: [d for d, v in zip(ds.dates, ds.series[tenor]) if v is None]
        for tenor in ("1D", "3M")
    }
    assert any(gaps.values()), "expected the fixture data to contain blanks"

    for tenor, missing in gaps.items():
        if not missing:
            continue
        body = json.loads((a / series_path(tenor, "full")).read_text("utf-8"))
        got = {p["t"] for p in body["points"]}
        for d in missing:
            assert d.isoformat() not in got, (
                f"{tenor}: blank {d} was emitted as a point"
            )
        # and the surrounding series is intact, not truncated at the gap
        assert len(body["points"]) == len(ds.dates) - len(missing)


def test_the_manifest_reuses_the_existing_hash_scheme(two_builds):
    """Not a second scheme: two hashing schemes drift and only one gets
    checked. cache.py's data_hash is file bytes + SCHEMA_VERSION."""
    from app.cache import SCHEMA_VERSION, data_hash

    a, _ = two_builds
    m = json.loads((a / "api" / "manifest.json").read_text("utf-8"))
    assert m["dataHash"] == data_hash(DATA)
    assert m["dataHash"].endswith(f":v{SCHEMA_VERSION}")
    assert m["schemaVersion"] == SCHEMA_VERSION
    assert m["asof"] == load_dataset(DATA).asof.isoformat()


def test_a_removed_id_does_not_leave_a_stale_file(tmp_path):
    """The output tree is cleared before writing. Without that, renaming or
    dropping a series leaves a file that still resolves — the frontend would
    keep working and keep serving data for something that no longer exists."""
    out = tmp_path / "pub"
    (out / "api" / "series").mkdir(parents=True)
    ghost = out / "api" / "series" / "GHOST.full.json"
    ghost.write_text('{"stale":true}', encoding="utf-8")
    B.build(out, quiet=True)
    assert not ghost.exists()
