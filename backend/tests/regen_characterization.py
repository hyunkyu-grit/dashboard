# -*- coding: utf-8 -*-
"""Regenerate `tests/data/backtest_characterization.json`.

    python -m tests.regen_characterization

Run this ONLY when a change's effect on backtest output is intended and
understood. The `git diff` it produces IS the change, expressed in numbers —
read it before committing. Never run it to turn a red pin green; that deletes
the only evidence the pin exists to preserve.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tests.test_backtest_characterization import FIXTURE, build_expected  # noqa: E402


def main() -> None:
    payload = build_expected()
    FIXTURE.parent.mkdir(parents=True, exist_ok=True)
    # sort_keys so a regeneration diffs as value changes, never as reordering.
    # newline="\n" is load-bearing on Windows: the default translates to CRLF,
    # git normalises the committed copy to LF, and the next regeneration would
    # then diff as EVERY line changed — which would hide the handful of numbers
    # that actually moved, i.e. the one thing this tool exists to show.
    FIXTURE.write_text(
        json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    n_pts = len(payload["backtest"]["points"])
    n_rows = len(payload["recon"]["rows"])
    n_raw = len(payload["raw"])
    print(f"wrote {FIXTURE}")
    print(f"  backtest: {n_pts} points, {len(payload['backtest']['positions'])} positions")
    print(f"  recon   : {n_rows} rows")
    print(f"  raw     : {n_raw} float64 values")


if __name__ == "__main__":
    main()
