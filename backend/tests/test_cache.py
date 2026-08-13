"""On-disk own-history cache (Session final Pass D): a changed source file must
invalidate the cache."""

import logging
from pathlib import Path

import pytest

from app.cache import cached, data_hash


def test_hash_matches_loads_mismatch_recomputes(tmp_path):
    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": calls["n"]}

    # miss → compute
    a = cached("dist", "hashA", compute, cache_dir=tmp_path)
    assert a == {"v": 1} and calls["n"] == 1
    # same hash → load from disk, no recompute
    b = cached("dist", "hashA", compute, cache_dir=tmp_path)
    assert b == {"v": 1} and calls["n"] == 1
    # changed source (new hash) → recompute + rewrite
    c = cached("dist", "hashB", compute, cache_dir=tmp_path)
    assert c == {"v": 2} and calls["n"] == 2


def test_data_hash_changes_with_content(tmp_path):
    f = tmp_path / "data.bin"
    f.write_bytes(b"one")
    h1 = data_hash(f)
    f.write_bytes(b"two")
    h2 = data_hash(f)
    assert h1 != h2
    assert data_hash(f) == h2  # stable for unchanged content


def test_data_hash_separates_days_for_the_same_bytes(tmp_path):
    """전일종가 rule (v7): the same file re-read after midnight yields a
    different dataset (the intraday row it dropped is now a past close), so
    cache keys must carry the effective asof, not the bytes alone."""
    import datetime as dt

    f = tmp_path / "data.bin"
    f.write_bytes(b"one")
    a = data_hash(f, dt.date(2026, 8, 4))
    b = data_hash(f, dt.date(2026, 8, 5))
    assert a != b
    assert a == data_hash(f, dt.date(2026, 8, 4))
    assert data_hash(f) != a  # the bytes-only form is a different key space


def test_real_data_file_hash_is_stable():
    data = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
    assert data_hash(data) == data_hash(data)


# ── a cache file the process died halfway through writing ──────────────────
# Pass A found this already correct (failure-modes.md §3) and said a
# regression test was worth having. "Correct" here means one thing: an
# unreadable cache is a slow start, never a failed one. The danger being
# guarded is not the corruption — it is someone tightening the except clause
# later and turning a recompute back into a crash on startup.


@pytest.mark.parametrize(
    "corruption, why",
    [
        ('{"hash": "hashA", "pay', "truncated mid-write"),
        ("", "zero bytes — file created, nothing flushed"),
        ('{"hash": "hashA"}', "valid JSON, no payload key"),
        ("[1, 2, 3]", "valid JSON, not an object"),
        ("null", "valid JSON, nothing at all"),
        ("\x00\x00\x00", "binary garbage"),
    ],
)
def test_half_written_cache_recomputes_and_says_so(tmp_path, caplog, corruption, why):
    (tmp_path / "dist.json").write_text(corruption, encoding="utf-8")

    calls = {"n": 0}

    def compute():
        calls["n"] += 1
        return {"v": "fresh"}

    with caplog.at_level(logging.WARNING, logger="sauron.cache"):
        got = cached("dist", "hashA", compute, cache_dir=tmp_path)

    assert got == {"v": "fresh"}, why
    assert calls["n"] == 1
    assert any("unreadable" in r.message for r in caplog.records)
    # and the bad file is replaced, so the next start is fast again
    assert cached("dist", "hashA", compute, cache_dir=tmp_path) == {"v": "fresh"}
    assert calls["n"] == 1


def test_the_write_is_atomic_so_no_half_file_is_left_behind(tmp_path):
    """The recovery above costs a full recompute. Writing through a temp file
    and renaming means a killed process leaves the OLD file or the NEW one,
    never a torn one."""
    cached("dist", "hashA", lambda: {"v": 1}, cache_dir=tmp_path)
    assert (tmp_path / "dist.json").exists()
    assert not list(tmp_path.glob("*.tmp"))
