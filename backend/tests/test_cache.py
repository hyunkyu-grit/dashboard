"""On-disk own-history cache (Session final Pass D): a changed source file must
invalidate the cache."""

from pathlib import Path

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


def test_real_data_file_hash_is_stable():
    data = Path(__file__).resolve().parents[2] / "data" / "irsdata.xlsx"
    assert data_hash(data) == data_hash(data)
