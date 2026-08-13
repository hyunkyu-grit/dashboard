"""
Where this deployment's Excel data files live.

The workbooks sit OUTSIDE the code -- in the project's `data/` folder -- because
they are data, not code. xlsx is already-compressed, so git would store a fresh
full copy of a 40 MB workbook on every refresh; `data/` is git-ignored and its
lifecycle is the owner's, separate from the code's.

DEVIATION from the frozen source: it resolved to a `Data/` folder SIBLING to the
backend checkout (shared with a separate frontend repo). This project is one
tree, so the default is `<project>/data` -- two levels up from this file, not
one. The refresh workflow also changed: there is no upload endpoint here, the
owner drops workbooks in directly, and core/data_watch.py notices and clears the
caches derived from them.

IRS_PRICER_DATA_DIR, if set, overrides the default -- the escape hatch for a
deployment whose data doesn't sit next to the checkout.

This module never touches the disk at import: resolving DATA_DIR is pure
computation. That matters because a fresh clone has no data/ yet and the app
must still boot (so it can report the absence). Call require_data_dir() at the
point of use instead.
"""

from __future__ import annotations

import os
from pathlib import Path

# irs_pricer/config.py -> irs_pricer/ -> backend/ -> project root
REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_DATA_DIR = REPO_ROOT / "data"

_ENV_VAR = "IRS_PRICER_DATA_DIR"


class DataDirNotFoundError(RuntimeError):
    """The resolved data directory doesn't exist.

    Raised only from require_data_dir(). The message names both the path we
    looked in and the env var, because the alternative failure modes are
    genuinely hard to diagnose: base_rate/call_rate return None for a missing
    file *by design* (absence is a legitimate state), so a wrong directory
    otherwise renders as a silently blank chart rather than an error.
    """

    def __init__(self, path: Path) -> None:
        super().__init__(
            f"데이터 폴더를 찾을 수 없습니다: {path}\n"
            f"엑셀 워크북을 이 폴더에 넣거나, 다른 폴더를 {_ENV_VAR} 환경변수로 지정하세요."
        )


def _resolve_data_dir() -> Path:
    env_dir = os.environ.get(_ENV_VAR)
    if env_dir:
        return Path(env_dir).expanduser()
    return DEFAULT_DATA_DIR


DATA_DIR = _resolve_data_dir()


def require_data_dir(path: Path | None = None) -> Path:
    """The data directory, or DataDirNotFoundError if it isn't there.

    Call this before reaching for a data file in a code path where a missing
    directory means misconfiguration rather than "the user hasn't uploaded
    that optional workbook yet".
    """
    target = DATA_DIR if path is None else path
    if not target.is_dir():
        raise DataDirNotFoundError(target)
    return target
