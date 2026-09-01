"""Guard: `backend/app/` must not import from `backend/research/`.

Research reads the application. The application must never read research —
otherwise a shadow implementation becomes a production dependency by accident,
which is precisely what "shadow only" is meant to prevent.

The check is textual and deliberately blunt: any mention of `research` in an
import statement under `app/` (or `irs_pricer/`) fails.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
PRODUCTION_TREES = ("app", "irs_pricer", "bigfoot", "wiring")

_IMPORT_RE = re.compile(
    r"^\s*(?:from\s+(?P<from>[.\w]+)\s+import|import\s+(?P<imp>[.\w, ]+))",
    re.MULTILINE,
)


def production_files() -> list[Path]:
    out: list[Path] = []
    for tree in PRODUCTION_TREES:
        root = BACKEND / tree
        if root.exists():
            out.extend(sorted(root.rglob("*.py")))
    return out


def test_there_are_production_files_to_check():
    """A guard that silently checks nothing is worse than no guard."""
    files = production_files()
    assert len(files) > 50, f"only found {len(files)} production files — path wrong?"


@pytest.mark.parametrize("path", production_files(), ids=lambda p: str(p.name))
def test_production_module_does_not_import_research(path: Path):
    src = path.read_text(encoding="utf-8", errors="replace")
    offenders = []
    for m in _IMPORT_RE.finditer(src):
        target = (m.group("from") or m.group("imp") or "")
        if re.search(r"\bresearch\b", target):
            line = src[: m.start()].count("\n") + 1
            offenders.append(f"{path.name}:{line}  {m.group(0).strip()}")
    assert not offenders, (
        "backend/app must not depend on backend/research:\n  " + "\n  ".join(offenders)
    )
