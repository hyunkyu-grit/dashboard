# -*- coding: utf-8 -*-
"""Repo hygiene guard (post-purge, 2026-08-05): company/raw data must
never be TRACKED — this class of accident becomes a red build, not a git
archaeology session.

Banned in the index:
  - anything under data/<subdir>/raw/  (the company-data drop convention,
    e.g. data/krwswapdata/raw/)
  - quote-export patterns anywhere under data/: *.xls, *.xlsx, *.xlsm
  - anything under data/krwswapdata/ at all (only derived stats in
    output/ are committable)

DELIBERATE EXEMPTION: data/raw/*.csv — the ECOS/FRED public-source API
caches (BOK official statistics; the offline-fallback design since
Phase 1). Company exports are never csv-cached there; if the owner wants
data/raw/ banned outright, tighten BANNED_RE and migrate the caches.
"""
import re
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

ROOT = Path(__file__).resolve().parents[2]

BANNED_RE = [
    re.compile(r"^data/[^/]+/raw/", re.I),      # data/<x>/raw/** drop dirs
    re.compile(r"^data/.*\.xls[xm]?$", re.I),   # quote exports under data/
    re.compile(r"^data/krwswapdata/", re.I),    # company area entirely
]


def _tracked_files() -> list:
    out = subprocess.check_output(["git", "ls-files"], cwd=ROOT)
    return out.decode("utf-8", errors="replace").splitlines()


def test_no_company_raw_data_tracked():
    offenders = [f for f in _tracked_files()
                 if any(rx.search(f) for rx in BANNED_RE)]
    assert not offenders, (
        "company/raw data tracked in git — remove from the index and, if "
        f"already committed, purge history (see phase_history_map.md): "
        f"{offenders}")


def test_purge_verification_holds():
    """RETIRED IN THIS REPO 2026-08-21 — the subject does not exist here.

    In BIGFOOT this asserted that the 2026-08-05 history purge stayed
    purged: no object path in ANY revision matched the export filename or
    an `.xlsx` suffix. That claim is **about BIGFOOT's git history**, and
    the migration deliberately did not copy that history (only the source
    at f888201). sauron-v2's own history legitimately contains `.xlsx`
    (`data/irsdata.xlsx`, `data/bokbaserate.xlsx` — the app's workbooks),
    so the assertion is not merely unprovable here, it is FALSE for
    reasons that have nothing to do with company data.

    What still has a subject is `test_no_company_raw_data_tracked` above,
    which reads the live index rather than history. That one carries the
    intent now, and it is scoped to the engine's own footprint below.

    The history assertion stays live in BIGFOOT's own tree. Do not
    "restore" it here — a green version of it in this repo would have to
    be so weakened that it proves nothing.
    """
    pytest.skip("BIGFOOT git history was not migrated; see docstring")


def test_engine_footprint_carries_no_company_data():
    """The migrated engine's own directories, checked file by file.

    `test_no_company_raw_data_tracked` reads BANNED_RE against the whole
    index, which is the right net for path SHAPES. This one is narrower and
    concrete: walk what the migration actually put on disk under the
    engine's four directories and refuse anything that is not a public-API
    cache or source. It exists because the migration copied
    `data/krwswapdata/` onto this machine (the engine's IRS satellite reads
    it) and nothing in this repo's .gitignore covered that path until the
    rule was added on 2026-08-21.
    """
    tracked = set(_tracked_files())
    engine_dirs = ("bigfoot/", "config/", "data/", "output/")
    suspect = [f for f in tracked
               if f.startswith(engine_dirs)
               and (f.lower().endswith((".xlsx", ".xls", ".xlsm", ".parquet"))
                    or "krwswapdata" in f.lower())]
    assert not suspect, (
        "company/terminal data tracked under the migrated engine: "
        f"{suspect}")
