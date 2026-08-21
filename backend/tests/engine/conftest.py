# -*- coding: utf-8 -*-
"""Session-finish hook: stamp output/engine_status.json (Phase 6a.1).

The hub's 엔진 상태 card reads this contract; the hub itself never runs
tests or git (read-only rule). The stamp is written only after a
FULL-suite green run (>= 5 distinct test files collected, zero failures)
so a scoped `pytest tests/test_x.py` can never publish a misleading
count.
"""
import json
import subprocess
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "output"
MIN_FILES_FOR_STAMP = 5


def _git_describe() -> str:
    try:
        return subprocess.check_output(
            ["git", "describe", "--tags", "--always"], cwd=ROOT,
            stderr=subprocess.DEVNULL).decode().strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def pytest_terminal_summary(terminalreporter, exitstatus, config):
    stats = terminalreporter.stats
    passed = len(stats.get("passed", []))
    failed = len(stats.get("failed", [])) + len(stats.get("error", []))
    skipped = len(stats.get("skipped", []))
    total = passed + failed + skipped
    files = {r.nodeid.split("::")[0] for r in stats.get("passed", [])}
    if failed or len(files) < MIN_FILES_FOR_STAMP:
        return                      # partial or red run: never stamp
    irf = {}
    try:
        irf = json.loads((OUT / "irf_summary.json").read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        pass
    head = irf.get("headline", {})
    stamp = {
        "module": "engine_status",
        "as_of": date.today().isoformat(),
        "current_tag": _git_describe(),
        "tests_passed": passed,
        "tests_total": total,
        "scorecard": {"passed": head.get("passed"),
                      "total": head.get("total"),
                      "waiver": 1 if irf.get("waiver") else 0},
        "active_flags_count": len(irf.get("caveats", [])),
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "engine_status.json").write_text(
        json.dumps(stamp, indent=2, ensure_ascii=False), encoding="utf-8")
